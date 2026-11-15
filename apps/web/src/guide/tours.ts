import type { Tour, TourId, TourStep } from './tour.js';

/**
 * The walkthroughs' content (design §10.11): one step per page or admin section, in the order the person does them.
 * Labels the pages show are quoted with “ ” exactly as the pages write them, so the test can find each one in the app.
 */

const SIGN_IN_TODO = [
  'Press “Continue with” Google, Microsoft or Apple, or use the “Email & password” or “Email me a link” tab.',
  'Fill in your email (and password) and press “Sign in” or “Send link”. Open a sign-in link in this same browser.',
  'If your account has an authenticator app, enter the 6-digit code it shows and press “Verify”.',
];

/** Setting up an authenticator, which every admin role needs for its tools. */
const TWO_STEP_TODO = [
  'On the “Two-step verification” card, press “Set up an authenticator app”.',
  'Scan the code with an authenticator app on your phone, then enter the 6-digit code it shows and a “Name for this device”.',
  'Press “Turn on”. Then sign out and sign back in, entering a code from the app when asked.',
];

/**
 * Signing in as a System or Site Admin, who may be required to sign in with Google (design §4): signed in another way,
 * the admin tools stay closed.
 */
const SITE_ADMIN_SIGN_IN_TODO = [
  'If this site requires Google sign-in of System and Site Admins, press “Continue with” Google and choose the Google account of your own address.',
  'Otherwise press “Continue with” Google, Microsoft or Apple, or use the “Email & password” or “Email me a link” tab, and press “Sign in” or “Send link”.',
  'If your account has an authenticator app, enter the 6-digit code it shows and press “Verify”.',
];

const ADMIN_ELECTIONS = { page: '/admin', tab: 'elections', title: 'Admin › Elections' } as const;

/**
 * Testing alone (design §10.4): nobody decides their own requests, so someone rehearsing alone switches this tab to the
 * Test Auditor, decides the request as it in Admin › Approvals, and switches back. `request` is the request as the
 * Approvals list names it. A Site Admin starts as themselves; someone following the Election Admin's walkthrough may be
 * acting as the Test Election Admin, or be a Site Admin acting as an Election Admin themselves. An approval needs a
 * sign-in in the last 15 minutes, and a persona has no login: the site asks the person acting to confirm their own.
 */
const CONFIRM_AS_YOURSELF =
  'If the site asks you to “Confirm it is you”, it means you, not the Test Auditor, which has no login: enter your own password, or sign in with Google again, and your authenticator code if you have one.';

function approveAsTestAuditor(request: string, from: 'site_admin' | 'election_admin'): string[] {
  const become =
    from === 'site_admin'
      ? 'Open Admin › Testing and press “Act as” beside Test Auditor. The yellow bar at the top now says you are acting as it.'
      : 'Make this tab the Test Auditor. Acting as the Test Election Admin, press “Switch persona” in the yellow bar at the top and choose Test Auditor. As yourself, a Site Admin, open Admin › Testing and press “Act as” beside Test Auditor.';
  const back =
    from === 'site_admin'
      ? 'Press “Stop acting” in the yellow bar: you are yourself again.'
      : 'Switch back the way you came: “Switch persona” and Test Election Admin, or “Stop acting”.';
  return [
    become,
    `Open Approvals in the admin menu. On ${request}, press “Approve”, write a reason and press OK.`,
    CONFIRM_AS_YOURSELF,
    back,
    'Press Open in this walkthrough’s panel to come back to the election, and carry on.',
  ];
}

/** Steps on an election's own pages are reached from the elections list, until the walkthrough has seen one. */
const PICK_FROM_LIST = {
  ...ADMIN_ELECTIONS,
  how: 'This step is on an election’s own page. Open the election from the list in Admin › Elections.',
} as const;

const voter: readonly TourStep[] = [
  {
    id: 'sign-in',
    title: 'Sign in',
    page: '/signin',
    about: 'Your login is how the site knows you are on an election’s voter roll.',
    todo: SIGN_IN_TODO,
    notes: [
      'No login yet? Register as a member: creating your login is its first step. Press Next.',
      'Already signed in? Press Next.',
    ],
  },
  {
    id: 'register',
    title: 'Register as a member',
    page: '/register',
    about: 'Only members vote: each election’s voter roll is taken from the Active members when it is set up.',
    todo: [
      'Create your login first if you have none (“Create login and continue”).',
      'If the page shows the bylaws, read them and tick “I have read these bylaws and agree to abide by them.”',
      'Fill in the sections, from About you to Confirmations, and press “Submit application”. Confirm your email address first if the page asks.',
    ],
    notes: [
      'A Membership Admin decides your application. Once you are admitted, you can vote in the elections set up after that.',
      'Already an Active member? The page says there is nothing to register: press Next.',
    ],
  },
  {
    id: 'account',
    title: 'Your account',
    page: '/account',
    about: 'Your membership, your details and how you sign in.',
    todo: [
      'Check the “Membership” card: it should say you are Active.',
      'If the “Two-step verification” card asks for it, press “Set up an authenticator app”, scan the code, enter the 6-digit code the app shows and press “Turn on”.',
    ],
    notes: [
      'Two-step verification is needed only when the site requires it of every member. Until it is set up, the pages that need a sign-in bring you back here.',
    ],
  },
  {
    id: 'home',
    title: 'The voting home',
    page: '/vote',
    about: 'Your starting point: a card for each thing you can do.',
    todo: [
      'Read the “Your ballots” card: it says how many elections are waiting for your vote or opening soon.',
      'Press “Open your ballots”.',
    ],
    notes: [
      'When voting opens, everyone on the roll is emailed a link to their ballot. About a day before it closes, those who have not voted get a reminder.',
    ],
  },
  {
    id: 'ballots',
    title: 'Your ballots',
    page: '/ballot',
    about: 'Every election you are on the voter roll for that has not finished, and where you stand in each.',
    todo: [
      'Find the election. Its card shows when voting opens and closes, and whether the ballot is secret or roll-call.',
      'Press “Vote now” while voting is open. Before it opens, “Read the ballot” lets you read it.',
    ],
    notes: [
      '“Roll-call” means how you vote is published with your name. On a “Secret ballot” nobody can see how you voted.',
      'Elections whose voting has closed are hidden until you switch on “Show finished votes”.',
      'No elections listed? You are not on the roll of a current election. Rolls are frozen when an election is set up, so becoming Active later does not add you to it.',
    ],
  },
  {
    id: 'cast',
    title: 'Cast your vote',
    page: '/ballot/:election',
    pick: {
      page: '/ballot',
      title: 'Your ballots',
      how: 'Open the election from Your ballots: press “Vote now” (or “Read the ballot”) on its card.',
    },
    about: 'The ballot itself. Before anything is cast, your browser checks it is the ballot frozen when the election was scheduled.',
    todo: [
      'Look for the line “Checked in this browser”. If the page says the ballot does not match, do not vote: tell an Auditor.',
      'Answer each contest: Yes, No or Abstain on a proposal; tick up to the number allowed; or, for a ranked contest, add candidates in order of preference and move them up or down.',
      'To skip a contest, leave it unanswered or press “Clear (skip this contest)”.',
      'Press “Review and cast”, check your answers, then press “Cast ballot”.',
    ],
    notes: ['You cannot change your ballot after casting it.', 'Before voting opens, the page says when it opens; you can read the ballot meanwhile.'],
  },
  {
    id: 'receipt',
    title: 'Keep your receipt',
    page: '/ballot/:election',
    pick: {
      page: '/ballot',
      title: 'Your ballots',
      how: 'The receipt shows on the ballot after you cast it: press “View your ballot” on the election’s card. Once voting has closed, switch on “Show finished votes” first.',
    },
    about: 'Once you have voted, the page shows your receipt: a commitment to each answer, with which you can check later that your vote was counted.',
    todo: [
      'Check the receipt says the server’s commitments match the ones your browser worked out.',
      'Press “Download receipt” to save it as a file, or switch on “Keep a copy in this browser”.',
      'Keep it to yourself: anyone who sees the full receipt can tell how you voted.',
    ],
    notes: [
      'If you do neither, the receipt is gone once you leave the page.',
      'The receipt is never sent to the server; checking it looks up only its commitments.',
    ],
  },
  {
    id: 'verify',
    title: 'Verify your receipt',
    page: '/ballot',
    about: 'Checks, in your browser and from public data only, that every part of your ballot is in the published record.',
    todo: [
      'Open “Verify a receipt” at the foot of Your ballots, or press “Verify” beside a receipt on the ballot page.',
      'Pick your receipt under “Saved in this browser”, “Open a downloaded receipt”, or paste it, then press “Check”.',
      'Read the steps for each contest: from your commitment, through the sealed block and the audit ledger, to the anchor outside the database.',
    ],
    notes: [
      '“Not yet” is normal while ballots wait in the encrypted pool, until enough others have voted or voting closes. Check again later.',
      'If something does not check out, keep the receipt and tell an Auditor.',
    ],
  },
  {
    id: 'results',
    title: 'See the results',
    page: '/results/:election',
    pick: {
      page: '/ballot',
      title: 'Your ballots',
      how: 'Once voting has closed, switch on “Show finished votes” in Your ballots and press “See results” on the election’s card.',
    },
    about: 'The count, which your browser checks again from the published ballots.',
    todo: [
      'See whether the results are provisional (signed and in the audit ledger) or certified by an Election Admin and an Auditor.',
      'Read the “Synopsis”, or “Full results” for each contest’s counts and rounds.',
      'Under “How these results were checked”, every step should pass.',
    ],
    notes: ['Results appear once voting has closed and every ballot is sealed and counted, usually within a minute.'],
  },
];

