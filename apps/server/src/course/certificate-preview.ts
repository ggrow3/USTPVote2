import { Injectable } from '@nestjs/common';
import { certificateDate, type LinkPreview } from 'ustp-domain';
import type { LinkPreviewSource } from '../link-previews/link-previews.js';
import { CourseService } from './course.service.js';

/**
 * A course certificate's link preview (design §15, "Link previews"; §10.8, "Sharing a certificate"), from what its
 * public page shows: the course, the day it was issued and the holder's name only while they show it. Never listed by
 * search engines. A certificate revoked, or never issued, has none.
 */
@Injectable()
export class CertificatePreviews implements LinkPreviewSource {
  readonly page = '/course/certificates/:id';

  constructor(private readonly courses: CourseService) {}

  async preview({ id }: Readonly<Record<string, string>>): Promise<LinkPreview | null> {
    const certificate = await this.courses.verifyCertificate(id!);
    if (!certificate.valid || !certificate.courseTitle || !certificate.issuedAt) return null;
    const { courseTitle, holderName } = certificate;
    const issued = certificateDate(certificate.issuedAt);
    return {
      title: holderName ? `${holderName} completed ${courseTitle}` : `Certificate: ${courseTitle}`,
      description: `${holderName ?? 'A learner'} completed ${courseTitle}, a free course from the U.S. Transhumanist Party, on ${issued}. Check the certificate, or take the course yourself.`,
      card: {
        kicker: 'Course certificate',
        title: courseTitle,
        lines: [holderName ? `Completed by ${holderName}` : 'Completed', `Issued ${issued}`, 'A free course anyone can take'],
      },
      listed: false,
    };
  }
}
