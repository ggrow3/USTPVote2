import type { AppNotificationKind } from '../inbox/notifications.js';

/**
 * What an application to join tells people (design §5.2): the applicant that it arrived and what was decided, in the
 * bell and by email, and the Membership Admins that one waits. The words only; `InboxNotices` delivers them.
 */
export interface ApplicationNotice {
  readonly kind: AppNotificationKind;
  /** The application, or for the Membership Admins' notice one fixed value, so several waiting make one notice. */
  readonly ref: string;
  readonly title: string;
  readonly link: string;
  /** More to say in the email, as paragraphs separated by blank lines. */
  readonly detail?: string;
}

/** To the applicant, as their application is submitted. */
export function applicationReceivedNotice(applicationId: string): ApplicationNotice {
  return {
    kind: 'application_received',
    ref: applicationId,
    title: 'We have your application to join the US Transhumanist Party',
    link: '/register',
    detail:
      'A Membership Admin will read it and decide. You will get an email when they have, and the Register page shows where it stands.\n\n' +
      'There is nothing more you need to do for now.',
  };
}

/** To the applicant, when a Membership Admin has decided. A rejection carries the reason the admin wrote, as the site shows it. */
export function applicationDecidedNotice(applicationId: string, decision: 'approve' | 'reject', reason: string): ApplicationNotice {
  if (decision === 'approve') {
    return {
      kind: 'application_approved',
      ref: applicationId,
      title: 'Your application was approved: you are now a member of the US Transhumanist Party',
      link: '/vote',
      detail:
        'Welcome. Your voting home lists what is open to you: ballots when a vote is on, the courses, the teams, the forum and the members’ room.\n\n' +
        'A good first step is the introductory course, or finding the candidates and office holders for your area.',
    };
  }
  return {
    kind: 'application_rejected',
    ref: applicationId,
    title: 'Your application to join the US Transhumanist Party was not approved',
    link: '/register',
    detail: `The Membership Admin who decided it wrote: ${reason}\n\nYou may apply again on the Register page.`,
  };
}

/** One notice for every Membership Admin, counting up while unread: an application waits for a decision. */
export const APPLICATIONS_WAITING_REF = 'applications';

export function applicationWaitingNotice(): ApplicationNotice {
  return {
    kind: 'application_waiting',
    ref: APPLICATIONS_WAITING_REF,
    title: 'An application to join is waiting for a decision',
    link: '/admin?tab=applications',
  };
}
