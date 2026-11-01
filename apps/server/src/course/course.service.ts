import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  Collections,
  courseBoardProblem,
  courseIdFromTitle,
  coursePlacementProblem,
  courseThreadId,
  draftCoursePackage,
  isCourseId,
  isCourseImageId,
  learnerCourseState,
  missingPrerequisites,
  PASS_PERCENT,
  placementOf,
  portraitProblem,
  publishedCoursePackage,
  uploadedVideoIds,
  uuidv7,
  withBoardChanges,
  type CertificateVerification,
  type CourseLink,
  type CourseMap,
  type CourseMapEntry,
  type CourseMapInput,
  type CourseThreadRecord,
  type CoursePackage,
  type CourseAttemptRecord,
  type CourseCatalog,
  type CourseBoardInput,
  type CourseCertificateRecord,
  type CourseLesson,
  type CourseMetadataInput,
  type CourseProgressRecord,
  type CourseQuizFeedback,
  type CourseRecord,
  type CourseVersionRecord,
  type FuturistProfile,
  type LearnerCourseView,
  type PublicCourseLesson,
  type SaveCourseLessonInput,
  type SaveFuturistProfileInput,
  type SubmitCourseQuizInput,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';
import { VideosService } from '../videos/videos.js';
import { FIRST_COURSE_POSITION, MAP_SEED, mapCourses } from './course-map-seed.js';
import { normalizePortrait } from './portrait.js';
import { transhumanismCourse, transhumanismLessons, transhumanismProfiles } from './transhumanism-seed.js';

const require = createRequire(import.meta.url);
interface QrMatrix {
  readonly size: number;
  get(row: number, column: number): boolean;
}
const QRCode = require('qrcode') as { create(text: string, options: { errorCorrectionLevel: 'M' }): { modules: QrMatrix } };

export interface QuizResult {
  readonly attempt: CourseAttemptRecord;
  readonly progress: CourseProgressRecord;
  readonly certificate: Pick<CourseCertificateRecord, 'certificateId' | 'issuedAt' | 'courseVersion'> | null;
  /** How each answer went, in the lesson's order. */
  readonly feedback: readonly CourseQuizFeedback[];
}

export interface UploadedCourseImage {
  readonly image: string;
  readonly width: number;
  readonly height: number;
}

/** First-party course storage. Drafts are editable; public learning always reads a frozen published snapshot. */
@Injectable()
export class CourseService {
  constructor(
    private readonly firebase: Firebase,
    private readonly videos: VideosService,
  ) {}

  async catalog(courseId: string): Promise<CourseCatalog> {
    const { course, version } = await this.publishedCourse(courseId);
    return this.catalogOf(version, await this.links(course.prerequisites));
  }

  private catalogOf(version: CourseVersionRecord, prerequisites: readonly CourseLink[]): CourseCatalog {
    return {
      course: { courseId: version.courseId, title: version.title, summary: version.summary, publishedVersion: version.version },
      lessons: version.lessons.map(publicLesson),
      profiles: version.profiles.map(withPortraitImage),
      prerequisites,
    };
  }

  async learner(courseId: string, accountId: string): Promise<LearnerCourseView> {
    const db = this.firebase.db;
    const { course, version: currentVersion } = await this.publishedCourse(courseId);
    const [progress, certificate, thread, prerequisites, passed] = await Promise.all([
      db.collection(Collections.courseProgress).doc(progressId(courseId, accountId)).get(),
      db.collection(Collections.courseCertificates).doc(progressId(courseId, accountId)).get(),
      db.collection(Collections.courseThreads).doc(courseThreadId(courseId, accountId)).get(),
      this.links(course.prerequisites),
      this.passedCourses(accountId, course.prerequisites),
    ]);
    const savedProgress = progress.data() as CourseProgressRecord | undefined;
    const savedCertificate = certificate.data() as CourseCertificateRecord | undefined;
    // Publishing is not allowed to silently rewrite a learner's active curriculum.  A learner with progress sees the
    // immutable version they started, while people who have already finished see the current catalogue and can still
    // download their earlier credential.
    const learningVersion = savedProgress && savedProgress.version !== currentVersion.version ? await this.version(courseId, savedProgress.version) : currentVersion;
    const catalog = this.catalogOf(learningVersion, prerequisites);
    return {
      ...catalog,
      progress: savedProgress?.version === learningVersion.version ? savedProgress : null,
      certificate: savedCertificate && savedCertificate.revokedAt === null ? pickCertificate(savedCertificate) : null,
      missingPrerequisites: prerequisites.filter((link) => !passed.has(link.courseId)),
      messaging: (thread.data() as CourseThreadRecord | undefined)?.messaging ?? false,
    };
  }