// Steps the Election Admin's and the Site Admin's walkthroughs share: running an election is the same work for both.

/** Starting an election in Admin › Elections. */
const NEW_ELECTION_TODO = [
  'Press “New election”. Give it a “Title”, choose “Secret ballot” or “Open roll-call”, and set when voting opens and closes.',
  'Press “Create draft”: the election editor opens.',
  'Or press “Import JSON” to start from a ustp.election file. “Download sample ballot” gives one with a question of every kind, to change first.',
];

/** Building the ballot, in the editor. */
const BUILD_STEP: TourStep = {
  id: 'build',
  title: 'Build the ballot',
  page: '/admin/elections/:election',
  pick: { ...PICK_FROM_LIST, how: 'Open the election from the list in Admin › Elections, or create one with “New election”.' },
  about: 'The ballot is built as voters will read it. Changes save themselves until scheduling freezes it.',
  todo: [
    'In the ballot’s details, check the “Ballot title”, description, voting window and secrecy. “More settings” holds the anonymity threshold.',
    'Under “Add a question:”, press “Yes / No / Abstain” for a proposal, or “Choose one”, “Choose several” or “Rank in order” for a contest.',
    'Fill in each question: its options (link a candidate’s member account when it is offered), or the “Text members vote on”. “More rules” sets what it takes to pass, the quorum and the office its winners take up.',
    'Watch for “All changes saved” in the save bar.',
  ],
  notes: [
    'You cannot stand in an election you administer, and a candidate in an election cannot administer it.',
    'Forum proposals are put on a draft’s ballot from Admin › Forum, with “Put on a ballot”.',
    'Questions from a ustp.election file, such as the sample ballot, are added after the ballot’s own with “Import JSON” beside “Download as JSON”.',
  ],
};

/** The ballot as voters will see it. */
const PREVIEW_STEP: TourStep = {
  id: 'preview',
  title: 'Preview the ballot',
  page: '/admin/elections/:election/preview',
  pick: PICK_FROM_LIST,
  about: 'The ballot as voters will see it once voting opens, as the draft stands now.',
  todo: ['Try the questions: nothing you choose here is sent.', 'Press “Back to the editor” when you are done.'],
  notes: ['In the editor, “Preview as voter” opens this page; the ballot also downloads as Word or JSON.'],
};

/** What still stops scheduling. */
const READY_STEP: TourStep = {
  id: 'ready',
  title: 'Check it is ready',
  page: '/admin/elections/:election',
  pick: PICK_FROM_LIST,
  about: 'The editor lists what still stops scheduling, and offers advisory checks.',
  todo: [
    'Read the banner at the top: “Not ready to schedule yet:” lists what to fix.',
    'If you like, press “Check against the bylaws” (a minute or two) and “Check consistency with Claude”. Their notes are advice and never stop scheduling.',
    'The “Where this election is” card shows every step to come and who it waits on.',
  ],
};

/** The results page, once certified. */
const RESULTS_STEP: TourStep = {
  id: 'results',
  title: 'The published results',
  page: '/results/:election',
  pick: PICK_FROM_LIST,
  about: 'The results page anyone can open and check, with the certification once it is approved.',
  todo: [
    'Check it says the results are certified, and that every step under “How these results were checked” passes.',
    'Share the page’s address, or use “Download CSV”, “Download as Word” or the “Google Sheets formula”.',
  ],
};

