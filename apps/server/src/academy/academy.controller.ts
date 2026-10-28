import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, Public, requireAccount, requireOwnAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { Firebase } from '../infra/firebase.js';
import { academyQuestions, ASSESSMENT_VERSION } from './questions.js';
import { randomUUID } from 'node:crypto';
import { ZodPipe } from '../common/validation.js';

const sectionIds = ['foundations','history','longevity','enhancement','intelligence','democracy','ethics','earth','space','future'] as const;
const completionSchema = z.object({ completed: z.boolean(), lessonVersion: z.literal(1) }).strict();
const sectionSchema = z.enum(sectionIds);
const attemptSchema = z.object({ section: sectionSchema, answer: z.number().int().min(0).max(3), assessmentVersion: z.literal(1) }).strict();
const COURSE_VERSION = 1;

/** Records self-attested reading completion, not graded assessment or certificate eligibility. */
@Controller('v1/academy')
export class AcademyController {
  constructor(private readonly firebase: Firebase) {}

  private ref(ctx: RequestContext) {
    requireOwnAccount(ctx);
    return this.firebase.db.collection('academyProgress').doc(requireAccount(ctx));
  }

  /** Issue once, only after every current section is complete and every quiz has a correct attempt. */
  @Post('certificates')
  async issueCertificate(@Ctx() ctx: RequestContext) {
    const owner = this.ref(ctx);
    const course = owner.collection('courses').doc('introduction-v1');
    const [sections, attempts] = await Promise.all([course.collection('sections').get(), course.collection('attempts').get()]);
    const done = new Set(sections.docs.filter(d => d.data().completed === true && d.data().lessonVersion === COURSE_VERSION).map(d => d.id));
    const passed = new Set(attempts.docs.filter(d => d.data().correct === true && d.data().assessmentVersion === ASSESSMENT_VERSION && d.data().questionVersion === ASSESSMENT_VERSION).map(d => d.data().section as string));
    if (!sectionIds.every(id => done.has(id) && passed.has(id))) {
      throw new ForbiddenException('Complete all ten sections and pass all ten knowledge checks before requesting a certificate');
    }
    const ownerDoc = course.collection('certificate').doc('issued');
    const id = randomUUID();
    const certDoc = this.firebase.db.collection('academyCertificates').doc(id);
    const name = (ctx.principal.name || ctx.principal.email || 'Academy learner').trim().slice(0, 160);
    const issuedAt = new Date().toISOString();
    return this.firebase.db.runTransaction(async tx => {
      const existing = await tx.get(ownerDoc);
      if (existing.exists) {
        const existingId = existing.data()?.certificateId as string | undefined;
        if (existingId) return { certificateId: existingId, existing: true };
      }
      tx.create(certDoc, { certificateId: id, ownerAccountId: requireAccount(ctx), learnerName: name, courseTitle: 'Introduction to Transhumanism', courseVersion: COURSE_VERSION, assessmentVersion: ASSESSMENT_VERSION, issuedAt, revoked: false });
      tx.create(ownerDoc, { certificateId: id, issuedAt });
      return { certificateId: id, existing: false };
    });
  }

  @Get('certificates/me')
  async myCertificate(@Ctx() ctx: RequestContext) {
    const doc = await this.ref(ctx).collection('courses').doc('introduction-v1').collection('certificate').doc('issued').get();
    return { certificateId: (doc.data()?.certificateId as string | undefined) ?? null };
  }

  @Public()
  @Get('certificates/verify/:id')
  async verifyCertificate(@Param('id') id: string) {
    if (!z.string().uuid().safeParse(id).success) throw new BadRequestException('Invalid certificate ID');
    const doc = await this.firebase.db.collection('academyCertificates').doc(id).get();
    const data = doc.data();
    if (!data || data.revoked === true) return { valid: false };
    return { valid: true, certificateId: id, learnerName: data.learnerName, courseTitle: data.courseTitle, courseVersion: data.courseVersion, issuedAt: data.issuedAt };
  }

  @Get('questions')
  questions() {
    return { assessmentVersion: ASSESSMENT_VERSION, questions: academyQuestions.map(({section,prompt,options}) => ({section,prompt,options})) };
  }

  @Put('attempts')
  async attempt(@Ctx() ctx: RequestContext, @Body(new ZodPipe(attemptSchema)) body: z.infer<typeof attemptSchema>) {
    const question = academyQuestions.find((q) => q.section === body.section);
    if (!question) throw new BadRequestException('Unknown section');
    const correct = body.answer === question.answer;
    const attemptId = randomUUID();
    const record = { ...body, correct, submittedAt: new Date().toISOString(), questionVersion: ASSESSMENT_VERSION };
    await this.ref(ctx).collection('courses').doc('introduction-v1').collection('attempts').doc(attemptId).create(record);
    return { attemptId, correct, explanation: question.explanation, assessmentVersion: ASSESSMENT_VERSION };
  }

  @Get('progress')
  async progress(@Ctx() ctx: RequestContext) {
    const snap = await this.ref(ctx).collection('courses').doc('introduction-v1').collection('sections').get();
    return { courseVersion: COURSE_VERSION, sections: snap.docs.filter((doc) => sectionIds.includes(doc.id as typeof sectionIds[number]) && doc.data().completed === true && doc.data().lessonVersion === 1).map((doc) => doc.id) };
  }

  @Put('progress/:section')
  async complete(
    @Ctx() ctx: RequestContext,
    @Param('section') section: string,
    @Body(new ZodPipe(completionSchema)) body: z.infer<typeof completionSchema>,
  ) {
    const parsed = sectionSchema.safeParse(section);
    if (!parsed.success) throw new BadRequestException('Unknown course section');
    const doc = this.ref(ctx).collection('courses').doc('introduction-v1').collection('sections').doc(parsed.data);
    await doc.set({ completed: body.completed, lessonVersion: body.lessonVersion, updatedAt: new Date().toISOString() });
    return { section: parsed.data, ...body };
  }
}
