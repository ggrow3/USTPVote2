import type { CandidateInput, MemberMatch } from 'ustp-domain';

/**
 * The election editor's candidate field (design §6.5): a member chosen from the search, linked to their account, or a
 * name typed as it should appear on the ballot.
 */
export type CandidateEntry = MemberMatch | string | null;

export const isMember = (entry: CandidateEntry): entry is MemberMatch => entry !== null && typeof entry === 'object';

/** What the field shows: a member's legal name, which is also their name on the ballot, or the text typed. */
export const entryLabel = (entry: CandidateEntry): string => (isMember(entry) ? entry.legalName : (entry ?? ''));

/** The body of `POST …/candidates`; the api trims and checks the name. */
export function candidateBody(entry: CandidateEntry): CandidateInput {
  return isMember(entry) ? { name: entry.legalName, accountId: entry.accountId } : { name: entry ?? '' };
}

/**
 * The entry after the text in the field changed. The member chosen stays chosen while the text is their name (the
 * field fills it in on choosing); any other text is a typed name, no longer linked to anyone.
 */
export function afterTyping(entry: CandidateEntry, text: string): CandidateEntry {
  if (isMember(entry) && entry.legalName === text) return entry;
  return text === '' ? null : text;
}

/** The line under a match, so two members with the same name can be told apart: preferred name and state. */
export function matchCaption(match: MemberMatch): string {
  const known = match.preferredName && match.preferredName !== match.legalName ? `Known as ${match.preferredName}` : null;
  return [known, match.state || null].filter(Boolean).join(' · ');
}

/** Why a match cannot be chosen for this contest, or null. The api refuses your own account (recusal). */
export function unavailableReason(match: MemberMatch, selfId: string | null, standing: readonly string[]): string | null {
  if (match.accountId === selfId) return 'You cannot stand in an election you administer';
  if (standing.includes(match.accountId)) return 'Already a candidate in this contest';
  return null;
}

/** What screen readers hear when the search answers: how many members match, and how many of them can be chosen. */
export function matchesAnnouncement(count: number, choosable = count): string {
  if (count === 0) return 'No Active member matches. Add candidate adds the name as typed.';
  const matches = `${count} ${count === 1 ? 'member matches' : 'members match'}`;
  if (choosable === 0) return `${matches}, but cannot be chosen for this contest. Add candidate adds the name as typed.`;
  if (choosable < count) return `${matches}, ${choosable} can be chosen. Use the down arrow to choose.`;
  return `${matches}. Use the down arrow to choose.`;
}

/** The line under the field: whether adding links a member's account. */
export function entryStatus(entry: CandidateEntry): string {
  if (isMember(entry)) return `Links the member account of ${entry.legalName}${entry.state ? ` (${entry.state})` : ''}.`;
  if (entry?.trim()) return 'Not linked to a member: added as typed.';
  return 'Type part of a member’s name and choose them to link their account, or type any name.';
}
