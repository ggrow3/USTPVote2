import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  acceptTerms,
  assistantView,
  checkAsk,
  checkForget,
  checkInRoom,
  changeRoomSetting,
  checkMessageRate,
  checkRoomMember,
  checkRoomOpen,
  deleteMessage,
  inRoom,
  erased,
  expiresAfter,
  memoryLists,
  memoryView,
  messageView,
  newAction,
  newDecision,
  newMessage,
  roomSettingsView,
  roomStatus,
  ROOM_LIMITS,
  ROOM_RETENTION,
  switchAssistant,
  uuidv7,
  withdrawConsent,
  type RoomActionInput,
  type RoomActionUpdate,
  type RoomAskInput,
  type RoomConsentInput,
  type RoomDecisionInput,
  type RoomFeedRecord,
  type RoomHistory,
  type RoomJobRecord,
  type RoomMemory,
  type RoomMemoryRecord,
  type RoomMemoryView,
  type RoomMessageInput,
  type RoomMessageRecord,
  type RoomMessageView,
  type RoomPerson,
  type RoomSetting,
  type RoomSettingsView,
  type RoomStatus,
  type RoomUpdates,
  type RoomViewContext,
  updateAction,
} from 'ustp-domain';
import { DirectoryService } from '../auth/directory.service.js';
import { accepted, assertCheck } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { RoomAssistant } from './room-assistant.js';
import { ASSISTANT_DISPATCH, type AssistantDispatch } from './room-dispatch.js';
import { RoomFeedWatcher } from './room-feed.js';
import { ROOM_MODEL, type RoomModel } from './room-model.js';
import { RoomRepository } from './room.repository.js';

/**
 * Who is calling: an account, and whether it calls as a Membership Admin (the room's admins) through
 * `/v1/admin/room`, whose routes check the role and its second factor.
 */
export interface RoomCaller {
  readonly accountId: string;
  readonly moderator: boolean;
}

/** A question the assistant will no longer answer; its record goes a day later, with the question's text. */
const cancelled = (job: RoomJobRecord, at: string): RoomJobRecord => ({
  ...job,
  state: 'cancelled',
  finishedAt: at,
  expireAt: expiresAfter(at, ROOM_RETENTION.jobDays),
});

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * The members' room (design §5.10). Every route but the door (`GET /v1/room`, accepting the terms) is for Active members
 * who accepted the current terms, checked on each request, so the room only ever holds people who said yes. Each change
 * runs in one transaction that takes the next number from `room_state/feed`, which is how pages learn of it; accepting
 * and withdrawing consent and the assistant's kill switch are ledgered with the change.
 */
@Injectable()
export class RoomService {
  private readonly logger = new Logger(RoomService.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly repo: RoomRepository,
    private readonly ledger: LedgerService,
    private readonly members: MemberDirectory,
    private readonly directory: DirectoryService,
    private readonly feedWatcher: RoomFeedWatcher,
    private readonly assistant: RoomAssistant,
    @Inject(ROOM_MODEL) private readonly model: RoomModel,
    @Inject(ASSISTANT_DISPATCH) private readonly dispatch: AssistantDispatch,
  ) {}

  /**
   * The door: the terms, whether the caller accepted them, whether an admin has closed the room, and for members in
   * the room its state.
   */
  async status(caller: RoomCaller): Promise<RoomStatus> {
    const [member, consent, feed] = await Promise.all([
      this.members.find(caller.accountId),
      this.repo.findConsent(caller.accountId),
      this.repo.findFeed(),
    ]);
    const active = checkRoomMember(member?.status).ok;
    if (!feed.open) {
      const ctx = await this.adminsNamed(caller, feed.openChangedBy ? [feed.openChangedBy] : []);
      const by = feed.openChangedBy ? { accountId: feed.openChangedBy, name: ctx.people.get(feed.openChangedBy)! } : null;
      return roomStatus(active, consent, null, { at: feed.openChangedAt, by });
    }
    if (!active || !inRoom(consent)) return roomStatus(active, consent, null);
    const [people, roles] = await Promise.all([this.people(), this.directory.activeRoles(caller.accountId)]);
    const ctx = await this.contextFor(caller, [], feed);
    return roomStatus(true, consent, {
      seq: feed.seq,
      memorySeq: feed.memorySeq,
      peopleSeq: feed.peopleSeq,
      assistant: assistantView(feed, this.model.kind, ctx),
      moderator: roles.includes('membership_admin'),
      people,
    });
  }

