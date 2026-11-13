import { z } from 'zod';
import { refuse, type Outcome } from '../check.js';
import type { LedgerEvent } from '../ledger-events.js';
import { addressSchema, basedOnSchema, changedFields, communicationsEvent, oneLine, stale, text } from './common.js';

/**
 * Partner groups (design §10.17): the allied organisations the party co-hosts events with and offers its courses to.
 * Communications Admins keep the list. A group is named in public, on the Partners page and on the events it
 * co-hosts, only once the team has recorded that it agreed to be: who at the group agreed, when, and how. Until then,
 * or once that consent is withdrawn, it stays on the team's list only. Every change is in the audit ledger, since
 * listing a group is something the party says in public.
 */

export const PARTNER_LIMITS = { name: 120, description: 600, consentFrom: 120, consentNote: 500, notes: 2000 } as const;

const contentShape = {
  name: oneLine(PARTNER_LIMITS.name).pipe(z.string().min(1, 'enter the group’s name')),
  /** What the group does, in its own words if it gave some: shown on the Partners page. */
  description: text(PARTNER_LIMITS.description),
  /** Its site, an `https://` address; empty for none. */
  website: addressSchema(false),
  /** For the team only: who to talk to there, what was agreed. Never shown in public. */
  notes: text(PARTNER_LIMITS.notes),
};

export const partnerContentSchema = z.strictObject(contentShape);
export type PartnerContent = Readonly<z.output<typeof partnerContentSchema>>;

/** `POST /v1/admin/communications/partners`: a group on the team's list, not yet listed in public. */
export const createPartnerSchema = partnerContentSchema;
export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;

/** `PUT …/partners/{partnerId}` */
export const updatePartnerSchema = z.strictObject({ ...contentShape, basedOn: basedOnSchema });
export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>;

/** `POST …/partners/{partnerId}/consent`: the group agreed to be listed. */
export const partnerConsentSchema = z.strictObject({
  basedOn: basedOnSchema,
  /** Who at the group agreed, and as what ("Jo Smith, chair"). */
  from: oneLine(PARTNER_LIMITS.consentFrom).pipe(z.string().min(1, 'say who at the group agreed')),
  /** How it was given ("by email, 10 November"). */
  note: text(PARTNER_LIMITS.consentNote),
});
export type PartnerConsentInput = z.infer<typeof partnerConsentSchema>;

/** `POST …/partners/{partnerId}/withdraw-consent` */
export const partnerVersionSchema = z.strictObject({ basedOn: basedOnSchema });
export type PartnerVersionInput = z.infer<typeof partnerVersionSchema>;

/** The group's agreement to be named in public, as the team recorded it. */
export interface PartnerConsent {
  readonly from: string;
  readonly note: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
}

