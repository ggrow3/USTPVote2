import type {
  AdminSection,
  ApprovalRequestRecord,
  ElectionRecord,
  MembershipAudience,
  MenuLink,
  Role,
  VoterElection,
} from 'ustp-domain';
import { SECTION_CAPTIONS, SECTION_LABELS } from './governance/navigation-text.js';

/** The signed-in home page (design §10.5): a card for each menu page and admin section the person is shown. */

/** A menu page, an admin section (as a start page names it: Offices is both), or the account. */
export type HomeCardKey = Exclude<MenuLink, 'admin' | 'signin'> | `admin/${AdminSection}` | 'account';

export interface HomeCard {
  readonly key: HomeCardKey;
  readonly title: string;
  readonly text: string;
  readonly to: string;
  /** The button's text; it names the card, so every button's name differs. */
  readonly action: string;
}

const REGISTER: Readonly<Record<Exclude<MembershipAudience, 'signed_out'>, Omit<HomeCard, 'key' | 'to'>>> = {
  no_membership: {
    title: 'Become a member',
    text: 'Apply to join the USTP: read the bylaws and fill in the application. A Membership Admin decides it.',
    action: 'Register as a member',
  },
  applicant: {
    title: 'Your application',
    text: 'Your application is waiting for a Membership Admin to decide it.',
    action: 'Follow your application',
  },
  active: {
    title: 'Your membership',
    text: 'You are an Active member: voter rolls are taken from Active members when an election is set up.',
    action: 'See your membership',
  },
  lapsed: {
    title: 'Your membership',
    text: 'Your membership has lapsed. A Membership Admin can renew it.',
    action: 'See your membership',
  },
  suspended: {
    title: 'Your membership',
    text: 'Your membership is suspended until a Membership Admin reinstates it.',
    action: 'See your membership',
  },
  resigned: {
    title: 'Rejoin the USTP',
    text: 'You resigned your membership. You can apply to join again.',
    action: 'Apply again',
  },
  rejected: {
    title: 'Apply again',
    text: 'Your last application was not accepted. You can apply to join again.',
    action: 'Apply again',
  },
};

/** The cards for what someone is shown, menu pages first (the ballot leads), then admin sections, then their account. */
export function homeCards(
  shown: { readonly menu: readonly MenuLink[]; readonly sections: readonly AdminSection[] },
  membership: Exclude<MembershipAudience, 'signed_out'>,
  testingEnabled: boolean,
): HomeCard[] {
  const cards: HomeCard[] = [];
  if (shown.menu.includes('ballot')) {
    cards.push({
      key: 'ballot',
      title: 'Your ballots',
      text: 'Elections you are on the voter roll for: vote, and see the results.',
      to: '/ballot',
      action: 'Open your ballots',
    });
  }
  if (shown.menu.includes('register')) cards.push({ key: 'register', to: '/register', ...REGISTER[membership] });
  if (shown.menu.includes('verify')) {
    cards.push({
      key: 'verify',
      title: 'Verify a vote',
      text: 'Check that a ballot you cast was counted, from the receipt you saved.',
      to: '/verify',
      action: 'Verify a receipt',
    });
  }
  if (shown.menu.includes('offices')) {
    cards.push({
      key: 'offices',
      title: 'Party offices',
      text: 'Who holds each office now, and whether they were elected or appointed.',
      to: '/offices',
      action: 'See the offices',
    });
  }
  if (shown.menu.includes('candidates')) {
    cards.push({
      key: 'candidates',
      title: 'Candidates',
      text: 'Members running for public office, on a map. Running yourself? Declare it with your platform.',
      to: '/candidates',
      action: 'See the candidates',
    });
  }
  if (shown.menu.includes('course')) {
    cards.push({
      key: 'course',
      title: 'Transhumanism course',
      text: 'Read the public lessons, take quizzes when signed in, and earn a verified certificate.',
      to: '/course/transhumanism',
      action: 'Explore the course',
    });
  }
  if (shown.menu.includes('admin')) {
    for (const section of shown.sections) {
      if (section === 'testing' && !testingEnabled) continue;
      const title = SECTION_LABELS[section];
      cards.push({ key: `admin/${section}`, title, text: SECTION_CAPTIONS[section], to: `/admin?tab=${section}`, action: `Open ${title}` });
    }
  }
  cards.push({
    key: 'account',
    title: 'Your account',
    text: 'Logins, two-step verification, your profile photo and your details.',
    to: '/account',
    action: 'Open your account',
  });
  return cards;
}