  /** Accepting the terms shown: recorded and ledgered before the room opens to them (spec rule 1). */
  async accept(caller: RoomCaller, input: RoomConsentInput): Promise<RoomStatus> {
    assertCheck(checkRoomMember((await this.members.find(caller.accountId))?.status));
    await this.change(async (tx, feed) => {
      const { consent, event } = accepted(acceptTerms(await this.repo.getConsent(tx, caller.accountId), input, caller.accountId, new Date().toISOString()));
      await this.ledger.record(tx, [event]);
      this.repo.setConsent(tx, consent);
      return { result: undefined, feed: { peopleSeq: feed.seq + 1 } };
    });
    return this.status(caller);
  }

  /** `/leave-room`: consent withdrawn, effective at once. Anyone may leave, Active or not. */
  async leave(caller: RoomCaller): Promise<RoomStatus> {
    await this.change(async (tx, feed) => {
      const { consent, event } = accepted(withdrawConsent(await this.repo.getConsent(tx, caller.accountId), new Date().toISOString()));
      await this.ledger.record(tx, [event]);
      this.repo.setConsent(tx, consent);
      return { result: undefined, feed: { peopleSeq: feed.seq + 1 } };
    });
    return this.status(caller);
  }

  /** A page of history, oldest first, and the feed number to ask for updates after. */
  async history(caller: RoomCaller, before: string | undefined): Promise<RoomHistory> {
    await this.assertInRoom(caller);
    // The feed number first: a message posted between the two reads then comes again as an update, never not at all.
    const feed = await this.repo.findFeed();
    const found = await this.repo.history(before, ROOM_LIMITS.page);
    const more = found.length > ROOM_LIMITS.page;
    const page = found.slice(0, ROOM_LIMITS.page).reverse();
    const ctx = await this.contextFor(caller, page);
    return { messages: page.map((m) => messageView(m, ctx)), before: more ? page[0]!.messageId : null, seq: feed.seq };
  }

  /**
   * What changed after `since`: at once if anything did, else when something does or `ROOM_LIMITS.waitSeconds` pass.
   * A page more than `ROOM_LIMITS.updates` changes behind is told to reload.
   */
  async updates(caller: RoomCaller, since: number, wait: boolean): Promise<RoomUpdates> {
    await this.assertInRoom(caller);
    let feed = await this.repo.findFeed();
    if (wait && feed.seq <= since) {
      await this.feedWatcher.wait(since, ROOM_LIMITS.waitSeconds * 1000);
      // Membership can end, or consent be withdrawn, while a request waits.
      await this.assertInRoom(caller);
      feed = await this.repo.findFeed();
    }
    const changed = feed.seq > since ? await this.repo.changedSince(since, ROOM_LIMITS.updates + 1) : [];
    const reset = changed.length > ROOM_LIMITS.updates || since > feed.seq;
    const ctx = await this.contextFor(caller, reset ? [] : changed, feed);
    return {
      seq: feed.seq,
      memorySeq: feed.memorySeq,
      peopleSeq: feed.peopleSeq,
      messages: reset ? [] : changed.map((m) => messageView(m, ctx)),
      assistant: assistantView(feed, this.model.kind, ctx),
      reset,
    };
  }

  async post(caller: RoomCaller, input: RoomMessageInput): Promise<RoomMessageView> {
    await this.assertInRoom(caller);
    await this.assertUnderRate(caller.accountId);
    const message = await this.change(async (tx, feed) => {
      const m = newMessage({ messageId: uuidv7(), kind: 'member', authorId: caller.accountId, body: input.body, createdAt: new Date().toISOString() }, feed.seq + 1);
      this.repo.createMessage(tx, m);
      return { result: m };
    });
    return messageView(message, await this.contextFor(caller, [message]));
  }

  /**
   * Its author deletes a message, or a Membership Admin any. Answers that cite it are erased with it, so its text
   * survives nowhere in the room; a question still waiting for the assistant is cancelled.
   */
  async deleteMessage(caller: RoomCaller, messageId: string): Promise<RoomMessageView> {
    await this.assertInRoom(caller);
    const message = await this.change(async (tx, feed) => {
      const current = await this.repo.getMessage(tx, messageId);
      const [citing, jobs] = await Promise.all([this.repo.getAnswersCiting(tx, messageId), current?.ask ? this.repo.getJobsFor(tx, [messageId]) : []]);
      const at = new Date().toISOString();
      const seq = feed.seq + 1;
      const deleted = accepted(deleteMessage(current, caller.accountId, caller.moderator, seq, at));
      this.repo.setMessage(tx, deleted);
      for (const answer of citing) if (!answer.deletedAt) this.repo.setMessage(tx, erased(answer, caller.accountId, seq, at));
      for (const job of jobs) if (job.state === 'queued' || job.state === 'running') this.repo.setJob(tx, cancelled(job, at));
      return { result: deleted, feed: { pending: feed.pending.filter((id) => id !== messageId) } };
    });
    return messageView(message, await this.contextFor(caller, [message]));
  }

