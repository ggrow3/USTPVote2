import { BadRequestException, Body, Controller, Get, Param, Put } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, requireAccount, requireOwnAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { Firebase } from '../infra/firebase.js';
import { ZodPipe } from '../common/validation.js';

const sectionIds = ['foundations','history','longevity','enhancement','intelligence','democracy','ethics','earth','space','future'] as const;
const completionSchema = z.object({ completed: z.boolean(), lessonVersion: z.literal(1) }).strict();
const sectionSchema = z.enum(sectionIds);
const COURSE_VERSION = 1;

/** Records self-attested reading completion, not graded assessment or certificate eligibility. */
@Controller('v1/academy')
export class AcademyController {
  constructor(private readonly firebase: Firebase) {}

  private ref(ctx: RequestContext) {
    requireOwnAccount(ctx);
    return this.firebase.db.collection('academyProgress').doc(requireAccount(ctx));
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