/** A line under the signed-out home page's sign-in form: words, then a link, then the rest of the sentence. */
export interface VisitorLink {
  readonly key: Exclude<MenuLink, 'signin'>;
  readonly before: string;
  readonly label: string;
  readonly after: string;
  readonly to: string;
}

const VISITOR_LINKS: readonly VisitorLink[] = [
  { key: 'register', before: 'New to USTP? ', label: 'Register as a member', after: ': creating your login is the first step.', to: '/register' },
  { key: 'ballot', before: 'Members: ', label: 'see your ballots and vote', after: '.', to: '/ballot' },
  { key: 'verify', before: 'Voted already? ', label: 'Verify your receipt', after: ' to check that your vote was counted.', to: '/verify' },
  { key: 'offices', before: 'Who leads the party? ', label: 'See who holds each office', after: ', elected or appointed.', to: '/offices' },
  { key: 'candidates', before: 'Running for office? ', label: 'See the party’s candidates', after: ' and where they run.', to: '/candidates' },
  { key: 'course', before: 'Interested in the future? ', label: 'Explore the Transhumanism course', after: '.', to: '/course/transhumanism' },
  { key: 'admin', before: 'Party officers: ', label: 'open the admin console', after: '.', to: '/admin' },
];

/**
 * The signed-out home page's card (design §10.5): the sign-in form while visitors are shown Sign in, and a line for
 * each other menu page they are shown. Ballot and Admin only send a visitor to sign in, so they have a line only when
 * the form is not there.
 */
export function visitorCard(menu: readonly MenuLink[]): { signIn: boolean; links: VisitorLink[] } {
  const signIn = menu.includes('signin');
  const links = VISITOR_LINKS.filter((l) => menu.includes(l.key) && !(signIn && (l.key === 'ballot' || l.key === 'admin')));
  return { signIn, links };
}

/** "1 application", "3 applications". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What the person's ballot list holds now. */
export function ballotStatus(elections: readonly VoterElection[]): string {
  if (!elections.length) return 'You are not on the voter roll of any current election.';
  const toVote = elections.filter((e) => e.state === 'open' && !e.castAt).length;
  const soon = elections.filter((e) => e.state === 'scheduled').length;
  const parts = [toVote && `${count(toVote, 'election')} waiting for your vote`, soon && `${count(soon, 'election')} opening soon`];
  return parts.filter(Boolean).join(' · ') || 'Nothing to vote on right now.';
}

/** Elections in progress, by state: drafts, scheduled, open, and closed ones waiting for certification. */
export function electionsStatus(elections: readonly ElectionRecord[]): string {
  const by = (state: ElectionRecord['state']) => elections.filter((e) => e.state === state).length;
  const parts = [
    by('draft') && count(by('draft'), 'draft'),
    by('scheduled') && `${by('scheduled')} scheduled`,
    by('open') && `${by('open')} open`,
    by('closed') && `${by('closed')} closed, to certify`,
  ];
  return parts.filter(Boolean).join(' · ') || 'No elections in progress.';
}

/** Two-person requests this person could decide: their role approves it, and it is neither theirs nor about them. */
export function approvalsStatus(requests: readonly ApprovalRequestRecord[], accountId: string | undefined, roles: readonly Role[]): string {
  const mine = requests.filter((r) => roles.includes(r.approverRole) && r.requestedBy !== accountId && r.subject !== accountId);
  return mine.length ? `${count(mine.length, 'request')} waiting for your decision` : 'Nothing waiting for your decision.';
}

/** Applications or photos waiting for a Membership Admin, from a list the API cuts off at `limit`. */
export function waitingStatus(n: number, what: 'application' | 'photo', limit: number): string {
  if (n >= limit) return `${limit} or more ${what}s waiting for review`;
  return n ? `${count(n, what)} waiting for review` : `No ${what}s waiting for review.`;
}
