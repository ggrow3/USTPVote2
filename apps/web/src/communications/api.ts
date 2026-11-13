import type {
  BotRecord,
  CalendarItemRecord,
  CalendarStatusInput,
  CreateBotInput,
  CreateCalendarItemInput,
  CreateEventInput,
  CreateNewsInput,
  CreatePartnerInput,
  EventRecord,
  CreateSharePostInput,
  MemberSharePost,
  NewsPostRecord,
  PartnerConsentInput,
  PartnerRecord,
  PressAssetRecord,
  PressKitInput,
  PressKitRecord,
  PublicBot,
  PublicEvent,
  PublicEventsPage,
  PublicNewsPost,
  PublicNewsSummary,
  PublicPartnersPage,
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
  UpdateEventInput,
  UpdateNewsInput,
  UpdatePartnerInput,
  UpdateSharePostInput,
} from 'ustp-domain';
import { api, apiBlob, apiUpload } from '../api.js';

/**
 * The communications context's API (design §10.9, §10.17, §12): the only place its routes are written. The public
 * reads `/v1/news`, `/v1/press`, `/v1/public/events` and `/v1/public/partners` and sends `/v1/suggestions`; Active
 * members read `/v1/share`; Communications Admins use `/v1/admin/communications`.
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

/** The Events and Partners pages (design §10.17), and each event's page. Calendar files are opened as links. */
export const eventsPage = () => api<PublicEventsPage>('GET', '/v1/public/events');
export const publicEvent = (slug: string) => api<PublicEvent>('GET', `/v1/public/events/${id(slug)}`);
export const partnersPage = () => api<PublicPartnersPage>('GET', '/v1/public/partners');

export const shareKit = () => api<MemberSharePost[]>('GET', '/v1/share');

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

export const adminEvents = () => api<EventRecord[]>('GET', `${ADMIN}/events`);
export const createEvent = (input: CreateEventInput) => api<EventRecord>('POST', `${ADMIN}/events`, input);
export const saveEvent = (eventId: string, input: UpdateEventInput) => api<EventRecord>('PUT', `${ADMIN}/events/${id(eventId)}`, input);
export const publishEvent = (eventId: string, basedOn: number) => api<EventRecord>('POST', `${ADMIN}/events/${id(eventId)}/publish`, { basedOn });
export const cancelEvent = (eventId: string, basedOn: number) => api<EventRecord>('POST', `${ADMIN}/events/${id(eventId)}/cancel`, { basedOn });
export const deleteEvent = (eventId: string) => api<void>('DELETE', `${ADMIN}/events/${id(eventId)}`);

export const adminPartners = () => api<PartnerRecord[]>('GET', `${ADMIN}/partners`);
export const addPartner = (input: CreatePartnerInput) => api<PartnerRecord>('POST', `${ADMIN}/partners`, input);
export const savePartner = (partnerId: string, input: UpdatePartnerInput) => api<PartnerRecord>('PUT', `${ADMIN}/partners/${id(partnerId)}`, input);
export const recordConsent = (partnerId: string, input: PartnerConsentInput) =>
  api<PartnerRecord>('POST', `${ADMIN}/partners/${id(partnerId)}/consent`, input);
export const withdrawConsent = (partnerId: string, basedOn: number) =>
  api<PartnerRecord>('POST', `${ADMIN}/partners/${id(partnerId)}/withdraw-consent`, { basedOn });
export const removePartner = (partnerId: string) => api<void>('DELETE', `${ADMIN}/partners/${id(partnerId)}`);

export const bots = () => api<BotRecord[]>('GET', `${ADMIN}/bots`);
export const addBot = (input: CreateBotInput) => api<BotRecord>('POST', `${ADMIN}/bots`, input);
export const saveBot = (botId: string, input: UpdateBotInput) => api<BotRecord>('PUT', `${ADMIN}/bots/${id(botId)}`, input);
export const botChecked = (botId: string, basedOn: number) => api<BotRecord>('POST', `${ADMIN}/bots/${id(botId)}/checked`, { basedOn });
export const removeBot = (botId: string) => api<void>('DELETE', `${ADMIN}/bots/${id(botId)}`);
