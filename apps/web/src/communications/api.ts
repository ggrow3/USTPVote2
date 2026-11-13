import { POLL_VOTER_HEADER } from 'ustp-domain';
import type {
  AdminPoll,
  BotRecord,
  CalendarItemRecord,
  CalendarStatusInput,
  CreateBotInput,
  CreateCalendarItemInput,
  CreateNewsInput,
  CreatePollInput,
  CreateSharePostInput,
  MemberSharePost,
  NewsPostRecord,
  PressAssetRecord,
  PressKitInput,
  PollVoteInput,
  PressKitRecord,
  PublicBot,
  PublicNewsPost,
  PublicNewsSummary,
  PublicPoll,
  PublicPressKit,
  ShareCountsRecord,
  ShareItem,
  SharePostRecord,
  ShareTarget,
  SuggestionInput,
  SuggestionRecord,
  SuggestionTriageInput,
  UpdateBotInput,
  UpdateCalendarItemInput,
  UpdateNewsInput,
  UpdatePollInput,
  UpdateSharePostInput,
} from 'ustp-domain';
import { api, apiBlob, apiUpload } from '../api.js';

/**
 * The communications context's API (design §10.9, §12): the only place its routes are written. The public reads
 * `/v1/news` and `/v1/press` and sends `/v1/suggestions`; Active members read `/v1/share`; Communications Admins use
 * `/v1/admin/communications`.
 */

const ADMIN = '/v1/admin/communications';
const id = encodeURIComponent;

// --- Public ----------------------------------------------------------------------------------------------------------

export const newsList = () => api<PublicNewsSummary[]>('GET', '/v1/news');
export const newsPost = (slug: string) => api<PublicNewsPost>('GET', `/v1/news/${id(slug)}`);

/** The feeds' addresses, for links (feed readers and bots fetch them; the page does not). */
export const FEEDS = { rss: '/v1/news/feed.xml', json: '/v1/news/feed.json' } as const;

/** Where Communications Admins upload videos for news posts and the press kit, a part at a time (design §10.10). */
export const VIDEO_UPLOADS = '/v1/admin/communications/videos';

export const pressPage = () => api<{ kit: PublicPressKit; bots: PublicBot[] }>('GET', '/v1/press');
export const pressAssetUrl = (assetId: string) => `/v1/press/assets/${id(assetId)}`;

/** The route is public but App Checked (design §10.9), so the form gets a token even when nobody is signed in. */
export const sendSuggestion = (input: Partial<SuggestionInput>) =>
  api<{ received: true }>('POST', '/v1/suggestions', input, { appCheck: true });

export const shareKit = () => api<MemberSharePost[]>('GET', '/v1/share');

/**
 * Issue polls (design §10.15). A signed-out browser shows its token, so the api can tell whether it answered; someone
 * signed in with an account reads and answers as themself. A signed-out answer is App Checked, as the suggestions form.
 */
const voterHeaders = (voter: string) => ({ headers: { [POLL_VOTER_HEADER]: voter } });
export const pollsList = (voter: string) => api<PublicPoll[]>('GET', '/v1/polls', undefined, voterHeaders(voter));
export const pollView = (pollId: string, voter: string, signedIn: boolean) =>
  api<PublicPoll>('GET', signedIn ? `/v1/polls/${id(pollId)}/mine` : `/v1/polls/${id(pollId)}`, undefined, voterHeaders(voter));
export const answerPoll = (pollId: string, input: PollVoteInput, signedIn: boolean) =>
  signedIn
    ? api<PublicPoll>('POST', `/v1/polls/${id(pollId)}/member-votes`, input)
    : api<PublicPoll>('POST', `/v1/polls/${id(pollId)}/votes`, input, { appCheck: true });

/** Counts a press of a share button; never fails the share itself. */
export function countShare(item: ShareItem, target: ShareTarget): void {
  void fetch('/v1/share/clicks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ item, target }),
    keepalive: true,
  }).catch(() => undefined);
}

// --- Communications Admins -------------------------------------------------------------------------------------------

export const adminNews = () => api<NewsPostRecord[]>('GET', `${ADMIN}/news`);
export const createNews = (input: CreateNewsInput) => api<NewsPostRecord>('POST', `${ADMIN}/news`, input);
export const saveNews = (postId: string, input: UpdateNewsInput) => api<NewsPostRecord>('PUT', `${ADMIN}/news/${id(postId)}`, input);
export const publishNews = (postId: string, basedOn: number) => api<NewsPostRecord>('POST', `${ADMIN}/news/${id(postId)}/publish`, { basedOn });
export const withdrawNews = (postId: string, basedOn: number) => api<NewsPostRecord>('POST', `${ADMIN}/news/${id(postId)}/withdraw`, { basedOn });
export const deleteNews = (postId: string) => api<void>('DELETE', `${ADMIN}/news/${id(postId)}`);

