import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  houseDistrict,
  houseSeats,
  NATION_ID,
  nextFederalElectionYear,
  NO_FEEDS,
  onRacePage,
  peopleWithPages,
  personContactId,
  personRecordsKey,
  personView,
  raceCode,
  raceNotUp,
  racePartyCandidates,
  racePlace,
  raceSeats,
  raceSitemapPaths,
  raceTitle,
  samePerson,
  seatGeoid,
  type AreaContact,
  type ContactFeed,
  type ContactFeedState,
  type District,
  type PersonView,
  type PublicCandidacy,
  type RacePlace,
  type RaceRecordsRecord,
  type RaceSeat,
  type RaceView,
} from 'ustp-domain';
import { CandidaciesService } from './candidacies.service.js';
import { CONTACT_SOURCE, type ContactSource } from './contact-source.js';
import { PROFILE_SOURCE, type ProfileSource } from './profile-source.js';
import { RaceRecordRepository } from './race-record.repository.js';

const HOUR_MS = 60 * 60 * 1000;
/** Records are read again once a day old, or an hour when one of them did not answer. */
const FRESH_MS = 24 * HOUR_MS;
const RETRY_MS = HOUR_MS;

const today = () => new Date().toISOString().slice(0, 10);
const electionYearNow = () => nextFederalElectionYear(today());

/** Two records' state of one feed together: missing if either was, answered if either did. */
function bothFeeds(a: Readonly<Record<ContactFeed, ContactFeedState>>, b: Readonly<Record<ContactFeed, ContactFeedState>>): Record<ContactFeed, ContactFeedState> {
  const either = (x: ContactFeedState, y: ContactFeedState): ContactFeedState => (x === 'unavailable' || y === 'unavailable' ? 'unavailable' : x === 'ok' || y === 'ok' ? 'ok' : 'off');
  return Object.fromEntries(Object.keys(a).map((f) => [f, either(a[f as ContactFeed], b[f as ContactFeed])])) as Record<ContactFeed, ContactFeedState>;
}

/** What a page shows needs no profile in the shared records: each api instance keeps those a day itself. */
const withoutProfile = (c: AreaContact): AreaContact => ({ ...c, profile: null });

/**
 * The race pages and people's pages (design §5.17): each state's federal races and each House seat, from the public
 * records of §5.12, with the party's own candidates there; and each public-record person with an official ID. The
 * records are read for a whole state at once (the presidency apart) and kept in `race_records` for every api instance a
 * day, so that a crawler reading every page costs the FEC a few requests per state a day; a record that does not
 * answer is asked again in an hour, the last full answer served meanwhile. No ZIP code is involved, so Google's ballot
 * data, which may not be kept, never is.
 */
@Injectable()
export class RacesService {
  private readonly logger = new Logger(RacesService.name);
  /** Each key's record being read now, so that pages asked together read it once. */
  private readonly reading = new Map<string, Promise<RaceRecordsRecord>>();
  /** The records this instance last had, to spare Firestore a read on every page. */
  private readonly memo = new Map<string, RaceRecordsRecord>();

  constructor(
    private readonly repo: RaceRecordRepository,
    private readonly candidacies: CandidaciesService,
    @Inject(CONTACT_SOURCE) private readonly source: ContactSource,
    @Inject(PROFILE_SOURCE) private readonly profiles: ProfileSource,
  ) {}

  /** A race page: 404 for an address that is no page (`racePlace`). */
  async race(state: string, district?: string): Promise<RaceView> {
    const place = racePlace(state, district);
    if (!place) throw new NotFoundException('no such race page: a state’s two-letter code in lower case, then a House district’s number or at-large');
    const electionYear = electionYearNow();
    const [records, nation, candidacies] = await Promise.all([
      this.records(place.state, electionYear),
      place.seat === null ? this.records(NATION_ID, electionYear) : Promise.resolve(null),
      this.candidacies.publicList(),
    ]);
    const census = place.seat === null ? null : await this.houseDistrict(place.state, place.seat);
    return this.view(place, electionYear, census, records, nation, candidacies, true);
  }

