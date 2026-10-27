import { describe, expect, it } from 'vitest';
import { DEFAULT_MAIL_FROM, loadConfig } from './config.js';

describe('election notice configuration', () => {
  const emulators = { FIRESTORE_EMULATOR_HOST: 'x', FIREBASE_AUTH_EMULATOR_HOST: 'y', GCLOUD_PROJECT: 'demo-p' };

  it('sends nothing in a real project unless switched on, and refuses the outbox there', () => {
    expect(loadConfig({})).toMatchObject({ mailTransport: 'off', webOrigin: null, mailReplyTo: null });
    expect(() => loadConfig({ MAIL_TRANSPORT: 'outbox' })).toThrow(/only allowed with the Firebase emulators/);
    expect(() => loadConfig({ MAIL_TRANSPORT: 'pigeon' })).toThrow(/MAIL_TRANSPORT must be/);
  });

  it('records notices in the outbox with the emulators, linking to the local web app', () => {
    expect(loadConfig(emulators)).toMatchObject({ mailTransport: 'outbox', mailFrom: DEFAULT_MAIL_FROM, webOrigin: 'http://localhost:5173' });
    expect(loadConfig({ ...emulators, MAIL_TRANSPORT: 'off' }).mailTransport).toBe('off');
  });

  it('takes the From and Reply-To headers and the web origin from the environment', () => {
    expect(
      loadConfig({
        WEB_ORIGIN: 'https://ustpvote2-dev.web.app/',
        MAIL_FROM: 'USTP Elections <elections@example.org>',
        MAIL_REPLY_TO: 'secretary@example.org',
      }),
    ).toMatchObject({
      webOrigin: 'https://ustpvote2-dev.web.app',
      mailFrom: 'USTP Elections <elections@example.org>',
      mailReplyTo: 'secretary@example.org',
    });
  });

  it('accepts only an origin for WEB_ORIGIN, since links are built from it', () => {
    expect(() => loadConfig({ WEB_ORIGIN: 'ustpvote2-dev.web.app' })).toThrow(/must be a URL/);
    expect(() => loadConfig({ WEB_ORIGIN: 'https://ustpvote2-dev.web.app/ballot' })).toThrow(/must be an origin/);
    expect(() => loadConfig({ WEB_ORIGIN: 'https://ustpvote2-dev.web.app/?x=1' })).toThrow(/must be an origin/);
    expect(() => loadConfig({ WEB_ORIGIN: 'ftp://example.org' })).toThrow(/must be an origin/);
  });
});
