import { Injectable } from '@nestjs/common';
import {
  HOUSE_SEATS,
  NON_STATES,
  nextFederalElectionYear,
  racePlace,
  raceStateName,
  raceTitle,
  seatName,
  type AreaContact,
  type LinkPreview,
  type PersonView,
  type RacePlace,
  type RaceView,
} from 'ustp-domain';
import type { LinkPreviewSource } from '../link-previews/link-previews.js';
import { RacesService } from './races.service.js';

const SOURCES = 'From public records: FEC filings and the members of Congress.';
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
/** "3 candidates listed so far", or that nobody is yet. */
const runningText = (n: number) => (n ? `${count(n, 'candidate')} listed so far` : 'Nobody listed as running yet');
/** "Nancy Pelosi (Democrat)", "Sam Senator (Democrat) and Sky Senator (Republican)". */
const namesText = (people: readonly Pick<AreaContact, 'name' | 'party'>[]) => {
  const named = people.map((p) => (p.party ? `${p.name} (${p.party})` : p.name));
  return named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : (named[0] ?? '');
};

/**
 * A race page's link preview (design §15, "Link previews"; §5.17): what the page heads it, who holds the seat and how
 * many run, as the records already held say. Before any record is held, it says what the page is, without people: a
 * preview is fetched by sites that wait a few seconds at most, so it never waits for the FEC.
 */
export function racePreview(place: RacePlace, view: RaceView | null, electionYear: number): LinkPreview {
  const year = view?.electionYear ?? electionYear;
  const title = raceTitle(place, year);
  const party = view?.party ?? [];
  const partyText = party.length ? ` Among them the Transhumanist Party’s ${party.map((c) => c.name).join(', ')}.` : '';
  if (place.seat !== null) {
    const seat = seatName(place);
    const holders = view?.holders ?? [];
    const running = (view?.candidates.length ?? 0) + party.length;
    return {
      title,
      description: `Who is running for ${seat} in ${year}${holders.length ? `, and who holds the seat now: ${namesText(holders)}` : ', and who holds the seat now'}.${view ? ` ${runningText(running)}.` : ''}${partyText} ${SOURCES}`,
      card: {
        kicker: `U.S. House · ${year}`,
        title,
        lines: [seat.charAt(0).toUpperCase() + seat.slice(1), ...(holders.length ? [`Holds the seat: ${namesText(holders)}`] : []), ...(view ? [runningText(running)] : [])],
      },
    };
  }
  const name = raceStateName(place.state);
  const seats = HOUSE_SEATS[place.state]!;
  const offices = [...(year % 4 === 0 ? ['President'] : []), ...(NON_STATES.has(place.state) ? [] : ['the U.S. Senate']), seats === 1 ? 'its seat in the U.S. House' : `its ${seats} seats in the U.S. House`];
  const senate = view?.candidates.filter((c) => c.office === 'us_senate').length ?? 0;
  const house = view?.seats.reduce((n, s) => n + s.running + s.party, 0) ?? 0;
  const lines = view
    ? [
        ...(NON_STATES.has(place.state) ? [] : [`U.S. Senate: ${count(senate, 'candidate')}`]),
        `U.S. House: ${count(house, 'candidate')} for ${count(seats, 'seat')}`,
        ...(party.length ? [`Transhumanist Party: ${count(party.length, 'candidate')}`] : []),
      ]
    : [`Every race for ${offices.slice(1).join(' and ')}`];
  return {
    title,
    description: `Who is running in ${name} in ${year} for ${offices.length > 1 ? `${offices.slice(0, -1).join(', ')} and ${offices.at(-1)}` : offices[0]}, and who holds those seats now.${partyText} ${SOURCES}`,
    card: { kicker: `Races · ${year}`, title, lines },
  };
}

/** A person's link preview: who they are, for which seat, as their race's records say. */
export function personPreview(view: PersonView): LinkPreview {
  const p = view.person;
  const where = view.race?.seat ?? 'the United States';
  const party = p.party ? ` (${p.party})` : '';
  const holder = p.role === 'holder';
  const running = holder && view.also ? `, running again in ${view.electionYear}` : '';
  return {
    title: `${p.name} · ${holder ? p.officeTitle : `Candidate for ${p.officeTitle}`}`,
    description: holder
      ? `${p.name}${party}, ${p.officeTitle} for ${where}${running}. Who else is listed for the seat, from public records.`
      : `${p.name}${party}, a candidate for ${p.officeTitle}, ${where}, in ${view.electionYear}${p.incumbent ? ', who holds the seat now' : ''}. ${SOURCES}`,
    type: 'profile',
    card: {
      kicker: holder ? p.officeTitle : `Candidate · ${p.officeTitle}`,
      title: p.name,
      lines: [where.charAt(0).toUpperCase() + where.slice(1), ...(p.party ? [p.party] : []), holder ? (view.also ? `Running again in ${view.electionYear}` : 'In office now') : `Running in ${view.electionYear}`],
    },
  };
}

@Injectable()
export class StateRacePreviews implements LinkPreviewSource {
  readonly page = '/races/:state';

  constructor(private readonly races: RacesService) {}

  async preview({ state }: Readonly<Record<string, string>>): Promise<LinkPreview | null> {
    const place = racePlace(state!);
    return place && racePreview(place, await this.races.heldRace(state!), nextFederalElectionYear(new Date().toISOString().slice(0, 10)));
  }
}

@Injectable()
export class SeatRacePreviews implements LinkPreviewSource {
  readonly page = '/races/:state/:district';

  constructor(private readonly races: RacesService) {}

  async preview({ state, district }: Readonly<Record<string, string>>): Promise<LinkPreview | null> {
    const place = racePlace(state!, district!);
    return place && racePreview(place, await this.races.heldRace(state!, district!), nextFederalElectionYear(new Date().toISOString().slice(0, 10)));
  }
}

@Injectable()
export class PersonPreviews implements LinkPreviewSource {
  readonly page = '/people/:id';

  constructor(private readonly races: RacesService) {}

  async preview({ id }: Readonly<Record<string, string>>): Promise<LinkPreview | null> {
    const view = await this.races.heldPerson(id!);
    return view && personPreview(view);
  }
}
