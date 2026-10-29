import { describe, expect, it } from 'vitest';
import { buildsDiffer, checkResult, nextBanner, refusedByOtherBuild, updateMessage, type PendingUpdate } from './version.js';

const A = 'aaaaaaa';
const B = 'bbbbbbb';
const C = 'ccccccc';

describe('buildsDiffer', () => {
  it('compares two known builds', () => {
    expect(buildsDiffer(A, A)).toBe(false);
    expect(buildsDiffer(A, B)).toBe(true);
  });

  it('cannot tell when either build has no commit (local and CI builds)', () => {
    expect(buildsDiffer(null, A)).toBeNull();
    expect(buildsDiffer(A, null)).toBeNull();
    expect(buildsDiffer(null, null)).toBeNull();
  });
});

describe('checkResult (page A)', () => {
  it('finds nothing while Hosting and the api run this build', () => {
    expect(checkResult(A, A, A)).toBeNull();
  });

  it('offers a reload once Hosting serves a newer web app, whatever the api says', () => {
    expect(checkResult(A, B, B)).toEqual({ reason: 'web-changed', commit: B });
    expect(checkResult(A, B, A)).toEqual({ reason: 'web-changed', commit: B });
    expect(checkResult(A, B, null)).toEqual({ reason: 'web-changed', commit: B });
  });

  it('waits while the api is new but Hosting still serves this page (mid-release, or the api rolled back)', () => {
    expect(checkResult(A, A, B)).toBe('wait');
  });

  it('offers a reload for a new api when Hosting cannot be asked', () => {
    expect(checkResult(A, null, B)).toEqual({ reason: 'api-changed', commit: B });
  });

  it('never offers one from a build without a commit, or when nothing could be read', () => {
    expect(checkResult(null, B, C)).toBeNull();
    expect(checkResult(A, null, null)).toBeNull();
  });
});

describe('refusedByOtherBuild (page A)', () => {
  it('blames a 400 or 409 on the page being out of date when the api runs another build', () => {
    expect(refusedByOtherBuild(400, A, B)).toBe(true);
    expect(refusedByOtherBuild(409, A, B)).toBe(true);
  });

  it('leaves ordinary refusals alone: same build, other statuses, unknown builds', () => {
    expect(refusedByOtherBuild(400, A, A)).toBe(false);
    expect(refusedByOtherBuild(409, A, A)).toBe(false);
    for (const status of [401, 403, 404, 429, 500]) expect(refusedByOtherBuild(status, A, B)).toBe(false);
    expect(refusedByOtherBuild(400, null, B)).toBe(false);
    expect(refusedByOtherBuild(400, A, null)).toBe(false);
  });
});

describe('nextBanner', () => {
  const api = (commit: string): PendingUpdate => ({ reason: 'api-changed', commit });
  const web = (commit: string): PendingUpdate => ({ reason: 'web-changed', commit });
  const refused = (commit: string): PendingUpdate => ({ reason: 'refused', commit });

  it('shows what a check found', () => {
    expect(nextBanner(null, web(B), null)).toEqual(web(B));
    expect(nextBanner(null, api(B), null)).toEqual(api(B));
  });

  it('hides it when a later check finds nothing, but keeps a refusal until dismissed or reloaded', () => {
    expect(nextBanner(web(B), null, null)).toBeNull();
    expect(nextBanner(api(B), null, null)).toBeNull();
    expect(nextBanner(refused(B), null, null)).toEqual(refused(B));
  });

  it('keeps a version put off with Later hidden until another commit comes along', () => {
    expect(nextBanner(null, web(B), web(B))).toBeNull();
    expect(nextBanner(null, web(B), api(B))).toBeNull();
    expect(nextBanner(null, web(C), web(B))).toEqual(web(C));
  });

  it('always shows a refusal, since a change was just lost', () => {
    expect(nextBanner(null, refused(B), web(B))).toEqual(refused(B));
    expect(nextBanner(null, refused(B), refused(B))).toEqual(refused(B));
  });

  it('lets a more urgent reason replace a less urgent one, never the other way', () => {
    expect(nextBanner(api(B), web(B), null)).toEqual(web(B));
    expect(nextBanner(web(B), refused(B), null)).toEqual(refused(B));
    expect(nextBanner(refused(B), web(C), null)).toEqual(refused(B));
    expect(nextBanner(web(B), api(B), null)).toEqual(web(B));
  });
});

describe('updateMessage', () => {
  it('offers the new version, or explains a refused request', () => {
    expect(updateMessage('web-changed')).toBe('A new version of USTP Vote is available.');
    expect(updateMessage('api-changed')).toBe('A new version of USTP Vote is available.');
    expect(updateMessage('refused')).toMatch(/updated while this page was open, so that was not saved\. Reload/);
  });
});
