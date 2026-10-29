import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  Collections,
  draftCoursePackage,
  isCourseImageId,
  PASS_PERCENT,
  portraitProblem,
  publishedCoursePackage,
  uuidv7,
  type CertificateVerification,
  type CoursePackage,
  type CourseAttemptRecord,
  type CourseCatalog,
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
  ) {}

  async catalog(courseId: string): Promise<CourseCatalog> {
    return this.catalogOf(await this.published(courseId));
  }

  private catalogOf(version: CourseVersionRecord): CourseCatalog {
    return {
      course: { courseId: version.courseId, title: version.title, summary: version.summary, publishedVersion: version.version },
      lessons: version.lessons.map(publicLesson),
      profiles: version.profiles.map(withPortraitImage),
    };
  }

  async learner(courseId: string, accountId: string): Promise<LearnerCourseView> {
    const [currentVersion, progress, certificate] = await Promise.all([
      this.published(courseId),
      this.firebase.db.collection(Collections.courseProgress).doc(progressId(courseId, accountId)).get(),
      this.firebase.db.collection(Collections.courseCertificates).doc(progressId(courseId, accountId)).get(),
    ]);
    const savedProgress = progress.data() as CourseProgressRecord | undefined;
    const savedCertificate = certificate.data() as CourseCertificateRecord | undefined;
    // Publishing is not allowed to silently rewrite a learner's active curriculum.  A learner with progress sees the
    // immutable version they started, while people who have already finished see the current catalogue and can still
    // download their earlier credential.
    const learningVersion = savedProgress && savedProgress.version !== currentVersion.version ? await this.version(courseId, savedProgress.version) : currentVersion;
    const catalog = this.catalogOf(learningVersion);
    return {
      ...catalog,
      progress: savedProgress?.version === learningVersion.version ? savedProgress : null,
      certificate: savedCertificate && savedCertificate.revokedAt === null ? pickCertificate(savedCertificate) : null,
    };
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
      lessons: lessons.docs.map((d) => d.data() as CourseLesson),
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
    const published = await this.published(courseId);
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

  private async published(courseId: string): Promise<CourseVersionRecord> {
    await this.ensureSeeded();
    const course = await this.firebase.db.collection(Collections.courses).doc(courseId).get();
    if (!course.exists) throw new NotFoundException('course not found');
    const record = course.data() as CourseRecord;
    if (record.publishedVersion === null) throw new NotFoundException('course is not published');
    return this.version(courseId, record.publishedVersion);
  }

  private async version(courseId: string, version: number): Promise<CourseVersionRecord> {
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
   * Seeds the course if it is missing. Checked each time, not remembered: the database can be emptied under a running
   * server (the emulators between tests), and a seed that failed is simply tried again.
   */
  private async ensureSeeded(): Promise<void> {
    if (!(await this.firebase.db.collection(Collections.courses).doc(COURSE_ID).get()).exists) await this.seedTranshumanism();
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
  questions: lesson.questions.map(({ questionId, prompt, choices }) => ({ questionId, prompt, choices })),
});
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

