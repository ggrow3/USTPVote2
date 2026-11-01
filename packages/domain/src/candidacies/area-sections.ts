import { inCandidateArea, type CandidateArea } from './area.js';
import type { PublicOffice } from './candidacy.js';
import { groupAreaContacts, nameKey, type AreaContact, type AreaOfficeGroup, type ContactRole } from './contacts.js';
import type { District } from './districts.js';
import type { PublicCandidacy } from './views.js';

/**
 * The three groups the Candidates and Your area pages put an area's people in (design §5.8), decided with the user
 * (2026-11-01): the Transhumanist Party's candidates (members' approved candidacies there), the member's representatives
 * (who holds each office there now), and everyone else running there, from public records and admins' entries. Someone
 * who is both a representative and one of the party's candidates is in both groups, marked as both wherever they show.
 */

/** Someone listed for a seat: the office, its district and their name. */
export interface SeatPerson {
  readonly office: PublicOffice;
  readonly district: Pick<District, 'kind' | 'geoid'>;
  readonly name: string;
}

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/** A name's first initial and surname, compared loosely, without a suffix such as Jr. */
function initialAndSurname(name: string): { readonly initial: string; readonly surname: string } {
  const words = nameKey(name)
    .split(' ')
    .filter((w) => w && !SUFFIXES.has(w));
  return { initial: words[0]?.[0] ?? '', surname: words.length > 1 ? words.at(-1)! : '' };
}

/**
 * Whether two entries are the same person for the same seat: the same office and district, and the same name loosely,
 * or the same first initial and surname, since a member's preferred name ("Mike Levin") need not be the one a public
 * record files ("Michael T. Levin").
 */
export function samePerson(a: SeatPerson, b: SeatPerson): boolean {
  if (a.office !== b.office || a.district.kind !== b.district.kind || a.district.geoid !== b.district.geoid) return false;
  if (nameKey(a.name) === nameKey(b.name)) return true;
  const x = initialAndSurname(a.name);
  const y = initialAndSurname(b.name);
  return x.surname !== '' && x.surname === y.surname && x.initial === y.initial;
}

/**
 * Whether someone is one of these people: the same person for the same seat, or anyone among them with exactly the same
 * name, since one area's people seldom share a name and an Assembly member running for the State Senate is still the
 * member's representative.
 */
export const isAmong = (person: SeatPerson, people: readonly SeatPerson[]): boolean =>
  people.some((p) => samePerson(p, person) || nameKey(p.name) === nameKey(person.name));

/** What a person is to the member, as a badge says wherever they show. */
export interface PersonMarks {
  /** They hold an office in the member's area now. */
  readonly representative: boolean;
  /** One of the Transhumanist Party's candidates: a member whose candidacy a Membership Admin approved. */
  readonly party: boolean;
}

/**
 * A person's marks, from the area's people in office and the party's candidates there. Someone a record lists as running
 * is the party's only for the party candidate's own seat: a namesake running for another is never marked as the
 * party's, while someone in office here who runs for another seat as the party's candidate is.
 */
export const personMarks = (
  person: SeatPerson & { readonly role?: ContactRole },
  holders: readonly SeatPerson[],
  party: readonly SeatPerson[],
): PersonMarks => ({
  representative: isAmong(person, holders),
  party: person.role === 'candidate' ? party.some((p) => samePerson(p, person)) : isAmong(person, party),
});

/** An area's people in the three groups. */
export interface AreaSections {
  /** The party's candidates in the area for elections to come, in the order given (soonest election first). */
  readonly party: readonly PublicCandidacy[];
  /** Every office of the area with who holds it now: none for a ZIP code someone types, which is not asked. */
  readonly representatives: readonly AreaOfficeGroup[];
  /**
   * Every office of the area with who else runs for it: anyone a public record or an admin lists as running for the
   * same seat as one of the party's candidates is that candidate, listed with the party's alone.
   */
  readonly running: readonly AreaOfficeGroup[];
  /** The area's people in office, for each person's marks. */
  readonly holders: readonly AreaContact[];
}

/**
 * An area's people in the three groups: `contacts` are who holds and who runs for its offices (`AreaContactsView` or
 * `AreaCandidatesView`), `candidacies` the public candidacies, of which the area's for elections not over are the
 * party's candidates there (`inCandidateArea`, so a member whose ZIP code could not be placed sees all of their state's).
 */
export function areaSections(area: CandidateArea, contacts: readonly AreaContact[], candidacies: readonly PublicCandidacy[], today: string): AreaSections {
  const holders = contacts.filter((c) => c.role === 'holder');
  const party = candidacies.filter((c) => c.electionDate >= today && inCandidateArea(c.district, area));
  const others = contacts.filter((c) => c.role === 'candidate' && !party.some((p) => samePerson(p, c)));
  return { party, representatives: groupAreaContacts(area, holders), running: groupAreaContacts(area, others), holders };
}
