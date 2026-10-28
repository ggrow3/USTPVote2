import type {
  ElectionDetail,
  ElectionRecord,
  MemberMatch,
  ProposalInput,
  ProposalSnapshotRecord,
  QuestionInput,
  SavedQuestion,
  UpdateElectionInput,
} from 'ustp-domain';
import { api } from '../api.js';

/**
 * The ballot builder's calls (design §6.5, §12): the election's details, its questions saved whole, their order, and
 * proposal texts. The rest of the election editor still calls its routes directly (W5 in docs/DOMAIN-MODEL.md).
 */

const electionUrl = (electionId: string) => `/v1/admin/elections/${encodeURIComponent(electionId)}`;

/** The election as the editor shows it, with the problems that block scheduling. */
export function electionDetail(electionId: string): Promise<ElectionDetail> {
  return api<ElectionDetail>('GET', electionUrl(electionId));
}

/** Changes the election's own fields (title, description, secrecy, window, anonymity threshold). */
export function updateElection(electionId: string, input: UpdateElectionInput): Promise<ElectionRecord> {
  return api<ElectionRecord>('PATCH', electionUrl(electionId), input);
}

/** Creates a question under the builder's ID (at `position`), or saves its rules and options whole. */
export function saveQuestion(electionId: string, contestId: string, input: QuestionInput): Promise<SavedQuestion> {
  return api<SavedQuestion>('PUT', `${electionUrl(electionId)}/questions/${encodeURIComponent(contestId)}`, input);
}

/** Puts the questions in this order; it must name every question once. */
export function reorderQuestions(electionId: string, contestIds: readonly string[]): Promise<void> {
  return api<void>('PUT', `${electionUrl(electionId)}/question-order`, { contestIds });
}

/** Deletes a question and its options. */
export function deleteQuestion(electionId: string, contestId: string): Promise<void> {
  return api<void>('DELETE', `${electionUrl(electionId)}/contests/${encodeURIComponent(contestId)}`);
}

/** Every proposal text captured so far, newest first (at most 200). */
export function proposalTexts(): Promise<ProposalSnapshotRecord[]> {
  return api<ProposalSnapshotRecord[]>('GET', '/v1/admin/proposals');
}

/** Captures a proposal text; it can never change afterwards. */
export function captureProposalText(input: ProposalInput): Promise<ProposalSnapshotRecord> {
  return api<ProposalSnapshotRecord>('POST', '/v1/admin/proposals', input);
}

/** Active members whose name matches, to link an option to the member standing (design §6.5). */
export function searchMembers(name: string): Promise<MemberMatch[]> {
  return api<MemberMatch[]>('GET', `/v1/admin/member-search?${new URLSearchParams({ name })}`);
}
