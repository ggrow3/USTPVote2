import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Collections,
  COURSE_CONVERSATION_LIMIT,
  courseThreadId,
  uuidv7,
  type AccountRecord,
  type CourseAttemptRecord,
  type CourseCertificateRecord,
  type CourseConversation,
  type CourseLearnerRow,
  type CourseMessageRecord,
  type CourseMessageSender,
  type CourseProgressRecord,
  type CourseThreadRecord,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';
import { CourseService } from './course.service.js';

/**
 * A course's learners as its Course Administrators see them, and each learner's conversation with the instructors
 * (design §10.8). The instructors are the Course Administrators, for every course; a learner may write only while a
 * Course Administrator has turned messaging on for them in that course.
 */
@Injectable()
export class CourseLearnersService {
  constructor(
    private readonly firebase: Firebase,
    private readonly courses: CourseService,
  ) {}

  /**
   * Everyone who has tried a quiz in the course, or whose messaging a Course Administrator has switched, with how they
   * stand: those with a message waiting first, then the most recently active.
   */
  async learners(courseId: string): Promise<readonly CourseLearnerRow[]> {
    await this.courses.record(courseId);
    const db = this.firebase.db;
    const [progressSnap, attemptsSnap, certificatesSnap, threadsSnap] = await Promise.all([
      db.collection(Collections.courseProgress).where('courseId', '==', courseId).get(),
      db.collection(Collections.courseAttempts).where('courseId', '==', courseId).select('accountId', 'attemptedAt').get(),
      db.collection(Collections.courseCertificates).where('courseId', '==', courseId).get(),
      db.collection(Collections.courseThreads).where('courseId', '==', courseId).get(),
    ]);
    const progress = byAccount(progressSnap.docs.map((doc) => doc.data() as CourseProgressRecord));
    const certificates = byAccount(certificatesSnap.docs.map((doc) => doc.data() as CourseCertificateRecord));
    const threads = byAccount(threadsSnap.docs.map((doc) => doc.data() as CourseThreadRecord));
    const attempts = new Map<string, { count: number; last: string }>();
    for (const doc of attemptsSnap.docs) {
      const { accountId, attemptedAt } = doc.data() as Pick<CourseAttemptRecord, 'accountId' | 'attemptedAt'>;
      const seen = attempts.get(accountId);
      attempts.set(accountId, { count: (seen?.count ?? 0) + 1, last: seen && seen.last > attemptedAt ? seen.last : attemptedAt });
    }

    const accountIds = [...new Set([...progress.keys(), ...attempts.keys(), ...threads.keys()])];
    if (!accountIds.length) return [];
    const accounts = new Map(
      (await db.getAll(...accountIds.map((id) => db.collection(Collections.accounts).doc(id)), { fieldMask: ['accountId', 'displayName'] }))
        .filter((snap) => snap.exists)
        .map((snap) => [snap.id, snap.data() as Pick<AccountRecord, 'displayName'>]),
    );
    const versionNumbers = [...new Set([...progress.values()].map((record) => record.version))];
    const versions = new Map(await Promise.all(versionNumbers.map(async (n) => [n, await this.courses.version(courseId, n)] as const)));

    const rows = accountIds.map((accountId): CourseLearnerRow => {
      const learning = progress.get(accountId);
      const certificate = certificates.get(accountId);
      const thread = threads.get(accountId);
      const lessons = (learning ? versions.get(learning.version)?.lessons ?? [] : []).map((lesson) => ({
        lessonId: lesson.lessonId,
        title: lesson.title,
        bestScore: learning!.bestScores[lesson.lessonId] ?? null,
        passed: learning!.completedLessonIds.includes(lesson.lessonId),
      }));
      const activity = [learning?.updatedAt, attempts.get(accountId)?.last, thread?.lastLearnerMessageAt].filter((at): at is string => !!at).sort();
      return {
        accountId,
        name: learnerName(accountId, accounts.get(accountId)?.displayName),
        version: learning?.version ?? null,
        lessons,
        lessonsPassed: lessons.filter((lesson) => lesson.passed).length,
        attempts: attempts.get(accountId)?.count ?? 0,
        lastActivityAt: activity.at(-1) ?? null,
        certificate: certificate ? { issuedAt: certificate.issuedAt, revokedAt: certificate.revokedAt } : null,
        messaging: thread?.messaging ?? false,
        unread: !!thread && waiting(thread.lastLearnerMessageAt, thread.instructorReadAt),
      };
    });
    return rows.sort(
      (a, b) => Number(b.unread) - Number(a.unread) || (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '') || a.name.localeCompare(b.name),
    );
  }

