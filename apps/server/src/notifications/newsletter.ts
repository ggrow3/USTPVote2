import { createHash, randomBytes } from 'node:crypto';
import { Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  checkNewsletterLimits,
  clientAddress,
  isNewsletterTrapped,
  isUnsubscribeToken,
  mailAddressKey,
  newsletterAddressSchema,
  newsletterSignup,
  newsletterSignupSchema,
  suggestionDay,
  uuidv7,
  type NewsletterAddressInput,
  type NewsletterConfirmStatus,
  type NewsletterLookup,
  type NewsletterOpen,
  type NewsletterSignupInput,
  type NewsletterSubscriberRecord,
  type NewsletterSummary,
} from 'ustp-domain';
import { AppChecked, Public, Roles } from '../auth/decorators.js';
import { assertCheck, ZodPipe } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { NewsletterRepository } from './newsletter.repository.js';
import { NoticeSettingsService } from './notice-settings.js';

/** SHA-256 (hex) of a link's token: what is kept of a confirmation link. */
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * The newsletter (design §10.15): sign-ups from the public form, confirmed by the link the worker emails (double opt-in),
 * an address deleted when its owner unsubscribes, and what Membership, System and Site Admins see of the list. Signing up
 * never says whether an address is on the list. Not ledgered: an address must be erasable.
 */
@Injectable()
export class NewsletterService {
  constructor(
    private readonly firebase: Firebase,
    private readonly list: NewsletterRepository,
    private readonly settings: NoticeSettingsService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Whether the form takes sign-ups: only where a confirmation could go (mail sent, all of it on, a contact set). */
  async open(): Promise<boolean> {
    if (this.config.mailTransport === 'off' || !this.config.webOrigin) return false;
    const settings = await this.settings.current();
    return settings.allEmails && !!(settings.contact ?? this.config.noticeContact);
  }

  /**
   * A sign-up from `address` (the sender's network address), within the day's limits: a new address waits for
   * confirmation and the worker emails the link; one already waiting gets another link after an hour; a confirmed one,
   * nothing. The answer is the same whichever it was.
   */
  async signUp(input: NewsletterSignupInput, address: string, now: Date = new Date()): Promise<void> {
    if (isNewsletterTrapped(input)) return;
    if (!(await this.open())) throw new ConflictException('the newsletter is not taking sign-ups just now; please try again later');
    const day = suggestionDay(now);
    const addressKey = mailAddressKey(input.email);
    await this.firebase.db.runTransaction(async (tx) => {
      const [limits, current] = await Promise.all([this.list.getLimits(tx, day), this.list.byAddress(addressKey, tx)]);
      const salt = limits?.salt ?? randomBytes(32).toString('hex');
      const sender = createHash('sha256').update(`${salt}:${address}`).digest('hex').slice(0, 32);
      assertCheck(checkNewsletterLimits(limits, sender));
      const step = newsletterSignup({ current, input, subscriberId: uuidv7(now.getTime()), addressKey, at: now });
      if (step.kind !== 'none') this.list.save(tx, step.record);
      this.list.setLimits(tx, {
        day,
        salt,
        total: (limits?.total ?? 0) + 1,
        senders: { ...limits?.senders, [sender]: (limits?.senders[sender] ?? 0) + 1 },
      });
    });
  }

  /** Whether a confirmation link's address is confirmed; 404 for a link that is no one's (or whose address was deleted). */
  async confirmStatus(token: string): Promise<NewsletterConfirmStatus> {
    const found = isUnsubscribeToken(token) ? await this.list.byConfirmHash(tokenHash(token)) : null;
    if (!found) throw new NotFoundException('this confirmation link is not valid');
    return { confirmed: found.status === 'confirmed' };
  }

  /** Confirms the link's address: on the list from now, with its unsubscribe token. Confirming again changes nothing. */
  async confirm(token: string): Promise<NewsletterConfirmStatus> {
    const found = isUnsubscribeToken(token) ? await this.list.byConfirmHash(tokenHash(token)) : null;
    if (!found) throw new NotFoundException('this confirmation link is not valid');
    await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.list.get(tx, found.subscriberId);
      if (!current || current.confirmTokenHash !== found.confirmTokenHash) throw new NotFoundException('this confirmation link is not valid');
      if (current.status === 'confirmed') return;
      const confirmed: NewsletterSubscriberRecord = {
        ...current,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        confirmDue: false,
        unsubscribeToken: randomBytes(32).toString('base64url'),
      };
      this.list.save(tx, confirmed);
    });
    return { confirmed: true };
  }

  /** Whether an unsubscribe token is a subscriber's; null when it is no one's here. */
  async isSubscriberToken(token: string): Promise<boolean> {
    return !!(await this.list.byUnsubscribeToken(token));
  }

  /** Unsubscribes the token's subscriber, deleting the record and the address with it; false for a token that is no one's here. */
  async unsubscribe(token: string): Promise<boolean> {
    const found = await this.list.byUnsubscribeToken(token);
    return !!found && (await this.list.delete(found.subscriberId));
  }

  /** How many are on the list and waiting. */
  async summary(now: Date = new Date()): Promise<NewsletterSummary> {
    const counts = await this.list.counts(new Date(now.getTime() - 30 * 86_400_000).toISOString());
    return { confirmed: counts.confirmed, pending: counts.pending, confirmedLast30Days: counts.confirmedSince };
  }

  /** One address: whether it is on the list or waiting, for an admin answering its owner. Never a list. */
  async lookup(email: string): Promise<NewsletterLookup> {
    const found = await this.list.byAddress(mailAddressKey(email));
    return found
      ? { found: true, status: found.status, signedUpAt: found.signedUpAt, confirmedAt: found.confirmedAt }
      : { found: false, status: null, signedUpAt: null, confirmedAt: null };
  }

  /** Takes an address off the list (its owner asked an admin), deleting it. 404 when it is not on it. */
  async remove(email: string): Promise<void> {
    const found = await this.list.byAddress(mailAddressKey(email));
    if (!found || !(await this.list.delete(found.subscriberId))) throw new NotFoundException('that address is not on the newsletter list');
  }
}

