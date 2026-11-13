import {
  absoluteUrl,
  HOUSE_SEATS,
  NON_STATES,
  personPath,
  racePath,
  raceStateName,
  type AreaContact,
  type ContactFeed,
  type ContactFeedState,
  type PersonView,
  type RaceSeatSummary,
  type RaceView,
  type Shareable,
} from 'ustp-domain';

/**
 * The words of the race pages and people's pages (design §5.17), kept apart from the pages so that tests can read them.
 */

/** A sentence's first letter in capitals: "The District of Columbia". */
export const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * What a state's page covers: "President, the U.S. Senate and its 52 seats in the U.S. House", and the statewide offices
 * when someone is listed for them (California's own list, in the years it elects them).
 */
export function stateOffices(state: string, electionYear: number, statewide = false): string {
  const seats = HOUSE_SEATS[state] ?? 0;
  const offices = [
    ...(electionYear % 4 === 0 ? ['President'] : []),
    ...(NON_STATES.has(state) ? [] : ['the U.S. Senate']),
    ...(statewide ? ['the statewide offices'] : []),
    seats === 1 ? 'its seat in the U.S. House' : `its ${seats} seats in the U.S. House`,
  ];
  return offices.length > 1 ? `${offices.slice(0, -1).join(', ')} and ${offices.at(-1)}` : offices[0]!;
}

/** A House seat on its state's page, after its code: "Nancy Pelosi (Democrat) · 3 running". */
export function seatSummaryText(seat: RaceSeatSummary): string {
  const holders = seat.holders.length ? seat.holders.map((h) => (h.party ? `${h.name} (${h.party})` : h.name)).join(', ') : 'Vacant, or not listed';
  const running = seat.running + seat.party;
  return `${holders} · ${running === 0 ? 'nobody listed as running yet' : `${running} running`}`;
}

/** Where the page's people come from, as its credit line names them. */
export function raceCredit(feeds: Readonly<Record<ContactFeed, ContactFeedState>>): string {
  return [
    'Candidates for Congress and President from the FEC, those who have filed and reported raising money',
    feeds.sos === 'ok' ? 'candidates on California’s ballot from its Secretary of State' : null,
    'members of Congress from the congress-legislators project',
    'biographies from Wikipedia and Wikidata, by FEC and Congress ID.',
  ]
    .filter(Boolean)
    .join('; ');
}

/** When the records were last read, in the reader's own time: "Nov 12, 2026, 7:30 PM". */
export const checkedText = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** What a race page shares. */
export function raceShareable(view: Pick<RaceView, 'state' | 'seat' | 'title' | 'electionYear' | 'candidates'>, origin = location.origin): Shareable {
  const statewide = view.candidates.some((c) => c.office === 'statewide');
  const what = view.seat === null ? `who is running for ${stateOffices(view.state, view.electionYear, statewide)}, and who holds those seats now` : 'who is running, and who holds the seat now';
  return { text: `${view.title}: ${what}.`, url: absoluteUrl(racePath(view), origin), hashtags: [], title: view.title };
}

/** A person's part, in a line: "U.S. Representative for California’s 12th congressional district", or what they run for. */
export function personRoleText(view: Pick<PersonView, 'person' | 'race' | 'electionYear'>): string {
  const p = view.person;
  const where = view.race?.seat ?? 'the United States';
  return p.role === 'holder' ? `${p.officeTitle} for ${where}` : `Running for ${p.officeTitle}, ${where}, in ${view.electionYear}`;
}

/** What a person's page shares. */
export function personShareable(view: Pick<PersonView, 'person' | 'race' | 'electionYear'>, origin = location.origin): Shareable {
  const p = view.person;
  const path = personPath(p.contactId) ?? '/races';
  const role = p.role === 'holder' ? personRoleText(view) : `a candidate for ${p.officeTitle}, ${view.race?.seat ?? 'the United States'}, in ${view.electionYear}`;
  return { text: `${p.name}${p.party ? ` (${p.party})` : ''}, ${role}.`, url: absoluteUrl(path, origin), hashtags: [], title: p.name };
}

/** The breadcrumbs above a race page or a person's: Races, the state, the seat. */
export function raceCrumbs(state: string | null, seat: { readonly code: string; readonly path: string } | null): { readonly label: string; readonly to: string }[] {
  return [
    { label: 'Races', to: '/races' },
    ...(state ? [{ label: capitalized(raceStateName(state)), to: racePath({ state, seat: null }) }] : []),
    ...(seat ? [{ label: seat.code, to: seat.path }] : []),
  ];
}

/** A person's own page, where they have one. */
export const personLink = (person: Pick<AreaContact, 'contactId'>): string | null => personPath(person.contactId);