  /** Turns a learner's messaging with the instructors on or off in this course; their conversation stays either way. */
  async switchMessaging(courseId: string, accountId: string, messaging: boolean, by: string): Promise<CourseThreadRecord> {
    await this.courses.record(courseId);
    const db = this.firebase.db;
    const ref = this.threadRef(courseId, accountId);
    return db.runTransaction(async (tx) => {
      const [thread, account] = await tx.getAll(ref, db.collection(Collections.accounts).doc(accountId));
      if (!account!.exists) throw new NotFoundException('no such learner');
      const now = new Date().toISOString();
      const current = thread!.data() as CourseThreadRecord | undefined;
      const record: CourseThreadRecord = current
        ? { ...current, messaging, switchedAt: now, switchedBy: by }
        : {
            threadId: courseThreadId(courseId, accountId),
            courseId,
            accountId,
            messaging,
            switchedAt: now,
            switchedBy: by,
            lastLearnerMessageAt: null,
            lastInstructorMessageAt: null,
            learnerReadAt: null,
            instructorReadAt: null,
          };
      tx.set(ref, record);
      return record;
    });
  }

  /** The conversation as one side reads it; reading it marks the other side's messages read. */
  async conversation(courseId: string, accountId: string, reader: CourseMessageSender): Promise<CourseConversation> {
    await this.courses.record(courseId);
    const db = this.firebase.db;
    const ref = this.threadRef(courseId, accountId);
    const thread = (await ref.get()).data() as CourseThreadRecord | undefined;
    if (!thread) return { messaging: false, messages: [] };
    const snap = await db
      .collection(Collections.courseMessages)
      .where('threadId', '==', thread.threadId)
      .orderBy('sentAt', 'desc')
      .limit(COURSE_CONVERSATION_LIMIT)
      .get();
    const messages = snap.docs.reverse().map((doc) => {
      const { messageId, from, authorName, body, sentAt } = doc.data() as CourseMessageRecord;
      return { messageId, from, authorName, body, sentAt };
    });
    const other = reader === 'learner' ? thread.lastInstructorMessageAt : thread.lastLearnerMessageAt;
    const readAt = reader === 'learner' ? thread.learnerReadAt : thread.instructorReadAt;
    if (waiting(other, readAt)) await ref.update({ [reader === 'learner' ? 'learnerReadAt' : 'instructorReadAt']: new Date().toISOString() });
    return { messaging: thread.messaging, messages };
  }

  /**
   * Adds a message to the learner's conversation: from the learner, or from an instructor (`authorId`, a Course
   * Administrator). Refused while messaging is off for the learner, either way round.
   */
  async send(courseId: string, accountId: string, from: CourseMessageSender, authorId: string, body: string): Promise<CourseConversation> {
    await this.courses.record(courseId);
    const db = this.firebase.db;
    const ref = this.threadRef(courseId, accountId);
    await db.runTransaction(async (tx) => {
      const [threadSnap, author] = await tx.getAll(ref, db.collection(Collections.accounts).doc(authorId));
      const thread = threadSnap!.data() as CourseThreadRecord | undefined;
      if (!thread?.messaging) {
        if (from === 'learner') throw new ForbiddenException('messages with the instructor are off for you in this course');
        throw new ConflictException('turn messaging on for this learner first');
      }
      const sentAt = new Date().toISOString();
      const displayName = (author!.data() as AccountRecord | undefined)?.displayName?.trim();
      const message: CourseMessageRecord = {
        messageId: uuidv7(),
        threadId: thread.threadId,
        courseId,
        accountId,
        from,
        authorId,
        authorName: from === 'learner' ? learnerName(accountId, displayName) : displayName || 'Instructor',
        body,
        sentAt,
      };
      tx.create(db.collection(Collections.courseMessages).doc(message.messageId), message);
      tx.update(
        ref,
        from === 'learner' ? { lastLearnerMessageAt: sentAt, learnerReadAt: sentAt } : { lastInstructorMessageAt: sentAt, instructorReadAt: sentAt },
      );
    });
    return this.conversation(courseId, accountId, from);
  }

  private threadRef(courseId: string, accountId: string) {
    return this.firebase.db.collection(Collections.courseThreads).doc(courseThreadId(courseId, accountId));
  }
}

const byAccount = <T extends { readonly accountId: string }>(records: readonly T[]) => new Map(records.map((record) => [record.accountId, record]));

/** Whether the other side has written since this side last read the conversation. */
const waiting = (lastFromOther: string | null, readAt: string | null) => !!lastFromOther && (!readAt || lastFromOther > readAt);

/** A learner's name as Course Administrators see it: never their email, which the role does not see. */
const learnerName = (accountId: string, displayName: string | null | undefined) => displayName?.trim() || `Learner ${accountId.slice(-6)}`;
