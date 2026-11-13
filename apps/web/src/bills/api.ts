import type {
  BillDetail,
  BillNoteView,
  BillRecentPage,
  BillRef,
  BillsAccess,
  BillSearchPage,
  BillSettingsView,
  BillText,
  BillTopic,
  BillWatchEntry,
  BillWatchSort,
  PartyPosition,
  PublicBillCard,
  PublicBillTeamView,
  PublicBillView,
  ScorecardMemberView,
  ScorecardView,
} from 'ustp-domain';
import { api } from '../api.js';

/**
 * The bills context's API (design §5.14, §12): the only place its routes are written. The legislative team uses
 * `/v1/bills`; System Admins name the teams that have it at `/v1/admin/bills`; everyone reads the public Legislation
 * page and scorecard at `/v1/public/bills` and `/v1/public/scorecard`.
 */

const enc = encodeURIComponent;
const bill = (ref: BillRef) => `/v1/bills/${ref.congress}/${enc(ref.type)}/${ref.number}`;

/** Query parameters with the empty ones left out. */
function query(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const billsAccess = () => api<BillsAccess>('GET', '/v1/bills/access');

export interface SearchParams {
  readonly q?: string;
  readonly congress?: number;
  readonly type?: string | null;
  readonly stage?: string | null;
  readonly member?: string;
  readonly from?: string;
  readonly to?: string;
  readonly sort?: string | null;
  readonly cursor?: string | null;
}

export const searchBills = (params: SearchParams) => api<BillSearchPage>('GET', `/v1/bills/search${query({ ...params })}`);

export interface RecentParams {
  readonly congress?: number;
  readonly type?: string | null;
  readonly from?: string;
  readonly to?: string;
  readonly sort?: string | null;
  readonly page?: number;
}

export const recentBills = (params: RecentParams) => api<BillRecentPage>('GET', `/v1/bills/recent${query({ ...params })}`);

export const getBill = (ref: BillRef) => api<BillDetail>('GET', bill(ref));

export const getBillText = (ref: BillRef, version: string) => api<BillText>('GET', `${bill(ref)}/text/${enc(version)}`);

export const getWatchlist = (sort: BillWatchSort, tag: string | null) => api<BillWatchEntry[]>('GET', `/v1/bills/watchlist${query({ sort, tag })}`);

/** Adds a bill (`basedOn` null) or changes its tags (`basedOn` the version shown). */
export const watchBill = (id: string, tags: readonly string[], basedOn: number | null) =>
  api<BillWatchEntry>('PUT', `/v1/bills/watchlist/${enc(id)}`, { tags, basedOn });

export const unwatchBill = (id: string) => api<{ removed: true; notes: number }>('DELETE', `/v1/bills/watchlist/${enc(id)}`);

export const addBillNote = (id: string, text: string) => api<BillNoteView>('POST', `/v1/bills/watchlist/${enc(id)}/notes`, { text });

export const editBillNote = (noteId: string, text: string) => api<BillNoteView>('PUT', `/v1/bills/notes/${enc(noteId)}`, { text });

export const deleteBillNote = (noteId: string) => api<{ deleted: true }>('DELETE', `/v1/bills/notes/${enc(noteId)}`);

export const billSettings = () => api<BillSettingsView>('GET', '/v1/admin/bills');

export const saveBillSettings = (teamIds: readonly string[], basedOn: number) => api<BillSettingsView>('PUT', '/v1/admin/bills', { teamIds, basedOn });

/** Shows a watched bill on the public Legislation page (`basedOn` null), or changes what the public sees of it. */
export const savePublicBill = (id: string, body: { topic: BillTopic; summary: string; positions: Record<string, PartyPosition>; basedOn: number | null }) =>
  api<PublicBillTeamView>('PUT', `/v1/bills/watchlist/${enc(id)}/public`, body);

export const withdrawPublicBill = (id: string) => api<{ withdrawn: true }>('DELETE', `/v1/bills/watchlist/${enc(id)}/public`);

export const publicBills = (topic: BillTopic | null) => api<PublicBillCard[]>('GET', `/v1/public/bills${query({ topic })}`);

export const publicBill = (id: string) => api<PublicBillView>('GET', `/v1/public/bills/${enc(id)}`);

export const publicScorecard = () => api<ScorecardView>('GET', '/v1/public/scorecard');

export const scorecardMember = (memberId: string) => api<ScorecardMemberView>('GET', `/v1/public/scorecard/${enc(memberId)}`);
