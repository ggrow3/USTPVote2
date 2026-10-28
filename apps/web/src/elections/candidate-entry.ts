import type { MemberMatch } from 'ustp-domain';

/**
 * Linking a question's option to the member standing (design §6.5): typing part of a name in an option offers the
 * Active members it matches, and choosing one links their account, under their legal name.
 */

/** The line under a match, so two members with the same name can be told apart: preferred name and state. */
export function matchCaption(match: MemberMatch): string {
  const known = match.preferredName && match.preferredName !== match.legalName ? `Known as ${match.preferredName}` : null;
  return [known, match.state || null].filter(Boolean).join(' · ');
}

/** Why a match cannot be linked in this question, or null. The api refuses your own account (recusal). */
export function unavailableReason(match: MemberMatch, selfId: string | null, standing: readonly string[]): string | null {
  if (match.accountId === selfId) return 'you cannot stand in an election you administer';
  if (standing.includes(match.accountId)) return 'already an option in this question';
  return null;
}

/** What screen readers hear when members match what was typed; nothing when none can be linked. */
export function matchesAnnouncement(choosable: number): string {
  if (choosable === 0) return '';
  const who = choosable === 1 ? 'An Active member matches' : `${choosable} Active members match`;
  return `${who}. Press the down arrow to link the option to ${choosable === 1 ? 'their' : 'one’s'} member account.`;
}
