import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The Firebase SDK, as the api client sees it: whoever is signed in, and App Check's token. */
const firebase = vi.hoisted(() => ({
  user: null as { getIdToken: () => Promise<string> } | null,
  appCheckToken: vi.fn(async (): Promise<string | null> => 'app-check-token'),
}));

vi.mock('./firebase.js', () => ({
  auth: {
    get currentUser() {
      return firebase.user;
    },
  },
  appCheckToken: firebase.appCheckToken,
}));

const { api } = await import('./api.js');
const { sendSuggestion } = await import('./communications/api.js');

/** The headers of each request the page sent. */
function serve() {
  const fetch = vi.fn(async (_path: string, _init?: RequestInit) => Response.json({ received: true }, { status: 202 }));
  vi.stubGlobal('fetch', fetch);
  return () => fetch.mock.calls.map(([, init]) => init?.headers as Record<string, string>);
}

beforeEach(() => {
  firebase.user = null;
  firebase.appCheckToken.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api', () => {
  it('signed out, sends neither token nor waits for App Check', async () => {
    const sent = serve();
    await api('GET', '/v1/news');
    expect(sent()[0]).not.toHaveProperty('authorization');
    expect(sent()[0]).not.toHaveProperty('x-firebase-appcheck');
    expect(firebase.appCheckToken).not.toHaveBeenCalled();
  });

  it('signed in, sends the ID token and an App Check token', async () => {
    firebase.user = { getIdToken: async () => 'id-token' };
    const sent = serve();
    await api('GET', '/v1/me');
    expect(sent()[0]).toMatchObject({ authorization: 'Bearer id-token', 'x-firebase-appcheck': 'app-check-token' });
  });

  it('signed out, sends an App Check token when the request asks for one', async () => {
    const sent = serve();
    await api('POST', '/v1/suggestions', {}, { appCheck: true });
    expect(sent()[0]).toMatchObject({ 'x-firebase-appcheck': 'app-check-token' });
    expect(sent()[0]).not.toHaveProperty('authorization');
  });

  it('sends no App Check header where App Check is not configured (the emulators)', async () => {
    firebase.appCheckToken.mockResolvedValueOnce(null);
    const sent = serve();
    await api('POST', '/v1/suggestions', {}, { appCheck: true });
    expect(sent()[0]).not.toHaveProperty('x-firebase-appcheck');
  });
});

describe('sendSuggestion', () => {
  // The route is public but App Checked (design §10.9), so a signed-out sender needs the token too.
  it('sends an App Check token when nobody is signed in', async () => {
    const sent = serve();
    await sendSuggestion({ topic: 'other', message: 'A suggestion for the party.' });
    expect(sent()[0]).toMatchObject({ 'x-firebase-appcheck': 'app-check-token' });
  });
});
