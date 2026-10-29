import { z } from 'zod';
import { deny, OK, refuse, type Check, type Outcome } from '../check.js';
import type { LedgerEvent } from '../ledger-events.js';
import { changedFields, communicationsEvent, oneLine, stale, text } from './common.js';

/**
 * The press kit (design §10.7): what a journalist needs, on the public Press page: who to contact, the party's own
 * description of itself, a few facts, and files to download (logos, photos, a fact sheet). Communications Admins keep it;
 * each save is ledgered with what changed.
 */

export const PRESS_KIT_LIMITS = {
  about: 3000,
  contactName: 100,
  contactRole: 100,
  email: 254,
  phone: 40,
  contactNote: 200,
  factLabel: 60,
  factValue: 200,
  facts: 20,
  assetTitle: 80,
  assetDescription: 200,
  fileName: 100,
  assets: 20,
} as const;

/** Files the kit offers: images (re-encoded, so stripped of their metadata) and PDFs (kept as sent). */
export const PRESS_ASSET_TYPES = ['image/png', 'image/jpeg', 'application/pdf'] as const;
export type PressAssetType = (typeof PRESS_ASSET_TYPES)[number];

/** A Firestore document holds 1 MiB, so a file is stored in at most this many bytes (as the hub's images). */
export const PRESS_ASSET_MAX_BYTES = 900_000;

/** The largest side an image is kept at: plenty for print at a column's width. */
export const PRESS_IMAGE_MAX_SIDE = 3000;

/** An uploaded file's ID: the SHA-256 of its stored bytes, in hex. */
export const isPressAssetId = (id: string) => /^[0-9a-f]{64}$/.test(id);

const email = z
  .string()
  .trim()
  .max(PRESS_KIT_LIMITS.email)
  .default('')
  .pipe(z.union([z.literal(''), z.email('enter an email address, or leave it empty')]));

const phone = z
  .string()
  .trim()
  .max(PRESS_KIT_LIMITS.phone)
  .default('')
  .refine((v) => !v || /^\+?[0-9 ().-]{7,}$/.test(v), 'a phone number: digits, spaces, + ( ) . -');

export const pressContactSchema = z.strictObject({
  name: oneLine(PRESS_KIT_LIMITS.contactName).default(''),
  /** Their office ("Director of Communications"). */
  role: oneLine(PRESS_KIT_LIMITS.contactRole).default(''),
  email,
  phone,
  /** When to expect an answer, or how best to reach them. */
  note: oneLine(PRESS_KIT_LIMITS.contactNote).default(''),
});
export type PressContact = Readonly<z.output<typeof pressContactSchema>>;

export const pressFactSchema = z.strictObject({
  label: oneLine(PRESS_KIT_LIMITS.factLabel).pipe(z.string().min(1, 'a fact needs a label')),
  value: oneLine(PRESS_KIT_LIMITS.factValue).pipe(z.string().min(1, 'a fact needs a value')),
});
export type PressFact = Readonly<z.output<typeof pressFactSchema>>;

export const pressAssetSchema = z.strictObject({
  id: z.string().refine(isPressAssetId, 'upload the file again'),
  title: oneLine(PRESS_KIT_LIMITS.assetTitle).pipe(z.string().min(1, 'a file needs a title')),
  description: oneLine(PRESS_KIT_LIMITS.assetDescription).default(''),
});
export type PressAsset = Readonly<z.output<typeof pressAssetSchema>>;

const kitShape = {
  /** The party's own description of itself, for journalists to quote ("boilerplate"). */
  about: text(PRESS_KIT_LIMITS.about),
  contact: pressContactSchema,
  facts: z.array(pressFactSchema).max(PRESS_KIT_LIMITS.facts).default([]),
  assets: z
    .array(pressAssetSchema)
    .max(PRESS_KIT_LIMITS.assets)
    .default([])
    .refine((a) => new Set(a.map((x) => x.id)).size === a.length, 'a file is listed twice'),
};

export const pressKitContentSchema = z.strictObject(kitShape);
export type PressKit = Readonly<z.output<typeof pressKitContentSchema>>;

/** `PUT /v1/admin/communications/press-kit`: the whole kit, and the version it was edited from. */
export const pressKitSchema = z.strictObject({ ...kitShape, basedOn: z.number().int().min(0) });
export type PressKitInput = z.infer<typeof pressKitSchema>;

