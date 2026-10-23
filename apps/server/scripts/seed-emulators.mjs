// Fills the local emulators with test data through the running api, the same way people would: accounts, role grants by
// a System Admin, bylaws, approved membership applications, elections taken through the roll and scheduling approvals,
// and cast ballots. Needs the emulators (`npm run emulators`) and the api (`npm run dev:api:emulators`, not the --require-mfa
// variant); the worker (`npm run dev:worker:emulators`) must also run for elections to open and ballots to be cast.
//
// Safe to run again: existing accounts, roles, members and elections (matched by title) are reused, and voters who
// have already voted are skipped. v1@example.test never gets a ballot cast for them, so a person can vote as v1.
import { randomBytes, randomInt } from 'node:crypto';

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
    const text = 'Article I. Name.\nThe name of this organization is the United States Transhumanist Party.\n';
    return call('POST', '/v1/admin/bylaws', ELECTION_ADMIN, { version: '2026.1', title: 'USTP Bylaws', text });
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
const OFFICES = [
  { positionId: 'chair', title: 'Chair', seats: 1, termMonths: 24, description: 'Chairs the party and its conventions.' },
  { positionId: 'outreach-coordinator', title: 'Outreach Coordinator', seats: 1, termMonths: 12, description: '' },
];

/** Defines an office as the Election Admin (it takes effect at once), unless it exists. */
async function defineOffice(office) {
  const { positions } = await call('GET', '/v1/admin/positions', AUDITOR);
  if (positions.some((p) => p.positionId === office.positionId)) return;
  await call('POST', '/v1/admin/positions', ELECTION_ADMIN, { ...office, reason: 'dev seed' });
}

// --- elections ----------------------------------------------------------------------------------------------------

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' };
const TWO_THIRDS = { threshold: { ratio: { num: 2, den: 3 }, comparison: 'gte' }, base: 'yes_no' };
/** "Select all that apply": each option a majority of ballots supports is adopted. */
const MAJORITY_OF_BALLOTS = { ratio: { num: 1, den: 2 }, comparison: 'gt' };

/**
 * The USTP's Platform Vote #9 (February–March 2025), all 20 questions, as a demo. The summaries are ours, not the
 * party's text; each question points to the official ballot. Yes/no questions are proposals, "select all that apply"
 * is approval voting with a majority floor, "current version or amendment" is a single choice (blank abstains), and
 * ranked questions are instant-runoff.
 */
const PLATFORM_VOTE_9_SOURCE = 'https://transhumanist-party.org/2025/02/18/ballot-options-platform-vote-9/';
const plank = (title, summary) => ({
  kind: 'proposal',
  title,
  body: `${summary}\n\nA summary for this demo, not the official text, which is at ${PLATFORM_VOTE_9_SOURCE}`,
  source: PLATFORM_VOTE_9_SOURCE,
  passRule: MAJORITY,
});
const selectAll = (title, options, description) => ({
  kind: 'choose_n',
  title,
  description,
  seats: options.length,
  maxSelections: options.length,
  supportFloor: MAJORITY_OF_BALLOTS,
  candidates: options,
});
const currentOrAmendment = (title, section, amendment, description) => ({
  kind: 'choose_n',
  title,
  description: `${description}\n\nLeave it blank to abstain.`,
  seats: 1,
  maxSelections: 1,
  candidates: [`Keep the current Section ${section}`, amendment],
});
const ranked = (title, options, description) => ({
  kind: 'irv',
  title,
  description: `${description}\n\nRank as many as you like; ranking none abstains.`,
  candidates: options,
});