const electionAdmin: readonly TourStep[] = [
  {
    id: 'sign-in',
    title: 'Sign in',
    page: '/signin',
    about: 'Sign in with the account a System Admin made an Election Admin.',
    todo: SIGN_IN_TODO,
    notes: ['Already signed in? Press Next.'],
  },
  {
    id: 'two-step',
    title: 'Two-step verification',
    page: '/account',
    about: 'The admin tools need two-step verification, and approvals and deletions a sign-in with it in the last 15 minutes.',
    todo: TWO_STEP_TODO,
    notes: ['Until you sign in with a code, the Administration page says “Admin tools need two-step verification”.'],
  },
  {
    id: 'elections',
    title: 'Admin › Elections',
    page: '/admin',
    tab: 'elections',
    about: 'Every election and its state, and where you start a new one.',
    todo: NEW_ELECTION_TODO,
    notes: ['To work on an election already listed, press it.', 'To tie a contest to an office, define the office first in Admin › Offices.'],
    rehearse: [
      'To rehearse as a test persona, open Admin › Testing as yourself and press “Act as” beside Test Election Admin, then carry on with this walkthrough as it.',
      'An Auditor approves the roll, the scheduling and the certification, and nobody approves their own requests: the steps that wait on an Auditor say when to switch this tab to the Test Auditor and back.',
    ],
  },
  BUILD_STEP,
  PREVIEW_STEP,
  READY_STEP,
  {
    id: 'roll',
    title: 'Request the voter roll',
    page: '/admin/elections/:election',
    pick: PICK_FROM_LIST,
    about: 'A snapshot of every Active member now. An Auditor approves it before the election can be scheduled.',
    todo: [
      'On the “Voter roll” card, press “Request roll snapshot”, give a reason and send it.',
      'An Auditor, or a Site Admin, approves it next; the worker signs the roll within a minute after.',
    ],
    notes: ['On a test deployment, “Request rehearsal roll” takes test voters only, for practice.'],
    rehearse: approveAsTestAuditor('“approve a rehearsal roll” (or “approve the voter roll”)', 'election_admin'),
  },
  {
    id: 'approvals',
    title: 'Admin › Approvals',
    page: '/admin',
    tab: 'approvals',
    about: 'Every two-person request waiting for a decision, yours among them.',
    todo: [
      'Find your request and see that it is waiting. “Review” opens what it is about.',
      'Come back to the editor once an Auditor or a Site Admin has decided it.',
    ],
    notes: ['You cannot decide your own requests: an Auditor or a Site Admin does.', 'Requests expire after 7 days.'],
    rehearse: approveAsTestAuditor('your request', 'election_admin'),
  },
  {
    id: 'schedule',
    title: 'Request scheduling',
    page: '/admin/elections/:election',
    pick: PICK_FROM_LIST,
    about: 'Scheduling freezes this exact ballot and roll once an Auditor approves. Voting then opens by itself at the set time.',
    todo: [
      'Once the roll is approved and nothing stops scheduling, press “Request scheduling” and give a reason.',
      'Do not edit the ballot after that: any edit voids the request.',
      'Wait for an Auditor or a Site Admin to approve it. The election is then scheduled.',
    ],
    notes: ['Voting must still open in the future when the Auditor approves.'],
    rehearse: approveAsTestAuditor('“schedule the election”', 'election_admin'),
  },
  {
    id: 'open',
    title: 'While voting is open',
    page: '/admin/elections/:election',
    pick: PICK_FROM_LIST,
    about: 'The worker opens voting at the opening time and emails everyone on the roll that it is time to vote.',
    todo: [
      'Watch the “Email to voters” card: how many on the roll each email went to.',
      'Press “Send test email” to see one in your own inbox. If some failed, the card offers to resend to them.',
    ],
    notes: [
      'About a day before voting closes, those who have not voted get a reminder.',
      'To stop a scheduled or open election, press “Cancel election” with a reason: an Auditor must approve it. A draft is cancelled at once.',
    ],
    rehearse: [
      'To vote as test voters on a rehearsal roll: press “Switch persona” in the yellow bar and choose a Test Voter (as yourself, “Act as” in Admin › Testing), then press “Vote now” on its ballot. Switch to the next voter the same way.',
      'To cancel the election instead: after “Cancel election”, switch this tab to the Test Auditor, open Approvals in the admin menu, press “Approve” on “cancel the election”, write a reason and press OK (and confirm it is you with your own sign-in if asked), then switch back.',
    ],
  },
  {
    id: 'certify',
    title: 'Request certification',
    page: '/admin/elections/:election',
    pick: PICK_FROM_LIST,
    about: 'When voting closes, the worker seals and counts the ballots and publishes provisional results, usually within a minute.',
    todo: [
      'On the “Results” card, press “View results” and read them.',
      'Back in the editor, press “Request certification” with a reason: an Auditor certifies exactly these provisional results.',
      'Once approved, the results are certified, and winners of contests that fill an office start their terms.',
    ],
    notes: [
      'A cancelled election nobody voted in can be deleted for good: “Delete election”, with a reason and a recent sign-in.',
    ],
    rehearse: approveAsTestAuditor('“certify the results”', 'election_admin'),
  },
  RESULTS_STEP,
];