/** `press_kit/current`; version 0 (never saved) is empty. */
export interface PressKitRecord extends PressKit {
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

export const EMPTY_PRESS_KIT: PressKitRecord = {
  about: '',
  contact: { name: '', role: '', email: '', phone: '', note: '' },
  facts: [],
  assets: [],
  version: 0,
  updatedAt: null,
  updatedBy: null,
};

/** `press_assets/{sha256}`: an uploaded file as stored, listed in the kit or not yet. */
export interface PressAssetRecord {
  readonly id: string;
  readonly contentType: PressAssetType;
  readonly bytes: number;
  /** An image's size in pixels; null for a PDF. */
  readonly width: number | null;
  readonly height: number | null;
  /** The name it downloads as, from the name it was uploaded with. */
  readonly fileName: string;
  readonly uploadedAt: string;
  readonly uploadedBy: string;
}

/** A file's name as it downloads: its uploaded name's letters, digits, dots, dashes and underscores, with the right ending. */
export function pressFileName(uploaded: string, type: PressAssetType): string {
  const ending = type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg';
  const base = uploaded
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, PRESS_KIT_LIMITS.fileName - 5);
  return `${base || 'ustp-press'}.${ending}`;
}

const FIELDS = Object.keys(kitShape) as (keyof PressKit)[];

/** `press_kit.changed`: the kit's new version and which parts changed, with the files added and removed. */
export interface PressKitChangedPayload {
  readonly version: number;
  readonly fields: readonly (keyof PressKit)[];
  readonly assetsAdded: readonly string[];
  readonly assetsRemoved: readonly string[];
}

/** Whether every file the kit lists was uploaded here. */
export function checkPressAssets(kit: PressKit, uploaded: ReadonlySet<string>): Check {
  const missing = kit.assets.find((a) => !uploaded.has(a.id));
  return missing ? deny(`“${missing.title}” is not a file uploaded here; upload it again`) : OK;
}

/** The kit as saved from the version it was edited from, and its ledger entry (none when nothing changed). */
export function savePressKit(
  current: PressKitRecord,
  input: PressKitInput,
  actor: string,
  at: string,
): Outcome<{ kit: PressKitRecord; event: LedgerEvent | null }> {
  if (input.basedOn !== current.version) return refuse('conflict', stale('press kit'));
  const { basedOn: _, ...content } = input;
  const fields = changedFields(FIELDS, current, { ...current, ...content });
  if (!fields.length) return { ok: true, value: { kit: current, event: null } };
  const kit: PressKitRecord = { ...content, version: current.version + 1, updatedAt: at, updatedBy: actor };
  const before = new Set(current.assets.map((a) => a.id));
  const after = new Set(kit.assets.map((a) => a.id));
  const payload: PressKitChangedPayload = {
    version: kit.version,
    fields,
    assetsAdded: [...after].filter((id) => !before.has(id)),
    assetsRemoved: [...before].filter((id) => !after.has(id)),
  };
  return { ok: true, value: { kit, event: communicationsEvent('press_kit.changed', actor, null, payload) } };
}

/** A file as the Press page lists it. */
export interface PublicPressAsset extends PressAsset {
  readonly contentType: PressAssetType;
  readonly bytes: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly fileName: string;
}

/** `GET /v1/press`: the kit as the Press page shows it (without who changed it), with the party's public bots. */
export interface PublicPressKit {
  readonly version: number;
  readonly about: string;
  readonly contact: PressContact;
  readonly facts: readonly PressFact[];
  readonly assets: readonly PublicPressAsset[];
  readonly updatedAt: string | null;
}

export function publicPressKit(kit: PressKitRecord, files: ReadonlyMap<string, PressAssetRecord>): PublicPressKit {
  return {
    version: kit.version,
    about: kit.about,
    contact: kit.contact,
    facts: kit.facts,
    assets: kit.assets.flatMap((a) => {
      const file = files.get(a.id);
      return file ? [{ ...a, contentType: file.contentType, bytes: file.bytes, width: file.width, height: file.height, fileName: file.fileName }] : [];
    }),
    updatedAt: kit.updatedAt,
  };
}