  /**
   * `/ask`: the question is posted as the member's message and queued for the assistant, which answers in the room once
   * the model has (design §5.10). 503 while the deployment has no model.
   */
  async ask(caller: RoomCaller, input: RoomAskInput): Promise<RoomMessageView> {
    await this.assertInRoom(caller);
    if (this.model.kind === 'off') {
      throw new ServiceUnavailableException('the assistant is not set up on this deployment: the room has no model yet');
    }
    await this.assertUnderRate(caller.accountId);
    const asked = await this.repo.askedSince(caller.accountId, new Date(Date.now() - DAY_MS).toISOString());
    const jobId = uuidv7();
    const question = await this.change(async (tx, feed) => {
      assertCheck(checkAsk(feed, asked));
      const at = new Date().toISOString();
      const m = newMessage({ messageId: uuidv7(), kind: 'member', authorId: caller.accountId, body: input.question, createdAt: at, ask: true }, feed.seq + 1);
      this.repo.createMessage(tx, m);
      this.repo.createJob(tx, {
        jobId,
        questionId: m.messageId,
        askedBy: caller.accountId,
        question: input.question,
        state: 'queued',
        createdAt: at,
        startedAt: null,
        finishedAt: null,
        answerId: null,
        error: null,
        expireAt: null,
      });
      return { result: m, feed: { pending: [...feed.pending, m.messageId] } };
    });
    try {
      await this.dispatch.send(jobId);
    } catch (e) {
      this.logger.error(`room question ${jobId} could not be queued: ${e instanceof Error ? e.message : e}`);
      await this.assistant.fail(jobId, 'it could not be passed to the assistant');
    }
    return messageView(question, await this.contextFor(caller, [question]));
  }

  /** `/decide`: a decision, the group's, with a notice in the room. */
  async decide(caller: RoomCaller, input: RoomDecisionInput): Promise<RoomMemoryView> {
    await this.assertInRoom(caller);
    const item = await this.change(async (tx, feed) => {
      const from = input.messageId ? await this.repo.getMessage(tx, input.messageId) : null;
      const at = new Date().toISOString();
      const seq = feed.seq + 1;
      const decision = accepted(newDecision(input, from, uuidv7(), caller.accountId, seq, at));
      this.repo.setItem(tx, decision);
      this.notice(tx, caller.accountId, `logged a decision: ${decision.text}`, { kind: 'decision', itemId: decision.itemId }, seq, at);
      return { result: decision as RoomMemoryRecord, feed: { memorySeq: seq } };
    });
    return memoryView(item, await this.memoryContext(caller, [item]));
  }

  /** `/todo`: an action item for someone in the room, with a notice. */
  async addAction(caller: RoomCaller, input: RoomActionInput): Promise<RoomMemoryView> {
    await this.assertInRoom(caller);
    const ownerIn = await this.isInRoom(input.ownerId);
    const owner = await this.nameOf(input.ownerId);
    const item = await this.change(async (tx, feed) => {
      const at = new Date().toISOString();
      const seq = feed.seq + 1;
      const action = accepted(newAction(input, ownerIn, uuidv7(), caller.accountId, seq, at));
      this.repo.setItem(tx, action);
      this.notice(tx, caller.accountId, `added an action item for ${owner}: ${action.text}${action.due ? ` (due ${action.due})` : ''}`, { kind: 'action', itemId: action.itemId }, seq, at);
      return { result: action as RoomMemoryRecord, feed: { memorySeq: seq } };
    });
    return memoryView(item, await this.memoryContext(caller, [item]));
  }

  /** An action item changed; marking it done tells the room. */
  async updateAction(caller: RoomCaller, itemId: string, input: RoomActionUpdate): Promise<RoomMemoryView> {
    await this.assertInRoom(caller);
    const ownerIn = await this.isInRoom(input.ownerId);
    const item = await this.change(async (tx, feed) => {
      const current = await this.repo.getItem(tx, itemId);
      const at = new Date().toISOString();
      const seq = feed.seq + 1;
      const changed = accepted(updateAction(current, input, ownerIn, caller.accountId, caller.moderator, seq, at));
      if (!changed) return { result: current!, unchanged: true };
      this.repo.setItem(tx, changed);
      if (changed.status === 'done' && current!.kind === 'action' && current!.status === 'open') {
        this.notice(tx, caller.accountId, `marked done: ${changed.text}`, { kind: 'action', itemId }, seq, at);
      }
      return { result: changed as RoomMemoryRecord, feed: { memorySeq: seq } };
    });
    return memoryView(item, await this.memoryContext(caller, [item]));
  }