  /**
   * The course map and list (design §10.8): every published course, and every course placed on the map, a draft
   * showing only its title as coming soon. For a signed-in learner, how they stand in each.
   */
  async courseMap(accountId: string | null): Promise<CourseMap> {
    const records = await this.records();
    const listings = await this.listings(records);
    const courses: CourseMapEntry[] = records
      .filter((record) => listings.has(record.courseId) || record.position)
      .map((record) => {
        const listed = listings.get(record.courseId);
        return {
          courseId: record.courseId,
          title: listed?.title ?? record.title,
          summary: listed?.summary ?? null,
          published: !!listed,
          lessonCount: listed?.lessons ?? 0,
          prerequisites: record.prerequisites,
          position: record.position,
        };
      });
    if (!accountId) return { courses };
    if (!courses.length) return { courses, status: [] };

    const db = this.firebase.db;
    const ids = courses.map((course) => course.courseId);
    const progress = new Map(
      (await db.getAll(...ids.map((id) => db.collection(Collections.courseProgress).doc(progressId(id, accountId)))))
        .filter((snap) => snap.exists)
        .map((snap) => [snap.get('courseId') as string, snap.data() as CourseProgressRecord]),
    );
    const passed = await this.passedCourses(accountId, ids);
    // A learner part-way through an earlier version is counted against that version's lessons.
    const earlier = records.filter((record) => progress.has(record.courseId) && progress.get(record.courseId)!.version !== record.publishedVersion);
    const earlierLessons = new Map(
      (await this.versionsOf(earlier.map((record) => [record.courseId, progress.get(record.courseId)!.version] as const))).map((version) => [
        version.courseId,
        version.lessons.length,
      ]),
    );
    const status = courses.map((course) => {
      const started = progress.get(course.courseId);
      const lessonCount = earlierLessons.get(course.courseId) ?? course.lessonCount;
      const missing = missingPrerequisites(course.prerequisites, passed);
      return {
        courseId: course.courseId,
        state: learnerCourseState({ passed: passed.has(course.courseId), missing, started: !!started }),
        lessonsPassed: passed.has(course.courseId) ? lessonCount : Math.min(started?.completedLessonIds.length ?? 0, lessonCount),
        lessonCount,
        missing,
      };
    });
    return { courses, status };
  }

  /** Every course, drafts included, for the Course tab's course picker and map, in map order. */
  async adminCourses(): Promise<readonly CourseRecord[]> {
    return this.records();
  }

