// Fills the local emulators with test data through the running api, the same way people would: accounts, role grants by
// a System Admin, bylaws, approved membership applications, elections taken through the roll and scheduling approvals,
// and cast ballots. The offices, bylaws and elections are the repository's examples (examples/manifest.json). Needs the emulators (`npm run emulators`) and the api (`npm run dev:api:emulators`, not the --require-mfa
// variant); the worker (`npm run dev:worker:emulators`) must also run for elections to open and ballots to be cast.
//
// Safe to run again: existing accounts, roles, members and elections (matched by title) are reused, and voters who
// have already voted are skipped. v1@example.test never gets a ballot cast for them, so a person can vote as v1.
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { newSalt } from 'ustp-audit';
import { randomBallot } from 'ustp-domain';

const API = process.env.API_URL ?? 'http://127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-ustpvote';
/** Every seeded account's password; the same one the integration tests use (src/testing/emulator.ts). */
const PASSWORD = 'correct horse battery staple';

// Only ever against local emulators: demo-* projects cannot reach real Firebase services.
const local = (url) => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
if (!PROJECT.startsWith('demo-') || !local(API) || !local(`http://${AUTH_HOST}`)) {
  throw new Error('seed-emulators only runs against a local api and the emulators of a demo-* project');
}
const AUTH = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1`;

const SYSTEM_ADMINS = ['admin1@example.test', 'admin2@example.test']; // BOOTSTRAP_SYSTEM_ADMIN_EMAILS in dev-api-emulators.mjs
const ELECTION_ADMIN = 'elections@example.test';
const AUDITOR = 'auditor@example.test';
const VOTER_NAMES = ['Ada Brooks', 'Ben Cruz', 'Cleo Dunn', 'Dana Ito', 'Eli Moreno', 'Fran Novak', 'Gus Patel', 'Hana Kim', 'Ivo Silva', 'Jo Banks', 'Kai Lund', 'Lee Ortiz'];
const VOTERS = VOTER_NAMES.map((_, i) => `v${i + 1}@example.test`);
const STATES = ['NY', 'CA', 'TX', 'WA', 'FL'];

const example = (path) => readFileSync(new URL(`../../../examples/${path}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(example('manifest.json'));

// --- HTTP ---------------------------------------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, url, body) {
    super(`${status} ${url}: ${body?.detail ?? body?.error?.message ?? JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

async function request(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new HttpError(res.status, url, body);
  return body;
}

const postJson = (url, body, headers = {}) =>
  request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

/** A fresh ID token for each call: approvals and role changes require a recent sign-in. */
const token = async (email) =>
  (await postJson(`${AUTH}/accounts:signInWithPassword?key=fake-api-key`, { email, password: PASSWORD, returnSecureToken: true })).idToken;

async function call(method, path, email, body) {
  const headers = { authorization: `Bearer ${await token(email)}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  try {
    return await request(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    if (e instanceof HttpError && e.body?.type?.endsWith('/mfa-required')) {
      throw new Error('the api requires admin MFA; seed against `npm run dev:api:emulators` (without --require-mfa)');
    }
    throw e;
  }
}

// --- people -------------------------------------------------------------------------------------------------------

/** A verified email/password user with a USTP account; reused if it exists. */
async function account(email) {
  try {
    const { localId } = await postJson(`${AUTH}/accounts:signUp?key=fake-api-key`, { email, password: PASSWORD, returnSecureToken: true });
    await postJson(`${AUTH}/projects/${PROJECT}/accounts:update`, { localId, emailVerified: true }, { authorization: 'Bearer owner' });
  } catch (e) {
    if (!(e instanceof HttpError && e.body?.error?.message === 'EMAIL_EXISTS')) throw e;
  }
  await call('POST', '/v1/accounts', email);
  return call('GET', '/v1/me', email);
}

/** Grants a role as the first System Admin (it takes effect at once), unless held. */
async function grant(email, role) {
  const me = await call('GET', '/v1/me', email);
  if (me.roles.includes(role)) return;
  await call('POST', '/v1/admin/roles', SYSTEM_ADMINS[0], { accountId: me.account.accountId, role, change: 'grant', reason: 'dev seed' });
}

async function bylaws() {
  try {
    return await call('GET', '/v1/bylaws/current', ELECTION_ADMIN);
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 404)) throw e;
    const { version, title, file } = MANIFEST.bylaws;
    return call('POST', '/v1/admin/bylaws', ELECTION_ADMIN, { version, title, text: example(file) });
  }
}

/** An Active member through the real path: application under the current bylaws, approved by a Membership Admin. */
async function member(email, legalName, current) {
  const me = await call('GET', '/v1/me', email);
  if (me.member?.status === 'active') return;
  const pending = (await call('GET', '/v1/registration/applications/me', email)).find((a) => a.status === 'pending');
  const application =
    pending ??
    (await call('POST', '/v1/registration/applications', email, {
      bylawsVersion: current.version,
      bylawsHash: current.contentHash,
      legalName,
      dateOfBirth: `${1950 + randomInt(55)}-0${1 + randomInt(9)}-1${randomInt(10)}`,
      attestsAge: true,
      supportsPlatform: true,
      state: STATES[randomInt(STATES.length)],
      city: 'Springfield',
      postalCode: String(10000 + randomInt(89999)),
      volunteer: randomInt(2) === 1,
      newsletter: randomInt(2) === 1,
    }));
  await call('POST', `/v1/admin/applications/${application.applicationId}/decision`, ELECTION_ADMIN, { decision: 'approve', reason: 'dev seed' });
}

// --- offices ------------------------------------------------------------------------------------------------------

/** Offices that seeded contests fill; certifying their results gives the winners terms. */
const OFFICES = MANIFEST.offices;

