import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Storage } from 'firebase-admin/storage';
import {
  Collections,
  photoVerdict,
  type PhotoCheckRecord,
  type PhotoDecisionInput,
  type ProfilePhotoRecord,
} from 'ustp-domain';
import { requireAccount, requireOwnAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PHOTO_CHECKER, type PhotoChecker } from './checker.js';
import { GravatarClient, GravatarError } from './gravatar.js';
import { normalizePhoto, PhotoInputError } from './image.js';

const CURRENT: readonly ProfilePhotoRecord['status'][] = ['accepted', 'needs_review'];

type Bucket = ReturnType<Storage['bucket']>;

/** Profile photos (design §5.3): normalized on upload, checked automatically, rejected only by a person. */
@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(PHOTO_CHECKER) private readonly checker: PhotoChecker,
    private readonly gravatars: GravatarClient,
  ) {}

  /** Stores a new photo for the caller, replacing (and deleting) their previous one. */
  async upload(ctx: RequestContext, body: unknown): Promise<ProfilePhotoRecord> {
    const accountId = requireAccount(ctx);
    const bucket = this.bucket();
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException('send the image as the request body');
    await this.requireMember(accountId);

    let image;
    try {
      image = await normalizePhoto(body);
    } catch (e) {
      if (e instanceof PhotoInputError) throw new BadRequestException(e.message);
      throw e;
    }
    let signals;
    try {
      signals = await this.checker.check(image.jpeg);
    } catch (e) {
      this.logger.error(`photo check failed: ${e instanceof Error ? e.message : String(e)}`);
      throw new ServiceUnavailableException('the photo check is unavailable right now; try again shortly');
    }
    const { verdict, reasons } = photoVerdict(signals);

    const db = this.firebase.db;
    const photoRef = db.collection(Collections.profilePhotos).doc();
    const checkRef = db.collection(Collections.photoChecks).doc();
    const storagePath = `profile-photos/${accountId}/${photoRef.id}.jpg`;
    const now = new Date().toISOString();
    await bucket.file(storagePath).save(image.jpeg, { contentType: 'image/jpeg', resumable: false });

    const replaced: string[] = [];
    try {
      const record = await db.runTransaction(async (tx) => {
        const previous = await tx.get(this.currentQuery(accountId));
        replaced.length = 0;
        for (const doc of previous.docs) {
          const old = doc.data() as ProfilePhotoRecord;
          if (old.storagePath) replaced.push(old.storagePath);
          tx.update(doc.ref, { status: 'superseded', storagePath: null });
        }
        const check: PhotoCheckRecord = {
          checkId: checkRef.id,
          photoId: photoRef.id,
          checker: this.checker.name,
          signals,
          verdict,
          reasons,
          checkedAt: now,
        };
        const photo: ProfilePhotoRecord = {
          photoId: photoRef.id,
          accountId,
          status: verdict === 'pass' ? 'accepted' : 'needs_review',
          storagePath,
          width: image.width,
          height: image.height,
          uploadedAt: now,
          checkId: checkRef.id,
          flags: reasons,
          decidedBy: null,
          decidedAt: null,
          decisionReason: null,
        };
        tx.create(checkRef, check);
        tx.create(photoRef, photo);
        return photo;
      });
      await this.deleteImages(replaced);
      return record;
    } catch (e) {
      await this.deleteImages([storagePath]);
      throw e;
    }
  }

  /**
   * The Gravatar of the address the caller signed in with, fetched only now that they ask (design §5.3), and
   * normalized as an upload is. Nothing is stored: the member reviews it and uploads it like any other photo, so it
   * gets the same checks and the same review.
   */
  async gravatar(ctx: RequestContext): Promise<Buffer> {
    // A test persona's photo is not the operator's to fill from their own address.
    requireOwnAccount(ctx);
    const accountId = requireAccount(ctx);
    const { email, emailVerified } = ctx.principal;
    if (!email || !emailVerified) throw new ConflictException('sign in with a verified email address to use its Gravatar');
    await this.requireMember(accountId);

    let bytes: Buffer;
    try {
      bytes = await this.gravatars.fetch(email);
    } catch (e) {
      if (!(e instanceof GravatarError)) throw e;
      if (e.kind === 'none') throw new NotFoundException(`Gravatar has no picture for ${email}, or none rated G`);
      const cause = e.cause instanceof Error ? ` (${e.cause.message})` : '';
      this.logger.warn(`gravatar fetch failed: ${e.message}${cause}`);
      if (e.kind === 'unavailable') throw new ServiceUnavailableException('Gravatar is not answering; try again shortly');
      throw new BadGatewayException(`your Gravatar picture cannot be used: ${e.message}`);
    }
    try {
      return (await normalizePhoto(bytes, ['jpeg', 'png', 'webp', 'gif'])).jpeg;
    } catch (e) {
      if (e instanceof PhotoInputError) throw new BadGatewayException(`your Gravatar picture cannot be used: ${e.message}`);
      throw e;
    }
  }

  /** The caller's latest photo, including a rejected one (so they can see why). */
  async mine(ctx: RequestContext): Promise<ProfilePhotoRecord | null> {
    const accountId = requireAccount(ctx);
    const snap = await this.firebase.db
      .collection(Collections.profilePhotos)
      .where('accountId', '==', accountId)
      .orderBy('uploadedAt', 'desc')
      .limit(1)
      .get();
    const latest = snap.docs[0]?.data() as ProfilePhotoRecord | undefined;
    return latest && latest.status !== 'superseded' ? latest : null;
  }

  async removeMine(ctx: RequestContext): Promise<void> {
    const accountId = requireAccount(ctx);
    const paths: string[] = [];
    await this.firebase.db.runTransaction(async (tx) => {
      const current = await tx.get(this.currentQuery(accountId));
      paths.length = 0;
      for (const doc of current.docs) {
        const photo = doc.data() as ProfilePhotoRecord;
        if (photo.storagePath) paths.push(photo.storagePath);
        tx.update(doc.ref, { status: 'superseded', storagePath: null });
      }
    });
    await this.deleteImages(paths);
  }

  async imageForOwner(ctx: RequestContext): Promise<Buffer> {
    const photo = await this.mine(ctx);
    if (!photo?.storagePath) throw new NotFoundException('no photo');
    return this.download(photo.storagePath);
  }

  // --- Membership Admin -------------------------------------------------------------------------------------

  async list(status: ProfilePhotoRecord['status'], limit: number): Promise<ProfilePhotoRecord[]> {
    const snap = await this.firebase.db
      .collection(Collections.profilePhotos)
      .where('status', '==', status)
      .orderBy('uploadedAt')
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as ProfilePhotoRecord);
  }

  async imageForAdmin(photoId: string): Promise<Buffer> {
    const snap = await this.firebase.db.collection(Collections.profilePhotos).doc(photoId).get();
    const photo = snap.data() as ProfilePhotoRecord | undefined;
    if (!photo?.storagePath) throw new NotFoundException('no image for that photo');
    return this.download(photo.storagePath);
  }

  /** Only a person rejects a photo, with a reason; the image is deleted on rejection. */
  async decide(ctx: RequestContext, photoId: string, input: PhotoDecisionInput): Promise<ProfilePhotoRecord> {
    const actor = requireAccount(ctx);
    let deletePath: string | null = null;
    const db = this.firebase.db;
    const decided = await db.runTransaction(async (tx) => {
      const ref = db.collection(Collections.profilePhotos).doc(photoId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundException('no such photo');
      const photo = snap.data() as ProfilePhotoRecord;
      if (photo.accountId === actor) throw new ForbiddenException('you cannot decide your own photo');
      if (!CURRENT.includes(photo.status)) throw new ConflictException(`photo is ${photo.status}`);
      await this.ledger.record(tx, [
        {
          type: 'photo.decided',
          actor,
          subject: photo.accountId,
          payload: { photoId, decision: input.decision, reason: input.reason, flags: [...photo.flags] },
        },
      ]);
      const reject = input.decision === 'reject';
      deletePath = reject ? photo.storagePath : null;
      const next: ProfilePhotoRecord = {
        ...photo,
        status: reject ? 'rejected' : 'accepted',
        storagePath: reject ? null : photo.storagePath,
        decidedBy: actor,
        decidedAt: new Date().toISOString(),
        decisionReason: input.reason,
      };
      tx.set(ref, next);
      return next;
    });
    if (deletePath) await this.deleteImages([deletePath]);
    return decided;
  }

  // --- internals --------------------------------------------------------------------------------------------

  private async requireMember(accountId: string): Promise<void> {
    const member = await this.firebase.db.collection(Collections.members).doc(accountId).get();
    if (!member.exists) throw new ConflictException('apply for membership before adding a photo');
  }

  private bucket(): Bucket {
    if (!this.config.photosBucket) throw new ServiceUnavailableException('photo storage is not configured (PHOTOS_BUCKET)');
    return this.firebase.storage.bucket(this.config.photosBucket);
  }

  private currentQuery(accountId: string) {
    return this.firebase.db
      .collection(Collections.profilePhotos)
      .where('accountId', '==', accountId)
      .where('status', 'in', CURRENT);
  }

  private async download(path: string): Promise<Buffer> {
    const [data] = await this.bucket().file(path).download();
    return data;
  }

  /** Best effort: a failed delete leaves an orphaned object, logged for cleanup, never a broken request. */
  private async deleteImages(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    const bucket = this.bucket();
    await Promise.all(
      paths.map((p) =>
        bucket
          .file(p)
          .delete({ ignoreNotFound: true })
          .catch((e: unknown) => this.logger.error(`could not delete ${p}: ${e instanceof Error ? e.message : String(e)}`)),
      ),
    );
  }
}