const PLATFORM_VOTE_9 = [
  plank(
    'Question I. Section E9-A: Defeat of COVID as a priority',
    'Adds a platform section making the defeat of COVID-19 as a public-health threat a priority, pursued through science and technology.',
  ),
  selectAll(
    'Question II. Provisions to add to Section E9-A (select all you support)',
    ['E9-A-i: Universal vaccine', 'E9-A-ii: Harmless competing variants', 'E9-A-iii: Neutralizing antibodies', 'E9-A-iv: Cures for Long COVID'],
    'Each provision a majority of ballots supports is added, unless No wins Question I.\n\n' +
      'E9-A-i: a vaccine that works against every variant and gives lasting immunity.\n' +
      'E9-A-ii: engineered harmless variants that outcompete the harmful ones.\n' +
      'E9-A-iii: antibodies that neutralize any variant.\n' +
      'E9-A-iv: reliable cures for every form of Long COVID.',
  ),
  plank(
    'Question III. Provision E9-A-Add-1: Science, not restrictions',
    'Adds to Section E9-A that COVID-19 should be fought with science and technology alone: no lockdowns or limits on ' +
      'liberty or medical choice, no stigma for people who take precautions, and nobody pushed into riskier behavior.',
  ),
  ranked(
    'Question IV. Section E9-B: Artificial intelligence (rank the options)',
    [
      'E9-B-1: Opportunity; no coercion of people or countries',
      'E9-B-2: Opportunity; no coercion of people',
      'E9-B-3: Pro-AI, with debate on risky uses',
      'E9-B-NO: No section of this sort',
    ],
    'E9-B-1: treat AI chiefly as an opportunity, support safety research and a ban on autonomous weapons, and oppose ' +
      'coercing individuals or countries to halt AI development.\n' +
      'E9-B-2: the same, but the clause against coercion covers individuals only.\n' +
      'E9-B-3: generally in favor of AI, with debate on uses that threaten livelihoods or safety.\n' +
      'E9-B-NO: add no section of this sort.',
  ),
  selectAll(
    'Question V. Provisions to add to Section E9-B (select all you support)',
    ['E9-B-i: Address unintended bias', 'E9-B-ii: No AI in law enforcement'],
    'Each provision a majority of ballots supports is added.\n\n' +
      'E9-B-i: AI policy must address unintended bias, so that AI systems do not discriminate by race, sex or similar traits.\n' +
      'E9-B-ii: no AI in law enforcement, such as facial recognition that misidentifies people.',
  ),
  plank('Question VI. Section E9-C: Reversible cryopreservation', 'Calls for $10 billion a year of research funding for reversible cryopreservation.'),
  plank(
    'Question VII. Section E9-D: Public money for public code',
    'Public money should go to open-source software and the people who contribute to it, with safeguards so that ' +
      'companies cannot crowd out individual developers.',
  ),
  plank(
    'Question VIII. Section E9-E: Privacy on social media',
    'Supports clearer, finer-grained and more visible privacy controls for the people who use social media.',
  ),
  ranked(
    'Question IX. Section E9-F: Government and business security (rank the options)',
    [
      'E9-F-1: Restrain government',
      'E9-F-2: Restrain government; no backdoor requests',
      'E9-F-3: Restrain government; regulation still allowed',
      'E9-F-NO: No section of this sort',
    ],
    'E9-F-1: government agencies should not undermine the security measures companies take.\n' +
      'E9-F-2: the same, and agencies may not ask companies to build hidden access into their software.\n' +
      'E9-F-3: the same as E9-F-1, without standing in the way of needed federal regulation of business, large ' +
      'corporations especially.\n' +
      'E9-F-NO: add no section of this sort.',
  ),
  plank(
    'Question X. Section E9-G: Security whistleblower program',
    'Supports a program for reporting security problems that go unaddressed, with protection against retaliation by employers.',
  ),
  currentOrAmendment(
    'Question XI. Section XXVII: Electing the President',
    'XXVII',
    'Amendment XXVII-1: Ranked-preference voting',
    'Current: abolish the Electoral College, so that a plurality of the national popular vote decides the presidency.\n' +
      'XXVII-1: still abolish the Electoral College, but decide by ranked-preference voting or a similar method instead of plurality.',
  ),
  plank(
    'Question XII. Section XXXVI: No sales tax on life necessities',
    "Section XXXVI would replace income taxes with a sales tax on large businesses' purchases. This adds that life " +
      'necessities, goods used up soon and needed chiefly to survive, are exempt from it.',
  ),
  currentOrAmendment(
    'Question XIII. Section LXXIX: Right to try',
    'LXXIX',
    'Amendment LXXIX-1: Wider right to try',
    'Current: repeal the FDA-approval requirement for treatments that willing patients want to use.\n' +
      'LXXIX-1: call for wider access to unapproved treatments, protection from liability, and a right to try that ' +
      'reaches beyond terminally ill patients.',
  ),
  currentOrAmendment(
    'Question XIV. Section XCIX: COVID relief',
    'XCIX',
    'Amendment XCIX-1: Free COVID care instead',
    'Current: a universal basic income of at least $1,000 a month during COVID-19 and its aftermath.\n' +
      'XCIX-1: replace it with free COVID-19 testing, vaccination, antivirals and related care, with no end date.',
  ),
  currentOrAmendment(
    'Question XV. Section CI: Air travel',
    'CI',
    'Amendment CI-1: Restore airline capacity',
    'Current: let most waiting travelers through airport checkpoints quickly, with any later health screening done without crowding.\n' +
      'CI-1: also tackle airline delays by restoring capacity, rehiring staff and keeping staffing and flights at pre-COVID levels.',
  ),
  ranked(
    'Question XVI. Section CII: Troops overseas (rank the options)',
    ['Current Section CII', 'CII-1: Recall, keeping defense of assets and citizens', 'CII-2: Recall, keeping defense of citizens only'],
    'Current: bring overseas U.S. military personnel home to build hospitals, deliver emergency aid and work on infrastructure.\n' +
      'CII-1: recall troops from abroad except those needed to defend American assets and citizens or to meet limited ' +
      'treaty obligations, and give troops at home crisis-response roles.\n' +
      'CII-2: the same, but keep abroad only troops defending American citizens or meeting treaty duties.',
  ),
  currentOrAmendment(
    'Question XVII. Section CIII: COVID cures and vaccines',
    'CIII',
    'Amendment CIII-1: Lasting, all-variant, public domain',
    'Current: fast research into COVID-19 cures and vaccines, funded and owned by the government and given out free, ' +
      'with a $100 billion vaccine package.\n' +
      'CIII-1: put the emphasis on lasting cures and on vaccines that work against every variant, released into the public domain.',
  ),
  ranked(
    'Question XVIII. Section CIV: Anti-aging research (rank the options)',
    ['Current Section CIV', 'CIV-1', 'CIV-2'],
    'Current: aging is the leading risk factor for death and for severe COVID-19; fund anti-aging research with $100 ' +
      'billion a year, permanently.\n' +
      'CIV-1 and CIV-2: keep the funding, add the disabilities that aging brings, and treat aging as a violation of the ' +
      'rights to life and health. They differ only in one conjunction.',
  ),
  currentOrAmendment(
    'Question XIX. Section CX: COVID testing',
    'CX',
    'Amendment CX-1: Continuous testing and data',
    'Current: widespread free COVID-19 testing, help for the makers of tests, and at-home kits mailed to labs.\n' +
      'CX-1: continuous testing with no end date, credit for the home-test approach, and a return to the data ' +
      'collection of the early pandemic.',
  ),
  ranked(
    'Question XX. Investigations and emergency declarations (rank the options)',
    ['ZR-JG-1: Decisive executive action in emergencies', 'RNS-1 and RNS-2: Neutral investigations, limited emergencies', 'Adopt neither (status quo)'],
    'These would form a new Article of the Constitution.\n\n' +
      'ZR-JG-1: in an emergency the Chairman may act and speak for the party, with limits on compelling retractions ' +
      'and good-faith efforts to let the Chairman answer attacks.\n' +
      'RNS-1 and RNS-2, one package: neutrality during outside investigations and only impartial internal ' +
      'investigators; emergencies defined narrowly, and membership approval for emergency actions longer than 14 days.\n' +
      'Adopt neither: keep things as they are.',
  ),
];

