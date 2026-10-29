import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import sharp, { type Metadata } from 'sharp';
import {
  checkPressAssets,
  EMPTY_PRESS_KIT,
  isPressAssetId,
  PRESS_ASSET_MAX_BYTES,
  PRESS_IMAGE_MAX_SIDE,
  pressFileName,
  publicBots,
  publicPressKit,
  savePressKit,
  type PressAssetRecord,
  type PressAssetType,
  type PressKitInput,
  type PressKitRecord,
  type PublicBot,
  type PublicPressKit,
} from 'ustp-domain';
import { accepted, assertCheck } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { CommunicationsRepository } from './communications.repository.js';

/** The Press page: the press kit and the party's public bots. */
export interface PressPage {
  readonly kit: PublicPressKit;
  readonly bots: readonly PublicBot[];
}

/** An image's stored size is stepped down until it fits a Firestore document. */
const SIDES = [PRESS_IMAGE_MAX_SIDE, 2400, 2000, 1600, 1200];

/**
 * Re-encodes an uploaded image upright, without its metadata (as profile photos): a PNG (kept lossless, for logos with
 * transparency) or a JPEG, at most `PRESS_IMAGE_MAX_SIDE` a side and `PRESS_ASSET_MAX_BYTES` stored.
 */
async function normalizeImage(input: Buffer): Promise<{ data: Buffer; type: PressAssetType; width: number; height: number }> {
  const options = { limitInputPixels: 50_000_000, failOn: 'error' } as const;
  let meta: Metadata;
  try {
    meta = await sharp(input, options).metadata();
  } catch {
    throw new BadRequestException('that file is not a readable image');
  }
  if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '')) throw new BadRequestException('use a PNG or JPEG image, or a PDF');
  const png = meta.format === 'png' || !!meta.hasAlpha;
  for (const side of SIDES) {
    const pipeline = sharp(input, options).rotate().resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true });
    const { data, info } = png
      ? await pipeline.png({ compressionLevel: 9, palette: false }).toBuffer({ resolveWithObject: true })
      : await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (data.length <= PRESS_ASSET_MAX_BYTES) return { data, type: png ? 'image/png' : 'image/jpeg', width: info.width, height: info.height };
  }
  throw new BadRequestException('that image is too large to keep even at 1200 pixels; try a simpler or smaller one');
}

/** A PDF is kept as sent: it must say it is one, and fit. */
function checkPdf(input: Buffer): Buffer {
  if (input.subarray(0, 5).toString('latin1') !== '%PDF-') throw new BadRequestException('that file is not a PDF');
  if (input.length > PRESS_ASSET_MAX_BYTES) throw new BadRequestException(`a PDF can be at most ${Math.floor(PRESS_ASSET_MAX_BYTES / 1000)} KB`);
  return input;
}

/** The press kit (design §10.7): the public Press page, and Communications Admins' edits and uploads. */
@Injectable()
export class PressKitService {
  constructor(
    private readonly firebase: Firebase,
    private readonly repo: CommunicationsRepository,
    private readonly ledger: LedgerService,
  ) {}

  private static record(stored: Partial<PressKitRecord> | null): PressKitRecord {
    return { ...EMPTY_PRESS_KIT, ...stored, contact: { ...EMPTY_PRESS_KIT.contact, ...stored?.contact } };
  }

  /** The kit as Communications Admins edit it. */
  async current(): Promise<PressKitRecord> {
    return PressKitService.record(await this.repo.pressKit());
  }

  async page(): Promise<PressPage> {
    const kit = await this.current();
    const [files, bots] = await Promise.all([this.repo.pressAssets(kit.assets.map((a) => a.id)), this.repo.allBots()]);
    return { kit: publicPressKit(kit, files), bots: publicBots(bots) };
  }

  /** Saves the kit from the version it was edited from; every file it lists must have been uploaded here. */
  async save(actor: string, input: PressKitInput): Promise<PressKitRecord> {
    return this.firebase.db.runTransaction(async (tx) => {
      const current = PressKitService.record(await this.repo.pressKit(tx));
      const files = await this.repo.pressAssets(input.assets.map((a) => a.id), tx);
      assertCheck(checkPressAssets(input, new Set(files.keys())), BadRequestException);
      const { kit, event } = accepted(savePressKit(current, input, actor, new Date().toISOString()));
      if (!event) return kit;
      await this.ledger.record(tx, [event]);
      this.repo.setPressKit(tx, kit);
      return kit;
    });
  }

  /**
   * Stores an uploaded file under the hash of its stored bytes and gives its record. It is offered only once the kit
   * is saved listing it, so uploading changes nothing the public sees.
   */
  async upload(actor: string, body: unknown, contentType: string, uploadedName: string): Promise<PressAssetRecord> {
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException('send the file as the request body');
    const file =
      contentType === 'application/pdf'
        ? { data: checkPdf(body), type: 'application/pdf' as const, width: null, height: null }
        : await normalizeImage(body);
    const id = createHash('sha256').update(file.data).digest('hex');
    const record: PressAssetRecord = {
      id,
      contentType: file.type,
      bytes: file.data.length,
      width: file.width,
      height: file.height,
      fileName: pressFileName(uploadedName, file.type),
      uploadedAt: new Date().toISOString(),
      uploadedBy: actor,
    };
    await this.repo.savePressAsset(record, file.data);
    return record;
  }

  /** A file the kit lists now; any other is not served, so nobody can use the site to hand out files. */
  async download(id: string): Promise<{ record: PressAssetRecord; data: Buffer }> {
    const kit = await this.current();
    const found = kit.assets.some((a) => a.id === id) ? await this.repo.pressAssetData(id) : null;
    if (!found) throw new NotFoundException('no such file in the press kit');
    return found;
  }

  /** A file uploaded here, listed or not, for Communications Admins to preview before saving the kit. */
  async preview(id: string): Promise<{ record: PressAssetRecord; data: Buffer }> {
    const found = isPressAssetId(id) ? await this.repo.pressAssetData(id) : null;
    if (!found) throw new NotFoundException('no such file');
    return found;
  }
}
