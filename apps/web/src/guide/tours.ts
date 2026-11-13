import type { Tour, TourId, TourStep } from './tour.js';

/**
 * The walkthroughs' content (design §10.11): one step per page or admin tab, in the order the person does them. Labels
 * the pages show are quoted with “ ” exactly as the pages write them, so the test can find each one in the app.
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

const ADMIN_ELECTIONS = { page: '/admin', tab: 'elections', title: 'Admin › Elections' } as const;

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
      'Read the bylaws and tick “I have read these bylaws and agree to abide by them.”',
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
    page: '/verify',
    about: 'Checks, in your browser and from public data only, that every part of your ballot is in the published record.',
    todo: [
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
    todo: [
      'Press “New election”. Give it a “Title”, choose “Secret ballot” or “Open roll-call”, and set when voting opens and closes.',
      'Press “Create draft”: the election editor opens.',
      'Or press “Import JSON” to start from a ustp.election file. “Download sample ballot” gives one with a question of every kind, to change first.',
    ],
    notes: ['To work on an election already listed, press it.', 'To tie a contest to an office, define the office first in Admin › Offices.'],
  },
  {
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
  },
  {
    id: 'preview',
    title: 'Preview the ballot',
    page: '/admin/elections/:election/preview',
    pick: PICK_FROM_LIST,
    about: 'The ballot as voters will see it once voting opens, as the draft stands now.',
    todo: ['Try the questions: nothing you choose here is sent.', 'Press “Back to the editor” when you are done.'],
    notes: ['In the editor, “Preview as voter” opens this page; the ballot also downloads as Word or JSON.'],
  },
  {
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
  },
  {
    id: 'roll',
    title: 'Request the voter roll',
    page: '/admin/elections/:election',
    pick: PICK_FROM_LIST,
    about: 'A snapshot of every Active member now. An Auditor approves it before the election can be scheduled.',
    todo: ['On the “Voter roll” card, press “Request roll snapshot”, give a reason and send it.', 'An Auditor approves it next; the worker signs the roll within a minute after.'],
    notes: ['On a test deployment, “Request rehearsal roll” takes test voters only, for practice.'],
  },
  {
    id: 'approvals',
    title: 'Admin › Approvals',
    page: '/admin',
    tab: 'approvals',
    about: 'Every two-person request waiting for a decision, yours among them.',
    todo: [
      'Find your request and see that it is waiting. “Review” opens what it is about.',
      'Come back to the editor once an Auditor has decided it.',
    ],
    notes: ['You cannot decide your own requests: an Auditor does.', 'Requests expire after 7 days.'],
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
      'Wait for an Auditor to approve it. The election is then scheduled.',
    ],
    notes: ['Voting must still open in the future when the Auditor approves.'],
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
  },
  {
    id: 'results',
    title: 'The published results',
    page: '/results/:election',
    pick: PICK_FROM_LIST,
    about: 'The results page anyone can open and check, with the certification once it is approved.',
    todo: [
      'Check it says the results are certified, and that every step under “How these results were checked” passes.',
      'Share the page’s address, or use “Download CSV”, “Download as Word” or the “Google Sheets formula”.',
    ],
  },
];

const auditor: readonly TourStep[] = [
  {
    id: 'sign-in',
    title: 'Sign in',
    page: '/signin',
    about: 'Sign in with the account a System Admin made an Auditor. An Auditor holds no other role.',
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
    page: '/verify',
    about: 'Voters are told to bring their receipt to an Auditor when something does not check out.',
    todo: [
      'Open the receipt file (“Open a downloaded receipt”) or paste it, and press “Check”.',
      'See which step fails: the commitment, the sealed block, the ledger entry, its signature or the anchor.',
    ],
    notes: ['“Not yet” while the ballot is still in the encrypted pool is not a failure.'],
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
};