/** Opens 40 s after creation, which leaves time for the roll and scheduling approvals. */
const ELECTIONS = [
  {
    title: '2026 Officer Election',
    description: 'Annual election of party officers and one platform plank.',
    secrecy: 'secret',
    opensIn: 40 * SECOND,
    closesIn: 2 * 60 * MINUTE,
    contests: [
      {
        kind: 'proposal',
        title: 'Plank 12: Right to repair',
        body: 'The party supports the right to repair.\n\nOwners of devices should be able to repair them or have them repaired by anyone they choose.',
        passRule: MAJORITY,
      },
      { kind: 'irv', title: 'Chair', positionId: 'chair', candidates: ['Alex Rivera', 'Blair Chen', 'Casey Okafor'] },
      { kind: 'choose_n', title: 'Board (2 seats)', seats: 2, maxSelections: 2, candidates: ['Dana Ito', 'Eli Moreno', 'Fran Novak'] },
    ],
  },
  {
    title: 'Bylaw Amendment 3 (roll-call)',
    description: 'Roll-call vote: how each member votes is published with their name.',
    secrecy: 'open',
    opensIn: 40 * SECOND,
    closesIn: 2 * 60 * MINUTE,
    contests: [
      {
        kind: 'proposal',
        title: 'Amendment 3: Remote participation at conventions',
        body: 'Members may attend and vote at conventions remotely.\n\nThe Secretary shall provide the means.',
        passRule: TWO_THIRDS,
      },
    ],
  },
  {
    title: 'Platform Vote #9 (demo)',
    description:
      "A demo built from the USTP's Platform Vote #9 ballot (February 17 to March 10, 2025): all 20 questions, with " +
      `the same 21-day window. The summaries are ours, not the official text, which is at ${PLATFORM_VOTE_9_SOURCE}. ` +
      'Where that ballot sets no threshold, this demo uses a majority of yes and no votes.',
    secrecy: 'secret',
    opensIn: 40 * SECOND,
    closesIn: 21 * DAY,
    contests: PLATFORM_VOTE_9,
  },
  {
    title: 'Committee Elections (15-minute window)',
    description: 'A short voting window, to watch an election close.',
    secrecy: 'secret',
    opensIn: 40 * SECOND,
    closesIn: 15 * MINUTE,
    contests: [
      {
        kind: 'choose_n',
        title: 'Outreach Coordinator',
        positionId: 'outreach-coordinator',
        seats: 1,
        maxSelections: 1,
        candidates: ['Mira Hale', 'Noor Aziz', 'Owen Park'],
      },
      {
        kind: 'choose_n',
        title: 'Policy Committee (approve any)',
        seats: 3,
        maxSelections: 5,
        candidates: ['Pia Ruiz', 'Quinn Lowe', 'Ravi Shah', 'Sam Diaz', 'Tess Bauer'],
      },
      { kind: 'irv', title: 'Newsletter Editor', candidates: ['Uma Reid', 'Vic Stone', 'Wen Zhao', 'Xan Price'] },
    ],
  },
  {
    title: '2027 Platform Convention',
    description: 'Scheduled for later: voters can read the ballot before it opens.',
    secrecy: 'secret',
    opensIn: 3 * DAY,
    closesIn: 4 * DAY,
    contests: [
      { kind: 'proposal', title: 'Plank 14: Open science', body: 'Publicly funded research should be openly published.', passRule: MAJORITY },
      { kind: 'irv', title: 'Convention Chair', candidates: ['Yara Cole', 'Zed Hart', 'Abe Lin'] },
    ],
  },
  {
    title: '2027 Bylaws Review (draft)',
    description: 'Still a draft: no roll, not scheduled.',
    secrecy: 'secret',
    opensIn: 30 * DAY,
    closesIn: 37 * DAY,
    draft: true,
    contests: [{ kind: 'choose_n', title: 'Review Committee', seats: 2, maxSelections: 2, candidates: ['Bo Grant', 'Cy Lam'] }],
  },
];

