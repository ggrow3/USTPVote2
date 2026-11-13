import { Injectable } from '@nestjs/common';
import { US_STATES, type ElectionStage, type LinkPreview, type PublicCandidacy } from 'ustp-domain';
import { orNone, type LinkPreviewSource } from '../link-previews/link-previews.js';
import { CandidaciesService } from './candidacies.service.js';

const STAGES: Readonly<Record<ElectionStage, string>> = { primary: 'Primary', general: 'General election', special: 'Special election', runoff: 'Runoff' };
const STATE_NAMES = new Map(US_STATES.map((s) => [s.code, s.name]));
const stateName = (code: string | null) => (code === null ? 'United States' : (STATE_NAMES.get(code) ?? code));

/** Where a candidacy is, as the Candidates page writes it: "Congressional District 12, California", "Texas". */
export function placeText({ district }: Pick<PublicCandidacy, 'district'>): string {
  return district.kind === 'nation' || district.kind === 'state' ? stateName(district.state) : `${district.name}, ${stateName(district.state)}`;
}

/** "Nov 3, 2026" from `YYYY-MM-DD`, whatever the server's time zone. */
export function electionDayText(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** A member's public candidacy's link preview (design §15, "Link previews"): who, for what, where and when. */
@Injectable()
export class CandidacyPreviews implements LinkPreviewSource {
  readonly page = '/candidates/:id';

  constructor(private readonly candidacies: CandidaciesService) {}

  async preview({ id }: Readonly<Record<string, string>>): Promise<LinkPreview | null> {
    const c = await orNone(this.candidacies.publicDetail(id!));
    if (!c) return null;
    const place = placeText(c);
    const when = `${STAGES[c.election]} · ${electionDayText(c.electionDate)}`;
    return {
      title: `${c.name} · Candidates`,
      description: `${c.name}, the U.S. Transhumanist Party's candidate for ${c.officeTitle}, ${place}: ${STAGES[c.election].toLowerCase()} on ${electionDayText(c.electionDate)}.${c.platform ? ` ${c.platform}` : ''}`,
      type: 'profile',
      card: { kicker: `Candidate · ${c.officeTitle}`, title: c.name, lines: [place, when] },
    };
  }
}