  /** A new draft course, off the map, with an ID made from its title. */
  async createCourse(input: CourseMetadataInput, accountId: string): Promise<CourseRecord> {
    await this.ensureSeeded();
    const db = this.firebase.db;
    const base = courseIdFromTitle(input.title).slice(0, 56).replace(/-+$/, '') || 'course';
    const candidates = [base, ...Array.from({ length: 19 }, (_, i) => `${base}-${i + 2}`)];
    return db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...candidates.map((id) => db.collection(Collections.courses).doc(id)));
      const index = snaps.findIndex((snap) => !snap.exists);
      if (index < 0) throw new ConflictException('there are already many courses with this title; choose another');
      const now = new Date().toISOString();
      const record: CourseRecord = {
        courseId: candidates[index]!,
        ...input,
        status: 'draft',
        version: 0,
        publishedVersion: null,
        prerequisites: [],
        position: null,
        createdAt: now,
        updatedAt: now,
        updatedBy: accountId,
      };
      tx.create(snaps[index]!.ref, record);
      return record;
    });
  }

  /** Deletes a course that was never published, with its draft lessons and profiles; one that was keeps its record. */
  async deleteCourse(courseId: string): Promise<void> {
    await this.ensureSeeded();
    const db = this.firebase.db;
    const ref = db.collection(Collections.courses).doc(courseId);
    await db.runTransaction(async (tx) => {
      const [snap, all, lessons, profiles] = await Promise.all([
        tx.get(ref),
        tx.get(db.collection(Collections.courses)),
        tx.get(db.collection(Collections.courseLessons).where('courseId', '==', courseId)),
        tx.get(db.collection(Collections.courseProfiles).where('courseId', '==', courseId)),
      ]);
      if (!snap.exists) throw new NotFoundException('course not found');
      if ((snap.data() as CourseRecord).publishedVersion !== null) {
        throw new ConflictException('a published course cannot be deleted: learners keep its certificates and can still check them');
      }
      const after = all.docs.map((doc) => withPlacement(doc.data() as CourseRecord)).find((course) => course.prerequisites.includes(courseId));
      if (after) throw new ConflictException(`${after.title} comes after this course; take it off that course's prerequisites first`);
      for (const doc of [...lessons.docs, ...profiles.docs]) tx.delete(doc.ref);
      tx.delete(ref);
    });
  }

  /** Puts a course on the map, or takes it off, and sets the courses before it; both apply at once (design §10.8). */
  async placeCourse(courseId: string, input: CourseMapInput, accountId: string): Promise<CourseRecord> {
    await this.ensureSeeded();
    const db = this.firebase.db;
    return db.runTransaction(async (tx) => {
      const courses = (await tx.get(db.collection(Collections.courses))).docs.map((doc) => withPlacement(doc.data() as CourseRecord));
      const course = courses.find((candidate) => candidate.courseId === courseId);
      if (!course) throw new NotFoundException('course not found');
      const problem = coursePlacementProblem(courses, courseId, input);
      if (problem) throw new ConflictException(problem);
      tx.update(db.collection(Collections.courses).doc(courseId), {
        prerequisites: input.prerequisites,
        position: input.position,
        placedAt: new Date().toISOString(),
        placedBy: accountId,
      });
      return { ...course, prerequisites: input.prerequisites, position: input.position };
    });
  }

  /**
   * Saves the Course tab's board: each listed course's square and prerequisites, together, so cards can swap squares
   * and the map be rearranged as an org chart in one go (409, in words, for anything `courseBoardProblem` finds).
   * Courses not listed keep their place. Every course, in map order, as the board then shows it.
   */
  async placeCourses(input: CourseBoardInput, accountId: string): Promise<CourseRecord[]> {
    await this.ensureSeeded();
    const db = this.firebase.db;
    return db.runTransaction(async (tx) => {
      const courses = (await tx.get(db.collection(Collections.courses))).docs.map((doc) => withPlacement(doc.data() as CourseRecord));
      const problem = courseBoardProblem(courses, input.courses);
      if (problem) throw new ConflictException(problem);
      const placedAt = new Date().toISOString();
      for (const change of input.courses) {
        tx.update(db.collection(Collections.courses).doc(change.courseId), {
          prerequisites: change.prerequisites,
          position: change.position,
          placedAt,
          placedBy: accountId,
        });
      }
      return withBoardChanges(courses, input.courses).sort(mapOrder);
    });
  }

  /** A course's record, placement included (404 for an ID that is no course). */
  async record(courseId: string): Promise<CourseRecord> {
    await this.ensureSeeded();
    if (!isCourseId(courseId)) throw new NotFoundException('course not found');
    const snap = await this.firebase.db.collection(Collections.courses).doc(courseId).get();
    if (!snap.exists) throw new NotFoundException('course not found');
    return withPlacement(snap.data() as CourseRecord);
  }

  private async records(): Promise<CourseRecord[]> {
    await this.ensureSeeded();
    const snap = await this.firebase.db.collection(Collections.courses).get();
    return snap.docs.map((doc) => withPlacement(doc.data() as CourseRecord)).sort(mapOrder);
  }

  /** What learners see of each published course: its title, summary and number of lessons. */
  private async listings(records: readonly CourseRecord[]): Promise<Map<string, { title: string; summary: string; lessons: number }>> {
    const published = records.filter((record) => record.publishedVersion !== null);
    const versions = await this.versionsOf(published.map((record) => [record.courseId, record.publishedVersion!] as const));
    return new Map(versions.map((version) => [version.courseId, { title: version.title, summary: version.summary, lessons: version.lessons.length }]));
  }

  /** Published versions by course and number, without their profiles; one that is missing is left out. */
  private async versionsOf(wanted: readonly (readonly [string, number])[]): Promise<Pick<CourseVersionRecord, 'courseId' | 'title' | 'summary' | 'lessons'>[]> {
    if (!wanted.length) return [];
    const db = this.firebase.db;
    const refs = wanted.map(([courseId, version]) => db.collection(Collections.courseVersions).doc(versionId(courseId, version)));
    const snaps = await db.getAll(...refs, { fieldMask: ['courseId', 'title', 'summary', 'lessons'] });
    return snaps.filter((snap) => snap.exists).map((snap) => snap.data() as Pick<CourseVersionRecord, 'courseId' | 'title' | 'summary' | 'lessons'>);
  }

  /** The courses named, with the title learners see: the published one, or the draft's while none is published. */
  private async links(courseIds: readonly string[]): Promise<CourseLink[]> {
    if (!courseIds.length) return [];
    const db = this.firebase.db;
    const records = (await db.getAll(...courseIds.map((id) => db.collection(Collections.courses).doc(id))))
      .filter((snap) => snap.exists)
      .map((snap) => snap.data() as CourseRecord);
    const listings = await this.listings(records);
    return records.map((record) => ({ courseId: record.courseId, title: listings.get(record.courseId)?.title ?? record.title }));
  }

  /** Which of these courses the learner has passed: they hold its certificate, not revoked. */
  async passedCourses(accountId: string, courseIds: readonly string[]): Promise<Set<string>> {
    if (!courseIds.length) return new Set();
    const db = this.firebase.db;
    const snaps = await db.getAll(...courseIds.map((id) => db.collection(Collections.courseCertificates).doc(progressId(id, accountId))));
    const certificates = snaps.map((snap) => snap.data() as CourseCertificateRecord | undefined);
    return new Set(certificates.filter((certificate) => certificate?.revokedAt === null).map((certificate) => certificate!.courseId));
  }

  async adminContent(courseId: string): Promise<{ readonly course: CourseRecord; readonly lessons: readonly CourseLesson[]; readonly profiles: readonly FuturistProfile[] }> {
    await this.ensureSeeded();
    const db = this.firebase.db;
    const [course, lessons, profiles] = await Promise.all([
      db.collection(Collections.courses).doc(courseId).get(),
      db.collection(Collections.courseLessons).where('courseId', '==', courseId).orderBy('order').get(),
      db.collection(Collections.courseProfiles).where('courseId', '==', courseId).orderBy('order').get(),
    ]);
    if (!course.exists) throw new NotFoundException('course not found');
    return {
      course: course.data() as CourseRecord,
      lessons: lessons.docs.map((d) => withVideo(d.data() as CourseLesson)),
      profiles: profiles.docs.map((d) => withPortraitImage(d.data() as FuturistProfile)),
    };
  }

  /** The course as one `ustp.course` file: the draft, or a published version (404 if it has none by that number). */
  async package(courseId: string, version: number | 'draft'): Promise<CoursePackage> {
    const exportedAt = new Date().toISOString();
    if (version === 'draft') {
      const { course, lessons, profiles } = await this.adminContent(courseId);
      return draftCoursePackage(course, lessons, profiles, exportedAt);
    }
    await this.ensureSeeded();
    const published = await this.version(courseId, version);
    return publishedCoursePackage({ ...published, profiles: published.profiles.map(withPortraitImage) }, exportedAt);
  }

  async updateMetadata(courseId: string, input: CourseMetadataInput, accountId: string): Promise<CourseRecord> {
    await this.ensureSeeded();
    const db = this.firebase.db;
    const ref = db.collection(Collections.courses).doc(courseId);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundException('course not found');
      const current = snap.data() as CourseRecord;
      const updated: CourseRecord = { ...current, ...input, status: 'draft', updatedAt: new Date().toISOString(), updatedBy: accountId };
      tx.set(ref, updated);
      return updated;
    });
  }

  async saveLesson(courseId: string, input: SaveCourseLessonInput, accountId: string): Promise<CourseLesson> {
    await this.ensureSeeded();
    const db = this.firebase.db;
    const lessonId = input.lessonId ?? uuidv7();
    const ref = db.collection(Collections.courseLessons).doc(`${courseId}_${lessonId}`);
    const courseRef = db.collection(Collections.courses).doc(courseId);
    return db.runTransaction(async (tx) => {
      if (!(await tx.get(courseRef)).exists) throw new NotFoundException('course not found');
      const now = new Date().toISOString();
      await this.videos.requireReady(uploadedVideoIds([input.video]), tx);
      const questions = input.questions.map((question) => ({ ...question, questionId: question.questionId ?? uuidv7() }));
      const record: CourseLesson = { courseId, lessonId, ...input, questions, updatedAt: now, updatedBy: accountId };
      tx.set(ref, record);
      tx.update(courseRef, { status: 'draft', updatedAt: now, updatedBy: accountId });
      return record;
    });
  }

  async deleteLesson(courseId: string, lessonId: string, accountId: string): Promise<void> {
    await this.deleteDraftRecord(Collections.courseLessons, courseId, lessonId, accountId, 'lesson');
  }

  async saveProfile(courseId: string, input: SaveFuturistProfileInput, accountId: string): Promise<FuturistProfile> {
    await this.ensureSeeded();
    const db = this.firebase.db;
    const profileId = input.profileId ?? uuidv7();
    const ref = db.collection(Collections.courseProfiles).doc(`${courseId}_${profileId}`);
    const courseRef = db.collection(Collections.courses).doc(courseId);
    return db.runTransaction(async (tx) => {
      if (!(await tx.get(courseRef)).exists) throw new NotFoundException('course not found');
      if (input.portraitImage && !(await tx.get(this.imageDoc(input.portraitImage))).exists) {
        throw new BadRequestException('that photo is not one uploaded here; upload it again');
      }
      const now = new Date().toISOString();
      const record: FuturistProfile = { courseId, profileId, ...input, updatedAt: now, updatedBy: accountId };
      tx.set(ref, record);
      tx.update(courseRef, { status: 'draft', updatedAt: now, updatedBy: accountId });
      return record;
    });
  }

  async deleteProfile(courseId: string, profileId: string, accountId: string): Promise<void> {
    await this.deleteDraftRecord(Collections.courseProfiles, courseId, profileId, accountId, 'profile');
  }

  /**
   * Stores an uploaded portrait, re-encoded, under the hash of its bytes, and gives that ID. It shows only once a
   * profile is saved with it and the course published, so uploading changes nothing a learner sees.
   */
  async uploadImage(courseId: string, body: unknown, accountId: string): Promise<UploadedCourseImage> {
    await this.ensureSeeded();
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException('send the image as the request body');
    if (!(await this.firebase.db.collection(Collections.courses).doc(courseId).get()).exists) throw new NotFoundException('course not found');
    const { image, width, height } = await normalizePortrait(body);
    const id = createHash('sha256').update(image).digest('hex');
    await this.imageDoc(id).set({ image, contentType: 'image/webp', width, height, courseId, uploadedAt: new Date().toISOString(), uploadedBy: accountId });
    return { image: id, width, height };
  }

  async image(id: string): Promise<Buffer> {
    if (!isCourseImageId(id)) throw new NotFoundException('no such image');
    const image = (await this.imageDoc(id).get()).get('image') as Buffer | undefined;
    if (!image) throw new NotFoundException('no such image');
    return Buffer.from(image);
  }

  private imageDoc(id: string) {
    return this.firebase.db.collection(Collections.courseImages).doc(id);
  }

  async publish(courseId: string, accountId: string): Promise<CourseVersionRecord> {
    const draft = await this.adminContent(courseId);
    if (draft.lessons.length === 0) throw new ConflictException('add at least one lesson before publishing');
    if (draft.lessons.some((lesson) => lesson.questions.length === 0)) throw new ConflictException('every lesson needs at least one quiz question');
    const unfinished = draft.profiles.find((profile) => portraitProblem(profile));
    if (unfinished) {
      throw new ConflictException(`every published profile needs a credited, open-licence portrait: ${unfinished.name} has ${portraitProblem(unfinished)}`);
    }
    const db = this.firebase.db;
    const courseRef = db.collection(Collections.courses).doc(courseId);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(courseRef);
      if (!snap.exists) throw new NotFoundException('course not found');
      const course = snap.data() as CourseRecord;
      const version = course.version + 1;
      const publishedAt = new Date().toISOString();
      const snapshot: CourseVersionRecord = {
        courseId,
        version,
        title: course.title,
        summary: course.summary,
        lessons: draft.lessons,
        profiles: draft.profiles,
        publishedAt,
        publishedBy: accountId,
      };
      tx.create(db.collection(Collections.courseVersions).doc(versionId(courseId, version)), snapshot);
      tx.update(courseRef, { status: 'published', version, publishedVersion: version, updatedAt: publishedAt, updatedBy: accountId });
      return snapshot;
    });
  }

  async submitQuiz(courseId: string, lessonId: string, input: SubmitCourseQuizInput, accountId: string): Promise<QuizResult> {
    const { course, version: published } = await this.publishedCourse(courseId);
    const missing = missingPrerequisites(course.prerequisites, await this.passedCourses(accountId, course.prerequisites));
    if (missing.length) {
      const titles = (await this.links(missing)).map((link) => link.title);
      throw new ConflictException(`pass ${titles.join(' and ')} first: this course's quizzes open once you have`);
    }
    const lesson = published.lessons.find((candidate) => candidate.lessonId === lessonId);
    if (!lesson) throw new NotFoundException('lesson not found');
    if (input.answers.length !== lesson.questions.length) {
      throw new BadRequestException(`answer every question: this quiz has ${lesson.questions.length}`);
    }
    if (lesson.questions.some((question, index) => input.answers[index]! >= question.choices.length)) {
      throw new BadRequestException("an answer is not one of its question's choices");
    }
    const feedback: CourseQuizFeedback[] = lesson.questions.map((question, index) => ({
      questionId: question.questionId,
      correct: question.correctIndex === input.answers[index],
      explanation: question.explanation,
    }));
    const correct = feedback.filter((answer) => answer.correct).length;
    const score = Math.round((correct / lesson.questions.length) * 100);
    const passed = score >= PASS_PERCENT;
    const db = this.firebase.db;
    const attempt: CourseAttemptRecord = {
      attemptId: uuidv7(),
      courseId,
      version: published.version,
      lessonId,
      accountId,
      score,
      passed,
      attemptedAt: new Date().toISOString(),
    };
    const progressRef = db.collection(Collections.courseProgress).doc(progressId(courseId, accountId));
    const certificateRef = db.collection(Collections.courseCertificates).doc(progressId(courseId, accountId));
    return db.runTransaction(async (tx) => {
      const [progressSnap, certificateSnap, accountSnap] = await Promise.all([
        tx.get(progressRef),
        tx.get(certificateRef),
        tx.get(db.collection(Collections.accounts).doc(accountId)),
      ]);
      const existing = progressSnap.data() as CourseProgressRecord | undefined;
      const current: CourseProgressRecord =
        existing?.version === published.version
          ? existing
          : { courseId, accountId, version: published.version, bestScores: {}, completedLessonIds: [], updatedAt: attempt.attemptedAt };
      const bestScores = { ...current.bestScores, [lessonId]: Math.max(current.bestScores[lessonId] ?? 0, score) };
      const completedLessonIds = passed && !current.completedLessonIds.includes(lessonId) ? [...current.completedLessonIds, lessonId].sort() : current.completedLessonIds;
      const progress: CourseProgressRecord = { ...current, bestScores, completedLessonIds, updatedAt: attempt.attemptedAt };
      tx.create(db.collection(Collections.courseAttempts).doc(attempt.attemptId), attempt);
      tx.set(progressRef, progress);

      let certificate = certificateSnap.data() as CourseCertificateRecord | undefined;
      if (!certificate && published.lessons.every((item) => completedLessonIds.includes(item.lessonId))) {
        const account = accountSnap.data() as { displayName: string | null; primaryEmail: string | null } | undefined;
        certificate = {
          certificateId: uuidv7(),
          courseId,
          courseVersion: published.version,
          accountId,
          recipientName: account?.displayName || account?.primaryEmail || 'Course learner',
          issuedAt: attempt.attemptedAt,
          revokedAt: null,
          revokedBy: null,
          revocationReason: null,
        };
        tx.create(certificateRef, certificate);
      }
      return {
        attempt,
        progress,
        certificate: certificate && certificate.revokedAt === null ? pickCertificate(certificate) : null,
        feedback,
      };
    });
  }

  async certificatePdf(courseId: string, accountId: string, origin: string): Promise<Buffer> {
    await this.ensureSeeded();
    const certificate = await this.certificateForLearner(courseId, accountId);
    const version = await this.version(courseId, certificate.courseVersion);
    return certificatePdf(certificate, version, `${origin}/course/certificates/${encodeURIComponent(certificate.certificateId)}`);
  }

  async verifyCertificate(certificateId: string): Promise<CertificateVerification> {
    await this.ensureSeeded();
    const found = await this.firebase.db.collection(Collections.courseCertificates).where('certificateId', '==', certificateId).limit(1).get();
    const certificate = found.docs[0]?.data() as CourseCertificateRecord | undefined;
    if (!certificate || certificate.revokedAt !== null) return { valid: false, courseTitle: null, courseVersion: null, issuedAt: null };
    const version = await this.version(certificate.courseId, certificate.courseVersion);
    return { valid: true, courseTitle: version.title, courseVersion: certificate.courseVersion, issuedAt: certificate.issuedAt };
  }

  async revokeCertificate(certificateId: string, reason: string, accountId: string): Promise<void> {
    await this.ensureSeeded();
    const db = this.firebase.db;
    const found = await db.collection(Collections.courseCertificates).where('certificateId', '==', certificateId).limit(1).get();
    const doc = found.docs[0];
    if (!doc) throw new NotFoundException('certificate not found');
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(doc.ref)).data() as CourseCertificateRecord;
      if (current.revokedAt) return;
      tx.update(doc.ref, { revokedAt: new Date().toISOString(), revokedBy: accountId, revocationReason: reason });
    });
  }

  private async deleteDraftRecord(collection: string, courseId: string, id: string, accountId: string, kind: 'lesson' | 'profile'): Promise<void> {
    await this.ensureSeeded();
    const db = this.firebase.db;
    const ref = db.collection(collection).doc(`${courseId}_${id}`);
    const courseRef = db.collection(Collections.courses).doc(courseId);
    await db.runTransaction(async (tx) => {
      if (!(await tx.get(ref)).exists) throw new NotFoundException(`${kind} not found`);
      const now = new Date().toISOString();
      tx.delete(ref);
      tx.update(courseRef, { status: 'draft', updatedAt: now, updatedBy: accountId });
    });
  }

  private async publishedCourse(courseId: string): Promise<{ readonly course: CourseRecord; readonly version: CourseVersionRecord }> {
    const course = await this.record(courseId);
    if (course.publishedVersion === null) throw new NotFoundException('course is not published');
    return { course, version: await this.version(courseId, course.publishedVersion) };
  }

  async version(courseId: string, version: number): Promise<CourseVersionRecord> {
    const snapshot = await this.firebase.db.collection(Collections.courseVersions).doc(versionId(courseId, version)).get();
    if (!snapshot.exists) throw new NotFoundException('published course version not found');
    return snapshot.data() as CourseVersionRecord;
  }

  private async certificateForLearner(courseId: string, accountId: string): Promise<CourseCertificateRecord> {
    const snap = await this.firebase.db.collection(Collections.courseCertificates).doc(progressId(courseId, accountId)).get();
    const certificate = snap.data() as CourseCertificateRecord | undefined;
    if (!certificate || certificate.revokedAt) throw new NotFoundException('no active course certificate');
    return certificate;
  }

  /**
   * Seeds the first course if it is missing, and the map's courses once. Checked each time, not remembered: the
   * database can be emptied under a running server (the emulators between tests), and a seed that failed is simply
   * tried again.
   */
  private async ensureSeeded(): Promise<void> {
    const db = this.firebase.db;
    const [first, map] = await db.getAll(db.collection(Collections.courses).doc(COURSE_ID), db.collection(Collections.courseSeeds).doc(MAP_SEED));
    if (!first!.exists) await this.seedTranshumanism();
    if (!map!.exists) await this.seedMap();
  }

  /** Adds the map's draft courses that are missing, and puts the first course on the map if it is not on it yet. */
  private async seedMap(): Promise<void> {
    const db = this.firebase.db;
    const markerRef = db.collection(Collections.courseSeeds).doc(MAP_SEED);
    const firstRef = db.collection(Collections.courses).doc(COURSE_ID);
    const refs = mapCourses.map((course) => db.collection(Collections.courses).doc(course.courseId));
    await db.runTransaction(async (tx) => {
      const [marker, first, ...existing] = await tx.getAll(markerRef, firstRef, ...refs);
      if (marker!.exists) return;
      existing.forEach((snap, index) => {
        if (!snap.exists) tx.create(refs[index]!, mapCourses[index]!);
      });
      if (first!.exists && first!.get('position') === undefined) tx.update(firstRef, { prerequisites: [], position: FIRST_COURSE_POSITION });
      tx.create(markerRef, { seed: MAP_SEED, seededAt: new Date().toISOString() });
    });
  }

  private async seedTranshumanism(): Promise<void> {
    const db = this.firebase.db;
    const courseRef = db.collection(Collections.courses).doc(COURSE_ID);
    await db.runTransaction(async (tx) => {
      if ((await tx.get(courseRef)).exists) return;
      const snapshot: CourseVersionRecord = {
        courseId: COURSE_ID,
        version: 1,
        title: transhumanismCourse.title,
        summary: transhumanismCourse.summary,
        lessons: transhumanismLessons,
        profiles: transhumanismProfiles,
        publishedAt: transhumanismCourse.createdAt,
        publishedBy: 'course-seed',
      };
      tx.create(courseRef, transhumanismCourse);
      for (const lesson of transhumanismLessons) tx.create(db.collection(Collections.courseLessons).doc(`${COURSE_ID}_${lesson.lessonId}`), lesson);
      for (const profile of transhumanismProfiles) tx.create(db.collection(Collections.courseProfiles).doc(`${COURSE_ID}_${profile.profileId}`), profile);
      tx.create(db.collection(Collections.courseVersions).doc(versionId(COURSE_ID, 1)), snapshot);
    });
  }
}