/** Creates the election, its contests and candidates; unless a draft, gets its roll and scheduling approved. */
async function election(spec, existing) {
  const found = existing.find((e) => e.title === spec.title && e.state !== 'cancelled');
  if (found) return { ...found, created: false };
  const iso = (ms) => new Date(Date.now() + ms).toISOString();
  const { electionId } = await call('POST', '/v1/admin/elections', ELECTION_ADMIN, {
    title: spec.title,
    description: spec.description,
    secrecy: spec.secrecy,
    opensAt: iso(spec.opensIn),
    closesAt: iso(spec.closesIn),
    kAnonymity: 3,
  });
  const url = `/v1/admin/elections/${electionId}`;
  for (const contest of spec.contests) {
    if (contest.kind === 'proposal') {
      const { title, body, source } = contest;
      const text = await call('POST', '/v1/admin/proposals', ELECTION_ADMIN, { title, body, ...(source && { source }) });
      await call('POST', `${url}/contests`, ELECTION_ADMIN, {
        kind: 'proposal',
        title,
        ...(contest.description && { description: contest.description }),
        proposalSnapshotId: text.snapshotId,
        passRule: contest.passRule,
      });
    } else {
      const { candidates, ...rules } = contest;
      const created = await call('POST', `${url}/contests`, ELECTION_ADMIN, rules);
      for (const name of candidates) await call('POST', `${url}/contests/${created.contestId}/candidates`, ELECTION_ADMIN, { name });
    }
  }
  if (!spec.draft) {
    const roll = await call('POST', `${url}/roll`, ELECTION_ADMIN, { reason: 'dev seed' });
    await call('POST', `/v1/admin/approvals/${roll.approvalId}/decision`, AUDITOR, { decision: 'approve', reason: 'dev seed' });
    const schedule = await call('POST', `${url}/schedule`, ELECTION_ADMIN, { reason: 'dev seed' });
    await call('POST', `/v1/admin/approvals/${schedule.id}/decision`, AUDITOR, { decision: 'approve', reason: 'dev seed' });
  }
  return { electionId, title: spec.title, created: true };
}