  /** `/memory`: every decision and action item; the page searches them, so searches never reach the api's logs. */
  async memory(caller: RoomCaller): Promise<RoomMemory> {
    await this.assertInRoom(caller);
    const [items, feed] = await Promise.all([this.repo.allItems(), this.repo.findFeed()]);
    return { ...memoryLists(items, await this.memoryContext(caller, items)), memorySeq: feed.memorySeq };
  }

  /** `/forget`: the item is deleted for good, and the notices about it and the answers citing it are erased with it. */
  async forget(caller: RoomCaller, itemId: string): Promise<void> {
    await this.assertInRoom(caller);
    await this.change(async (tx, feed) => {
      const [item, notices, citing] = await Promise.all([
        this.repo.getItem(tx, itemId),
        this.repo.getNoticesAbout(tx, itemId),
        this.repo.getAnswersCiting(tx, itemId),
      ]);
      assertCheck(checkForget(item, caller.accountId, caller.moderator));
      const at = new Date().toISOString();
      const seq = feed.seq + 1;
      this.repo.deleteItem(tx, itemId);
      for (const m of [...notices, ...citing]) if (!m.deletedAt) this.repo.setMessage(tx, erased(m, caller.accountId, seq, at));
      return { result: undefined, feed: { memorySeq: seq } };
    });
  }

  /** A Membership Admin's kill switch: off cancels the questions waiting and stops the assistant until switched on. */
  async switchAssistant(caller: RoomCaller, on: boolean): Promise<RoomStatus> {
    await this.assertInRoom(caller);
    await this.change(async (tx, feed) => {
      const at = new Date().toISOString();
      const { feed: switched, cancelled: waiting, event } = accepted(switchAssistant(feed, on, caller.accountId, at));
      const jobs = await this.repo.getJobsFor(tx, waiting);
      await this.ledger.record(tx, [event]);
      for (const job of jobs) if (job.state === 'queued' || job.state === 'running') this.repo.setJob(tx, cancelled(job, at));
      this.notice(tx, caller.accountId, on ? 'switched the assistant on' : 'switched the assistant off', null, feed.seq + 1, at);
      return { result: undefined, feed: switched };
    });
    return this.status(caller);
  }

  /** The admins' switches and how the room is doing (Admin › Members' room). */
  async settings(caller: RoomCaller): Promise<RoomSettingsView> {
    const [feed, people, roles] = await Promise.all([this.repo.findFeed(), this.people(), this.directory.activeRoles(caller.accountId)]);
    const ctx = await this.adminsNamed(caller, [feed.openChangedBy, feed.serverChangedBy].filter((x): x is string => !!x));
    return roomSettingsView(feed, this.model.kind, people.length, roles.includes('system_admin'), ctx);
  }

  /**
   * An admin opens or closes the room, or a System Admin switches its model server (the routes check the roles):
   * ledgered as `room.settings_changed`, with a notice in the room. Switching the server off cancels the questions
   * waiting; switching it on starts the model, so the next question need not wait while it loads.
   */
  async changeSetting(caller: RoomCaller, setting: RoomSetting, on: boolean): Promise<RoomSettingsView> {
    await this.change(async (tx, feed) => {
      const at = new Date().toISOString();
      const { feed: changed, cancelled: waiting, event } = accepted(changeRoomSetting(feed, setting, on, caller.accountId, at));
      const jobs = await this.repo.getJobsFor(tx, waiting);
      await this.ledger.record(tx, [event]);
      for (const job of jobs) if (job.state === 'queued' || job.state === 'running') this.repo.setJob(tx, cancelled(job, at));
      const said = setting === 'open' ? (on ? 'opened the room' : 'closed the room') : on ? 'switched the assistant’s server on' : 'switched the assistant’s server off';
      this.notice(tx, caller.accountId, said, null, feed.seq + 1, at);
      return { result: undefined, feed: changed };
    });
    if (setting === 'server' && on && this.model.kind !== 'off') {
      await this.dispatch.warm().catch((e: unknown) => this.logger.warn(`room model warm-up not queued: ${e instanceof Error ? e.message : e}`));
    }
    return this.settings(caller);
  }

