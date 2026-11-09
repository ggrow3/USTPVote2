import { Injectable } from '@nestjs/common';
import type { LinkPreview } from 'ustp-domain';
import { orNone, type LinkPreviewSource } from '../link-previews/link-previews.js';
import { CourseService } from './course.service.js';

/** A published course's link preview (design §15, "Link previews"): its title and summary, and how many lessons. */
@Injectable()
export class CoursePreviews implements LinkPreviewSource {
  readonly page = '/course/:courseId';

  constructor(private readonly courses: CourseService) {}

  async preview({ courseId }: Readonly<Record<string, string>>): Promise<LinkPreview | null> {
    const catalog = await orNone(this.courses.catalog(courseId!));
    if (!catalog) return null;
    const { course, lessons } = catalog;
    const summary = course.summary.trim() || 'A free course from the U.S. Transhumanist Party: lessons, quizzes and a certificate.';
    return {
      title: course.title,
      description: summary,
      card: {
        kicker: 'Free course',
        title: course.title,
        lines: [`${lessons.length} ${lessons.length === 1 ? 'lesson' : 'lessons'} · quizzes and a certificate`],
      },
    };
  }
}
