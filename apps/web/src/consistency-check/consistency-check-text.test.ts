import type { ConsistencyCheckResult } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import {
  changedSince,
  confirmText,
  findingContests,
  finishedAnnouncement,
  introText,
  sourceText,
  statusText,
} from './consistency-check-text.js';

const check = (fields: Partial<ConsistencyCheckResult>): ConsistencyCheckResult => ({
  checkId: 'e1_a1',
  electionId: 'e1',
  electionTitle: 'Platform Vote #9 (demo)',
  electionDescription: '',
  view: 'ballot',
  definitionHash: 'ab'.repeat(32),
  materialHash: 'cd'.repeat(32),
  bylaws: null,
  requestedBy: 'a1',
  requestedAt: '2026-10-27T12:00:00.000Z',
  status: 'queued',
  startedAt: null,
  finishedAt: null,
  checker: null,
  model: null,
  references: [],
  findings: [],
  summary: null,
  error: null,
  usage: null,
  contests: [
    { position: 1, contestId: 'q1', title: 'Question I. Section E9-A' },
    { position: 2, contestId: 'q2', title: 'Question II. Provisions to add to Section E9-A' },
    { position: 4, contestId: 'q4', title: 'Question IV. Section E9-B' },
  ],
  ...fields,
});
const finding = { source: 'platform' as const, provision: 'Section CIV', passage: null, severity: 'low' as const, explanation: 'x' };

describe('consistency check wording', () => {
  it('says where a check stands, in words', () => {
    expect(statusText(null, true)).toBe('Sending the proposals…');
    expect(statusText(null)).toBe('');
    expect(statusText(check({ status: 'queued' }))).toMatch(/^Waiting for the server/);
    expect(statusText(check({ status: 'running' }))).toMatch(/minute or two/);
    expect(statusText(check({ status: 'failed' }))).toBe('The check failed.');
    expect(statusText(check({ status: 'done' }))).toBe('No inconsistencies found.');
    expect(statusText(check({ status: 'done', findings: [{ ...finding, contests: [1] }] }))).toBe('1 possible inconsistency found.');
    expect(finishedAnnouncement(check({ status: 'done', findings: [{ ...finding, contests: [1] }, { ...finding, contests: [4] }] }))).toBe(
      'Consistency check finished: 2 possible inconsistencies found.',
    );
  });

  it('names the source and provision, or that the conflict is within the ballot', () => {
    expect(sourceText({ source: 'platform', provision: 'Article VI, Section CIV' })).toBe('With the Platform: Article VI, Section CIV');
    expect(sourceText({ source: 'bill-of-rights', provision: '' })).toBe('With the Transhumanist Bill of Rights');
    expect(sourceText({ source: 'ballot', provision: 'Question IV. Section E9-B' })).toBe('Between questions on this ballot');
  });

  it('links a finding to the questions it names, by title, in ballot order', () => {
    expect(findingContests(check({}), { contests: [1, 4, 9] }).map((c) => c.title)).toEqual(['Question I. Section E9-A', 'Question IV. Section E9-B']);
  });

  it('tells the person what leaves the system and that they get one run', () => {
    expect(introText('ballot')).toMatch(/^Claude, an AI model made by Anthropic, can read this ballot's proposals with/);
    expect(introText('admin')).toMatch(/this election's proposals, as they stand now,/);
    expect(confirmText('ballot')).toMatch(/sent to Anthropic for this; nothing about you, or how or whether you voted, is\. You can run the check once for this election/);
  });

  it('notices a draft edited since its check', () => {
    expect(changedSince(check({}), 'ab'.repeat(32))).toBe(false);
    expect(changedSince(check({}), 'ef'.repeat(32))).toBe(true);
    expect(changedSince(check({}), null)).toBe(false);
  });
});