  /**
   * One change to the room in one transaction: `run` reads what it needs and writes with feed number `feed.seq + 1`,
   * which this then records (with any other change to the feed). Reads come first, as transactions require.
   */
  private change<T>(
    run: (tx: Transaction, feed: RoomFeedRecord) => Promise<{ result: T; feed?: Partial<Omit<RoomFeedRecord, 'seq'>>; unchanged?: boolean }>,
  ): Promise<T> {
    return this.firebase.db.runTransaction(async (tx) => {
      const feed = await this.repo.getFeed(tx);
      const { result, feed: changes, unchanged } = await run(tx, feed);
      if (!unchanged) this.repo.setFeed(tx, { ...feed, ...changes, seq: feed.seq + 1 });
      return result;
    });
  }

  /** A notice in the room of what someone did. */
  private notice(tx: Transaction, actor: string, body: string, ref: RoomMessageRecord['ref'], seq: number, at: string): void {
    this.repo.createMessage(tx, newMessage({ messageId: uuidv7(), kind: 'notice', authorId: actor, body, createdAt: at, ref }, seq));
  }

  /** Active, accepted the current terms (spec rule 1), and the room open; checked on every request. */
  private async assertInRoom(caller: RoomCaller): Promise<void> {
    const [member, consent, feed] = await Promise.all([this.members.find(caller.accountId), this.repo.findConsent(caller.accountId), this.repo.findFeed()]);
    assertCheck(checkRoomMember(member?.status));
    assertCheck(checkRoomOpen(feed));
    assertCheck(checkInRoom(consent));
  }

  private async isInRoom(accountId: string): Promise<boolean> {
    const [member, consent] = await Promise.all([this.members.find(accountId), this.repo.findConsent(accountId)]);
    return checkRoomMember(member?.status).ok && inRoom(consent);
  }

  private async assertUnderRate(accountId: string): Promise<void> {
    const now = Date.now();
    const [minute, day] = await Promise.all([
      this.repo.postedSince(accountId, new Date(now - MINUTE_MS).toISOString()),
      this.repo.postedSince(accountId, new Date(now - DAY_MS).toISOString()),
    ]);
    assertCheck(checkMessageRate(minute, day));
  }

  /** Everyone in the room: Active members who accepted the current terms, by name. */
  private async people(): Promise<RoomPerson[]> {
    const ids = await this.repo.consentedIds();
    const records = await this.members.findMany(ids);
    return ids
      .flatMap((accountId, i) => {
        const m = records[i];
        return m && m.status === 'active' ? [{ accountId, name: m.preferredName ?? m.legalName }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async nameOf(accountId: string): Promise<string> {
    const [m] = await this.members.findMany([accountId]);
    return m ? (m.preferredName ?? m.legalName) : 'a former member';
  }

  /** Names for the messages' authors and whoever switched the assistant. */
  private async contextFor(caller: RoomCaller, messages: readonly RoomMessageRecord[], feed?: RoomFeedRecord): Promise<RoomViewContext> {
    const ids = [...new Set([...messages.map((m) => m.authorId), feed?.switchedBy].filter((x): x is string => !!x))];
    return this.named(caller, ids);
  }

  private async memoryContext(caller: RoomCaller, items: readonly RoomMemoryRecord[]): Promise<RoomViewContext> {
    const ids = [...new Set(items.flatMap((i) => (i.kind === 'action' ? [i.createdBy, i.ownerId] : [i.createdBy])))];
    return this.named(caller, ids);
  }

  /**
   * Names for admins who switched something: a System Admin may hold no membership, so their account's display name,
   * else "an admin"; never an email address.
   */
  private async adminsNamed(caller: RoomCaller, ids: readonly string[]): Promise<RoomViewContext> {
    const [records, accounts] = await Promise.all([this.members.findMany(ids), this.directory.displayNames(ids)]);
    const people = new Map(ids.map((id, i) => [id, records[i] ? (records[i]!.preferredName ?? records[i]!.legalName) : (accounts.get(id) ?? 'an admin')]));
    return { accountId: caller.accountId, moderator: caller.moderator, people };
  }

  private async named(caller: RoomCaller, ids: readonly string[]): Promise<RoomViewContext> {
    const records = await this.members.findMany(ids);
    const people = new Map(ids.map((id, i) => [id, records[i] ? (records[i]!.preferredName ?? records[i]!.legalName) : 'Former member']));
    return { accountId: caller.accountId, moderator: caller.moderator, people };
  }
}
