import { describe, expect, it } from 'vitest';
import { electionPackageFileName, readElectionPackage } from './election-files.js';

const file = (text: string) => new File([text], 'spring.election.json', { type: 'application/json' });
const valid = {
  format: 'ustp.election',
  v: 1,
  title: 'Spring vote',
  secrecy: 'open',
  window: { opensInSeconds: 120, votingSeconds: 300 },
  contests: [{ kind: 'irv', title: 'Chair', candidates: ['Ada', 'Grace'] }],
};

describe('election package files', () => {
  it('read a chosen file with the api schema, listing problems by path', async () => {
    expect(await readElectionPackage(file(JSON.stringify(valid)))).toMatchObject({
      ok: true,
      pkg: { title: 'Spring vote', kAnonymity: 10, contests: [{ candidates: [{ name: 'Ada' }, { name: 'Grace' }] }] },
    });
    expect(await readElectionPackage(file(JSON.stringify({ ...valid, window: {}, contests: [{ kind: 'irv', title: '' }] })))).toEqual({
      ok: false,
      problems: ['window: give either opensAt and closesAt, or opensInSeconds and votingSeconds', 'contests.0.title: enter a title'],
    });
    expect(await readElectionPackage(file('{ "format": '))).toEqual({ ok: false, problems: ['spring.election.json is not a JSON file'] });
  });

  it('name the download after the election and the day', () => {
    expect(electionPackageFileName('2026 Officer Élection!', new Date('2026-10-26T12:00:00Z'), 'UTC')).toBe(
      'ustp-vote-2026-officer-election-2026-10-26.election.json',
    );
  });
});
