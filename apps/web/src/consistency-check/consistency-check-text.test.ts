import { CONSISTENCY_DOCUMENTS, ORIGINAL_CONSISTENCY_DOCUMENTS, type ConsistencyCheckResult } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import {
  changedSince,
  comparedParts,
  confirmText,
  documentLabel,
  documentsAnnouncement,
  documentsText,
  findingContests,
  finishedAnnouncement,
  introText,
  sourceText,
  statusText,
  summaryText,
  usedText,
} from './consistency-check-text.js';

const check = (fields: Partial<ConsistencyCheckResult>): ConsistencyCheckResult => ({
  checkId: 'e1_a1',
  electionId: 'e1',
  electionTitle: 'Platform Vote #9 (demo)',
  electionDescription: '',
  view: 'ballot',
  definitionHash: 'ab'.repeat(32),
  materialHash: 'cd'.repeat(32),
  documents: ORIGINAL_CONSISTENCY_DOCUMENTS,
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

  it('sums up the folded card in one line', () => {
    expect(summaryText(null, { available: true })).toBe('An advisory check by Claude. Not run yet.');
    expect(summaryText(null, { available: false })).toBe('Nothing to check: every contest elects someone.');
    expect(summaryText(null, { available: true, requesting: true })).toBe('Checking…');
    expect(summaryText(check({ status: 'running' }), { available: true })).toBe('Checking…');
    expect(summaryText(check({ status: 'failed' }), { available: true })).toBe('The check failed.');
    expect(summaryText(check({ status: 'done', findings: [{ ...finding, contests: [1] }] }), { available: true })).toBe('1 possible inconsistency found.');
    expect(summaryText(check({ status: 'done' }), { available: true, error: true })).toMatch(/^Something went wrong/);
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
    expect(introText('ballot', ORIGINAL_CONSISTENCY_DOCUMENTS)).toBe(
      "Claude, an AI model made by Anthropic, can read this ballot's proposals with the USTP Constitution (whose Article VI is the Platform), the Transhumanist Bill of Rights and the bylaws in force, and point out where they may disagree with those texts or with each other. It is advisory: it can miss things or flag things that are not there, and it changes nothing on the ballot.",
    );
    expect(introText('admin', CONSISTENCY_DOCUMENTS)).toMatch(/this election's proposals, as they stand now, with .*, the bylaws in force and the Constitution of the United States, and point out/);
    expect(confirmText('ballot')).toMatch(/sent to Anthropic for this; nothing about you, or how or whether you voted, is\. You can run the check once for this election/);
  });

  it('says in the button\'s place that the one run has been used, and when', () => {
    expect(usedText(check({ status: 'done' }), 'en-US')).toBe(
      'You have used your one consistency check of this election (asked for on Oct 27, 2026). Its result is kept here for you to read again.',
    );
  });

  it('names only the documents chosen, and says when there are none', () => {
    expect(introText('ballot', ['us-constitution'])).toMatch(/proposals with the Constitution of the United States, and point out where they may disagree with those texts or with each other\./);
    expect(introText('ballot', [])).toMatch(/can read this ballot's proposals and point out where they may disagree with each other\./);
    expect(introText('ballot', [])).not.toMatch(/Constitution|bylaws|Bill of Rights/);
    expect(documentLabel('transhumanist-bill-of-rights')).toBe('The Transhumanist Bill of Rights');
    expect(documentsText(['bylaws', 'us-constitution'])).toBe('Compares the questions with the bylaws in force and the Constitution of the United States, and with each other.');
    expect(documentsText([])).toBe('Compares the questions with each other only: no documents are chosen.');
    expect(documentsAnnouncement([])).toMatch(/^Saved\. Compares the questions with each other only/);
  });

  it('says what a saved result was compared with, linking the texts it read', () => {
    const reference = { id: 'us-constitution' as const, title: 'Constitution of the United States', url: 'https://example.test/us', retrievedAt: null, modifiedAt: null, sha256: null };
    const parts = comparedParts(check({ documents: ['bylaws', 'us-constitution'], references: [reference], bylaws: { version: '2026.1', contentHash: 'ab' } }));
    expect(parts).toEqual([
      { text: 'the bylaws, version 2026.1', reference: null },
      { text: 'Constitution of the United States', reference },
    ]);
    expect(comparedParts(check({ documents: ['bylaws', 'ustp-constitution'] })).map((p) => p.text)).toEqual([
      'the bylaws (none were published)',
      'the USTP Constitution (whose Article VI is the Platform)',
    ]);
  });

  it('notices a draft edited since its check', () => {
    expect(changedSince(check({}), 'ab'.repeat(32))).toBe(false);
    expect(changedSince(check({}), 'ef'.repeat(32))).toBe(true);
    expect(changedSince(check({}), null)).toBe(false);
  });
});
