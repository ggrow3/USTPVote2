import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  acceptTerms,
  assistantView,
  changeDoor,
  checkAsk,
  checkForget,
  checkInRoom,
  changeRoomSetting,
  checkMessageRate,
  checkRoomMember,
  checkRoomOpen,
  checkSignals,
  deleteMessage,
  inRoom,
  erased,
  expiresAfter,
  jokeBody,
  joinVoice,
  memoryLists,
  memoryView,
  messageView,
  newAction,
  newDecision,
  newMessage,
  nextJoke,
  roomSettingsView,
  roomStatus,
  ROOM_LIMITS,
  ROOM_RETENTION,
  signalRecord,
  signalView,
  switchAssistant,
  touchVoice,
  uuidv7,
  voiceLive,
  voiceView,
  withdrawConsent,
  type RoomActionInput,
  type RoomActionUpdate,
  type RoomAskInput,
  type RoomConsentInput,
  type RoomDecisionInput,
  type RoomDoorInput,
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
  type RoomSignalsInput,
  type RoomStatus,
  type RoomUpdates,
  type RoomViewContext,
  type RoomVoiceJoined,
  type RoomVoiceJoinInput,
  type RoomVoiceRecord,
  type RoomVoiceUpdateInput,
  type RoomVoiceView,
  updateAction,
} from 'ustp-domain';
import { DirectoryService } from '../auth/directory.service.js';
import { accepted, assertCheck } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
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
 * and withdrawing consent and the assistant's kill switch are ledgered with the change. The call is peer to peer: the
 * api says who is in it and passes each pair's handshake, and never carries its sound.
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
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /**
   * The door: the terms, whether the caller accepted them, whether an admin has closed the room, and for members in
   * the room its state.
   */
  async status(caller: RoomCaller): Promise<RoomStatus> {
    const [member, consent, feed, door] = await Promise.all([
      this.members.find(caller.accountId),
      this.repo.findConsent(caller.accountId),
      this.repo.findFeed(),
      this.repo.findDoor(),
    ]);
    const active = checkRoomMember(member?.status).ok;
    if (!feed.open) {
      const ctx = await this.adminsNamed(caller, feed.openChangedBy ? [feed.openChangedBy] : []);
      const by = feed.openChangedBy ? { accountId: feed.openChangedBy, name: ctx.people.get(feed.openChangedBy)! } : null;
      return roomStatus(door, active, consent, null, { at: feed.openChangedAt, by });
    }
    if (!active || !inRoom(consent, door.terms.version)) return roomStatus(door, active, consent, null);
    // Read after the feed, so who is in the call is never older than the `voiceSeq` it is shown with.
    const [people, roles, call] = await Promise.all([this.people(door.terms.version), this.directory.activeRoles(caller.accountId), this.repo.allVoice()]);
    const ctx = await this.contextFor(caller, [], feed);
    return roomStatus(door, true, consent, {
      seq: feed.seq,
      memorySeq: feed.memorySeq,
      peopleSeq: feed.peopleSeq,
      assistant: assistantView(feed, this.model.kind, ctx),
      moderator: roles.includes('membership_admin'),
      people,
      voiceSeq: feed.voiceSeq,
      voice: await this.callView(caller, call),
    });
  }

  /** Accepting the terms shown: recorded and ledgered before the room opens to them (spec rule 1). */
  async accept(caller: RoomCaller, input: RoomConsentInput): Promise<RoomStatus> {
    assertCheck(checkRoomMember((await this.members.find(caller.accountId))?.status));
    await this.change(async (tx, feed) => {
      const [current, door] = await Promise.all([this.repo.getConsent(tx, caller.accountId), this.repo.getDoor(tx)]);
      const { consent, event } = accepted(acceptTerms(current, door.terms, input, caller.accountId, new Date().toISOString()));
      await this.ledger.record(tx, [event]);
      this.repo.setConsent(tx, consent);
      return { result: undefined, feed: { peopleSeq: feed.seq + 1 } };
    });
    return this.status(caller);
  }

  /** `/leave-room`: consent withdrawn, effective at once, and out of the call. Anyone may leave, Active or not. */
  async leave(caller: RoomCaller): Promise<RoomStatus> {
    await this.change(async (tx, feed) => {
      const [current, voice] = await Promise.all([this.repo.getConsent(tx, caller.accountId), this.repo.getVoiceOf(tx, caller.accountId)]);
      const { consent, event } = accepted(withdrawConsent(current, new Date().toISOString()));
      await this.ledger.record(tx, [event]);
      this.repo.setConsent(tx, consent);
      if (voice) this.repo.deleteVoice(tx, caller.accountId);
      return { result: undefined, feed: { peopleSeq: feed.seq + 1, ...(voice && { voiceSeq: feed.seq + 1 }) } };
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
   * A page more than `ROOM_LIMITS.updates` changes behind is told to reload. A page in the call (`voiceSession`) gets
   * the handshakes sent to it too, and every page who is in the call whenever that changed.
   */
  async updates(caller: RoomCaller, since: number, wait: boolean, voiceSession?: string): Promise<RoomUpdates> {
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
    const [ctx, call, signals] = await Promise.all([
      this.contextFor(caller, reset ? [] : changed, feed),
      feed.voiceSeq > since || reset ? this.repo.allVoice() : null,
      voiceSession && feed.seq > since ? this.repo.signalsFor(caller.accountId, since) : [],
    ]);
    return {
      seq: feed.seq,
      memorySeq: feed.memorySeq,
      peopleSeq: feed.peopleSeq,
      messages: reset ? [] : changed.map((m) => messageView(m, ctx)),
      assistant: assistantView(feed, this.model.kind, ctx),
      voiceSeq: feed.voiceSeq,
      voice: call ? await this.callView(caller, call) : null,
      signals: signals.filter((s) => s.toSession === voiceSession).map(signalView),
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

  /** The admins' switches, the door's words and how the room is doing (Admin › Members' room). */
  async settings(caller: RoomCaller): Promise<RoomSettingsView> {
    const [feed, door, roles] = await Promise.all([this.repo.findFeed(), this.repo.findDoor(), this.directory.activeRoles(caller.accountId)]);
    const people = await this.people(door.terms.version);
    const changers = [feed.openChangedBy, feed.serverChangedBy, door.introChangedBy, door.termsChangedBy].filter((x): x is string => !!x);
    const ctx = await this.adminsNamed(caller, [...new Set(changers)]);
    return roomSettingsView(feed, door, this.model.kind, people.length, roles.includes('system_admin'), ctx);
  }

  /**
   * An admin saves the door's intro line and terms, ledgered as `room.door_changed`. Changed terms are a new version:
   * everyone in the room is back at the door at once, and out of the call (open pages learn of it through the feed),
   * and accepts them to come back; a notice in the room says who changed them.
   */
  async saveDoor(caller: RoomCaller, input: RoomDoorInput): Promise<RoomSettingsView> {
    await this.change(async (tx, feed) => {
      const at = new Date().toISOString();
      const [door, call] = await Promise.all([this.repo.getDoor(tx), this.repo.getAllVoice(tx)]);
      const saved = accepted(changeDoor(door, input, caller.accountId, at));
      if (!saved) return { result: undefined, unchanged: true };
      await this.ledger.record(tx, [saved.event]);
      this.repo.setDoor(tx, saved.door);
      if (!saved.newTerms) return { result: undefined, unchanged: true };
      for (const v of call) this.repo.deleteVoice(tx, v.accountId);
      this.notice(tx, caller.accountId, `changed the room’s terms (version ${saved.door.terms.version}); everyone accepts them again to stay`, null, feed.seq + 1, at);
      return { result: undefined, feed: { peopleSeq: feed.seq + 1, ...(call.length > 0 && { voiceSeq: feed.seq + 1 }) } };
    });
    return this.settings(caller);
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
      // Closing the room ends its call too.
      const call = setting === 'open' && !on ? await this.repo.getAllVoice(tx) : [];
      await this.ledger.record(tx, [event]);
      for (const job of jobs) if (job.state === 'queued' || job.state === 'running') this.repo.setJob(tx, cancelled(job, at));
      for (const v of call) this.repo.deleteVoice(tx, v.accountId);
      const said = setting === 'open' ? (on ? 'opened the room' : 'closed the room') : on ? 'switched the assistant’s server on' : 'switched the assistant’s server off';
      this.notice(tx, caller.accountId, said, null, feed.seq + 1, at);
      return { result: undefined, feed: call.length ? { ...changed, voiceSeq: feed.seq + 1 } : changed };
    });
    if (setting === 'server' && on && this.model.kind !== 'off') {
      await this.dispatch.warm().catch((e: unknown) => this.logger.warn(`room model warm-up not queued: ${e instanceof Error ? e.message : e}`));
    }
    return this.settings(caller);
  }

  /**
   * `/joke`: the assistant tells a lame joke from its list (no model needed) as its message, for whoever asked; pages in
   * the call read it out. It counts towards the asker's messages, and stops while the assistant is switched off.
   */
  async joke(caller: RoomCaller): Promise<RoomMessageView> {
    await this.assertInRoom(caller);
    await this.assertUnderRate(caller.accountId);
    const message = await this.change(async (tx, feed) => {
      const joke = accepted(nextJoke(feed));
      const m = newMessage(
        { messageId: uuidv7(), kind: 'assistant', authorId: caller.accountId, body: jokeBody(joke), createdAt: new Date().toISOString(), joke: true },
        feed.seq + 1,
      );
      this.repo.createMessage(tx, m);
      return { result: m, feed: { jokes: feed.jokes + 1 } };
    });
    return messageView(message, await this.contextFor(caller, [message]));
  }

  /**
   * Joining the call from a page: an earlier page of the member's in it is replaced, and anyone gone quiet is dropped.
   * The page then calls everyone already there.
   */
  async joinVoice(caller: RoomCaller, input: RoomVoiceJoinInput): Promise<RoomVoiceJoined> {
    await this.assertInRoom(caller);
    const sessionId = uuidv7();
    const { call, voiceSeq } = await this.change(async (tx, feed) => {
      const at = new Date().toISOString();
      const everyone = await this.repo.getAllVoice(tx);
      const others = everyone.filter((v) => v.accountId !== caller.accountId && voiceLive(v, at));
      const mine = accepted(joinVoice(everyone.find((v) => v.accountId === caller.accountId) ?? null, others, caller.accountId, sessionId, input.muted, at));
      this.repo.setVoice(tx, mine);
      for (const v of everyone) if (v.accountId !== caller.accountId && !voiceLive(v, at)) this.repo.deleteVoice(tx, v.accountId);
      return { result: { call: [...others, mine], voiceSeq: feed.seq + 1 }, feed: { voiceSeq: feed.seq + 1 } };
    });
    const stun = this.config.room.voiceStun;
    return { sessionId, voiceSeq, voice: await this.callView(caller, call), iceServers: stun.length ? [{ urls: [...stun] }] : [] };
  }

  /**
   * The page is still in the call (it says so every `ROOM_VOICE_LIMITS.heartbeatSeconds`), muted or not; anyone gone
   * quiet is dropped. Only muting, unmuting or a drop changes the room.
   */
  async updateVoice(caller: RoomCaller, input: RoomVoiceUpdateInput): Promise<void> {
    await this.assertInRoom(caller);
    await this.change(async (tx, feed) => {
      const at = new Date().toISOString();
      const everyone = await this.repo.getAllVoice(tx);
      const { record, changed } = accepted(touchVoice(everyone.find((v) => v.accountId === caller.accountId) ?? null, input.sessionId, input.muted, at));
      const stale = everyone.filter((v) => v.accountId !== caller.accountId && !voiceLive(v, at));
      this.repo.setVoice(tx, record);
      for (const v of stale) this.repo.deleteVoice(tx, v.accountId);
      return changed || stale.length ? { result: undefined, feed: { voiceSeq: feed.seq + 1 } } : { result: undefined, unchanged: true };
    });
  }

  /** This page leaves the call; the member in it from another page is left alone. Anyone may leave, Active or not. */
  async leaveVoice(caller: RoomCaller, sessionId: string): Promise<void> {
    await this.change(async (tx, feed) => {
      const mine = await this.repo.getVoiceOf(tx, caller.accountId);
      if (!mine || mine.sessionId !== sessionId) return { result: undefined, unchanged: true };
      this.repo.deleteVoice(tx, caller.accountId);
      return { result: undefined, feed: { voiceSeq: feed.seq + 1 } };
    });
  }

  /** Handshakes from a page in the call to others in it, which their next update brings them. */
  async signal(caller: RoomCaller, input: RoomSignalsInput): Promise<void> {
    await this.assertInRoom(caller);
    await this.change(async (tx, feed) => {
      const at = new Date().toISOString();
      const call = new Map((await this.repo.getAllVoice(tx)).map((v) => [v.accountId, v]));
      const sender = accepted(checkSignals(call.get(caller.accountId) ?? null, input, call, at));
      this.repo.setVoice(tx, sender);
      for (const s of input.signals) this.repo.createSignal(tx, signalRecord(sender, s, uuidv7(), feed.seq + 1, at));
      return { result: undefined };
    });
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
    const [member, consent, feed, door] = await Promise.all([
      this.members.find(caller.accountId),
      this.repo.findConsent(caller.accountId),
      this.repo.findFeed(),
      this.repo.findDoor(),
    ]);
    assertCheck(checkRoomMember(member?.status));
    assertCheck(checkRoomOpen(feed));
    assertCheck(checkInRoom(consent, door.terms.version));
  }

  private async isInRoom(accountId: string): Promise<boolean> {
    const [member, consent, door] = await Promise.all([this.members.find(accountId), this.repo.findConsent(accountId), this.repo.findDoor()]);
    return checkRoomMember(member?.status).ok && inRoom(consent, door.terms.version);
  }

  private async assertUnderRate(accountId: string): Promise<void> {
    const now = Date.now();
    const [minute, day] = await Promise.all([
      this.repo.postedSince(accountId, new Date(now - MINUTE_MS).toISOString()),
      this.repo.postedSince(accountId, new Date(now - DAY_MS).toISOString()),
    ]);
    assertCheck(checkMessageRate(minute, day));
  }

  /** Everyone in the room: Active members who accepted the terms in force (`version`), by name. */
  private async people(version: number): Promise<RoomPerson[]> {
    const ids = await this.repo.consentedIds(version);
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

  /**
   * Names for the messages' authors and whoever switched the assistant. A notice's author may be an admin with no
   * membership (who opened or closed the room, switched its server or changed its terms), named as `adminsNamed` does.
   */
  private async contextFor(caller: RoomCaller, messages: readonly RoomMessageRecord[], feed?: RoomFeedRecord): Promise<RoomViewContext> {
    const ids = [...new Set([...messages.map((m) => m.authorId), feed?.switchedBy].filter((x): x is string => !!x))];
    const admins = messages.flatMap((m) => (m.kind === 'notice' && m.authorId ? [m.authorId] : []));
    return this.named(caller, ids, admins);
  }

  /** Who is in the call, by name. */
  private async callView(caller: RoomCaller, call: readonly RoomVoiceRecord[]): Promise<RoomVoiceView[]> {
    return voiceView(call, new Date().toISOString(), await this.named(caller, call.map((v) => v.accountId)));
  }

  private async memoryContext(caller: RoomCaller, items: readonly RoomMemoryRecord[]): Promise<RoomViewContext> {
    const ids = [...new Set(items.flatMap((i) => (i.kind === 'action' ? [i.createdBy, i.ownerId] : [i.createdBy])))];
    return this.named(caller, ids);
  }

  /**
   * Names for admins who switched something: a System Admin may hold no membership, so their account's display name,
   * else "an admin"; never an email address.
   */
  private adminsNamed(caller: RoomCaller, ids: readonly string[]): Promise<RoomViewContext> {
    return this.named(caller, ids, ids);
  }

  /** Members by name (preferred, else legal); anyone else is a former member, or, if among `admins`, named as an admin. */
  private async named(caller: RoomCaller, ids: readonly string[], admins: readonly string[] = []): Promise<RoomViewContext> {
    const records = await this.members.findMany(ids);
    const unlisted = ids.filter((id, i) => !records[i] && admins.includes(id));
    const accounts = unlisted.length ? await this.directory.displayNames(unlisted) : new Map<string, string>();
    const name = (id: string, i: number) =>
      records[i] ? (records[i]!.preferredName ?? records[i]!.legalName) : unlisted.includes(id) ? (accounts.get(id) ?? 'an admin') : 'Former member';
    const people = new Map(ids.map((id, i) => [id, name(id, i)]));
    return { accountId: caller.accountId, moderator: caller.moderator, people };
  }
}
