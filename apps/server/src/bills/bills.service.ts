import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  administersSite,
  BILL_LIMITS,
  billId,
  billLabel,
  billStatus,
  checkNoteChange,
  checkTags,
  congressGovUrl,
  congressLabel,
  currentCongress,
  isVersionCode,
  parseBillId,
  settleSearch,
  sortWatchlist,
  tidyTags,
  uuidv7,
  validBillRef,
  type BillDetail,
  type BillNoteInput,
  type BillNoteRecord,
  type BillNoteView,
  type BillRecentInput,
  type BillRecentPage,
  type BillRecord,
  type BillRef,
  type BillsAccess,
  type BillSearchInput,
  type BillSearchPage,
  type BillSettingsChangedPayload,
  type BillSettingsInput,
  type BillSettingsRecord,
  type BillSettingsView,
  type BillText,
  type BillWatchEntry,
  type BillWatchQuery,
  type BillWatchRecord,
  type WatchBillInput,
} from 'ustp-domain';
import { ApiKeys } from '../api-keys/api-keys.js';
import { requireAccount } from '../auth/decorators.js';
import { DirectoryService } from '../auth/directory.service.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { TeamRoster } from '../teams/team-roster.js';
import { BILL_SOURCE, BillSourceError, type BillSource } from './bill-source.js';
import { BillRepository } from './bill.repository.js';

/** Someone with the tool, as its routes see them. */
interface Caller {
  readonly accountId: string;
  readonly systemAdmin: boolean;
}

const NOT_FOR_YOU =
  'the Bills page is for the legislative team: the teams a System or Site Admin names under Admin › Bills, and System and Site Admins. Ask a team’s lead to join it';

/** The status a service's failure has (design §5.14): its hourly limit 429, anything else 502. */
function sourceError(e: unknown): never {
  if (e instanceof BillSourceError) {
    if (e.kind === 'rate_limited') throw new HttpException({ message: e.message }, HttpStatus.TOO_MANY_REQUESTS);
    throw new BadGatewayException(e.message);
  }
  throw e;
}

/**
 * The legislative team's Bills tool (design §5.14): bills in Congress found, sorted and read through the `BillSource`
 * port, and the watchlist the team shares, with tags and notes. Who has it is a System Admin's setting: the teams named,
 * and System Admins. Only the setting is ledgered; the list and notes are the team's working papers.
 */
