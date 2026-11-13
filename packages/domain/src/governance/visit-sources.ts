import { sha256Hex } from 'ustp-audit';
import { REFERRAL_PARAM } from '../referrals/referrals.js';
import { trackedPageById, type VisitFromInput } from './page-visits.js';

/**
 * Where visitors came from (design §10.7, the party's decisions of 2026-11-12): the first page someone opens in a
 * browser tab is counted with the site that sent them, as its host alone (`facebook.com`, never the rest of the
 * address, which can hold search words or private links), and the campaign tags of the address they arrived at
 * (`utm_source`, `utm_medium`, `utm_campaign`), and whether it was a member's referral link (never whose). The web app
 * reads these from the landing address and sends them as fields of their own, never the address's query. Counts per UTC
 * day, naming nobody, even for someone signed in, so they are kept for good like the pages' hits.
 */

/** The campaign tags counted, as the address names them. */
export const CAMPAIGN_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;
/** What the web app takes off the address once it has read it, so a shared or reloaded link is not counted twice. */
export const LANDING_PARAMS = [...CAMPAIGN_PARAMS, 'utm_term', 'utm_content', 'utm_id', REFERRAL_PARAM] as const;

/** The longest a tag is kept; a longer one is cut. */
export const VISIT_TAG_MAX = 64;
const HOST_MAX = 253;


/** Where one arrival came from, as counted. Null where it had none. */
export interface VisitSource {
  /** The referring site's host, lower case, without a leading `www.`; never this site's own. */
  readonly referrer: string | null;
  readonly source: string | null;
  readonly medium: string | null;
  readonly campaign: string | null;
  /** It came by a member's referral link (design §5.17); never whose. */
  readonly referral: boolean;
}

const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** A host as counted: lower case, no `www.`, no trailing dot; null for anything else. */
export function referrerHost(value: string | undefined | null): string | null {
  if (!value) return null;
  const host = value.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return host.length <= HOST_MAX && HOST.test(host) ? host : null;
}

/** A tag as counted: lower case, letters, digits and `-_.~+:@!/` only (anything else becomes `_`), runs of space as one, cut at `VISIT_TAG_MAX`. */
export function campaignTag(value: string | undefined | null): string | null {
  if (!value) return null;
  const tag = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[^a-z0-9 \-_.~+:@!/]/g, '_')
    .slice(0, VISIT_TAG_MAX)
    .trim();
  return tag || null;
}

/** Where an arrival came from, made tidy; `ownHost` (this site's) is never a referrer. */
export function visitSource(from: VisitFromInput, ownHost: string | null): VisitSource {
  const host = referrerHost(from.referrer);
  const own = referrerHost(ownHost);
  return {
    referrer: host && host !== own ? host : null,
    source: campaignTag(from.source),
    medium: campaignTag(from.medium),
    campaign: campaignTag(from.campaign),
    referral: from.referral === true,
  };
}

/** Whether an arrival came with nothing: no other site, no tag, no referral link (typed in, a bookmark, an app). */
export function isDirect(source: VisitSource): boolean {
  return !source.referrer && !source.source && !source.medium && !source.campaign && !source.referral;
}

/**
 * What the web app sends with the first page of a tab: from the landing address's query (`search`, as
 * `location.search`) and `document.referrer`; empty when there is nothing but this site itself.
 */
export function landingFrom(search: string, referrer: string, ownHost: string): VisitFromInput {
  const query = new URLSearchParams(search);
  let host: string | undefined;
  try {
    host = referrer ? new URL(referrer).hostname : undefined;
  } catch {
    host = undefined;
  }
  const from: VisitFromInput = {
    ...(host && referrerHost(host) !== referrerHost(ownHost) && { referrer: host }),
    ...(query.get('utm_source') && { source: query.get('utm_source')!.slice(0, 500) }),
    ...(query.get('utm_medium') && { medium: query.get('utm_medium')!.slice(0, 500) }),
    ...(query.get('utm_campaign') && { campaign: query.get('utm_campaign')!.slice(0, 500) }),
    ...(query.get(REFERRAL_PARAM) && { referral: true }),
  };
  return from;
}

