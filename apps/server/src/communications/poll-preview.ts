import { Injectable } from '@nestjs/common';
import { choiceShare, leadingChoices, percent, pollBars, pollClosesAt, pollState, type LinkPreview } from 'ustp-domain';
import type { LinkPreviewSource } from '../link-previews/link-previews.js';
import { PollsService } from './polls.service.js';

/** "November 19, 2026", in Eastern time: a US party's polls close on a US evening, which in UTC is often the next day. */
const easternDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

const answers = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'answer' : 'answers'}`;

/**
 * An issue poll's link preview (design §15, "Link previews"; §10.16). While it is open, the question and its choices,
 * never the running results, which only those who answered see; once it has closed, a bar per choice. A poll says
 * it is a poll, not an election.
 */
@Injectable()
export class PollPreviews implements LinkPreviewSource {
  readonly page = '/polls/:id';

  constructor(private readonly polls: PollsService) {}

  async preview({ id }: Readonly<Record<string, string>>): Promise<LinkPreview | null> {
    const poll = await this.polls.findPublished(id!);
    if (!poll) return null;
    const closes = easternDay(pollClosesAt(poll)!);
    if (pollState(poll, new Date()) === 'open') {
      return {
        title: `Poll: ${poll.question}`,
        description: `${poll.question} Answer the U.S. Transhumanist Party's poll by ${closes} and see what others think. A poll, not an election: anyone may answer.`,
        card: {
          kicker: `Poll · Open until ${closes}`,
          title: poll.question,
          lines: [poll.choices.map((c) => c.label).join(' · '), 'Answer, then see what everyone thinks'],
        },
      };
    }
    const { everyone, members } = await this.polls.results(poll);
    const leaders = leadingChoices(poll.choices, everyone);
    const top = leaders[0];
    const lead =
      leaders.length === 1 && top
        ? `Most chose “${top.label}” (${percent(choiceShare(everyone, top.choiceId), 0)})`
        : leaders.length > 1
          ? `A tie between ${leaders.map((c) => `“${c.label}”`).join(' and ')}`
          : 'Nobody answered';
    const memberLead = leadingChoices(poll.choices, members);
    const membersSaid =
      members.total > 0 && memberLead.length === 1 ? `; Active members chose “${memberLead[0]!.label}” (${percent(choiceShare(members, memberLead[0]!.choiceId), 0)})` : '';
    return {
      title: `Poll results: ${poll.question}`,
      description: `${poll.question} ${lead}${membersSaid}, of ${answers(everyone.total)} to the U.S. Transhumanist Party's poll, closed ${closes}. A poll, not an election.`,
      card: { kicker: `Poll results · ${answers(everyone.total)}`, title: poll.question, bars: pollBars(poll.choices, everyone) },
    };
  }
}
