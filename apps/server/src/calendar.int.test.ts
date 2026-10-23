import { votingCalendar, type PublicElection } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedElection, type SeededElection } from './testing/elections.js';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

let voters: (User & { accountId: string })[];
beforeEach(async () => {
  await resetEmulators();
  voters = [];
  for (let i = 0; i < 2; i++) voters.push(await api.member(`v${i}@example.test`));
});

const publicUrl = (e: SeededElection | string) => `/v1/public/elections/${typeof e === 'string' ? e : e.electionId}`;

/** The event as a calendar link fetches it through Firebase Hosting at vote.example.org: no credentials. */
async function ics(url: string) {
  const res = await api.app.inject({
    method: 'GET',
    url: `${url}/calendar.ics`,
    headers: { 'x-forwarded-host': 'vote.example.org', 'x-forwarded-proto': 'https' },
  });
  return { status: res.statusCode, text: res.body, headers: res.headers };
}

const dtstamp = (text: string) => /\r\nDTSTAMP:(\d{8}T\d{6}Z)\r\n/.exec(text)?.[1];
/** Back from the basic form to an ISO string votingCalendar accepts. */
const isoOf = (basic: string) => basic.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z');

describe('voting calendar event', () => {
  it('is served to anyone for a scheduled election, from the public record, and names nobody on the roll', async () => {
    const election = await seedElection(api, {
      voters: voters.map((v) => v.accountId),
      opensAt: '2030-05-01T14:00:00.000Z',
      closesAt: '2030-05-08T14:00:00.000Z',
    });
    const res = await ics(publicUrl(election));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(`inline; filename="ustp-vote-${election.electionId}.ics"`);

    const record = (await api.call('GET', publicUrl(election))).body as PublicElection;
    const stamp = dtstamp(res.text);
    expect(stamp).toBeDefined();
    expect(res.text).toBe(votingCalendar({ election: record.election, origin: 'https://vote.example.org', now: isoOf(stamp!) }));
    expect(res.text).toContain('\r\nDTSTART:20300501T140000Z\r\nDTEND:20300508T140000Z\r\n');
    expect(res.text).toContain(`\r\nURL:https://vote.example.org/ballot/${election.electionId}\r\n`);
    for (const v of voters) expect(res.text).not.toContain(v.accountId);
    expect(res.text).not.toContain('example.test');
  });

  it('marks a cancelled election cancelled', async () => {
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId), state: 'cancelled' });
    const res = await ics(publicUrl(election));
    expect(res.status).toBe(200);
    expect(res.text).toContain('\r\nSEQUENCE:1\r\nSTATUS:CANCELLED\r\n');
  });

  it('answers 404 for drafts and unknown elections', async () => {
    const draft = await seedElection(api, { voters: [], state: 'draft' });
    for (const url of [publicUrl(draft), publicUrl('nope')]) {
      const res = await ics(url);
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
    }
  });
});