const COURSE_ID = 'transhumanism';
const progressId = (courseId: string, accountId: string) => `${courseId}_${accountId}`;
const versionId = (courseId: string, version: number) => `${courseId}_${String(version).padStart(6, '0')}`;
const publicLesson = (lesson: CourseLesson): PublicCourseLesson => ({
  ...lesson,
  video: lesson.video ?? null,
  questions: lesson.questions.map(({ questionId, prompt, choices }) => ({ questionId, prompt, choices })),
});
/** Courses saved before the map have no prerequisites or position. */
const withPlacement = (course: CourseRecord): CourseRecord => ({ ...course, ...placementOf(course) });
/** Map order: row by row, left to right, then the courses off the map by title. */
const mapOrder = (a: CourseRecord, b: CourseRecord) =>
  (a.position ? 0 : 1) - (b.position ? 0 : 1) ||
  (a.position?.row ?? 0) - (b.position?.row ?? 0) ||
  (a.position?.column ?? 0) - (b.position?.column ?? 0) ||
  a.title.localeCompare(b.title);
/** Lessons saved, or published, before videos have none. */
const withVideo = (lesson: CourseLesson): CourseLesson => ({ ...lesson, video: lesson.video ?? null });
/** Profiles saved, or published, before portraits could be uploaded have no portraitImage. */
const withPortraitImage = (profile: FuturistProfile): FuturistProfile => ({ ...profile, portraitImage: profile.portraitImage ?? null });
const pickCertificate = (certificate: CourseCertificateRecord) => ({
  certificateId: certificate.certificateId,
  issuedAt: certificate.issuedAt,
  courseVersion: certificate.courseVersion,
});