// --- ballots ------------------------------------------------------------------------------------------------------

/** A plausible random ballot: most contests answered, every contest kind exercised. */
function randomParts(electionId, definition) {
  const parts = [];
  for (const contest of definition.contests) {
    if (randomInt(10) === 0) continue; // a skipped contest now and then
    let selection;
    if (contest.spec.kind === 'proposal') selection = ['yes', 'yes', 'yes', 'no', 'no', 'abstain'][randomInt(6)];
    else {
      const ids = contest.candidates.map((k) => k.candidateId);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      const max = contest.spec.kind === 'choose_n' ? contest.spec.maxSelections : (contest.spec.maxRanks ?? ids.length);
      selection = ids.slice(0, 1 + randomInt(Math.min(max, ids.length)));
    }
    parts.push({ v: 1, electionId, contestId: contest.contestId, selection, salt: randomBytes(32).toString('hex') });
  }
  return parts.length ? parts : randomParts(electionId, definition);
}

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
    await new Promise((resolve) => setTimeout(resolve, 3 * SECOND));
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
for (const spec of ELECTIONS) {
  const e = await election(spec, existing);
  elections.push(e);
  console.log(`election: ${e.title} — ${e.created ? 'created' : 'already there'}`);
}

// Only elections created just now still have to open; on a re-run, ballots go into whatever is open.
const opening = ELECTIONS.filter((s) => !s.draft && s.opensIn < MINUTE)
  .map((s) => elections.find((e) => e.title === s.title))
  .filter((e) => e.created)
  .map((e) => e.electionId);
if (await waitUntilOpen(opening)) {
  for (const e of await call('GET', '/v1/elections', VOTERS[1])) {
    if (e.state === 'open') console.log(`ballots: ${await castBallots(e.electionId, VOTERS.slice(1))} cast in ${e.title}`);
  }
} else {
  console.log('the elections have not opened: start the worker (`npm run dev:worker:emulators -w apps/server`) and run this again to cast ballots');
}
console.log(`done. Sign in at http://localhost:5173 with any of these accounts (password: see PASSWORD in this script); ${VOTERS[0]} has not voted yet.`);