  /**
   * A race page as the records already held say, without asking any record or Wikidata, for its link preview: a link's
   * preview is asked for by sites that wait a few seconds at most. Null when the state's records are not held yet.
   */
  async heldRace(state: string, district?: string): Promise<RaceView | null> {
    const place = racePlace(state, district);
    if (!place) return null;
    const electionYear = electionYearNow();
    const [records, nation, candidacies] = await Promise.all([
      this.held(place.state, electionYear),
      place.seat === null ? this.held(NATION_ID, electionYear) : Promise.resolve(null),
      this.candidacies.publicList(),
    ]);
    return records ? this.view(place, electionYear, null, records, nation, candidacies, false) : null;
  }

  /**
   * A person's page, by their FEC candidate ID or Bioguide ID: found in the records that list them (read again when a
   * day old), or, for an FEC ID no record holds yet, in the state it was filed in; 404 when no record lists them.
   */
  async person(id: string): Promise<PersonView> {
    const found = await this.findPerson(id, true);
    const { people } = await this.profiles.withProfiles([found.person]);
    return { ...found, person: people[0] ?? found.person };
  }

  /** A person's page as the records already held say, for its link preview; null when none lists them. */
  async heldPerson(id: string): Promise<PersonView | null> {
    return this.findPerson(id, false).catch((e: unknown) => {
      if (e instanceof NotFoundException) return null;
      throw e;
    });
  }