/** Defines an office as the Election Admin (it takes effect at once), unless it exists. */
async function defineOffice(office) {
  const { positions } = await call('GET', '/v1/admin/positions', AUDITOR);
  if (positions.some((p) => p.positionId === office.positionId)) return;
  await call('POST', '/v1/admin/positions', ELECTION_ADMIN, { ...office, reason: 'dev seed' });
}

// --- elections ----------------------------------------------------------------------------------------------------

/**
 * Imports an example election (examples/elections, design §6.7) unless one with its title is there; for `scheduled`
 * examples, gets its roll and scheduling approved. An import the api refuses is reported and skipped.
 */
async function election(entry, existing) {
  const pkg = JSON.parse(example(entry.file));
  const found = existing.find((e) => e.title === pkg.title && e.state !== 'cancelled');
  if (found) return { ...found, created: false };
  let electionId;
  try {
    ({ electionId } = (await call('POST', '/v1/admin/elections/import', ELECTION_ADMIN, pkg)).election);
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    return { title: pkg.title, created: false, refused: e.message };
  }
  const url = `/v1/admin/elections/${electionId}`;
  if (entry.seed === 'scheduled') {
    const roll = await call('POST', `${url}/roll`, ELECTION_ADMIN, { reason: 'dev seed' });
    await call('POST', `/v1/admin/approvals/${roll.approvalId}/decision`, AUDITOR, { decision: 'approve', reason: 'dev seed' });
    const schedule = await call('POST', `${url}/schedule`, ELECTION_ADMIN, { reason: 'dev seed' });
    await call('POST', `/v1/admin/approvals/${schedule.id}/decision`, AUDITOR, { decision: 'approve', reason: 'dev seed' });
  }
  // Those opening within a minute are the ones to wait for and vote in.
  const opensSoon = entry.seed === 'scheduled' && (pkg.window.opensInSeconds ?? Infinity) < 60;
  return { electionId, title: pkg.title, created: true, opensSoon };
}

// --- ballots ------------------------------------------------------------------------------------------------------

/** A plausible random ballot (as test votes' `random`): most contests answered, every contest kind exercised. */
const randomParts = (electionId, definition) =>
  randomBallot(definition, Math.random).map((s) => ({ v: 1, electionId, ...s, salt: newSalt() }));

async function castBallots(electionId, voters) {
  let cast = 0;
  for (const email of voters) {
    const view = await call('GET', `/v1/elections/${electionId}/ballot`, email);
    if (view.election.castAt || view.election.state !== 'open') continue;
    await call('POST', `/v1/elections/${electionId}/ballots`, email, {
      definitionHash: view.definitionHash,
      parts: randomParts(electionId, view.definition),
    });
    cast++;
  }
  return cast;
}

/** Waits for the worker to open the given elections; false if it does not within two minutes. */
async function waitUntilOpen(electionIds) {
  for (let i = 0; i < 40; i++) {
    const visible = await call('GET', '/v1/elections', VOTERS[1]);
    if (electionIds.every((id) => visible.find((e) => e.electionId === id)?.state === 'open')) return true;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  return false;
}

// --- run ----------------------------------------------------------------------------------------------------------

try {
  await fetch(`http://${AUTH_HOST}/`);
} catch {
  throw new Error(`no Auth emulator at ${AUTH_HOST}; start the emulators with \`npm run emulators -w apps/server\``);
}
try {
  await request(`${API}/healthz`);
} catch {
  throw new Error(`no api at ${API}; start it with \`npm run dev:api:emulators -w apps/server\``);
}

for (const email of SYSTEM_ADMINS) {
  const me = await account(email);
  if (!me.roles.includes('system_admin')) {
    throw new Error(`${email} is not a System Admin; start the api with \`npm run dev:api:emulators\`, which bootstraps it`);
  }
}
await account(ELECTION_ADMIN);
await account(AUDITOR);
await grant(ELECTION_ADMIN, 'election_admin');
await grant(ELECTION_ADMIN, 'membership_admin');
await grant(AUDITOR, 'auditor');
console.log(`staff: ${SYSTEM_ADMINS.join(', ')} (System Admins), ${ELECTION_ADMIN} (Election + Membership Admin), ${AUDITOR} (Auditor)`);

for (const office of OFFICES) await defineOffice(office);
console.log(`offices: ${OFFICES.map((o) => o.title).join(', ')}`);

const current = await bylaws();
for (const [i, email] of VOTERS.entries()) {
  await account(email);
  await member(email, VOTER_NAMES[i], current);
}
console.log(`voters: ${VOTERS[0]} … ${VOTERS.at(-1)} (Active members)`);

const existing = await call('GET', '/v1/admin/elections', ELECTION_ADMIN);
const elections = [];
for (const entry of MANIFEST.elections.filter((e) => e.seed)) {
  const e = await election(entry, existing);
  elections.push(e);
  console.log(`election: ${e.title} — ${e.refused ? `not imported (${e.refused})` : e.created ? 'created' : 'already there'}`);
}

// Only elections created just now still have to open; on a re-run, ballots go into whatever is open.
const opening = elections.filter((e) => e.opensSoon).map((e) => e.electionId);
if (await waitUntilOpen(opening)) {
  for (const e of await call('GET', '/v1/elections', VOTERS[1])) {
    if (e.state === 'open') console.log(`ballots: ${await castBallots(e.electionId, VOTERS.slice(1))} cast in ${e.title}`);
  }
} else {
  console.log('the elections have not opened: start the worker (`npm run dev:worker:emulators -w apps/server`) and run this again to cast ballots');
}
console.log(`done. Sign in at http://localhost:5173 with any of these accounts (password: see PASSWORD in this script); ${VOTERS[0]} has not voted yet.`);