export const adminShare = () => api<SharePostRecord[]>('GET', `${ADMIN}/share`);
export const shareCounts = () => api<ShareCountsRecord[]>('GET', `${ADMIN}/share-counts`);
export const createShare = (input: CreateSharePostInput) => api<SharePostRecord>('POST', `${ADMIN}/share`, input);
export const saveShare = (shareId: string, input: UpdateSharePostInput) => api<SharePostRecord>('PUT', `${ADMIN}/share/${id(shareId)}`, input);
export const publishShare = (shareId: string, basedOn: number) => api<SharePostRecord>('POST', `${ADMIN}/share/${id(shareId)}/publish`, { basedOn });
export const archiveShare = (shareId: string, basedOn: number) => api<SharePostRecord>('POST', `${ADMIN}/share/${id(shareId)}/archive`, { basedOn });
export const deleteShare = (shareId: string) => api<void>('DELETE', `${ADMIN}/share/${id(shareId)}`);

export const calendar = () => api<CalendarItemRecord[]>('GET', `${ADMIN}/calendar`);
export const team = () => api<{ accountId: string; name: string }[]>('GET', `${ADMIN}/team`);
export const createCalendarItem = (input: CreateCalendarItemInput) => api<CalendarItemRecord>('POST', `${ADMIN}/calendar`, input);
export const saveCalendarItem = (itemId: string, input: UpdateCalendarItemInput) => api<CalendarItemRecord>('PUT', `${ADMIN}/calendar/${id(itemId)}`, input);
export const setCalendarStatus = (itemId: string, input: CalendarStatusInput) => api<CalendarItemRecord>('POST', `${ADMIN}/calendar/${id(itemId)}/status`, input);
export const deleteCalendarItem = (itemId: string) => api<void>('DELETE', `${ADMIN}/calendar/${id(itemId)}`);

export const suggestions = () => api<SuggestionRecord[]>('GET', `${ADMIN}/suggestions`);
export const triageSuggestion = (suggestionId: string, input: SuggestionTriageInput) =>
  api<SuggestionRecord>('PUT', `${ADMIN}/suggestions/${id(suggestionId)}`, input);
export const deleteSuggestion = (suggestionId: string) => api<void>('DELETE', `${ADMIN}/suggestions/${id(suggestionId)}`);

export const adminPressKit = () => api<PressKitRecord>('GET', `${ADMIN}/press-kit`);
export const savePressKit = (input: PressKitInput) => api<PressKitRecord>('PUT', `${ADMIN}/press-kit`, input);
export const uploadPressAsset = (file: File) => apiUpload<PressAssetRecord>(`${ADMIN}/press-kit/assets?name=${id(file.name)}`, file);
/** An uploaded file, listed or not, as a blob (it needs the admin's sign-in, which an <img> cannot send). */
export const pressAssetBlob = (assetId: string) => apiBlob(`${ADMIN}/press-kit/assets/${id(assetId)}`);

export const bots = () => api<BotRecord[]>('GET', `${ADMIN}/bots`);
export const addBot = (input: CreateBotInput) => api<BotRecord>('POST', `${ADMIN}/bots`, input);
export const saveBot = (botId: string, input: UpdateBotInput) => api<BotRecord>('PUT', `${ADMIN}/bots/${id(botId)}`, input);
export const botChecked = (botId: string, basedOn: number) => api<BotRecord>('POST', `${ADMIN}/bots/${id(botId)}/checked`, { basedOn });
export const removeBot = (botId: string) => api<void>('DELETE', `${ADMIN}/bots/${id(botId)}`);

export const adminPolls = () => api<AdminPoll[]>('GET', `${ADMIN}/polls`);
export const createPoll = (input: CreatePollInput) => api<AdminPoll>('POST', `${ADMIN}/polls`, input);
export const savePoll = (pollId: string, input: UpdatePollInput) => api<AdminPoll>('PUT', `${ADMIN}/polls/${id(pollId)}`, input);
export const publishPollNow = (pollId: string, basedOn: number) => api<AdminPoll>('POST', `${ADMIN}/polls/${id(pollId)}/publish`, { basedOn });
export const closePollNow = (pollId: string, basedOn: number) => api<AdminPoll>('POST', `${ADMIN}/polls/${id(pollId)}/close`, { basedOn });
export const deletePoll = (pollId: string) => api<void>('DELETE', `${ADMIN}/polls/${id(pollId)}`);