const auditor: readonly TourStep[] = [
  {
    id: 'sign-in',
    title: 'Sign in',
    page: '/signin',
    about: 'Sign in with the account a System Admin made an Auditor. An Auditor holds no other role, unless they are a Site Admin.',
    todo: SIGN_IN_TODO,
    notes: ['Already signed in? Press Next.'],
  },
  {
    id: 'two-step',
    title: 'Two-step verification',
    page: '/account',
    about: 'The admin tools need two-step verification, and every approval a sign-in with it in the last 15 minutes.',
    todo: TWO_STEP_TODO,
  },
  {
    id: 'approvals',
    title: 'Admin › Approvals',
    page: '/admin',
    tab: 'approvals',
    about: 'Every two-person request waiting for a decision: voter rolls, scheduling, certification, cancelling, and appointments to offices and ends of terms.',
    todo: [
      'Read each request: what it asks, who asked and when, when it expires, and the reason given.',
      'Press “Review” to open what it is about, and check it as the next steps describe.',
      'Press “Approve” or “Reject” and give a reason. Approving carries the action out at once.',
    ],
    notes: [
      'Approve and Reject are greyed out on your own requests and on requests about your own account.',
      'If your sign-in is more than 15 minutes old, the site first asks you to confirm it is you and for an authenticator code.',
      'Requests expire after 7 days.',
      'Site Admins decide these requests too, but never their own.',
    ],
    rehearse: [
      'Nothing waiting? The requests come from the Test Election Admin: press “Switch persona” in the yellow bar, choose Test Election Admin and make one in the election editor, such as “Request rehearsal roll”.',
      'Then press “Switch persona” again and choose Test Auditor to decide it here.',
    ],
  },
  {
    id: 'elections',
    title: 'Admin › Elections',
    page: '/admin',
    tab: 'elections',
    about: 'Every election and its state. You read them here; only Election Admins change them.',
    todo: ['Press the election a request is about: its editor opens, read-only for you.'],
  },
  {
    id: 'roll',
    title: 'Approve the voter roll',
    page: '/admin/elections/:election',
    pick: { ...PICK_FROM_LIST, how: 'Open the election from Admin › Elections, or press “Review” on its request in Admin › Approvals.' },
    about: 'The members who may vote, as of one moment. Once approved, the roll is frozen.',
    todo: [
      'On the “Voter roll” card, check the number of Active members and the date match the request.',
      'Open “Members on this roll” and look through the names.',
      'Under “Waiting for a decision”, press “Approve” or “Reject” with a reason (or do it in Admin › Approvals).',
    ],
    notes: ['A rehearsal roll is test voters only, for practice on a test deployment.'],
  },
  {
    id: 'schedule',
    title: 'Approve scheduling',
    page: '/admin/elections/:election',
    pick: PICK_FROM_LIST,
    about: 'Scheduling freezes the ballot and roll, and voting opens at the set time. You approve exactly the ballot you saw.',
    todo: [
      'Compare the request’s definition hash (its first 12 characters) with the editor’s “Definition hash” line.',
      'Read the ballot as voters will: “Preview as voter”, or “Download ballot as Word”. Check the details: title, description, voting window and anonymity threshold.',
      'Check the roll is approved. If you like, run “Check against the bylaws”; its notes are advice only.',
      'Press “Approve” or “Reject” with a reason.',
    ],
    notes: [
      'If anything changed after the request, the server refuses the approval.',
      'Approving scheduling also approves the text of every proposal on the ballot.',
    ],
  },
  {
    id: 'check-results',
    title: 'Check the results',
    page: '/results/:election',
    pick: PICK_FROM_LIST,
    about: 'After voting closes, the worker seals and counts the ballots and publishes provisional results.',
    todo: [
      'Note the results hash under “How these results were checked”.',
      'Check that every step there passes, and read the “Full results”.',
    ],
    notes: ['If the page says the results do not check out, do not certify them.'],
  },
  {
    id: 'certify',
    title: 'Certify the results',
    page: '/admin/elections/:election',
    pick: PICK_FROM_LIST,
    about: 'Certifying makes the provisional results final and starts the winners’ terms of office.',
    todo: [
      'Compare the request’s results hash with the “Results” card in the editor.',
      'Press “Approve” or “Reject” with a reason.',
    ],
    notes: [
      'A request to cancel a scheduled or open election comes to you too: check the election is still in the state the request names, and read the reason.',
    ],
  },
  {
    id: 'ledger',
    title: 'Admin › Audit ledger',
    page: '/admin',
    tab: 'audit',
    about: 'Every recorded action, chained by hash, sealed into signed blocks and anchored outside the database.',
    todo: [
      'Under “Ledger verification”, press “Verify ledger”: the server recomputes every entry, block, signature and anchor.',
      'In “Ledger blocks”, each block’s signature should be valid and anchored (the newest may not be anchored yet).',
      'Read the entries, oldest first; “Load more” shows the next 50.',
    ],
    notes: [
      'A failure names the entry or block where it fails.',
      'To check from outside the site, run the ustp-verify command-line tool (packages/verify) against the public record.',
    ],
  },
  {
    id: 'security',
    title: 'Admin › Security',
    page: '/admin',
    tab: 'security',
    about: 'Who signed in, when and how (kept 180 days), and which pages people visit.',
    todo: [
      'Choose a “Period” and search by email, account, address, method or browser.',
      'Look over the sign-ins of the accounts that hold roles, and whether they used two-step.',
      'Press “Export CSV” to keep a copy.',
    ],
    notes: ['Failed sign-in attempts are not listed here: they are in Identity Platform’s request logs.'],
  },
  {
    id: 'verify',
    title: 'Check a voter’s receipt',
    page: '/ballot',
    about: 'Voters are told to bring their receipt to an Auditor when something does not check out.',
    todo: [
      'Open “Verify a receipt” at the foot of Your ballots.',
      'Open the receipt file (“Open a downloaded receipt”) or paste it, and press “Check”.',
      'See which step fails: the commitment, the sealed block, the ledger entry, its signature or the anchor.',
    ],
    notes: ['“Not yet” while the ballot is still in the encrypted pool is not a failure.'],
  },
];

/**
 * A Site Admin acts as every role but System Admin (design §10.1), so runs a whole election: the Election Admin's part
 * as themselves, and the Auditor's for requests someone else made. Only their own requests wait on another person.
 */