/**
 * The public sign-up form and its confirmation link (design §10.15), for anyone, with no sign-in. Signing up sends App
 * Check where it is enforced, as the suggestions form does; a GET never changes anything, since mail scanners open links
 * by themselves: the confirmation page's button makes the POST.
 */
@Controller('v1/public/newsletter')
@Public()
export class PublicNewsletterController {
  constructor(
    private readonly newsletter: NewsletterService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  @Get()
  async open(): Promise<NewsletterOpen> {
    return { open: await this.newsletter.open() };
  }

  /** 202 whatever became of it, so the form never says whether an address is on the list. */
  @Post()
  @AppChecked()
  @HttpCode(202)
  async signUp(@Body(new ZodPipe(newsletterSignupSchema)) body: NewsletterSignupInput, @Req() request: FastifyRequest): Promise<{ received: true }> {
    const { ip } = clientAddress(request.headers['x-forwarded-for'], request.socket?.remoteAddress, this.config.trustedProxyHops);
    await this.newsletter.signUp(body, ip ?? 'unknown');
    return { received: true };
  }

  @Get('confirm/:token')
  confirmStatus(@Param('token') token: string): Promise<NewsletterConfirmStatus> {
    return this.newsletter.confirmStatus(token);
  }

  @Post('confirm/:token')
  @HttpCode(200)
  confirm(@Param('token') token: string): Promise<NewsletterConfirmStatus> {
    return this.newsletter.confirm(token);
  }
}

/** What Membership, System and Site Admins see of the list under Admin › Email (design §10.15): counts, and one address at a time. */
@Controller('v1/admin/newsletter')
@Roles('membership_admin', 'system_admin', 'site_admin')
export class NewsletterAdminController {
  constructor(private readonly newsletter: NewsletterService) {}

  @Get()
  summary(): Promise<NewsletterSummary> {
    return this.newsletter.summary();
  }

  @Post('lookup')
  @HttpCode(200)
  lookup(@Body(new ZodPipe(newsletterAddressSchema)) body: NewsletterAddressInput): Promise<NewsletterLookup> {
    return this.newsletter.lookup(body.email);
  }

  @Post('remove')
  @HttpCode(204)
  async remove(@Body(new ZodPipe(newsletterAddressSchema)) body: NewsletterAddressInput): Promise<void> {
    await this.newsletter.remove(body.email);
  }
}