@Injectable()
export class BillsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly repo: BillRepository,
    private readonly roster: TeamRoster,
    private readonly members: MemberDirectory,
    private readonly directory: DirectoryService,
    private readonly ledger: LedgerService,
    private readonly keys: ApiKeys,
    @Inject(BILL_SOURCE) private readonly source: BillSource,
  ) {}

  private latest(): number {
    return currentCongress(new Date());
  }

  /** Whether the caller has the tool, and through which teams. Never refused. */
  async access(ctx: RequestContext): Promise<BillsAccess> {
    const latest = this.latest();
    if (!ctx.accountId) return { allowed: false, teams: [], systemAdmin: false, currentCongress: latest, keySource: null };
    const { allowed, teams, systemAdmin } = await this.standing(ctx.accountId);
    return { allowed, teams, systemAdmin, currentCongress: latest, keySource: allowed ? (await this.keys.billsKey()).source : null };
  }

  private async standing(accountId: string) {
    const [roles, member, settings, mine] = await Promise.all([
      this.directory.activeRoles(accountId),
      this.members.find(accountId),
      this.repo.settings(),
      this.roster.teamIdsOf(accountId),
    ]);
    const systemAdmin = administersSite(roles);
    const named = new Set(settings.teamIds);
    const candidates = member?.status === 'active' ? mine.filter((id) => named.has(id)) : [];
    const teams = candidates.length
      ? (await this.roster.all()).filter((t) => candidates.includes(t.teamId) && !t.archived).map((t) => ({ teamId: t.teamId, name: t.name }))
      : [];
    return { allowed: systemAdmin || teams.length > 0, teams, systemAdmin };
  }

  private async caller(ctx: RequestContext): Promise<Caller> {
    const accountId = requireAccount(ctx);
    const { allowed, systemAdmin } = await this.standing(accountId);
    if (!allowed) throw new ForbiddenException(NOT_FOR_YOU);
    return { accountId, systemAdmin };
  }

  async search(ctx: RequestContext, input: BillSearchInput): Promise<BillSearchPage> {
    await this.caller(ctx);
    const settled = settleSearch(input, this.latest());
    if (!settled.ok) throw new BadRequestException(settled.reason);
    return this.source.search(settled.search, this.latest()).catch(sourceError);
  }

  async recent(ctx: RequestContext, input: BillRecentInput): Promise<BillRecentPage> {
    await this.caller(ctx);
    const latest = this.latest();
    const congress = input.congress ?? latest;
    if (congress > latest) throw new BadRequestException(`the ${congressLabel(latest)} is the latest`);
    if (input.from && input.to && input.from > input.to) throw new BadRequestException('the first date is after the second');
    return this.source
      .recent({ congress, type: input.type ?? null, from: input.from ?? null, to: input.to ?? null, sort: input.sort ?? 'updated', page: input.page ?? 1 })
      .catch(sourceError);
  }

  async detail(ctx: RequestContext, congress: string, type: string, number: string): Promise<BillDetail> {
    const caller = await this.caller(ctx);
    const ref = this.ref(congress, type, number);
    const record = await this.record(ref);
    const id = billId(ref);
    const [watched, notes, counts] = await Promise.all([this.repo.findWatched(id), this.repo.notesOn(id), this.repo.noteCounts()]);
    const names = await this.names([...(watched ? [watched.addedBy] : []), ...notes.map((n) => n.author)]);
    return {
      ...record,
      id,
      label: billLabel(ref),
      status: billStatus(record.actions, record.laws),
      url: congressGovUrl(ref),
      watch: watched ? this.entry(watched, names, counts, false) : null,
      notes: notes.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((n) => this.noteView(n, names, caller)),
    };
  }

  async text(ctx: RequestContext, congress: string, type: string, number: string, version: string): Promise<BillText> {
    await this.caller(ctx);
    const ref = this.ref(congress, type, number);
    if (!isVersionCode(version)) throw new BadRequestException('a text version is a code of letters, such as ih or enr');
    const text = await this.source.text({ ...ref, version }).catch(sourceError);
    if (!text) throw new NotFoundException(`GovInfo has no ${version.toUpperCase()} text of ${billLabel(ref)} in the ${congressLabel(ref.congress)}`);
    return text;
  }

  /** The watchlist, its stale entries read again from Congress.gov first (at most `refreshPerRead`). */
  async watchlist(ctx: RequestContext, query: BillWatchQuery): Promise<BillWatchEntry[]> {
    await this.caller(ctx);
    const now = Date.now();
    const all = await this.repo.allWatched();
    const due = all
      .filter((e) => now - Date.parse(e.checkedAt) > BILL_LIMITS.refreshAfterMs)
      .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))
      .slice(0, BILL_LIMITS.refreshPerRead);
    const failed = new Set<string>();
    const refreshed = new Map<string, BillWatchRecord>();
    await Promise.all(
      due.map(async (e) => {
        try {
          const record = await this.source.bill(e);
          if (!record) return;
          const fields = this.snapshot(record, new Date().toISOString());
          if (await this.repo.refreshWatched(e.billId, fields)) refreshed.set(e.billId, { ...e, ...fields });
        } catch {
          failed.add(e.billId);
        }
      }),
    );
    const current = all.map((e) => refreshed.get(e.billId) ?? e);
    const tag = query.tag?.toLocaleLowerCase('en');
    const shown = sortWatchlist(
      tag ? current.filter((e) => e.tags.some((t) => t.toLocaleLowerCase('en') === tag)) : current,
      query.sort ?? 'latest_action',
    );
    const [names, counts] = await Promise.all([this.names(shown.map((e) => e.addedBy)), this.repo.noteCounts()]);
    return shown.map((e) => this.entry(e, names, counts, failed.has(e.billId)));
  }

  /** Adds a bill to the watchlist with its tags, or changes the tags of one on it, from the version edited. */
  async watch(ctx: RequestContext, id: string, input: WatchBillInput): Promise<BillWatchEntry> {
    const caller = await this.caller(ctx);
    const ref = this.refFromId(id);
    const tags = tidyTags(input.tags);
    assertCheck(checkTags(tags));
    const existing = await this.repo.findWatched(billId(ref));
    const record = existing ? null : await this.record(ref);
    const at = new Date().toISOString();
    const saved = await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.repo.getWatched(tx, billId(ref));
      if (current) {
        if (input.basedOn !== current.version) throw new ConflictException('someone changed this bill’s tags since you opened it: look again and redo your change');
        const next: BillWatchRecord = { ...current, tags, updatedAt: at, updatedBy: caller.accountId, version: current.version + 1 };
        this.repo.setWatched(tx, next);
        return next;
      }
      if (input.basedOn !== null) throw new ConflictException('this bill was taken off the watchlist since you opened it: add it again if it is still wanted');
      if ((await this.repo.countWatched(tx)) >= BILL_LIMITS.watchlist) {
        throw new ConflictException(`the watchlist holds at most ${BILL_LIMITS.watchlist} bills: take some off first`);
      }
      const bill = record ?? (await this.record(ref));
      const next: BillWatchRecord = {
        ...ref,
        billId: billId(ref),
        ...this.snapshot(bill, at),
        tags,
        addedAt: at,
        addedBy: caller.accountId,
        updatedAt: at,
        updatedBy: caller.accountId,
        version: 1,
      };
      this.repo.setWatched(tx, next);
      return next;
    });
    const [names, counts] = await Promise.all([this.names([saved.addedBy]), this.repo.noteCounts()]);
    return this.entry(saved, names, counts, false);
  }

  /** Takes a bill off the watchlist, with its notes. */
  async unwatch(ctx: RequestContext, id: string): Promise<{ readonly removed: true; readonly notes: number }> {
    await this.caller(ctx);
    const ref = this.refFromId(id);
    const notes = await this.firebase.db.runTransaction(async (tx) => {
      if (!(await this.repo.getWatched(tx, billId(ref)))) throw new NotFoundException(`${billLabel(ref)} is not on the watchlist`);
      return this.repo.deleteWatched(tx, billId(ref));
    });
    return { removed: true, notes };
  }

  async addNote(ctx: RequestContext, id: string, input: BillNoteInput): Promise<BillNoteView> {
    const caller = await this.caller(ctx);
    const ref = this.refFromId(id);
    const note: BillNoteRecord = {
      noteId: uuidv7(),
      billId: billId(ref),
      text: input.text,
      author: caller.accountId,
      createdAt: new Date().toISOString(),
      editedAt: null,
    };
    await this.firebase.db.runTransaction(async (tx) => {
      if (!(await this.repo.getWatched(tx, note.billId))) throw new NotFoundException(`${billLabel(ref)} is not on the watchlist: add it first, then its notes`);
      this.repo.setNote(tx, note);
    });
    return this.noteView(note, await this.names([note.author]), caller);
  }

  async editNote(ctx: RequestContext, noteId: string, input: BillNoteInput): Promise<BillNoteView> {
    const caller = await this.caller(ctx);
    const saved = await this.firebase.db.runTransaction(async (tx) => {
      const note = await this.repo.getNote(tx, noteId);
      if (!note) throw new NotFoundException('there is no such note');
      assertCheck(checkNoteChange(note, caller.accountId, 'edit', caller.systemAdmin));
      const next: BillNoteRecord = { ...note, text: input.text, editedAt: new Date().toISOString() };
      this.repo.setNote(tx, next);
      return next;
    });
    return this.noteView(saved, await this.names([saved.author]), caller);
  }

  async deleteNote(ctx: RequestContext, noteId: string): Promise<{ readonly deleted: true }> {
    const caller = await this.caller(ctx);
    await this.firebase.db.runTransaction(async (tx) => {
      const note = await this.repo.getNote(tx, noteId);
      if (!note) throw new NotFoundException('there is no such note');
      assertCheck(checkNoteChange(note, caller.accountId, 'delete', caller.systemAdmin));
      this.repo.deleteNote(tx, noteId);
    });
    return { deleted: true };
  }

  /** Admin › Bills: which teams have the tool, the teams to pick from, and the key in use (System Admins). */
  async settings(): Promise<BillSettingsView> {
    const [settings, teams, key] = await Promise.all([this.repo.settings(), this.roster.all(), this.keys.billsKey()]);
    const names = settings.updatedBy ? await this.names([settings.updatedBy]) : new Map<string, string>();
    return {
      teamIds: settings.teamIds,
      version: settings.version,
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedBy ? { accountId: settings.updatedBy, name: names.get(settings.updatedBy) ?? settings.updatedBy } : null,
      teams,
      keySource: key.source,
    };
  }

  /** Names the teams that have the tool, from the version edited; ledgered as `bills.settings_changed`. */
  async saveSettings(ctx: RequestContext, input: BillSettingsInput): Promise<BillSettingsView> {
    const actor = requireAccount(ctx);
    const teamIds = [...new Set(input.teamIds)];
    const teams = new Map((await this.roster.all()).map((t) => [t.teamId, t]));
    await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.repo.getSettings(tx);
      if (input.basedOn !== current.version) throw new ConflictException('someone saved these settings since you opened them: look again and redo your change');
      for (const id of teamIds) {
        const team = teams.get(id);
        if (!team) throw new NotFoundException(`there is no team ${id}`);
        if (team.archived && !current.teamIds.includes(id)) throw new ConflictException(`${team.name} is archived: restore it under Admin › Teams first`);
      }
      const unchanged = teamIds.length === current.teamIds.length && teamIds.every((id) => current.teamIds.includes(id));
      if (unchanged) return;
      const next: BillSettingsRecord = { teamIds, version: current.version + 1, updatedAt: new Date().toISOString(), updatedBy: actor };
      const payload: BillSettingsChangedPayload = { before: current.teamIds, after: teamIds };
      await this.ledger.record(tx, [{ type: 'bills.settings_changed', actor, subject: null, payload: { ...payload } }]);
      this.repo.setSettings(tx, next);
    });
    return this.settings();
  }

  private ref(congress: string, type: string, number: string): BillRef {
    const ref = /^\d{1,4}$/.test(congress) && /^\d{1,6}$/.test(number) ? validBillRef(Number(congress), type, Number(number), this.latest()) : null;
    if (!ref) throw new NotFoundException('there is no such bill: a bill is its Congress (the 103rd on), its type (hr, s, hjres, sjres, hconres, sconres, hres, sres) and its number');
    return ref;
  }

  private refFromId(id: string): BillRef {
    const ref = parseBillId(id, this.latest());
    if (!ref) throw new NotFoundException('there is no such bill: a bill is written 119-hr-10538');
    return ref;
  }

  private async record(ref: BillRef): Promise<BillRecord> {
    const record = await this.source.bill(ref).catch(sourceError);
    if (!record) throw new NotFoundException(`Congress.gov has no ${billLabel(ref)} in the ${congressLabel(ref.congress)}`);
    return record;
  }

  /** What the watchlist keeps of a bill, as Congress.gov describes it now. */
  private snapshot(record: BillRecord, at: string): Pick<BillWatchRecord, 'title' | 'sponsor' | 'status' | 'latestAction' | 'checkedAt'> {
    return {
      title: record.title,
      sponsor: record.sponsors[0]?.fullName || null,
      status: billStatus(record.actions, record.laws),
      latestAction: record.latestAction,
      checkedAt: at,
    };
  }

  private entry(e: BillWatchRecord, names: Map<string, string>, counts: Map<string, number>, stale: boolean): BillWatchEntry {
    const { addedBy, updatedBy: _updatedBy, ...rest } = e;
    return { ...rest, label: billLabel(e), addedBy: { accountId: addedBy, name: names.get(addedBy) ?? 'a former member' }, notes: counts.get(e.billId) ?? 0, stale };
  }

  private noteView(n: BillNoteRecord, names: Map<string, string>, caller: Caller): BillNoteView {
    return {
      noteId: n.noteId,
      text: n.text,
      author: { accountId: n.author, name: names.get(n.author) ?? 'a former member' },
      createdAt: n.createdAt,
      editedAt: n.editedAt,
      mine: n.author === caller.accountId,
      deletable: checkNoteChange(n, caller.accountId, 'delete', caller.systemAdmin).ok,
    };
  }

  /** People's names, as members know them (preferred, else legal), else their account's display name. */
  private async names(accountIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(accountIds)];
    if (!ids.length) return new Map();
    const [records, display] = await Promise.all([this.members.findMany(ids), this.directory.displayNames(ids)]);
    const names = new Map<string, string>();
    ids.forEach((id, i) => {
      const m = records[i];
      const name = m ? m.preferredName || m.legalName : display.get(id);
      if (name) names.set(id, name);
    });
    return names;
  }
}
