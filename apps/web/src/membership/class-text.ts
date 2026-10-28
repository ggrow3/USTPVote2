import { memberClass, type MemberClass, type MemberRecord } from 'ustp-domain';

/**
 * Wording for the answers to the membership questions (design §5.2): a member's class from the first, and Yes or No.
 * Plain TypeScript with no browser imports, so the Members list's logic can use it in unit tests.
 */

/** Each member class by its name, from the answer to "eligible to vote in any United States elections?". */
export const MEMBER_CLASS_LABELS: Readonly<Record<MemberClass, string>> = {
  united_states: 'United States Member',
  allied: 'Allied Member',
};

/** What a class or an answer says for someone never asked: they joined before the questions. */
export const CLASS_NOT_ASKED = 'Not asked';

/** "United States Member", "Allied Member", or "Not asked". */
export function memberClassText(usVoteEligible: boolean | null | undefined): string {
  const c = memberClass(usVoteEligible);
  return c ? MEMBER_CLASS_LABELS[c] : CLASS_NOT_ASKED;
}

/** A Yes or No answer, or "Not asked". */
export function answerText(answer: boolean | null | undefined): string {
  return typeof answer === 'boolean' ? (answer ? 'Yes' : 'No') : CLASS_NOT_ASKED;
}

/** A member's class, from their record. Records from before the question lack the answer. */
export function classOf(member: Pick<MemberRecord, 'usVoteEligible'>): MemberClass | null {
  return memberClass(member.usVoteEligible ?? null);
}