/** `partners/{partnerId}` */
export interface PartnerRecord extends PartnerContent {
  readonly partnerId: string;
  /** Null until the group agrees to be listed, and again once it asks not to be. */
  readonly consent: PartnerConsent | null;
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/** Whether the public may see the group: only once it agreed. */
export const partnerListed = (partner: Pick<PartnerRecord, 'consent'>): boolean => partner.consent !== null;

const FIELDS = Object.keys(contentShape) as (keyof PartnerContent)[];

/** `partner.changed` */
export interface PartnerChangedPayload {
  readonly partnerId: string;
  readonly change: 'added' | 'updated' | 'consent_recorded' | 'consent_withdrawn' | 'removed';
  readonly name: string;
  readonly listed: boolean;
  readonly version: number;
  readonly fields?: readonly (keyof PartnerContent)[];
}

const partnerEvent = (actor: string, partner: PartnerRecord, change: PartnerChangedPayload['change'], fields?: (keyof PartnerContent)[]) =>
  communicationsEvent('partner.changed', actor, partner.partnerId, {
    partnerId: partner.partnerId,
    change,
    name: partner.name,
    listed: change !== 'removed' && partnerListed(partner),
    version: partner.version,
    ...(fields && { fields }),
  } satisfies PartnerChangedPayload);

export function addPartner(input: CreatePartnerInput, partnerId: string, actor: string, at: string): { partner: PartnerRecord; event: LedgerEvent } {
  const partner: PartnerRecord = { partnerId, ...input, consent: null, version: 1, createdAt: at, createdBy: actor, updatedAt: at, updatedBy: actor };
  return { partner, event: partnerEvent(actor, partner, 'added') };
}

export function updatePartner(
  partner: PartnerRecord | null,
  input: PartnerContent,
  basedOn: number,
  actor: string,
  at: string,
): Outcome<{ partner: PartnerRecord; event: LedgerEvent | null }> {
  if (!partner) return refuse('not_found', 'no such partner');
  if (basedOn !== partner.version) return refuse('conflict', stale('partner'));
  const next = { ...partner, ...input };
  const fields = changedFields(FIELDS, partner, next);
  if (!fields.length) return { ok: true, value: { partner, event: null } };
  const updated: PartnerRecord = { ...next, version: partner.version + 1, updatedAt: at, updatedBy: actor };
  // Notes are the team's own: changing only them is not something the party says.
  const event = fields.every((f) => f === 'notes') ? null : partnerEvent(actor, updated, 'updated', fields);
  return { ok: true, value: { partner: updated, event } };
}

/** The group agreed to be listed: it is on the Partners page, and named on the events it co-hosts, at once. */
export function recordPartnerConsent(
  partner: PartnerRecord | null,
  input: Omit<PartnerConsentInput, 'basedOn'>,
  basedOn: number,
  actor: string,
  at: string,
): Outcome<{ partner: PartnerRecord; event: LedgerEvent }> {
  if (!partner) return refuse('not_found', 'no such partner');
  if (basedOn !== partner.version) return refuse('conflict', stale('partner'));
  if (partner.consent) return refuse('conflict', 'its consent is already recorded; withdraw it first to record it again');
  const consented: PartnerRecord = {
    ...partner,
    consent: { from: input.from, note: input.note, recordedAt: at, recordedBy: actor },
    version: partner.version + 1,
    updatedAt: at,
    updatedBy: actor,
  };
  return { ok: true, value: { partner: consented, event: partnerEvent(actor, consented, 'consent_recorded') } };
}

/** The group asked not to be listed, or the team stops listing it: it leaves the public pages at once. */
export function withdrawPartnerConsent(partner: PartnerRecord | null, basedOn: number, actor: string, at: string): Outcome<{ partner: PartnerRecord; event: LedgerEvent }> {
  if (!partner) return refuse('not_found', 'no such partner');
  if (basedOn !== partner.version) return refuse('conflict', stale('partner'));
  if (!partner.consent) return refuse('conflict', 'it is not listed');
  const withdrawn: PartnerRecord = { ...partner, consent: null, version: partner.version + 1, updatedAt: at, updatedBy: actor };
  return { ok: true, value: { partner: withdrawn, event: partnerEvent(actor, withdrawn, 'consent_withdrawn') } };
}

/** Takes the group off the team's list; the events it co-hosted no longer name it. */
export function removePartner(partner: PartnerRecord | null, actor: string): Outcome<LedgerEvent> {
  if (!partner) return refuse('not_found', 'no such partner');
  return { ok: true, value: partnerEvent(actor, partner, 'removed') };
}

/** A co-host as an event names it: a listed group only. */
export interface PublicPartnerRef {
  readonly partnerId: string;
  readonly name: string;
  readonly website: string;
}

/** Of `ids`, in that order, the groups that are listed. */
export function listedPartners(ids: readonly string[], partners: ReadonlyMap<string, PartnerRecord>): PublicPartnerRef[] {
  return ids.flatMap((id) => {
    const partner = partners.get(id);
    return partner && partnerListed(partner) ? [{ partnerId: partner.partnerId, name: partner.name, website: partner.website }] : [];
  });
}

/** A group as the Partners page lists it, with the events it co-hosts there. */
export interface PublicPartner extends PublicPartnerRef {
  readonly description: string;
  /** When it agreed to be listed. */
  readonly since: string;
}

/** The listed groups, by name. */
export function publicPartners(partners: readonly PartnerRecord[]): PublicPartner[] {
  return partners
    .filter(partnerListed)
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.partnerId.localeCompare(b.partnerId))
    .map((p) => ({ partnerId: p.partnerId, name: p.name, website: p.website, description: p.description, since: p.consent!.recordedAt }));
}
