import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CALENDAR_PAST_DAYS,
  createCalendarItem,
  setCalendarStatus,
  updateCalendarItem,
  uuidv7,
  type CalendarContent,
  type CalendarItemRecord,
  type CalendarStatusInput,
  type CreateCalendarItemInput,
  type Outcome,
  type UpdateCalendarItemInput,
} from 'ustp-domain';
import { DirectoryService } from '../auth/directory.service.js';
import { accepted } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { CommunicationsRepository } from './communications.repository.js';

/** Someone on the communications team, for the calendar's "who posts it". */
export interface TeamMate {
  readonly accountId: string;
  readonly name: string;
}

/**
 * The social media calendar (design §10.7): what the party's own accounts will post, and when. The team's own planning,
 * so it is not ledgered.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly firebase: Firebase,
    private readonly repo: CommunicationsRepository,
    private readonly directory: DirectoryService,
  ) {}

  /** Items planned for the last `CALENDAR_PAST_DAYS` days or later, and any still planned, soonest first. */
  async list(): Promise<CalendarItemRecord[]> {
    const since = new Date(Date.now() - CALENDAR_PAST_DAYS * 86_400_000).toISOString();
    return (await this.repo.calendar(since)).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  }

  /** The Communications Admins who could be asked to post an item. */
  async team(): Promise<TeamMate[]> {
    return this.directory.roleHolders('communications_admin');
  }

  async create(actor: string, input: CreateCalendarItemInput): Promise<CalendarItemRecord> {
    await this.assertAssignee(input);
    const item = createCalendarItem(input, uuidv7(), actor, new Date().toISOString());
    await this.firebase.db.runTransaction(async (tx) => this.repo.setCalendarItem(tx, item));
    return item;
  }

  async update(actor: string, itemId: string, input: UpdateCalendarItemInput): Promise<CalendarItemRecord> {
    const { basedOn, ...content } = input;
    await this.assertAssignee(content);
    return this.change(itemId, (item) => updateCalendarItem(item, content, basedOn, actor, new Date().toISOString()));
  }

  async setStatus(actor: string, itemId: string, input: CalendarStatusInput): Promise<CalendarItemRecord> {
    return this.change(itemId, (item) => setCalendarStatus(item, input, actor, new Date().toISOString()));
  }

  async delete(itemId: string): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      if (!(await this.repo.getCalendarItem(tx, itemId))) throw new NotFoundException('no such calendar item');
      this.repo.deleteCalendarItem(tx, itemId);
    });
  }

  /** An item is assigned to someone on the team, or to nobody in particular. */
  private async assertAssignee(content: Pick<CalendarContent, 'assignee'>): Promise<void> {
    if (content.assignee && !(await this.team()).some((m) => m.accountId === content.assignee)) {
      throw new BadRequestException('assign it to a Communications Admin, or to nobody in particular');
    }
  }

  private change(itemId: string, act: (item: CalendarItemRecord | null) => Outcome<CalendarItemRecord>): Promise<CalendarItemRecord> {
    return this.firebase.db.runTransaction(async (tx) => {
      const item = accepted(act(await this.repo.getCalendarItem(tx, itemId)));
      this.repo.setCalendarItem(tx, item);
      return item;
    });
  }
}