const siteAdmin: readonly TourStep[] = [
  {
    id: 'sign-in',
    title: 'Sign in',
    page: '/signin',
    about:
      'Sign in with the account a System Admin made a Site Admin. A Site Admin acts as every role but System Admin without being granted it, the Election Admin and the Auditor among them.',
    todo: SITE_ADMIN_SIGN_IN_TODO,
    notes: [
      'Signed in another way while Google is required, the Administration page says “System and Site Admins must sign in with Google”: sign out, and sign in again with Google.',
      'Already signed in? Press Next.',
    ],
  },
  {
    id: 'two-step',
    title: 'Two-step verification',
    page: '/account',
    about:
      'Whether a Site Admin needs two-step verification is a System Admin’s switch, “Require it of Site Admins”. On, as it starts, you need it on every page, as System Admins do. Off, you need it nowhere: not for approvals, nor for the testing tools.',
    todo: [
      'If the “Two-step verification” card says “You need two-step verification on every page.”, press “Set up an authenticator app”.',
      'Scan the code with an authenticator app on your phone, then enter the 6-digit code it shows and a “Name for this device”.',
      'Press “Turn on”. Then sign out and sign back in, entering a code from the app when asked.',
    ],
    notes: [
      'No such notice on the card? Two-step verification is off for Site Admins on this site: press Next, or set it up anyway.',
      'While it is required, every page but this one brings you back here until you sign in with a code.',
      'Approvals need a sign-in in the last 15 minutes: when yours is older, the site first asks you to confirm it is you.',
    ],
  },
  {
    id: 'elections',
    title: 'Admin › Elections',
    page: '/admin',
    tab: 'elections',
    about: 'Every election and its state. You create and change them as an Election Admin does, with no Election Admin role granted.',
    todo: NEW_ELECTION_TODO,
    notes: ['To work on an election already listed, press it.', 'To tie a contest to an office, define the office first in Admin › Offices.'],
    rehearse: [
      'Get the test personas ready first: open Admin › Testing and press “Create admin personas” if none are listed, then “Add voters” for the test voters of a rehearsal roll.',
      'No Testing in your admin menu? A System Admin shows it to Site Admins in Admin › Navigation.',
      'You build the election and make every request as yourself. Nobody approves their own requests, so each step that waits on an approval says when to act as the Test Auditor and when to stop.',
    ],
  },
  BUILD_STEP,
  PREVIEW_STEP,
  READY_STEP,
  {
    id: 'roll',
    title: 'Request the voter roll',
    page: '/admin/elections/:election',
    pick: PICK_FROM_LIST,
    about:
      'A snapshot of every Active member now. Someone other than you approves it, an Auditor or another Site Admin, before the election can be scheduled.',
    todo: [
      'On the “Voter roll” card, press “Request roll snapshot”, give a reason and send it. On a test deployment, “Request rehearsal roll” takes test voters only.',
      'Wait for an Auditor or another Site Admin to approve it. The worker signs the roll within a minute after.',
    ],
    notes: ['You cannot approve your own request: Admin › Approvals says “You requested this; another admin must decide.”'],
    rehearse: approveAsTestAuditor('“approve a rehearsal roll” (or “approve the voter roll”)', 'site_admin'),
  },
  {
    id: 'approvals',
    title: 'Admin › Approvals',
    page: '/admin',
    tab: 'approvals',
    about: 'Every two-person request waiting for a decision. You decide them as an Auditor does, all but your own.',
    todo: [
      'Find your request and see that it is waiting: it says “You requested this; another admin must decide.” “Review” opens what it is about.',
      'Requests someone else made, you may decide: check them as the Auditor walkthrough says, then press “Approve” or “Reject” and give a reason.',
    ],
    notes: [
      'You never decide a request about your own account, nor one in an election you stand in.',
      'If your sign-in is more than 15 minutes old, the site first asks you to confirm it is you.',
      'Requests expire after 7 days. Role changes are not here: make them in Admin › People, where they take effect at once.',
    ],
    rehearse: approveAsTestAuditor('your request', 'site_admin'),
  },
  {
    id: 'schedule',
    title: 'Request scheduling',
    page: '/admin/elections/:election',
    pick: PICK_FROM_LIST,
    about:
      'Scheduling freezes this exact ballot and roll once someone else approves it. Voting then opens by itself at the set time.',
    todo: [
      'Once the roll is approved and nothing stops scheduling, press “Request scheduling” and give a reason.',
      'Do not edit the ballot after that: any edit voids the request.',
      'Wait for an Auditor or another Site Admin to approve it. The election is then scheduled.',
    ],
    notes: ['Voting must still open in the future when the request is approved.'],
    rehearse: approveAsTestAuditor('“schedule the election”', 'site_admin'),
  },
  {
    id: 'open',
    title: 'While voting is open',
    page: '/admin/elections/:election',
    pick: PICK_FROM_LIST,
    about: 'The worker opens voting at the opening time and emails everyone on the roll that it is time to vote.',
    todo: [
      'Watch the “Email to voters” card: how many on the roll each email went to.',
      'Press “Send test email” to see one in your own inbox. If some failed, the card offers to resend to them.',
    ],
    notes: [
      'About a day before voting closes, those who have not voted get a reminder.',
      'To stop a scheduled or open election, press “Cancel election” with a reason: someone else must approve it. A draft is cancelled at once.',
    ],
    rehearse: [
      'To vote as test voters on a rehearsal roll: open Admin › Testing, press “Act as” beside a Test Voter, then “Vote now” on its ballot. “Switch persona” in the yellow bar moves to the next voter. Press “Stop acting” when they have voted.',
      'To cancel the election instead: after “Cancel election”, press “Act as” beside Test Auditor in Admin › Testing, open Approvals in the admin menu, press “Approve” on “cancel the election”, write a reason and press OK (and confirm it is you with your own sign-in if asked), then press “Stop acting”.',
    ],
  },
  {
    id: 'certify',
    title: 'Request certification',
    page: '/admin/elections/:election',
    pick: PICK_FROM_LIST,
    about: 'When voting closes, the worker seals and counts the ballots and publishes provisional results, usually within a minute.',
    todo: [
      'On the “Results” card, press “View results” and read them.',
      'Back in the editor, press “Request certification” with a reason: someone else certifies exactly these provisional results.',
      'Once approved, the results are certified, and winners of contests that fill an office start their terms.',
    ],
    notes: [
      'A cancelled election nobody voted in can be deleted for good: “Delete election”, with a reason and a recent sign-in.',
    ],
    rehearse: approveAsTestAuditor('“certify the results”', 'site_admin'),
  },
  RESULTS_STEP,
];

/**
 * A Site Admin's whole console (design §10.11): every admin section they are shown, in the side menu's order, one step
 * each, after signing in. Running an election has its own walkthrough (`siteAdmin`); this one says what each section is
 * for, what to do there, and what stays with System Admins (design §10.1).
 */