/** Compact server-side PDF, including a real QR matrix that resolves to the privacy-preserving public verifier. */
function certificatePdf(certificate: CourseCertificateRecord, course: CourseVersionRecord, verificationUrl: string): Buffer {
  const qr = QRCode.create(verificationUrl, { errorCorrectionLevel: 'M' }).modules;
  const commands: string[] = [
    'q 0.08 0.15 0.28 rg 0 0 612 792 re f Q',
    'q 1 1 1 rg 36 36 540 720 re f Q',
    textCommand(306, 680, 25, 'Certificate of Completion', 'center'),
    textCommand(306, 620, 13, 'This certifies that', 'center'),
    textCommand(306, 570, 23, certificate.recipientName, 'center'),
    textCommand(306, 525, 13, 'has successfully completed', 'center'),
    textCommand(306, 490, 18, course.title, 'center'),
    textCommand(306, 455, 12, `Course version ${certificate.courseVersion} · Issued ${new Date(certificate.issuedAt).toLocaleDateString('en-US')}`, 'center'),
    textCommand(306, 415, 10, 'Verify this credential by scanning the QR code or entering its certificate number.', 'center'),
    textCommand(306, 390, 10, `Certificate ${certificate.certificateId}`, 'center'),
  ];
  const cell = 2.25;
  const x = 306 - (qr.size * cell) / 2;
  const y = 130;
  commands.push('0 0 0 rg');
  for (let row = 0; row < qr.size; row++) {
    for (let column = 0; column < qr.size; column++) {
      if (qr.get(row, column)) commands.push(`${round(x + column * cell)} ${round(y + (qr.size - row - 1) * cell)} ${cell} ${cell} re f`);
    }
  }
  commands.push(textCommand(306, 105, 8, verificationUrl, 'center'));
  return buildPdf(commands.join('\n'));
}

function textCommand(x: number, y: number, size: number, value: string, align: 'center' | 'left'): string {
  const safe = pdfText(value);
  const estimate = safe.length * size * 0.48;
  const left = align === 'center' ? Math.max(48, x - estimate / 2) : x;
  return `BT /F1 ${size} Tf 0.08 0.15 0.28 rg 1 0 0 1 ${round(left)} ${y} Tm (${safe}) Tj ET`;
}

function pdfText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/[\\()]/g, '\\$&')
    .slice(0, 180);
}

function buildPdf(content: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const startXref = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

const round = (value: number) => Math.round(value * 100) / 100;