/** The landing address without the tags it was read for (and none of the rest changed), or null when it had none. */
export function withoutLandingParams(query: Readonly<Record<string, unknown>>): Record<string, unknown> | null {
  if (!LANDING_PARAMS.some((p) => p in query)) return null;
  return Object.fromEntries(Object.entries(query).filter(([key]) => !(LANDING_PARAMS as readonly string[]).includes(key)));
}

/**
 * `visit_sources/{day}_{hash}`: arrivals on one UTC day at one page with the same source and tags. The hash is of the
 * page and the source, so the same arrival again is one more on the same record.
 */
export interface VisitSourceRecord extends VisitSource {
  readonly day: string;
  /** The tracked page they arrived at (`TRACKED_PAGES`). */
  readonly page: string;
  readonly count: number;
}

export function visitSourceId(day: string, page: string, source: VisitSource): string {
  const key = JSON.stringify([page, source.referrer, source.source, source.medium, source.campaign, source.referral]);
  return `${day}_${sha256Hex(key).slice(0, 24)}`;
}

/** The most records one report reads; past it, the report says it stopped short. */
export const VISIT_SOURCES_READ_MAX = 20_000;
/** Rows of each table the report gives, the most first. */
export const VISIT_SOURCES_ROWS = 100;

export interface VisitSourcesReport {
  /** Arrivals in the period (the first page opened in a tab), and per day in line with the report's `dayList`. */
  readonly arrivals: number;
  readonly daily: readonly number[];
  /** Of the arrivals: from another site, with any campaign tag, by a member's referral link, and with none of those. */
  readonly fromSites: number;
  readonly withCampaign: number;
  readonly byReferralLink: number;
  readonly direct: number;
  /** The referring sites, the most first. */
  readonly sites: readonly { readonly host: string; readonly arrivals: number }[];
  /** Each combination of tags, the most first. */
  readonly campaigns: readonly { readonly source: string | null; readonly medium: string | null; readonly campaign: string | null; readonly arrivals: number }[];
  /** The pages arrived at, the most first. */
  readonly landings: readonly { readonly page: string; readonly label: string; readonly arrivals: number }[];
  /** More records than `VISIT_SOURCES_READ_MAX` in the period: the oldest are left out. */
  readonly truncated: boolean;
}

function top<K extends string>(counts: Map<K, number>): [K, number][] {
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, VISIT_SOURCES_ROWS);
}

/** The report from the period's records (any order) and its days, oldest first. */
export function visitSourcesReport(input: { readonly dayList: readonly string[]; readonly records: readonly VisitSourceRecord[]; readonly truncated: boolean }): VisitSourcesReport {
  const inPeriod = new Set(input.dayList);
  const records = input.records.filter((r) => inPeriod.has(r.day) && r.count > 0);
  const sum = (rs: readonly VisitSourceRecord[]) => rs.reduce((n, r) => n + r.count, 0);
  const perDay = new Map<string, number>();
  const sites = new Map<string, number>();
  const campaigns = new Map<string, number>();
  const landings = new Map<string, number>();
  for (const r of records) {
    perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.count);
    if (r.referrer) sites.set(r.referrer, (sites.get(r.referrer) ?? 0) + r.count);
    if (r.source || r.medium || r.campaign) {
      const key = JSON.stringify([r.source, r.medium, r.campaign]);
      campaigns.set(key, (campaigns.get(key) ?? 0) + r.count);
    }
    landings.set(r.page, (landings.get(r.page) ?? 0) + r.count);
  }
  return {
    arrivals: sum(records),
    daily: input.dayList.map((d) => perDay.get(d) ?? 0),
    fromSites: sum(records.filter((r) => r.referrer)),
    withCampaign: sum(records.filter((r) => r.source || r.medium || r.campaign)),
    byReferralLink: sum(records.filter((r) => r.referral)),
    direct: sum(records.filter(isDirect)),
    sites: top(sites).map(([host, arrivals]) => ({ host, arrivals })),
    campaigns: top(campaigns).map(([key, arrivals]) => {
      const [source, medium, campaign] = JSON.parse(key) as [string | null, string | null, string | null];
      return { source, medium, campaign, arrivals };
    }),
    landings: top(landings).map(([page, arrivals]) => ({ page, label: trackedPageById(page)?.label ?? page, arrivals })),
    truncated: input.truncated,
  };
}