const siteAdminSite: readonly TourStep[] = [
  siteAdmin[0]!,
  siteAdmin[1]!,
  {
    id: 'console',
    title: 'The admin console',
    page: '/admin',
    about:
      'Every admin tool, as sections in a side menu under five headings: Membership, Elections, Community, Outreach and System. As a Site Admin you use every other role’s sections without being granted the role.',
    todo: [
      'Press Admin in the main menu. The page is headed “Administration”.',
      'Press a section in the side menu to open it. On a narrow screen, press the button at the top that names the open section: the menu opens from the left, and “Close the menu” shuts it.',
      'Press the star beside a section you use often: it moves under “Favourites” at the top, and the first favourite is the section the console opens on.',
      'Press Next to go through the sections one by one, in the menu’s order.',
    ],
    notes: [
      'Three things stay with System Admins: Sign-in methods and API keys, which are not in your menu, and switching the members’ room’s model server.',
      'You delete no account and no test voter, you never change a System Admin’s account, and you cannot grant or revoke System Admin.',
      'Almost every change asks for a reason. It is recorded with your name in the audit ledger, which cannot be edited.',
      'Favourites are kept in this browser only. A section missing from your menu was hidden in Admin › Navigation.',
    ],
  },
  {
    id: 'applications',
    title: 'Admin › Applications',
    page: '/admin',
    tab: 'applications',
    about: 'People who applied to join on the Register page, waiting for a decision. The menu shows how many are waiting.',
    todo: [
      'Stay on “Pending”. Read an application; the applicant’s name opens their member page.',
      'Press “Approve” or “Reject”, write the reason and confirm. An approved applicant is an Active member at once.',
      '“Approved” and “Rejected” list the applications already decided.',
    ],
    notes: [
      'A rejected applicant is shown your reason, so write it for them.',
      'Both buttons are greyed out on your own application: another admin decides it.',
      'Approving does not add anyone to the roll of an election already set up.',
    ],
  },
  {
    id: 'members',
    title: 'Admin › Members',
    page: '/admin',
    tab: 'members',
    about: 'Every member: find them, change their status, correct their details, export the list and add members yourself.',
    todo: [
      'Find someone with “Search by name” and the “Location”, “Class” and “Email” filters. “Clear search and filters” starts over.',
      'Press “Change status” on a row to change a membership’s status, with a reason. “History” shows every change so far.',
      'Press a name to open the member’s page: “Correct details”, “Send the welcome email again”, “Stop email to this member”, “Appoint to an office” and “Write to this member” are there.',
      'To add people who never applied, press “Add members”: “One member” takes an “Email address” and a “Legal name”; “From a CSV file” takes a file made from “Download the template”.',
      'Press “Export CSV” for the list as a spreadsheet, of everyone found or only the rows you ticked.',
    ],
    notes: [
      'Added members are Active at once and are sent a welcome email with a link to sign in.',
      'Adding a future System or Site Admin? Tick “Will be a System or Site Admin: welcome them to sign in with Google, with no password to set”.',
      'You cannot change your own status or correct your own details: another admin does.',
      'Stopping a member’s email stops election notices too, and the member sees it on their Account page.',
    ],
  },
  {
    id: 'inbox',
    title: 'Admin › Membership inbox',
    page: '/admin',
    tab: 'inbox',
    about: 'The membership team’s shared conversations with members: every admin with this section sees the same threads.',
    todo: [
      'Open a conversation that needs an answer. “Answered”, “Closed” and “All” show the rest; “Anyone’s” and “Nobody’s” filter by who has it.',
      'Set “Who has it” to yourself, or leave it with “The whole team”.',
      'Write the answer and press “Send” or “Send and close”. “Add as a note” keeps it for the team only.',
      'To start a conversation, press “Write to a member”, fill in the “Subject” and “Message” and send it.',
    ],
    notes: [
      'The member sees the membership team as the sender, not your name, and gets the message on the site and by email.',
      'Conversations are kept for two years after their last message.',
    ],
  },
  {
    id: 'registration',
    title: 'Admin › Registration form',
    page: '/admin',
    tab: 'registration',
    about: 'What the Register page says and asks: its heading and intro, the bylaws applicants agree to, the two questions, the Core Ideals and which fields are asked.',
    todo: [
      'Edit the “Page heading” and the “Intro (optional)”.',
      'Under “Bylaws applicants agree to”, paste or edit the bylaws. Left blank, applicants agree to none.',
      'Under “Fields the application asks”, set each field to required, optional or not shown.',
      'Check the “Preview”, then press “Save changes”. “Discard changes” undoes your edits; “Restore the default” brings back the original form.',
    ],
    notes: [
      'Saving changed bylaws publishes a new version for good: the site asks you to confirm first, and every version stays readable.',
      'Neither question’s answer ever refuses an application: the first only decides the member’s class.',
    ],
  },
  {
    id: 'first-steps',
    title: 'Admin › Getting started',
    page: '/admin',
    tab: 'first_steps',
    about: 'The getting started list new members see on their voting home.',
    todo: [
      'Under “Steps, in the order members see them”, press “Add a step”.',
      'Fill in “What to do”, “What it is for (optional)” and the “Link”, and choose under “Ticked” what ticks it: one of the site’s own checks, or the member themselves.',
      'Move or remove steps with the buttons on each row.',
      'Try the “Preview”, then press “Save changes”.',
    ],
    notes: ['Each of the site’s own checks can tick only one step.'],
  },
  {
    id: 'photos',
    title: 'Admin › Photos',
    page: '/admin',
    tab: 'photos',
    about: 'Members’ profile photos that the automatic checks flagged for a person to look at.',
    todo: [
      'Stay on “Needs review” and look at each photo and what it was flagged for.',
      'Press “Accept” or “Reject” and give the reason.',
      '“Accepted” and “Rejected” list the photos already decided.',
    ],
    notes: [
      'Rejecting deletes the image, and the member is shown your reason.',
      'The automatic checks only flag a photo: they never reject one.',
      'Both buttons are greyed out on your own photo.',
    ],
  },
  {
    id: 'teams',
    title: 'Admin › Teams',
    page: '/admin',
    tab: 'teams',
    about: 'The party’s teams: create them, and manage any team as its leads do.',
    todo: [
      'Press “New team”, fill in its settings, its “ID, for its address (e.g. outreach)” and its “First lead”, and press “Create team”.',
      'Open a team. Under “Requests to join”, press “Approve” or “Decline”.',
      'Under “Who is on the team”, use “Make lead”, “Make member” or “Remove”. Under “Add someone”, press “Add to the team”.',
      'Under “Team settings”, press “Change settings”, then “Save settings”. “Archive team” retires a team; “Restore team” brings it back.',
    ],
    notes: [
      'A team’s ID cannot change later, and a team always keeps at least one lead.',
      'You can add anyone, whatever the team’s joining rule or size limit says.',
      'Which teams get the Bills page is set in Admin › Bills.',
    ],
  },
  {
    id: 'elections',
    title: 'Admin › Elections',
    page: '/admin',
    tab: 'elections',
    about: 'Every election and its state. Running one has a walkthrough of its own.',
    todo: [
      'To start one, press “New election” or “Import JSON”. To work on one already listed, press it.',
      'For the rest, from the ballot to certified results, follow the Site Admin walkthrough on the Guide page: it has every step and each approval.',
    ],
    notes: [
      'You make the Election Admin’s requests yourself, and someone else approves each: an Auditor or another Site Admin.',
      'You cannot stand in an election you administer.',
    ],
  },
  {
    id: 'offices',
    title: 'Admin › Offices',
    page: '/admin',
    tab: 'offices',
    about: 'The party’s offices and who holds each, as the public Offices page shows them: define offices, appoint people outside elections, and end terms.',
    todo: [
      'Fill in “Define or change an office”: its “Title”, “Seats” and “Term (months)”, with a reason, and press “Save office”. It takes effect at once.',
      'Press “Appoint” on an office, choose the member, when the term “Starts” and “Ends” and a “Reason”, and press “Ask an Auditor to approve”.',
      'Press “End term” beside a holder to end a term early, with a reason.',
    ],
    notes: [
      'Appointing and ending a term wait under “Waiting for an Auditor” until someone else approves them in Admin › Approvals: an Auditor or another Site Admin.',
      'Winners of an election’s contests take up their offices by themselves when the results are certified.',
      'You cannot ask for your own appointment.',
    ],
  },
  {
    id: 'candidacies',
    title: 'Admin › Candidacies',
    page: '/admin',
    tab: 'candidacies',
    about: 'Members running for public office: each candidacy is reviewed before it shows on the public Candidates page.',
    todo: [
      'On the “Review” tab, read each candidacy waiting. A change to a candidacy already public shows “The version public now” beside it.',
      'Press “Approve”, or “Ask for changes” with a note the member sees.',
      'Under “All candidacies”, “View” opens one and “Take down” removes it from the Candidates page.',
      'On the “Your area emails” tab, press “New template” to write an email members can send to the people who represent them.',
    ],
    notes: [
      'Taking a candidacy down cannot be undone, and the member sees your reason.',
      'Your own candidacy is reviewed by another admin.',
    ],
  },
  {
    id: 'approvals',
    title: 'Admin › Approvals',
    page: '/admin',
    tab: 'approvals',
    about: 'Every request that needs a second person: voter rolls, scheduling, certification, cancelling an election, appointments to offices and ends of terms.',
    todo: [
      'Read each request: what it asks, who asked, when it expires and the reason given.',
      'Press “Review” to open what it is about.',
      'Press “Approve” or “Reject” and give a reason. Approving carries the action out at once.',
    ],
    notes: [
      'You never decide your own request: it says “You requested this; another admin must decide.”',
      'If your sign-in is more than 15 minutes old, the site first asks you to confirm it is you.',
      'Requests expire after 7 days. Role changes and emails to members are not here: see Admin › People and Admin › Email.',
    ],
  },
  {
    id: 'audit',
    title: 'Admin › Audit ledger',
    page: '/admin',
    tab: 'audit',
    about: 'Every recorded action on the site, yours among them, chained by hash, sealed into signed blocks and anchored outside the database.',
    todo: [
      'Press “Verify ledger”: the server checks every entry, block, signature and anchor.',
      'Read the entries to see who did what, when and why. “Load more” shows the next 50.',
    ],
    notes: ['Nothing here can be edited or removed, by anyone.'],
  },
  {
    id: 'forum',
    title: 'Admin › Forum',
    page: '/admin',
    tab: 'forum',
    about: 'Moderating the members’ forum and their messages, and putting members’ proposals on a ballot.',
    todo: [
      'Under “Reported”, read each reported post or comment and press “Remove”, with a reason its author sees, or “Dismiss”.',
      'Under “Reported messages”, read each report and press “Close” once it is dealt with.',
      'Open a post from “Proposals, most supported first”: its “Moderate” menu has “Lock the thread”, “Pin to the top” and “Restore”.',
      'On a proposal, press “Put on a ballot”, choose the draft “Election”, the “Question title” and what it “Passes with”, and press “Add to the election”.',
    ],
    notes: [
      'Putting a proposal on a ballot freezes its text: its author can no longer change it.',
      'It needs a draft election to add it to: create one in Admin › Elections first.',
    ],
  },
  {
    id: 'room',
    title: 'Admin › Members’ room',
    page: '/admin',
    tab: 'room',
    about: 'The members’ chat room: whether it is open, and the intro and terms members accept at its door.',
    todo: [
      'Press “Close the room” to shut it for everyone, or “Open the room” to open it again, and confirm.',
      'Under “What members read at the door”, edit the “Intro” or the “Terms” and save.',
      'Changed terms ask you to confirm with “Put them in force”. “Use the original wording” brings back the first text.',
    ],
    notes: [
      'New terms send everyone in the room back to the door to accept them.',
      'The assistant’s model server is a System Admin’s to switch, since it decides what the GPU costs.',
    ],
  },
  {
    id: 'course',
    title: 'Admin › Course administration',
    page: '/admin',
    tab: 'course',
    about: 'The courses on the Courses page: the course map, each course’s lessons, quizzes and profiles, publishing, and the students.',
    todo: [
      'Under “Courses and the course map”, press “New course”, or choose one in “Course to edit”. Drag courses on the map, or press “Arrange as org chart”, then “Save map”.',
      'Edit the “Course title” and “Public summary” and press “Save draft”. “Show on the Courses page” and “Open without sign-in” take effect at once.',
      'Under “Lessons and quizzes”, press “New lesson” or “Edit”, write the lesson and its questions, and press “Save lesson”.',
      'Under “Futurist profiles and portraits”, each profile needs a portrait with “Alt text”, a “Credit” and a “Licence”.',
      'Press “Publish new version”: learners see the draft only once it is published.',
      'Under “Students”, see who is taking the course and write to a student.',
    ],
    notes: [
      'A published version cannot be changed: publish another to correct it.',
      '“Delete course” is offered only for a course never published, and cannot be undone.',
      '“Export JSON” and “Export all (JSON)” give the courses as files, quiz answers included.',
    ],
  },
  {
    id: 'bills',
    title: 'Admin › Bills',
    page: '/admin',
    tab: 'bills',
    about: 'Which teams get the Bills page, where the legislative team follows bills in Congress.',
    todo: ['Under “Teams with the Bills page”, tick the teams.', 'Press “Save”.'],
    notes: [
      'Who is on a team is set in Admin › Teams. System and Site Admins always have the Bills page.',
      'The page reads Congress.gov with a key that a System Admin keeps under API keys.',
    ],
  },
  {
    id: 'communications',
    title: 'Admin › Communications',
    page: '/admin',
    tab: 'communications',
    about: 'What the party publishes: news and press releases, events, partners, the share kit, issue polls, the press kit and the Discord bot.',
    todo: [
      'On “News”, press “New post”, fill in the “Title”, “Summary” and “Text”, press “Save draft” and then “Publish”.',
      'On “Events”, press “New event”. On “Partners”, press “Add a group”, and list it only once its consent is recorded.',
      'On “Share kit”, press “New post to share” and “Publish to the kit” for words members can post themselves.',
      'On “Polls”, press “New poll”, write the “Question” and its choices, and “Publish”. “Close now” ends it.',
      'On “Suggestions”, read what visitors sent and press “Mark answered”, “Archive” or “Spam”.',
      'On “Press kit”, keep the media contact, facts and files current and press “Save the press kit”.',
    ],
    notes: [
      'A news post’s address cannot change once it is published. “Withdraw” takes a post down.',
      'The other tabs are “Calendar”, for planned social posts, “Bots”, “Discord”, “Officials & candidates” and “Email templates”.',
    ],
  },
  {
    id: 'email',
    title: 'Admin › Email',
    page: '/admin',
    tab: 'email',
    about: 'Everything the site emails: a message to members, the newsletter list, who gets no email, the log of every email, and the settings.',
    todo: [
      'On “Settings”, see whether “Send email” is on: while it is off the site sends members nothing. Set the “Sender name” and which kinds of email go out, and press “Save”.',
      'On “Setup and test”, press “Check now”, then choose someone under “Send it to” and press “Send test email”.',
      'On “Email members”, choose “Who it goes to”, write the “Subject” and “Your message”, and check the preview.',
      'Send it. While emails need approval, press “Send for approval”: a System or Site Admin presses “Approve” before it goes.',
      'On “Email log” and “Daily counts”, see what was sent, to whom, and what became of it.',
      'On “Who gets no email”, stop or restore email to one member, with a reason.',
    ],
    notes: [
      'An email that has gone cannot be taken back: “Stop sending” only halts what has not gone yet.',
      'Switching “Send email” on or off takes effect at once, after you confirm.',
      'The emails you send to members carry a link to unsubscribe.',
    ],
  },
  {
    id: 'hub',
    title: 'Admin › Link hub',
    page: '/admin',
    tab: 'hub',
    about: 'The party’s link hub, the first page visitors see: its links, its profile, banner and background, and how often each link is pressed.',
    todo: [
      'On “Links”, press “Add link” or “Add section”, and move, edit, hide or delete the rows. Each change saves at once.',
      'On “Profile & Discord”, set the “Name”, “Tagline” and “Bio”, the logo, the banner and the background, and press “Save settings”.',
      'On “Analytics”, see the clicks. Press “View the hub” to see the page itself.',
    ],
    notes: ['If someone else saved while you were editing, your save is refused and the hub loads again.'],
  },
  {
    id: 'quote',
    title: 'Admin › Home page quote',
    page: '/admin',
    tab: 'quote',
    about: 'The quote over the sign-in on the voting home.',
    todo: [
      'Switch “Show a quote on the home page” on or off.',
      'Fill in the “Quote”, “Who said it” and “Source (optional)”.',
      'Check the “Preview” and press “Save changes”.',
    ],
  },
  {
    id: 'people',
    title: 'Admin › People',
    page: '/admin',
    tab: 'people',
    about: 'Every account and the roles it holds. You grant and revoke every role but System Admin, and a change takes effect at once.',
    todo: [
      'Find the account with “Email starts with”, or list the officers with “Holding a role”.',
      'Press “Change roles” on its row: the “Change a role” form is filled in with the person.',
      'Choose “Grant” or “Revoke” and the “Role”, write the “Reason” and press “Grant role” or “Revoke role”.',
    ],
    notes: [
      'A role change needs a sign-in in the last 15 minutes, and nobody changes their own roles.',
      'An account holds two roles at most; a Site Admin may hold three more besides. An Auditor holds no other role, unless they are a Site Admin.',
      'You cannot change a System Admin’s account, nor make a Site Admin an Auditor or end that: a System Admin does.',
      'Only System Admins delete accounts.',
      'The person needs two-step verification before the role’s tools open, unless they are a Site Admin while that is not required of Site Admins.',
    ],
  },
  {
    id: 'security',
    title: 'Admin › Security',
    page: '/admin',
    tab: 'security',
    about: 'Who signed in, when and how, and which pages people visit.',
    todo: [
      'Choose a “Period” and search the sign-ins by email, account, address, method or browser.',
      'Look over the sign-ins of the accounts that hold roles, and whether they used two-step verification.',
      'Lower down, see the visits “By page”, “By person” or “Where from”.',
      'Press “Export CSV” to keep a copy.',
    ],
    notes: [
      'Sign-ins are kept 180 days. Failed attempts are not listed here.',
      'A “Measurement ID” here turns on Google Analytics for the site; “Switch off” ends it.',
    ],
  },
  {
    id: 'navigation',
    title: 'Admin › Navigation',
    page: '/admin',
    tab: 'navigation',
    about: 'Which menu links and admin sections each kind of visitor, member and officer is shown, and the page each starts on after signing in.',
    todo: [
      'Choose the columns: “All”, “Membership” or “Staff roles”.',
      'Under “Main menu”, tick the links each column is shown. For a role, a link is added to what their membership gives, left to it, or hidden.',
      'Under “Admin sections”, tick the sections each role is shown.',
      'Under “After sign-in”, set what each column “Starts on”.',
      'Press “Save changes”. “Restore defaults” brings back the original settings.',
    ],
    notes: [
      'This changes what people are shown, not what they are allowed: a hidden page still opens by its address for whoever may use it.',
      'People and Navigation are always shown to System Admins.',
    ],
  },
  {
    id: 'testing',
    title: 'Admin › Testing',
    page: '/admin',
    tab: 'testing',
    about: 'On a test deployment only: test personas to act as, and demo elections, so you can rehearse every part alone. A live site has no such section.',
    todo: [
      'Under “Test personas”, press “Create admin personas” if none are listed, then set “Test voters to add” and press “Add voters”.',
      'Press “Act as” beside a persona: this tab is now them, and the yellow bar at the top says so. “Switch persona” changes to another, and “Stop acting” makes you yourself again.',
      'On the “Demo election” card, set when “Voting opens” and how long “Voting lasts”, and press “Create demo election”.',
      'Follow “Rehearse an election” on the page, or the Site Admin walkthrough, whose steps say when to act as the Test Auditor.',
    ],
    notes: [
      'Rehearsals email nobody, and their elections are marked as rehearsals.',
      'Only System Admins delete test voters.',
      'Acting as the Test Site Admin, you change only test personas’ roles.',
    ],
  },
  {
    id: 'members-view',
    title: 'The site as members see it',
    page: '/vote',
    about: 'The voting home, where a member starts. Knowing the members’ side makes their questions easier to answer.',
    todo: [
      'Read the cards: each is something the person signed in can do, “Your ballots” among them.',
      'Press “Open your ballots”: the elections a member can vote in, and at the foot “Verify a receipt”, where a voter checks their vote was counted.',
      'Go through the main menu as a member would: each link is one you set in Admin › Navigation.',
      'On the Guide page, the Voter walkthrough shows voting step by step, and the Election Admin’s and Auditor’s show their parts.',
    ],
    notes: ['That is every section. Press Finish, and start this walkthrough again from the Guide page whenever you need it.'],
    rehearse: [
      'To see exactly what a member sees, open Admin › Testing and press “Act as” beside a Test Voter. Press “Stop acting” in the yellow bar when you are done.',
    ],
  },
];

export const TOURS: Readonly<Record<TourId, Tour>> = {
  voter: {
    id: 'voter',
    title: 'Voter',
    who: 'A member who votes: from signing in to checking that the vote was counted.',
    role: null,
    steps: voter,
  },
  election_admin: {
    id: 'election_admin',
    title: 'Election Admin',
    who: 'The officer who sets an election up: the ballot, the voter roll, scheduling and certification.',
    role: 'election_admin',
    steps: electionAdmin,
  },
  auditor: {
    id: 'auditor',
    title: 'Auditor',
    who: 'The officer who approves each step an Election Admin asks for, and checks the ledger.',
    role: 'auditor',
    steps: auditor,
  },
  site_admin: {
    id: 'site_admin',
    title: 'Site Admin',
    who: 'A Site Admin running a whole election: the Election Admin’s part as themselves, the approvals by someone else.',
    role: 'site_admin',
    steps: siteAdmin,
  },
  site_admin_site: {
    id: 'site_admin_site',
    title: 'Site Admin: every section',
    who: 'A Site Admin learning the whole admin console: what each section is for, what to do there, and what stays with System Admins.',
    role: 'site_admin',
    steps: siteAdminSite,
  },
};
