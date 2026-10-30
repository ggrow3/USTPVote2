/**
 * Tokens for the service's own account from the Cloud Run metadata server: an OAuth access token for Google APIs
 * (Cloud Tasks) and an ID token for calling a private Cloud Run service (the room's model). Each is kept until a minute
 * before it expires. Only used in Cloud Run; the emulators never reach for them.
 */
const METADATA = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default';

interface Cached {
  readonly token: string;
  readonly until: number;
}

const cache = new Map<string, Cached>();

async function cached(key: string, fetchToken: () => Promise<{ token: string; expiresInSeconds: number }>): Promise<string> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.token;
  const { token, expiresInSeconds } = await fetchToken();
  cache.set(key, { token, until: Date.now() + (expiresInSeconds - 60) * 1000 });
  return token;
}

async function metadata(path: string): Promise<Response> {
  const res = await fetch(`${METADATA}/${path}`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`metadata server answered ${res.status} for ${path.split('?')[0]}`);
  return res;
}

export function accessToken(): Promise<string> {
  return cached('access', async () => {
    const body = (await (await metadata('token')).json()) as { access_token: string; expires_in: number };
    return { token: body.access_token, expiresInSeconds: body.expires_in };
  });
}

/** An ID token for `audience` (a Cloud Run service's URL). They last an hour. */
export function idToken(audience: string): Promise<string> {
  return cached(`id:${audience}`, async () => {
    const token = await (await metadata(`identity?audience=${encodeURIComponent(audience)}&format=full`)).text();
    return { token, expiresInSeconds: 3600 };
  });
}