  /** The race pages and people's pages for the sitemap: the people from the records of this election held now. */
  async sitemapPaths(): Promise<string[]> {
    const people = await this.repo.people(electionYearNow()).catch((e: unknown) => {
      this.logger.warn(`race records unreadable for the sitemap: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    });
    return raceSitemapPaths(people);
  }

  private async findPerson(id: string, refresh: boolean): Promise<PersonView> {
    const contactId = personContactId(id);
    if (!contactId) throw new NotFoundException('no such person: their page is found by an FEC candidate ID or a Bioguide ID');
    const electionYear = electionYearNow();
    const holding = (await this.repo.holding(contactId)).filter((r) => r.electionYear === electionYear).map((r) => r.key);
    const keys = [...new Set([...holding, ...(refresh ? [personRecordsKey(id)] : [])].filter((k): k is string => k !== null))];
    for (const key of keys) {
      const record = refresh ? await this.records(key, electionYear) : await this.held(key, electionYear);
      const view = record && personView(contactId, record);
      if (view) return view;
    }
    throw new NotFoundException(`the public records list nobody with that ID for the ${electionYear} election`);
  }

  private async view(
    place: RacePlace,
    electionYear: number,
    district: District | null,
    ofState: RaceRecordsRecord | null,
    nation: RaceRecordsRecord | null,
    candidacies: readonly PublicCandidacy[],
    profiled: boolean,
  ): Promise<RaceView> {
    // The presidency first, as the pages list the offices.
    const read = [nation, ofState].filter((r): r is RaceRecordsRecord => r !== null);
    const contacts = read.flatMap((r) => r.contacts);
    const shown = contacts.filter((c) => onRacePage(place, c));
    const party = racePartyCandidates(place, candidacies, today());
    const listed = [...shown.filter((c) => c.role === 'holder'), ...shown.filter((c) => c.role === 'candidate' && !party.some((p) => samePerson(p, c)))];
    const { people, state } = profiled ? await this.profiles.withProfiles(listed) : { people: listed, state: 'off' as const };
    const candidates = people.filter((c) => c.role === 'candidate');
    return {
      state: place.state,
      seat: place.seat,
      code: raceCode(place),
      title: raceTitle(place, electionYear),
      electionYear,
      district,
      party,
      holders: people.filter((c) => c.role === 'holder'),
      candidates,
      notUp: raceNotUp(place, ofState?.notUp ?? [], candidates, electionYear),
      seats: place.seat === null ? raceSeats(place.state, ofState?.contacts ?? [], party) : [],
      feeds: read.length ? read.map((r) => r.feeds).reduce(bothFeeds) : { ...NO_FEEDS, fec: 'unavailable' },
      profiles: state,
      checkedAt: read.length ? read.map((r) => r.checkedAt).sort()[0]! : null,
    };
  }

  /** A House seat's Census district, with its point and lines; its GEOID and name alone when the Census does not answer. */
  private async houseDistrict(state: string, seat: RaceSeat): Promise<District> {
    const geoid = seatGeoid(state, seat);
    const listed = await this.candidacies.districtList('congressional', state).catch(() => []);
    return listed.find((d) => d.geoid === geoid) ?? houseDistrict(state, seat);
  }

  private async houseDistricts(state: string): Promise<District[]> {
    const listed = await this.candidacies.districtList('congressional', state).catch(() => []);
    return houseSeats(state).map((seat) => listed.find((d) => d.geoid === seatGeoid(state, seat)) ?? houseDistrict(state, seat));
  }

  /** The records held for a key and election, fresh or not; null when there are none. */
  private async held(key: string, electionYear: number): Promise<RaceRecordsRecord | null> {
    const memo = this.memo.get(key);
    if (memo?.electionYear === electionYear) return memo;
    const stored = await this.repo.get(key).catch((e: unknown) => {
      this.logger.warn(`race records ${key} unreadable: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    if (stored?.electionYear !== electionYear) return null;
    this.memo.set(key, stored);
    return stored;
  }

  /** The records for a key and election, read again from the public records when stale; the stale ones if that fails. */
  private async records(key: string, electionYear: number): Promise<RaceRecordsRecord | null> {
    const memo = this.memo.get(key);
    if (memo?.electionYear === electionYear && Date.parse(memo.freshUntil) > Date.now()) return memo;
    const held = await this.held(key, electionYear);
    if (held && Date.parse(held.freshUntil) > Date.now()) return held;
    const k = `${key}:${electionYear}`;
    let reading = this.reading.get(k);
    if (!reading) {
      reading = this.read(key, electionYear, held).finally(() => this.reading.delete(k));
      this.reading.set(k, reading);
    }
    try {
      return await reading;
    } catch (e) {
      this.logger.warn(`race records ${key} could not be read: ${e instanceof Error ? e.message : String(e)}`);
      return held;
    }
  }

  /**
   * Asks the public records for a key. When one did not answer and full records of this election are held, those are
   * kept and asked again in an hour, rather than replaced by fewer people.
   */
  private async read(key: string, electionYear: number, held: RaceRecordsRecord | null): Promise<RaceRecordsRecord> {
    const found = key === NATION_ID ? await this.source.forNation(electionYear) : await this.source.forState(key, await this.houseDistricts(key), electionYear);
    const now = Date.now();
    const failed = Object.values(found.feeds).includes('unavailable');
    const heldWasFull = held !== null && !Object.values(held.feeds).includes('unavailable');
    const record: RaceRecordsRecord =
      failed && heldWasFull
        ? { ...held, freshUntil: new Date(now + RETRY_MS).toISOString() }
        : {
            key,
            electionYear,
            checkedAt: new Date(now).toISOString(),
            freshUntil: new Date(now + (failed ? RETRY_MS : FRESH_MS)).toISOString(),
            contacts: found.contacts.map(withoutProfile),
            notUp: found.notUp,
            feeds: found.feeds,
            people: peopleWithPages(found.contacts),
          };
    this.memo.set(key, record);
    await this.repo.set(record).catch((e: unknown) => this.logger.warn(`race records ${key} not saved: ${e instanceof Error ? e.message : String(e)}`));
    return record;
  }

  /** Forgets what this instance holds (tests). */
  forget(): void {
    this.memo.clear();
  }
}
