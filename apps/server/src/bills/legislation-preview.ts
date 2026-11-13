import { Injectable } from '@nestjs/common';
import {
  BILL_STATUS_LABELS,
  BILL_TOPIC_SHORT,
  memberLabel,
  memberPlace,
  memberTag,
  VOTE_CAST_LABELS,
  type CardBar,
  type LinkPreview,
  type PublicBillView,
} from 'ustp-domain';
import { orNone, type LinkPreviewSource } from '../link-previews/link-previews.js';
import { PublicBills } from './public-bills.js';

/**
 * The link previews of the public Legislation page and scorecard (design §15, "Link previews"; §5.14): the list, each
 * bill, the scorecard and each member's line on it, from the same copy the pages read.
 */

/** "October 20, 2026", in UTC. */
const longDay = (date: string) => new Date(date.length === 10 ? `${date}T00:00:00Z` : date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

const PARTY = 'the U.S. Transhumanist Party';

@Injectable()
export class LegislationPreviews implements LinkPreviewSource {
  readonly page = '/legislation';

  constructor(private readonly bills: PublicBills) {}

  async preview(): Promise<LinkPreview> {
    const list = await this.bills.list(null);
    const latest = list[0];
    const title = 'Science, AI and longevity bills in Congress';
    return {
      title,
      description: `The bills in Congress on science, artificial intelligence and longevity that ${PARTY} follows, as they move, with how each member voted on them${list.length ? `: ${plural(list.length, 'bill')} now` : ''}.`,
      card: {
        kicker: 'Legislation',
        title,
        lines: [
          list.length ? `${plural(list.length, 'bill')} the party follows` : 'The bills the party follows',
          ...(latest?.latestAction ? [`Latest: ${latest.label}, ${BILL_STATUS_LABELS[latest.status].toLowerCase()}, ${longDay(latest.latestAction.date)}`] : []),
        ],
      },
    };
  }
}

/** The newest roll call that was read, as bars: yeas and nays, the party's position drawn solid. */
function voteBars(bill: PublicBillView): CardBar[] | null {
  const vote = bill.votes.find((v) => v.totals);
  if (!vote?.totals) return null;
  const cast = vote.totals.yea + vote.totals.nay;
  if (!cast) return null;
  return (['yea', 'nay'] as const).map((side) => ({
    label: `${VOTE_CAST_LABELS[side]}${vote.position === side ? ' (the party’s position)' : ''}`,
    value: vote.totals![side].toLocaleString('en-US'),
    share: vote.totals![side] / cast,
    ...(vote.position === side ? { highlight: true } : {}),
  }));
}

@Injectable()
export class PublicBillPreviews implements LinkPreviewSource {
  readonly page = '/legislation/:billId';

  constructor(private readonly bills: PublicBills) {}

  async preview({ billId }: Readonly<Record<string, string>>): Promise<LinkPreview | null> {
    const bill = await orNone(this.bills.bill(billId!));
    if (!bill) return null;
    const title = `${bill.label}: ${bill.title}`;
    const status = `${BILL_STATUS_LABELS[bill.status]}${bill.latestAction ? `, ${longDay(bill.latestAction.date)}` : ''}`;
    const bars = voteBars(bill);
    return {
      title,
      description: bill.summary || bill.crsSummary?.paragraphs.find((p) => p.length > 40) || `${status}. ${bill.latestAction?.text ?? ''}`.trim(),
      type: 'article',
      card: {
        kicker: `Bill in Congress · ${BILL_TOPIC_SHORT[bill.topic]}`,
        title,
        ...(bars ? { bars } : { lines: [status, ...(bill.sponsor ? [`Sponsor: ${bill.sponsor.name}`] : [])] }),
      },
    };
  }
}

@Injectable()
export class ScorecardPreviews implements LinkPreviewSource {
  readonly page = '/scorecard';

  constructor(private readonly bills: PublicBills) {}

  async preview(): Promise<LinkPreview> {
    const card = await this.bills.scorecard();
    const title = 'Congress scorecard: science, AI and longevity';
    return {
      title,
      description: `How each member of Congress voted on the science, AI and longevity bills ${PARTY} follows, against the party's position${card.votes ? `: ${plural(card.votes, 'roll call')} on ${plural(card.bills, 'bill')}` : ''}.`,
      card: {
        kicker: 'Scorecard',
        title: 'How Congress voted on science, AI and longevity',
        lines: card.votes ? [`${plural(card.rows.length, 'member')} of Congress`, `${plural(card.votes, 'roll call')} scored on ${plural(card.bills, 'bill')}`] : ['Against the U.S. Transhumanist Party’s positions'],
      },
    };
  }
}

@Injectable()
export class ScorecardMemberPreviews implements LinkPreviewSource {
  readonly page = '/scorecard/:memberId';

  constructor(private readonly bills: PublicBills) {}

  async preview({ memberId }: Readonly<Record<string, string>>): Promise<LinkPreview | null> {
    const view = await orNone(this.bills.member(memberId!));
    if (!view) return null;
    const m = view.member;
    const name = memberLabel(m);
    const cast = m.with + m.against;
    const all = cast + m.missed;
    const bar = (label: string, n: number, highlight = false): CardBar => ({ label, value: n.toLocaleString('en-US'), share: all ? n / all : 0, ...(highlight ? { highlight } : {}) });
    return {
      title: `${name} (${memberTag(m)}): scorecard`,
      description: cast
        ? `${name} (${memberTag(m)}) voted with ${PARTY}'s position on ${m.with} of ${plural(cast, 'scored vote')} on science, AI and longevity bills${m.missed ? `, and missed ${m.missed}` : ''}.`
        : `${name} (${memberTag(m)}) on the science, AI and longevity bills ${PARTY} follows.`,
      type: 'profile',
      card: {
        kicker: `Scorecard · ${m.chamber === 'house' ? 'U.S. House' : 'U.S. Senate'}, ${memberPlace(m)}`,
        title: name,
        ...(all
          ? { bars: [bar('With the party’s position', m.with, true), bar('Against it', m.against), ...(m.missed ? [bar('Did not vote', m.missed)] : [])] }
          : { lines: [`${plural(view.votes.length, 'vote')} on the bills the party follows`] }),
      },
    };
  }
}
