# Accessibility

The web app (`apps/web`) targets **WCAG 2.2 level AA** (design §19, M5). This page records the audit done on
2026-10-21: what was checked, what was fixed, what is still open, and what a person with a screen reader still has to
test. Keep it current when pages change.

## How it was checked

- **Every page and component**: sign-in (including two-step), register, account (profile photo, authenticator setup),
  ballot list, voting (proposal, choose-up-to-N, ranked choice, review dialog, receipt), verify, the admin console
  (applications, members, photos, bylaws, elections, approvals, sign-in methods, audit ledger), the contest dialog and
  the election editor. Templates were read against the criteria below, and Quasar 2.35's own ARIA and keyboard
  behaviour was read in its source rather than assumed.
- **Keyboard only, in a Chromium browser against the seeded emulators**: v1@example.test cast "2026 Officer Election"
  without a mouse: skip link, a proposal (radio group), a ranked-choice contest (add, move up and down, remove, re-add),
  a choose-2 contest, the review dialog and the cast. Then the receipt, the Verify page with the saved receipt, the
  account menu and sign-out. As elections@example.test: admin tabs (arrow keys), every panel it can see, the New
  election dialog, the election editor, the contest dialog (validation), the remove-contest confirmation and a reason
  prompt (both cancelled), and the status-history dialog. As auditor@example.test: the audit ledger and its verification.
  As admin1@example.test: sign-in methods and the role-change form. As v1 again: the account page, the authenticator
  dialog, the Resign prompt (cancelled), the register page and the review dialog on "Bylaw Amendment 3" (backed out).
- **Target size**: every control on the signed-in pages measured against 24 × 24 px (2.5.8), including the spacing
  exception.
- **Accessibility tree and DOM**: names, roles and states read back for the controls above; live-region text read after
  each change.
- **Both themes** (light, and dark via `prefers-color-scheme`), and **320 px wide** for reflow.
- **Contrast** computed from the actual colours (WCAG relative luminance), not estimated.
- **Added 2026-10-23, registering as one flow** (Register page, against the emulators, signed out): the step list
  (an `ol` named "Steps to register", `aria-current="step"` on the current step, hidden "Done:" before finished ones);
  the create-login form (empty submit focuses Email, both messages linked to their fields, the password message follows
  typing and gives way to the hint); after "Create login and continue" focus moves to the "Apply for membership"
  heading, as it does after a federated sign-in, and the verification note is a light banner (alert) with "Send the
  link again"; the application form itself (an empty submit focuses Legal name), a submit before verifying (an alert
  says so, the answers stay), and the submitted state (focus on its heading). Light and dark themes: the current step
  is 4.94 light / 6.49 dark, its marker white on primary 4.94, other steps 21 / 18.7, the card's caption 4.61 / 7.77
  and the sign-in link 4.94 / 5.84. At 320 px the steps wrap and nothing scrolls sideways. Found and fixed on the way:
  the application's sections sat 16 px left of the page (a margin reset cancelled the form's gutter), and field error
  messages in the dark theme (below).
- **Added 2026-10-23, one layout for every form** (every page, admin panel and dialog, against the emulators as
  admin1, elections, auditor, v1, a new applicant and signed out; light and dark; 1024 px and 320 px): the shared
  classes in `layout.css` (below, "Layout") replaced each page's own gutters and widths. Read back from the DOM, not
  estimated: every field in a card starts and ends 16 px inside it, rows of fields (Offices, the role change, City and
  ZIP, Version and Title, the election dates) share those edges, and a button or toggle beside a field is the field's
  40 px height; admin panels start on the page title's left edge (Quasar's panel padding had put them 16 px right of
  it). Hints and errors sit under their field with no space reserved when there is none to show, so an empty submit
  (Offices, the application) shows each message under its field, checkbox messages start on their checkbox's label,
  and focus still goes to the first invalid field. At 320 px no page or admin tab scrolls sideways; the one that did,
  Results, was a full results hash and tie-break seed in a caption, which now break (`code` in `app.css`). Labels,
  names, focus order and live regions are unchanged: the Sign in page's "New to USTP?" link moved inside its card but
  keeps its place in the reading order, and the election editor's back button now shows its name, "Administration"
  (it was an icon named "Back to administration"). Dark-theme admin panels now sit on the page background (#121212)
  like every other page rather than Quasar's #1d1d1d panel, which only raises the contrast of text on them.
- **Added 2026-10-25, the same four menu links for everyone** (every page, against the emulators signed out and as a
  new login with no membership, an applicant, rejected, resigned, Active (v1), lapsed and suspended members, admin1,
  elections, auditor, and admin1 acting as a test voter, each on every page at desktop width; then Home, Admin, Register
  and Ballot at 320 px, Admin in the light theme and the others in the dark): Register, Ballot, Verify
  and Admin are always there, and the current page's link keeps `aria-current="page"` and its underline. Each page
  still has one `h1` and its title. Ballot and Admin send signed-out visitors to sign-in, which now says why in a line
  under its heading ("Sign in to see your ballots and vote.") and returns them afterwards, focus on the page's `h1`.
  Admin for someone with no role, Register for applicants and members, and the empty ballot list for people on no roll
  are plain text with ordinary links, in a card or the existing grey banner: the banner's link is `#aa4600` on
  `#eeeeee` (5.05) in both themes, the card's link accent on `#1d1d1d` (5.84) and its caption 7.77 in the dark theme.
  At 320 px the four links fit on one row (Quasar's xs breakpoint narrows their padding and letter spacing; Admin
  ends 5 px inside the bar), each 38 px tall, and nothing scrolls sideways; enlarged text wraps them onto a second
  row (since 2026-10-27 the bar keeps one row and puts what does not fit behind More; see Offices in the menu).
- **Added 2026-10-26, member profiles and member details** (against the emulators as elections@example.test, the
  seeded Membership Admin, and as v2; the profile at 1024 px light and 320 px dark): names in the Members and
  Applications tabs are links to `/admin/members/{accountId}`, whose `h1` is the member's name (and the page title),
  focused on arrival, with the Admin link still marked. Its cards have `h2` headings; the applications are expansion
  items (buttons with `aria-expanded`), the newest open, each answer group an `h3` over a `dl` of question and answer.
  Correct details is a dialog named by its title; an empty reason focuses the Reason field with its message, and on
  close focus returns to Correct details. Change status is the members list's menu and reason prompt. Your own record
  says so in a banner and offers neither. On the account page, Edit details replaces the facts with the form and
  focuses Preferred name; an invalid phone focuses the phone field with its message; after Save or Cancel focus goes
  back to Edit details. Someone else's details are typed with `autocomplete="off"`, your own with the usual tokens.
  Labels are medium weight and values normal weight, both in the page's text colour; "Not given" is `text-grey-7`
  (4.61 on a light card, 7.77 on a dark one). At 320 px the facts stack, label over value, and nothing scrolls sideways (the bylaws
  hash breaks).
- **Added 2026-10-26, the Members tab as one table** (against the emulators as elections@example.test, with
  active, lapsed, suspended, resigned, applicant and rejected members and office holders; light and dark at 1400 px,
  375 px light and dark, 320 px dark): the card's `h2` is "Members". The search field is named "Search by name" (its
  placeholder is not its name) and the state select is labelled by the visible "State" (`label for`). The status filters
  are native buttons in a group named "Status", each with `aria-pressed`; the pressed one is filled (black on the
  light theme, white on the dark), not only coloured. Every column header but Actions is a button inside its `th`, and
  the sorted column's `th` has `aria-sort`; the arrow is decoration. The checkboxes are named "Select Ada Brooks" and
  "Select every member on this page" (mixed when some are ticked), and they only choose rows for Export CSV, whose
  name then reads "Export 2 selected" (otherwise "Export CSV: 12 members"). Statuses are words in a tinted pill, with
  a dot as decoration, rather than `QBadge`, so the list is no longer a run of live regions. Initials circles are
  hidden from screen readers (the name follows). "Showing 12 of 12 members" is a status message, so a search or filter
  is announced with its count; the pager is a `nav` named "Pages of members" with "Previous page" and "Next page"
  buttons, disabled at the ends. Keyboard only: search, State, then each status filter (Space presses it, the focus
  ring shows round the filled one), the header buttons and each row's controls in reading order. Captions inside the
  table (office descriptions, "4 days ago", "Member", the headers) are `#616161` rather than `text-grey-7`, so they keep
  4.5:1 on a row under Quasar's hover tint (figures below). At 375 and 320 px the search and State take a row each,
  the filters wrap, nothing on the page scrolls sideways, and the table scrolls inside its card.
- **Added 2026-10-26, the election emails and their card in the election editor** (against the emulators as
  elections@example.test, open, scheduled and reminded seeded elections; light at desktop width, dark at 375 px): the
  card is a `section` named by its `h2` "Email to voters", with an `h3` per email ("Voting is open", "Closing soon:
  reminder to those who have not voted"). Each caption says in words where that email stands ("Sent to 12 of the 12
  people on the roll…", or when it will go, or why there is none), and the counts are a `dl` (Sent, Still to send,
  Failed, Bounced, Skipped), each with what it means. A resend button names the email and how many it is for (visible
  "Resend to the 1 it failed for"; its name adds which email); its dialog's focus starts on Cancel, and the new status
  is announced when it is done. Each preview is that message's plain text in a `pre` that wraps, so at 375 px nothing
  scrolls sideways; captions are `#b0b0b0` on `#1d1d1d` in the dark theme. The emails themselves
  (`votingOpenMessage`, `closingSoonMessage`): `lang="en"`, a title, an `h1` and `h2`s, real text with no images, the
  times as tables with `th scope="col"` and `scope="row"`, links named for what they open ("Open your ballot for
  “2026 Officer Election”", "Add the voting window to your calendar", "open the Verify page", the contact address),
  black on white with links in `#bd4e00` (4.9:1), and a plain-text part with the same content. Not yet seen in mail
  clients, which differ in what HTML they keep.
- **Added 2026-10-27, Admin › Election emails** (against the emulators as admin1@example.test, a System Admin; light at
  desktop width, dark at 375 px): the panel's `h2` is "Election emails", each email a `section` named by its `h3`
  ("Voting is open", "Closing soon: reminder…") and the contact another. Every field has a visible label (the two
  switches "Send this email" and "Send the reminder", "Hours before voting closes", "Subject", "Opening paragraph, after
  the greeting", "Contact for election questions"); the built-in wording is the placeholder and, in words, the hint
  ("Empty: Voting is open: {title}"), and the lead time's hint says it in days ("2 days before the close…"). A wording
  the checks refuse (an unknown placeholder such as `{name}`) is said under its field and marks it `aria-invalid`, and
  Save stays disabled until it is fixed; the count of unsaved changes is shown beside Save. The previews are plain text
  in a `pre` that wraps, so at 375 px nothing scrolls sideways; captions are `#b0b0b0` on `#1d1d1d` in the dark theme.
  An Election Admin does not get the tab, and `?tab=email` falls back to their first section.
- **Added 2026-10-27, the emails in the election workflow** (against the emulators as elections@example.test: an open
  election with its reminder to come, then due, then sent; a scheduled one-day election with email switched off; light
  at desktop width, dark at 375 px): the list has an "Email to voters" item after Open for voting, with its status in
  words before its name ("Sent:", "Sending:", "To come:", "Not sent:") and a marker (✓, ▶, none, –) that is
  decoration; it never takes `aria-current`, which stays on the election's one current step. Its lines name each email
  and say how far it got in words. In the lanes, "Emails the roll" and "Sends a reminder" use the actions' existing
  colours and marks, so the contrast figures below hold; a step that will not come is dashed and marked –. The longest
  new label, "reminder", is narrower than "ballot key" already in the worker's lane, and at 375 px every label stays
  inside its box with nothing scrolling sideways. The counts in the list update while an email goes out (the card's
  reread, every 20 seconds).

- **Added 2026-10-26, who sees which link and the home page** (design §10.5; against the emulators signed out, as a
  new login with no membership, an applicant, lapsed, suspended, resigned and rejected members, v1, elections@,
  auditor@ and admin1@, after admin1 saved settings that differ from the defaults; the matrix at 1600 px in the dark
  theme and 320 px in the light, the home page at 1600 and 320 px dark): the matrix is a `table` with a hidden
  caption, column groups ("Membership", "Staff roles · added to membership") as `th scope="colgroup"` over
  `colgroup`s, each audience a `th scope="col"`, each row's link or section a `th scope="row"`, and row groups
  ("Main menu", "Admin sections", "After sign-in") as `th scope="rowgroup"`. Every switchable cell is a native
  checkbox named for what it does ("Show Ballot to Applicant", "Show Members to Membership Admin"), reached with Tab
  and switched with Space, with the usual focus ring; each start page is a native `select` named "Applicant starts
  on", its admin sections in an `optgroup`. Locked cells are text, not controls: a dash or tick hidden from screen
  readers and the reason as hidden text ("Not available: only Membership Admins may use this", "Always shown, so System
  Admins cannot be locked out"); a legend above the table says the same in words. Unsaved changes are listed in words
  ("Hide Ballot from Applicant") above Save. The table scrolls sideways inside the card, a focusable region named by its
  caption, with the row headers kept in view; at 1600 px it fits, at 320 px the row headers take 128 px and "Columns
  to show" (All, Membership, Staff roles, a button group with `aria-pressed`) narrows it. The page itself does not
  scroll sideways at 320 px. Colours: a shown cell is white on primary (4.94); a hidden cell's ring and dash
  `#757575` on white (4.61) and `#b0b0b0` on the dark card (7.77); a shown cell's fill is primary, 4.94 on white and
  3.41 on the dark card (non-text); a locked tick is the link colour (4.94 / 5.84), a locked dash the caption grey; the
  sticky row headers repaint the card's own colour in both themes. The home page is one `h1` ("Welcome, Ada
  Brooks"), a caption naming the membership state and roles, and a list named "What you can do" of cards, each an
  `h2` with a button whose text names its destination ("Open your ballots", "Open Applications"); one column at
  320 px with nothing scrolling sideways. The Sign in row, added afterwards, was checked the same way: one checkbox
  ("Show Sign in to Signed out") and text in every other column ("Not applicable: already signed in"; since
  2026-10-28 one cell across those columns, see the matrix without its dashes). Hiding every way
  for visitors to sign in shows a light banner (`orange-2`, black text) saying why, and Save stays disabled. Fixed on
  the way: the cells' hidden text was positioned against the admin panel rather than the table, which gave the panel a
  second sideways scrollbar below the matrix's own.

- **Added 2026-10-26, the platform consistency check** (design §5.5; against the emulators with the stand-in checker,
  as v1 on "Platform Vote #9 (demo)" and as elections@example.test in its election editor and in "2027 Bylaws Review
  (draft)"; the ballot at desktop width dark, 320 px light and 375 px dark, the editor at 375 px dark): the card is a
  `section` named by its `h2` "Consistency with the platform", above the questions on the ballot and above Contests in
  the editor, with a caption saying what Claude reads and that the check is advisory. "Check consistency with Claude"
  opens a dialog named by its title ("Check consistency with Claude?") saying what is sent to Anthropic and that it runs
  once per election; focus starts on Cancel. Once asked, the button is gone, so focus moves to the status line under
  it ("Waiting for the server to start the check…", then the outcome), which stays in the page while the check runs
  and when it ends, so focus is never lost; the start and the finish ("Consistency check finished: 4 possible
  inconsistencies found.") are announced politely, and a failure is the card's alert banner, not announced again.
  Findings are an ordered list: "Finding 1", the severity in words beside an icon hidden from screen readers ("Possible
  tension", in `deep-orange-10`), the source in words ("With the Platform: Article VI", "Between questions on this
  ballot"), the passage concerned as a `blockquote`, the explanation, and a button per question named "Go to" and the
  question's title, which moves focus to that question's heading. Long titles wrap and start at the left. When a
  draft has changed since the check, a caption says so in words. Reloading shows the person's one check again: in the
  button's place a sentence in the page's text colour says the run is used and when ("You have used your one
  consistency check of this election (asked for on …)"), with a tick icon hidden from screen readers, rather than a
  disabled button, which would drop out of the tab order and fail contrast. Colours are existing pairs: links `#bd4e00` on white (4.94) and `#ff6900` on the dark card (5.84),
  severity `#bf360c` (5.60) and `#ffb74d` (9.74), captions `#757575` (4.61) and `#b0b0b0` (7.77), read back from the
  computed styles. At 320 and 375 px nothing scrolls sideways.
- **Added 2026-10-27, Admin › Claude, the Anthropic API key** (design §5.6; against the emulators as
  admin1@example.test, with both checks switched to Claude and a made-up key; desktop width dark, 320 px light): the
  panel is a `section` named by its `h2` "Anthropic API key", with a caption saying what the key is for and that
  nobody can see it once saved. A line in the page's text colour says whether a key is set ("No key is set, so neither
  Claude check can run." / "A key is set. It ends in TEST and was added on Oct 27, 2026 by …"), its key icon hidden
  from screen readers; each check's state is a `dl` ("Bylaws check": "On, but it cannot run until a key is added.").
  The key is a labelled password field ("Anthropic API key", "New key, to replace the one in use" when one is set) with
  `autocomplete="off"` and a hint linked to it. Saving an empty field, or a paste that is not an API key (an Admin key,
  spaces), focuses the field, marks it `aria-invalid` and links the message to it, and sends nothing; a key Anthropic
  refuses comes back the same way. Once saved, the field is emptied, focus moves to the status line and "Key saved. It
  ends in TEST." is announced politely; the button becomes "Replace the key", beside "Remove the key", whose dialog is
  named by its title ("Remove the Anthropic API key?"), says the key stays valid at Anthropic, and starts on Cancel;
  after it, focus returns to the status line and "Key removed." is announced. The section is a row in the Navigation
  settings ("Show Claude to System Admin"). Captions `#757575` on white (4.61), read back from the computed styles; at
  320 px nothing scrolls sideways and the check states stack.
- **Added 2026-10-27, the election setup check's side notes** (design §6.9; against private emulators with the
  stand-in checker and a finished check of "Committee Elections (15-minute window)" given test notes, on its public
  results page signed out: desktop width dark, 320 px light and dark): each set of notes is a `complementary` landmark
  named after what it is about ("Bylaws check notes on this election", "Bylaws check notes on Policy Committee (approve
  any)"), the election's above the contest cards and each contest's after its rules, so it is met in reading order.
  The gavel and severity icons are `aria-hidden`; the severity is in words ("Clear mismatch with the bylaws", "Likely
  mismatch…", "Worth a look") with the topic after it; each set says it comes from an automated check (or the local
  stand-in); quoted bylaws lines are `blockquote`s, "Bylaws, line 11: “…”". Fixed on the way: the light theme's caption
  grey `#757575` on the notes' grey tint was 4.22:1, so captions inside them are `#616161` (5.67); the severity
  `deep-orange-10` is 5.13 there, and in the dark theme `#b0b0b0` is 7.08 and `#ffb74d` 8.86. At 320 px the notes wrap
  inside the card and nothing scrolls sideways. Not yet seen in a browser: the notes on the ballot page and the
  election editor's "Check against the bylaws" card (both need a signed-in Election Admin, Auditor or voter); they use
  the same component and the card follows the consistency check's (named button, focus to the progress, the end
  announced, a failure as a banner, "Go to contest" named with the contest by a screen-reader-only suffix).
- **Added 2026-10-27, appointing members to offices** (design §6.4; against the emulators as elections@example.test,
  the seeded Membership and Election Admin, then as auditor@example.test, and signed out; desktop width dark, 320 px
  light and dark): each office's card in the Offices tab has Appoint (named "Appoint to Chair" by a screen-reader-only
  suffix, like Change and End term), and the member profile has an Offices card (`h2`) with Appoint to an office for an
  Active member other than yourself, and says why not for anyone else. Both open one dialog, `aria-modal`, named by its
  `h2` ("Appoint to Chair", "Appoint Ben Cruz to an office"); focus moves into it and returns to the button that opened
  it on Cancel or after sending, and like the app's other form dialogs it is persistent, so Escape does not throw the
  typed reason away. The member is a combobox labelled "Member", described by the line under it (what choosing does,
  then who is chosen), that searches as typing pauses and announces how many members match and how many can be
  chosen; members who cannot be chosen (yourself, a holder of the office, one with an appointment waiting) stay in the
  list, disabled, with the reason in their caption. Starts and Ends are `fieldset`s whose `legend` names their radios
  ("When an Auditor approves", "After a full term of 24 months"…); the date and months fields appear under the radio
  that needs them, labelled "Started on", "Months", "Ends on", with `max` set to today or to the office's longest term.
  The term the choices give ("Term if approved now: Oct 27, 2026 – Apr 27, 2027") and any reason it cannot be asked for
  ("Chair has no free seat: end a term first, then appoint.", "The term would already be over.") are shown as text and
  announced politely once they change; the reason is a light banner (`bg-orange-1`, black text) in both themes, never
  colour alone. Sending with a field missing focuses the first invalid field with its message. The Reason field's hint
  says the reason is published. Pending appointments and term endings are listed under "Waiting for an Auditor" (`h3`)
  on the office's card and the profile, and in the Approvals tab as "appoint Ada Brooks to the office chair, from Nov 1,
  2025, for 24 months", whose Approve and Reject buttons carry the same text for screen readers; the requester's own
  request says "You requested this; another admin must decide." Each term says Elected or Appointed in words. The
  public Offices page (`/offices`, page title "Offices · USTP Vote") has an `h1`, an `h2` per office and a list of
  holders, each "Appointed · since … · until …" with the reason, or "Elected (results)" linking to the results; at
  320 px nothing scrolls sideways on it, in the Offices tab or in the dialog, whose buttons wrap.
- **Added 2026-10-27, Offices in the menu, and its More button** (design §10.5; against the emulators signed out, as
  elections@example.test (Membership and Election Admin, no membership) and as admin1@example.test, at 320, 375, 396,
  400 and 600 px; 320 px in the light and the dark theme): Offices, the public Offices page, is a fifth menu link,
  shown to everyone by default; under the signed-out home page's sign-in form a line "Who leads the party? See who
  holds each office, elected or appointed." links to it, and the signed-in home page has a "Party offices" card ("See
  the offices"), apart from the admin section's "Offices" card ("Open Offices"). The bar keeps one
  row: the links that do not fit go, in menu order, behind "More" at its end, a native `button` with `aria-expanded`
  and `aria-controls` naming a `ul` of the same links, which follows it inside the `nav` and in the tab order. At 320
  and 375 px that is Register, Ballot, Verify and More (Offices, Admin), More ending 8 px inside the bar; from 396 px
  all five fit and there is no More; with Offices hidden from visitors, their four links fit with no More (Admin ends
  at 307 px). With the menu text at 28 px it is Register and More, with WCAG 1.4.12 text spacing Register, Ballot and
  More: the bar never wraps and nothing scrolls sideways. More opens with a click, Enter or Space; Tab goes on into the
  list; Escape closes it and returns focus to More; tabbing past the list, clicking outside it or following one of its
  links closes it. The list is white on black (21:1) with the white focus ring, an edge of white at 30% so it stands
  out on the dark page, and the current page marked by an accent bar on its left (7.27, as the bar's underline) and
  `aria-current="page"`; More is underlined while the current page is behind it. The copy of the row that is measured
  is `aria-hidden` and `visibility: hidden` in a box of no size. In the navigation settings the Offices link and the
  Offices section are both rows, so the sections' checkboxes are now named as their changes are listed ("Show Offices
  to Signed out", "Show Admin › Offices to Election Admin", "Show Admin › Members to Membership Admin"). Measured in
  the browser pane while it was hidden, which delivers no resize notices: the bar fits when it loads, when its links
  change (signing out re-fitted it) and on every check above, but refitting as a window is dragged narrower was
  reviewed in code only (a `ResizeObserver` on the bar and on the measured copy).
- **Added 2026-10-27, choosing the consistency check's documents** (design §5.5; against the emulators as
  elections@example.test on "2027 Bylaws Review (draft)" and "Platform Vote #9 (demo)"; desktop width dark, 320 px
  light): in the editor's consistency card an Election Admin on a draft has a `fieldset` whose `legend` is "Compare
  the questions with", with one checkbox per document, each named by its visible label ("The Constitution of the
  United States"), and a caption saying the questions are always compared with each other and when the choice is
  fixed. Space toggles a box; focus stays on it, the change is saved at once and announced politely ("Saved. Compares
  the questions with the bylaws in force and the Constitution of the United States, and with each other."), and the
  boxes are disabled while it saves; a refused save is the card's alert banner and the boxes go back. The card's
  first sentence names only the documents chosen, on the ballot as in the editor; on an election that is no longer a
  draft, or for an Auditor, that sentence is the only place they are listed (no checkboxes). A result ends with what it
  was compared with, from its own record, each text it read a link; when the choice has changed since, a caption says
  so in words (`text-deep-orange-10`, 5.60 on white). At 320 px the labels wrap beside their boxes and nothing
  scrolls sideways.

- **Added 2026-10-27, the home page as a sign-in landing page, and its quote** (design §10.5; the page has since moved,
  unchanged, to `/vote` as the voting home, and `/` is the link hub, next entry; against the emulators
  signed out, as v1 and as admin1 signing in from the home page's card, and as admin1 changing the quote, switching it
  off and restoring the default; light at 1024 and 375 px, dark at 1024, 375 and 320 px): signed out, the page's one
  `h1` is the party's name ("United States Transhumanist Party — Member Voting"), its icon `alt=""`. The quote is a
  `figure`: the words in a `blockquote`, then a `figcaption` with who said them and the source in a `cite`; the
  quotation marks and the dash are CSS, so the stored words carry none. The card is the sign-in page's own form (one
  component, so the same names, order and two-step step), under an `h2` "Sign in to USTP Vote", with Register and
  Verify as links in sentences, named for where they go ("Register as a member", "Verify your receipt"). Signing in on
  the page replaces the form with the cards, so focus moves to their `h1` ("Welcome, Ada Brooks") rather than being
  lost with the form. Reading and tab order follow the layout, the quote then the card; under 1024 px the card stacks
  under the quote, and at 320 and 375 px nothing scrolls sideways. The quote's size follows its column (22 to 25 px
  on phones, smaller for a long quote), so 200% text zoom reflows it like any text. The picture is an inline SVG,
  `aria-hidden="true"`. Text over it sits on a translucent panel, and the figures below are its colours over the
  picture's worst colour for each theme, computed from the code's colours and checked against the computed styles;
  they rest on the panel's opacity alone, so a browser without `backdrop-filter` (the blur) gets the same. The Home
  page quote tab: a switch "Show a quote on the home page", three labelled fields with hints giving their limits and a
  character count, errors in words under a field ("Needed while the quote is shown", "Over 80 characters") read out as
  alerts, a preview on the picture in the current theme, the unsaved changes listed in words ("Hide the quote", "Who
  said it: Lyndon B. Johnson"), and Save disabled while a field is in error.

- **Added 2026-10-28, the new-version banner** (design §15; a production build against a changed `/version.json`,
  signed out, on the hub and on `/vote`, at 800 and 320 px; Later clicked, the tab order read from the page): when a release has replaced the web
  app under an open page, a bar says "A new version of USTP Vote is available." with Reload and Later; after a request
  the api refused because the page is out of date, it says "USTP Vote was updated while this page was open, so that
  was not saved. Reload the page, then try again.", and the error's toast ends with the same advice. The bar is a
  `region` named "New version" at the foot of the fixed header, under the menu (on the hub, which has no header, the
  header then holds only the bar), so it stays in view, Reload and Later come right after the menu in the tab order,
  and the scroll padding grows with it (2.4.11). Its message is spoken once through the layout's polite live region,
  without moving focus. Black on light blue `#e3f2fd` (18.39, 10.95 under the header's black focus tint) in both
  themes; Reload is white on primary (4.94); Later is a flat black button. Later hides the bar for that tab and puts
  focus on the page's `h1` (2.4.3). At 320 px the message wraps above the buttons and nothing scrolls sideways. Not yet
  heard in a screen reader.

## What was fixed

| WCAG 2.2 | Before | Now |
| --- | --- | --- |
| 1.3.1 Info and relationships | Titles were styled `div`s, no headings at all; the main navigation was a tab list; contest controls and ranked lists had no group names; receipt table had no header row | One `h1` per page, `h2`/`h3` below it; nav is a `<nav>` of links; each contest is a named `section`, its radio/checkbox group is labelled by the contest title, the ranking is a named list; table headers and captions added |
| 1.4.1 Use of colour | Verify steps showed passed / failed / pending only as a coloured icon | Each step starts with hidden text "Passed:", "Failed:" or "Not checked yet:" |
| 1.4.3 Contrast (minimum) | Green (Quasar positive) with white text 2.6:1; dark theme: grey captions 3.0:1, primary-coloured text 4.1:1, red text 2.9:1, links 2.0:1; orange text 3.1:1; a light banner left white text on cream (1.1:1); the emulator badge 2.2:1; Quasar's hover and focus tint took button and tab text down to 3.55:1 | Brand positive `#2e7d32` (5.1:1); dark-theme overrides for `text-primary` (and the focused field label and current menu item, which Quasar colours with primary directly), `text-positive`, `text-negative`, `text-grey-7` and links (all ≥ 5.8:1); warning text uses `deep-orange-10` (5.6:1); badges and banners get dark text where the background is light; the tint darkens the header and filled buttons and is lighter on page and card surfaces, so text keeps 4.6:1 or more under it (table below) |
| 1.4.10 Reflow | At 320 px the header cut the site name to "U" and pushed the account button off screen; on Verify the Check buttons were cut off, and long receipt titles widened cards past the screen; the review and status-history dialogs had minimum widths wider than a phone | Account button becomes an icon on phones (its name keeps the account); fields take a full row on phones; page stacks no longer wrap (that is what sized cards to their widest content; now `.ustp-content`, and `.column` where one remains); dialogs are as wide as the screen less Quasar's 24 px margins at most; full hashes in running text break |
| 1.4.11 Non-text contrast | Outlined field borders 1.8:1; toggle track 2.7:1; focus shown only as a faint tint | Borders 4.6:1; toggle track 4.6:1; focus ring below |
| 2.1.1 Keyboard | The bylaws text sat in a scroll area that could not be scrolled from the keyboard | A focusable, named scroll region |
| 2.4.1 Bypass blocks | Header and navigation before every page | "Skip to main content" link, first in the tab order |
| 2.4.2 Page titled | Every page was "USTP Vote" | "Page · USTP Vote", with the election title on ballot and editor pages (`usePageTitle`) |
| 2.4.3 Focus order | After a route change focus stayed on the old link; adding or removing a ranked candidate, clearing a contest, casting (the dialog's opener disappears) and submitting the application all dropped focus to the page body | Focus moves to the new page's `h1`; ranked-choice controls move focus to the next sensible control (next "Add" button, the moved row's button, the neighbouring row); after casting focus lands on the receipt heading; invalid forms focus the first invalid field |
| 2.4.4 / 2.4.6 Link purpose, labels | Many identical names: "Move up", "Remove", "Approve", "Reject", "Check", "Edit", "History", "Change", "Refresh", "Review" | Names say what they act on ("Move Casey Okafor up", "Approve Ada Brooks", "Check the saved receipt", "Change status of Ben Cruz"); the visible text always comes first (2.5.3) |
| 2.4.7 Focus visible | Quasar's focus tint, nearly invisible on many controls | A 2 px ring with 3:1 or better on every surface: primary on light, accent on dark, white in the header, on coloured banners and on toasts, darker orange on light banners |
| 2.4.11 Focus not obscured | The fixed header could cover a control the browser scrolled to | `scroll-padding-top` follows the header's height |
| 2.5.8 Target size (minimum) | "Copy definition hash" 19 × 19 px, the members' copy buttons extra-small, "Clear (skip this contest)" 23 px tall | 24 × 24 px or larger (the Clear button is 32 px tall); since 2026-10-28, 48 px on the ballot list, the ballot and its Cast dialog |
| 3.3.1 Error identification | Errors were shown, but focus stayed on the submit button | Focus goes to the first invalid field; Quasar links its message with `aria-describedby` |
| 4.1.2 Name, role, value | Prompt dialogs (reasons, codes, passwords) had unnamed inputs and unnamed dialogs; the app's own dialogs were unnamed; sign-in method toggles had no name; filter toggles had no group name | Every dialog is named by its title (`dialog()` in `dialogs.ts` for Quasar's Dialog plugin, `aria-labelledby` elsewhere); prompt inputs are labelled; toggles named; toggle groups named (Quasar already sets `aria-pressed`) |
| 4.1.3 Status messages | Ranking changes, the limit in choose-N contests and casting were silent (result banners and toasts were already `role="alert"` in Quasar, but the ledger result banner was not re-inserted, so a second run was not read) | Announced through two live regions in the layout (`announce()` in `a11y.ts`), plus "Checking your receipt…"; the ledger result is cleared before each run so its alert is read every time |

Also: the review-and-cast dialog now opens with focus on its title, so a screen reader reads the summary from the top
(Tab then reaches Back and Cast ballot); destructive confirmations (remove contest, login, device, photo; delete
election) open with focus on Cancel.

- **Added 2026-10-28, the home page as the party's link hub, and its settings** (design §10.6; against the emulators
  on private ports, signed out and as admin1@example.test; 320 px and 1024 px, dark and light, the theme picked with
  the hub's own button): the hub is a page of its own, without the app's header, so it has no skip link (nothing comes
  before its content but its two buttons). Its one `h1` is the party's name; the logo or initials tile beside it is
  `alt=""` / `aria-hidden`. The icon row is a `nav` named "U.S. Transhumanist Party online" holding a list of links,
  each named by its link's title ("X / Twitter", "Discord server") as the icon is its only content; the Discord card is
  a `section` named by its `h2` "Join the conversation", its button a link named "Join our Discord"; each section is a
  `section` named by its `h2` (set in capitals by CSS only, so it is read as written) over a list of links whose names
  are their title and subtitle. Arrows and icons are `aria-hidden`. Share is a button named "Share this page"; the
  theme button is named "Dark theme" with `aria-pressed`, as is the app header's, now on every other page. Cards are
  72 px tall at least and icons 48 px across (2.5.8, and the 44 px of 2.5.5). Hover gives a glow and a 2 px lift over
  200 ms; keyboard focus gets the glow and the ring (in the accent, 4.43 light, 6.82 dark); reduced motion removes the
  movement. At 320 px the column is 288 px, the icons wrap four to a line, long titles wrap, and nothing scrolls
  sideways; the name sizes with the width (32 to 46 px). Clicking a card still follows its real `href`, so the
  address shows on hover and can be copied or opened in a new tab; the count is a `keepalive` request beside it.
  The default theme a System Admin sets (dark to start with) applies to every page until a visitor picks one, and the
  root's `color-scheme` follows the theme in force: before that, a device in dark mode drew a picked light theme on a
  dark canvas with white default text (found here; `.body--light` now paints the page white too).
  **Admin → Link hub**: three Quasar tabs (Links, Profile & Discord, Analytics) with `aria-controls` and
  `aria-labelledby`. Links: each section is a `section` named by its `h3`; every control in a row is named for its
  link ("Show Subreddit on the hub", "Move Discord server up", "Edit Discord server", "Delete Discord server"), the
  "+ Link" button "Add a link to Community"; a star and "icon row" are visible text or a hidden ", starred", and a
  hidden link's title is followed by a hidden ", hidden". A draft's switch is disabled and its row says what it still
  needs ("Draft: needs an address before it can be shown"). Each change saves at once with a toast saying what changed
  ("Saved: Show “Subreddit”."); controls are disabled while it saves, and focus stays on the control used, or its twin
  when a move reaches the end (checked: moving Discord server to the top left focus on "Move Discord server down").
  Deleting asks first, Cancel focused. The link dialog is named by its `h2`, its fields labelled with hints and errors
  in words ("Needed while the link is shown"), and an invalid save focuses the first field in error; closing it
  returns focus to the button that opened it. Profile & Discord: three `fieldset`s with `legend`s (Profile, Look,
  Discord), the accent's contrast with white given in words under it ("White text on it: 4.94:1 (4.5:1 needed)") and a
  colour too low refused before Save with the reason, the colour picker named "Pick the accent colour", the logo
  upload a button (its file input is hidden from the tab order and the tree), and the unsaved changes listed in words
  before "Save settings". Analytics: the totals as text, and a table with a hidden caption, column headers and each
  link's name as its row header; the bars are `aria-hidden` (the numbers beside them say the same). At 320 px each
  link row puts its clicks and controls under its title, and the table scrolls inside its card.
- **Added 2026-10-28, the ballot list and the ballot by touch** (design §10.5; against the emulators on private ports
  as v1@example.test, casting in "Committee Elections (15-minute window)" and reading "Platform Vote #9 (demo)"; desktop
  width dark, 375 px dark, 320 px light): `/ballot` is a list named "Your elections" of cards, each with an `h2` (the
  election), its voting window and secrecy as text, and a status line in words beside an icon hidden from screen
  readers ("Voting is open. You have not voted yet.", "You voted on Oct 28, 3:40 AM."), so the state never rests on
  colour; the line is primary (accent in the dark theme), positive or `grey-7`, the same pairs as before (4.94 / 5.84,
  5.13 / 8.38, 4.61 / 7.77, read back from the computed styles). Each button names its election with a
  screen-reader-only suffix ("Vote now: 2026 Officer Election", "See results: …"), the visible text first (2.5.3).
  Buttons, choices, toggles and "Read the full text" rows on the list, the ballot and the Cast dialog measured 48 px
  tall, round icon buttons (move up, move down, remove) 48 × 48 px: 2.5.5's 44 px and more. At 375 and 320 px the
  buttons stack, each as wide as its card (290 and 238 px), Yes, No and Abstain stack, each choice is a 48 px line as
  wide as the card, a ranked row puts its three buttons under the name, and nothing scrolls sideways; the dialog's
  Back and Cast ballot share its width (144 px each at 375 px). Text is 16 px with 14 px captions, in the dialog too.
  Focus order and the announcements are unchanged.
- **Added 2026-10-28, the matrix without its dashes** (design §10.5; against the emulators on private ports as
  admin1@example.test; 1600 and 320 px, light and dark, by keyboard): cells with nothing to set are no longer a dash
  each. With the Membership columns, the Admin sections row group keeps its `th scope="rowgroup"` and has one row, a
  cell across the table saying "Admin sections are given to staff roles, never to a membership state alone." and a
  "Switch to Staff roles" button. With All, the first section row has one `td` spanning the eight membership columns
  and all eighteen section rows ("Staff roles only", why, and the same button); each row keeps its `th scope="row"`,
  and the role cells their checkbox, lock text and name ("Show Admin › Members to Membership Admin"). Sign in is one
  `td` across the signed-in columns. The button sets "Columns to show" (Staff roles then `aria-pressed="true"`) and
  moves focus to the "Admin sections" header (`focusElement`), so Tab goes on to "Show Admin › Applications to
  Membership Admin"; checked with Enter and Space. The merged cells' words stay beside the row headers while the table
  scrolls (sticky, no wider than the part in view), and the scrolling region has `scroll-padding-left` as wide as the
  row headers, so a control reached with Tab or Shift+Tab is scrolled clear of them (2.4.11; the button measured 8 px
  right of the headers after Shift+Tab from a role column scrolled fully right). The legend's dash and tick show only
  with role columns. At 1600 px the All view (13 columns since Course Administrator) is wider than the admin card and
  scrolls inside it; at 320 px the row headers take 128 px and the merged words wrap to the 126 px beside them; the
  page does not scroll sideways at either width. Colours are existing pairs: the button primary 4.94 on white, accent
  5.84 on the dark card; the words the caption grey, 4.61 / 7.77; "Staff roles only" the text colour. Seen, not
  changed: in the Membership view the table is 3 px wider than the card at 1600 px (the "Starts on" selects set its
  columns' minimum), so a sideways scrollbar shows; it was so before.
- **Added 2026-10-28, the hub's cover banner and the page background photo** (design §10.6; against the emulators on
  private ports as admin1@example.test, uploading a 1500×500 banner and a 2560×1440 photo of a pure white sky over black
  land, the worst case for a scrim; 1024 px light and dark, 375 px dark): both images are decorative, the banner an
  `img` with `alt=""` (the settings say to put anything it says in the name, tagline or bio) and the background inside
  an `aria-hidden` element, as the sunrise is. The hub's `h1` stays the name, under the banner and the logo's tile. The
  photo lies under a scrim, white at 55% in the light theme and `#0c0a0e` at 60% in the dark one, so the theme's text
  keeps 5.18:1 and 5.22:1 over any pixel (figures below; the domain tests check them over pure black and white, and the
  scrim was read back from the computed style in each theme). The voting home's panels and the pages' cards sit on top
  unchanged, with more contrast still. In the settings, each image is a group with a bold name, a caption giving the
  sizes to upload, an upload button and a button to go without it, named for what it does ("Use the initials", "Remove
  the banner", "Use the sunrise"); its preview is `aria-hidden`, and the change is listed in words before saving ("A new
  cover banner", "Page background: the sunrise instead of the photo"). A file of the wrong type, over 5 MB or the wrong
  size is refused in words before it is sent ("The cover banner must be 3:1 and at least 1120×374 pixels, such as
  1500×500; this one is 1920×1080."). At 375 px a wide preview goes above its text, the banner is 343 × 114 px with the
  tile over a third of it, and nothing scrolls sideways.
- **Added 2026-10-29, the consistency check folded to one line** (design §5.5; against the emulators on private ports
  with the stand-in checker, as v1@example.test on "Platform Vote #9 (demo)"; desktop width dark, 375 px dark, 320 px
  light, by keyboard): the card starts folded. Its `h2` holds a native `button` with `aria-expanded` and
  `aria-controls` naming the folded part, so the heading is still there to move by and the button is read with it:
  "Consistency with the platform" and a line saying where the person's check stands ("An advisory check by Claude.
  Not run yet.", "Checking…", "4 possible inconsistencies found."). The `section` is named by the title alone. Its
  icons are hidden from screen readers; the chevron turns when open, without motion when reduced motion is asked
  for. The focus ring goes inside the card's edge, as on rows. Folded, the card is 44 px tall at desktop width and
  52 px at 375 and 320 px (below 360 px the decorative leading icon is dropped so the title keeps to one line); Enter
  opens it. The folded part is hidden with `display: none`, never removed, so the status line that focus moves to
  after "Run the check" and the polite announcements work as before; a check running or finished while folded shows
  in the line.

### Contrast figures

The brand colours are those of the party's site, transhumanist-party.org, read from its theme's colour-scheme CSS
on 2026-10-22: primary `#bd4e00` (its header and links), accent `#ff6900` (its hover colour and buttons) and a black
menu bar. They are set once, in `apps/web/src/main.ts`; `app.css` refers to them as `var(--q-primary)` and
`var(--q-accent)`. The figures below were recomputed for them; the first audit's figures for Quasar's blue are in git
history. The page background is white in the light theme; in the dark theme Quasar's page is `#121212` and cards,
menus and dialogs `#1d1d1d`. Every page but the hub and the voting home puts its content on one card over the voting
home's picture (`PageShell`, white or `#1d1d1d`), so text on those pages has the card's figures.

| Foreground on background | Colours | Ratio |
| --- | --- | --- |
| White on primary (header, filled buttons, primary badges and banners) | `#fff` on `#bd4e00` | 4.94 |
| Primary text on white (flat buttons, tabs, outlines, focused fields) | `#bd4e00` on `#fff` | 4.94 |
| Primary-coloured text in the dark theme: accent instead (`text-primary`, the focused field's label, the current menu item), on the page / a card | `#ff6900` on `#121212` / `#1d1d1d` | 6.49 / 5.84 (primary itself: 3.79 / 3.41) |
| Primary as non-text in the dark theme, on a card (ticked checkboxes, radios, toggles) | `#bd4e00` on `#1d1d1d` | 3.41 |
| Links in page content, light page | `#bd4e00` on `#fff` | 4.94 |
| Links in page content, dark page / a page's card | `#ff6900` on `#121212` / `#1d1d1d` | 6.49 / 5.84 |
| Links in light banners, both themes (`orange-2` / `orange-1` / `grey-3`) | `#aa4600` on `#ffe0b2` / `#fff3e0` / `#eeeeee` | 4.62 / 5.34 / 5.05 |
| Menu bar: white links on black; the current page's underline (accent) on black | `#fff` / `#ff6900` on `#000` | 21.0 / 7.27 |
| White on positive (badges, Approve, success banners and toasts); positive text on white | `#2e7d32` | 5.13 |
| Positive text on the dark page / a dark card | `#81c784` on `#121212` / `#1d1d1d` | 9.31 / 8.38 |
| White on negative | `#fff` on `#c10015` | 6.41 |
| Negative text on the dark page / a dark card | `#ef9a9a` on `#121212` / `#1d1d1d` | 8.71 / 7.83 |
| A field's error message in the dark theme, on a card (Quasar uses negative itself: `#c10015`, 2.63) | `#ef9a9a` on `#1d1d1d` | 7.83 |
| `text-grey-7` captions on white | `#757575` on `#fff` | 4.61 |
| `text-grey-7` captions on the dark page / dark card | `#b0b0b0` on `#121212` / `#1d1d1d` | 8.64 / 7.77 |
| Members table captions and headers, light: on a card / under the row hover tint / on the header row; dark: on a card / under the tint | `#616161` on `#fff` / `#f7f7f7` / `#f8f8f8`; `#b0b0b0` on `#1d1d1d` / `#2f2f2f` | 6.19 / 5.78 / 5.78; 7.77 / 6.17 |
| Members table: a member's name (link) under the row hover tint; light / dark | `#bd4e00` on `#f7f7f7` / `#ff6900` on `#2f2f2f` | 4.61 / 4.64 |
| Members status pills, light: Active, Suspended, Lapsed, Resigned, Applicant, Rejected | `#2e7d32` on `#e8f5e9`; `#c62828` on `#ffebee`; `#616161` on `#eeeeee`; `#1565c0` on `#e3f2fd`; `#9a4d00` on `#fff3e0`; `#6a1b9a` on `#f3e5f5` | 4.56; 4.92; 5.34; 5.03; 5.57; 7.75 |
| Members status pills, dark: the same order | `#81c784` on `#1e3320`; `#ef9a9a` on `#3d1e1e`; `#bdbdbd` on `#2e2e2e`; `#90caf9` on `#1a2c3d`; `#ffb74d` on `#3a2a12`; `#ce93d8` on `#33203a` | 6.73; 6.96; 7.23; 8.16; 7.98; 6.24 |
| Members: the pressed status filter, light / dark; initials (hidden from screen readers), light / dark | `#fff` on `#121212` / `#121212` on `#fff`; `#aa4600` on `#f6e6db` / `#ffb68a` on `#4a2a14` | 18.73 / 18.73; 4.81 / 7.54 |
| Warning text on white (`deep-orange-10`) | `#bf360c` on `#fff` | 5.60 |
| Warning text on the dark page / dark card | `#ffb74d` on `#121212` / `#1d1d1d` | 10.82 / 9.74 |
| Warning badge (photo "waiting for review") | `#000` on `#f2c037` | 12.37 |
| Emulator badge | `#000` on `#ff9800` | 9.74 |
| Bylaws check: a flagged line's label ("Finding 2"), at its lowest, on a changed line's green tint; light / dark | `#bf360c` on `#e0f1e3` / `#ffb74d` on `#203123` | 4.75 / 8.00 |
| Bylaws check: a flagged line's bar (non-text), on a card; light / dark | `#bf360c` on `#fff` / `#ffb74d` on `#1d1d1d` | 5.60 / 9.74 |
| Outlined field border on white | `rgba(0,0,0,.54)` on `#fff` | 4.61 |
| Toggle track (off) on white | | 4.6 |
| Focus ring: primary on white / accent on the dark page / white on the header, menu bar and coloured banners / darker orange on light banners | | 4.94 / 6.49 / ≥ 4.94 / ≥ 4.62 |
| Under the hover / focus tint, on a fill (header, filled buttons): black at .15 / .22 darkens primary and positive under the white text | `#fff` on `#a14200` / `#933d00`; on `#276a2b` / `#246227` | 6.37 / 7.22; 6.60 / 7.36 |
| Under the tint, light theme (the text's own colour at .08, hover and focus): primary on white (flat and outline buttons, tabs, the current menu item); negative on white; black on white | `#bd4e00` on `#fbf6f3`; `#c10015` on `#fbf3f4`; `#000` on `#f3f3f3` | 4.60; 5.87; 18.93 |
| Under the tint, dark theme (the text's own colour at .12): accent on the page / a card; `#ef9a9a` on a card; white on a card | `#ff6900` on `#2d231c` / `#362d26`; on `#353030`; on `#363636` | 5.31 / 4.66; 6.04; 12.08 |
| Hub, dark (page `#0b0b0b`, cards `#212121`): name and titles on the page / a card; the bio, subtitles and "Live on Discord" on the page / a card; section labels on the page; the bright tone (initials, a starred row's star, the recent clicks) on a card / black / a tile `#2b2b2b`; under the page's glow (the bright tone at 12% over black), the bio | `#f5f5f5` on `#0b0b0b` / `#212121`; `#b8b8b8` on `#0b0b0b` / `#212121`; `#a6a6a6` on `#0b0b0b`; `#ff6900` on `#212121` / `#000` / `#2b2b2b`; `#b8b8b8` on `#1f0d00` | 18.05 / 14.77; 9.92 / 8.12; 8.09; 5.58 / 7.27 / 4.90; 9.49 |
| Hub, dark: a starred card's title / subtitle on its tint (the bright tone at 10% over the card) | `#f5f5f5` / `#b8b8b8` on `#37281e` | 12.97 / 7.13 |
| Hub, both themes: "Join our Discord" and a starred card's icon, white on the accent (System Admins cannot save an accent under 4.5:1 with white) | `#fff` on `#bd4e00` | 4.94 |
| Hub, light (page `#f6f2ec`, cards `#fff`): text on the page / a card; the bio and subtitles on a card / the page / under the page's glow (`#ffede0`) / on a starred card's tint (`#fff0e6`); section labels on the page; the accent (initials, star, recent clicks) on white | `#1a1a1a` on `#f6f2ec` / `#fff`; `#57524c` on `#fff` / `#f6f2ec` / `#ffede0` / `#fff0e6`; `#645e57` on `#f6f2ec`; `#bd4e00` on `#fff` | 15.61 / 17.40; 7.73 / 6.93 / 6.79 / 6.94; 5.74; 4.94 |
| Hub focus ring: the accent on the light page; the bright tone on the dark page / a card | `#bd4e00` on `#f6f2ec`; `#ff6900` on `#0b0b0b` / `#212121` | 4.43; 6.82 / 5.58 |
| Link hub settings, dark (rows `#212121`, cards `#1c1c1c`): captions and addresses on a row / a card; a hidden link's title and address, dimmed to 72%; light: captions on white | `#b8b8b8` on `#212121` / `#1c1c1c`; `#bababa` / `#8e8e8e` on `#212121`; `#5c5650` on `#fff` | 8.12 / 8.59; 8.30 / 4.91; 7.24 |
| Page background photo (design §10.6), light: text over the scrim (white at 55%) over the photo's darkest pixel, black (together `#8c8c8c`); dark: white over the scrim (`#0c0a0e` at 60%) over its brightest, white (together `#6d6c6e`) | `#1a1a1a` on `#8c8c8c`; `#fff` on `#6d6c6e` | 5.18; 5.22 |
| Voting home over the photo: the panel over the scrim's worst colour, light (`#e8e8e8`): the quote, the quotation marks, the source; dark (`#272529`): the same | `#1a1a1a`, `#a34400`, `#4a4a4a` on `#e8e8e8`; `#fff`, `#ff8a3d`, `#d0d0d0` on `#272529` | 14.20, 5.06, 7.23; 15.19, 6.48, 9.85 |
| App icon: white ballot box on primary | `#fff` on `#bd4e00` | 4.94 |
| Home page, light: text on the panel (white at 80%) over the picture's darkest colour, `#bd4e00` (together `#f2dccc`): the quote, the party's name and who said it; the quotation marks; the source | `#1a1a1a`; `#a34400`; `#4a4a4a` on `#f2dccc` | 13.12; 4.68; 6.68 |
| Home page, dark: text on the panel (`#0c0a0e` at 72%) over the picture's brightest colour, a star (white at 70% on the sky, `#c2bbb4`; together `#3f3c3c`): the quote, the party's name and who said it; the quotation marks; the source | `#fff`; `#ff8a3d`; `#d0d0d0` on `#3f3c3c` | 10.97; 4.68; 7.11 |
| Election workflow swim lanes, light (on a white card; bands `#f5f5f5`): the current action, white on primary, and its border, its ▶ mark (on white) and the current band's name on the card / band; a done action, black on `#e8f5e9`, its border on that fill / the card, and its ✓ mark, white on that border colour; other actions black on white; their border, a not-reached action's text and – mark, the lane notes, lane lines and arrows `#757575` on the card / band (other band names are black) | `#fff` on `#bd4e00`; `#bd4e00` on `#fff` / `#f5f5f5`; `#000` on `#e8f5e9`; `#2e7d32` on `#e8f5e9` / `#fff`; `#fff` on `#2e7d32`; `#757575` on `#fff` / `#f5f5f5` | 4.94; 4.94 / 4.53; 18.67; 4.56 / 5.13; 5.13; 4.61 / 4.23 |
| Election workflow swim lanes, dark (on `#1d1d1d`; bands `#262626`): the current action, black on the accent, and its border, its ▶ mark (on the card) and the current band's name on the card / band; a done action, white on `#203123`, its border on that fill / the card, and its ✓ mark, the card's colour on that border colour; other actions white on the card; their border, a not-reached action's text and – mark, the lane notes, lane lines and arrows `#b0b0b0` on the card / band | `#000` on `#ff6900`; `#ff6900` on `#1d1d1d` / `#262626`; `#fff` on `#203123`; `#81c784` on `#203123` / `#1d1d1d`; `#1d1d1d` on `#81c784`; `#b0b0b0` on `#1d1d1d` / `#262626` | 7.27; 5.84 / 5.24; 13.77; 6.84 / 8.38; 8.38; 7.77 / 6.98 |

Corrections to the first audit: `orange-10` (`#e65100`) is 3.79:1 on white, not 5.60 (5.60 is `deep-orange-10`), so
warning text failed until it moved to `deep-orange-10`; `orange-9` was 3.08; `text-grey-7` on white is 4.61, not 6.19.

The accent fails as text on white and under white text (2.89:1 either way), so it is used only in the dark theme and on
black. Warning text (`deep-orange-10`) is close in hue to primary, so a warning is always a worded label ("Flagged: …",
an approval's blocker), never colour alone.

Quasar shows hover and keyboard focus with `.q-focus-helper`, a layer over the control: its text colour, with black at
.1 and white at .4 on top, at opacity .15 on hover and .22 on focus. That pulls the background towards the text, so as
Quasar ships it white on primary fell to 3.96:1 on hover and 3.55 on focus, white on positive 3.98 / 3.53, flat primary
buttons on white 4.31 / 4.07 and flat accent buttons on a dark card 4.40 / 3.74. Tabs and list rows were lower still
(3.97 / 3.59 for primary tabs), because the layer covered their text as well. `app.css` now makes the layer black on
the header and filled buttons; elsewhere it keeps Quasar's colour at .08 in the light theme and .12 in the dark one,
under the .10 that primary text on white allows and the .14 the accent on a dark card allows; and it stacks tab and
list-row content above the layer, as Quasar already does for buttons. The figures above are the layer's colours composited as
the browser paints them, and were read back from the computed styles in a browser, both themes.

## Patterns for new pages

- Call `usePageTitle('…')` and render exactly one `<h1>` (the layout focuses it after navigation). Card titles are
  `<h2 class="text-subtitle1">`, sub-sections `<h3>`; reset margins come from `app.css`.
- A dialog is named by its title: `<q-dialog aria-labelledby="x">` with `<h2 id="x">`, or `dialog({...})` from
  `dialogs.ts` instead of `$q.dialog`; give every prompt a `label`.
- When the control that has focus disappears or moves, put focus somewhere sensible with `focusSoon(selector)` or
  `focusElement(el)`.
- Announce results that appear without a page change with `announce(text)`; use `'assertive'` only for errors.
  Quasar banners (`q-banner`) and toasts are already alerts: don't announce their text again, and clear a result banner
  before recomputing it so it is read on every run.
- Repeated buttons get the object in their name: `<q-btn label="Remove"><span class="sr-only">&nbsp;{{ name }}</span></q-btn>`
  or an `aria-label` that starts with the visible text. The `&nbsp;` matters: Vue drops a plain leading space before
  an interpolation.
- Side notes (the election setup check's notes beside a contest, `election-check/BylawsCheckNotes.vue`) are an `aside`
  named after what they are about ("Bylaws check notes on Plank 12"), placed after the contest's rules so they come in
  reading order; severity is in words next to an `aria-hidden` icon, and quoted text is a `blockquote`.
- Colour classes: use `text-deep-orange-10` for warning text (`orange-9` and `orange-10` fail on white); light badge or
  banner backgrounds need `text-color="black"` / `text-black` (a `q-banner` with `text-black` also gets the darker link
  and focus colour). `app.css` fixes the dark theme for `text-primary`, `-positive`, `-negative`, `-grey-7` and
  `-deep-orange-10`; another palette class used for text needs the same check. Don't use `accent` on light
  backgrounds or under white text.
- Text on a button, tab or clickable row needs about 4.9:1 at rest in the light theme and 5.7 on a dark card to keep
  4.5 under the hover and focus tint. A flat button on a colour fill other than the header (a banner, a toast) needs
  adding to the black-tint selectors in `app.css`, next to `.q-header .q-btn`.
- Brand colours: change them only in `main.ts` (and `index.html`, `manifest.webmanifest` and `make-icons.mjs` for the
  primary), then recompute the table above.

### Layout

Every page, admin panel, card, form and dialog uses the classes in `apps/web/src/layout.css`, so edges line up across
the app and everything stacks at 320 px. Use them instead of Quasar's `q-gutter-*` classes, `row`/`col` grids and
inline widths: gutters move each child by a margin, and a gutter inside another one is what pushed rows of fields 16 px
right of the fields around them.

- **Page or panel**: one `<div class="ustp-content">` inside `<PageShell>` (`components/PageShell.vue`), or as the
  panel's root: a column 860 px wide at most, 16 px between its parts. `PageShell` draws the voting home's picture
  behind the page and puts the page on one card lifted off it, as wide as the column plus its padding, with 16 px text
  and a larger `h1` and card headings; `width="narrow"` for a sign-in style form (with `ustp-narrow`, 480 px),
  `width="wide"` for the admin console (the voting home's 1176 px). The hub and the voting home lay out their own
  pages. A back link goes first,
  `<q-btn flat dense no-caps icon="arrow_back" label="…" class="ustp-back" />`, then the `h1` (with its caption in one
  `div` when it has one).
- **Card**: `q-card flat bordered`, made of `q-card-section`s. The first holds the `h2` and its caption
  (`text-caption text-grey-7`); a section straight after another needs no `q-pt-none` (`layout.css` removes the extra
  padding). A heading with buttons or badges beside it is a `q-card-section class="ustp-header"` whose first child is
  the heading block; the buttons move underneath when there is no room. Lists (`q-list`) are direct children of the
  card, not inside a section, so their text lines up with the heading.
- **Form**: the fields in a `q-form` (or a section) with `class="ustp-form"`: one field per row, 16 px apart, each as
  wide as the card. Every field is `outlined dense`; add `hide-bottom-space` to any field with a hint or an error, so
  space appears only for a message that is showing. A message for something that is not a field (a checkbox, the
  bylaws line list) is `ustp-message`, set like a field's own; checkboxes in a run go in `ustp-options`.
- **Fields side by side**: `<div class="ustp-row">`; each field takes an equal share (twice that with
  `ustp-row__wide`) and the row stacks once a field would be under 200 px. A button or `q-btn-toggle` in a row keeps its
  width and takes a field's 40 px height, so it lines up with the field it acts on.
- **Filters above a list or table** and other control bars: `ustp-toolbar` (fields 240 px, or 120 px with
  `ustp-field--short`).
- **Buttons**: a form's or card's buttons go last, in `<div class="ustp-actions">` (or a `q-card-section` with that
  class): the primary (filled) button first, on the fields' left edge, then the others. Dialogs keep Quasar's
  `q-card-actions align="right"`, as the Dialog plugin's prompts do: dismiss first, the primary last, its right edge on
  the fields' right edge.
- **Dialog**: `q-card class="ustp-dialog"` (480 px) or `"ustp-dialog ustp-dialog--wide"` (640 px, for long text and
  previews); on a phone either is the screen less Quasar's 24 px margins. Its body is a `q-card-section class="ustp-form"`.
- **Facts** (a member's details, an application's answers): `<dl class="ustp-facts">` of `dt` and `dd` pairs, labels
  in one 14rem column everywhere so values line up across cards; stacked, label over value, on phones.
- **Long sections of one form** (the application): each `fieldset class="ustp-fieldset"` is a card's section, its
  `legend` the heading, then an optional caption, then `<div class="ustp-form">` with the fields.

The bylaws check (design §5.4) was checked on 2026-10-22 against the emulators' stand-in, in both themes and at 320 px:
a flagged line in the draft editor has a bar, a flag icon and a worded label ("Finding 2"), hidden text with the
severity and source ("Flagged by the check: finding 2, likely conflict with the US Constitution"), and an edit button
named "Edit line 6 (flagged)"; each finding gives its severity in words ("Clear conflict", "Likely conflict",
"Possible tension"), and its line buttons ("Go to line 6") switch to the line list, scroll the line into view and move
focus to its edit button. Start and finish are announced through the live region; a failure is a banner.

The Word downloads (design §9) were checked on 2026-10-25 against the emulators, in both themes and at 320 px. Each
button's name starts with its visible text and adds the election ("Download ballot as Word: 2026 Officer Election",
"Download as Word: …, ballot and results"); on the results page it is described by the line under it, which says what
the file holds and how to open it in Google Docs. The button shows a spinner while the file is built, and a failure is
a toast. The file itself uses Word's own structure, which Word, Google Docs and screen readers in both navigate: the
title and Heading 1–3 styles, real bullet lists, tables with a header row that repeats on each page, links as links, a
document title and the language (en-US).

The results synopsis (design §9) was checked on 2026-10-26 against the emulators, on "Platform Vote #9 (demo)" (20
contests) provisional and certified, in both themes at 1024 px and at 320 px, and in its print layout (from the dark
theme). Synopsis and Full results are Quasar tabs (`role="tab"`, `aria-selected`, `aria-controls` naming each
`tabpanel`, which is labelled by its tab). The synopsis is an `h2` with one `h3` per contest ("1. Question I. …") and
"Altogether"; the facts at the top are a `dl`. Each table has a hidden caption naming its contest and ballots, column
headers, and the choice or candidate as the row header. Outcomes are words in a tinted pill ("Passed", "Failed", "No
quorum", "3 elected, 1 vacant") with a tick, cross or dash hidden from screen readers, not `QBadge`, so twenty
contests are not twenty live regions; a candidate's "Elected" or "Not elected" is a word in its own column, Elected
in bold. The pills reuse the members table's tones (green, red and grey, figures above: 4.56, 4.92 and 5.34 light,
6.73, 6.96 and 7.23 dark). "Print" is named "Print the synopsis". A ranked-choice entry's "Every round" link selects
the Full results tab and moves focus to it. At 320 px names and results wrap in their cells and the first column
starts on the headings' edge, so no table scrolls sideways, nor does the page. Printed, it is black on white whatever
the theme, without the header, menu, banners or buttons, and a contest is not split across pages.

The election editor's workflow (design §6.1) was checked on 2026-10-26 against the emulators, in both themes and at
320 px, for elections in draft, scheduled, open, closed, certified and cancelled. The card "Where this election is"
(an `h2`) says the current step and what it waits on in its caption. The steps are an `ol` named "Steps of this
election" and a `ul` named "Ways out"; the current step has `aria-current="step"`, and every step's name is read after
its status ("Done:", "Current step:", "To come:", "Possible:", "Not reached:"), which sighted readers get from the
marker (a tick, a filled play symbol, an empty or dashed circle, a dash) and the current step's bold text. What a step
waits on is a nested list under it ("Waiting: An Auditor approves scheduling (requested …)").

The swim lanes replaced the flowchart on 2026-10-26 and were checked the same way (draft, open, open with a
cancellation pending, roll-call, cancelled while scheduled, certified), in both themes and at 320, 700, 1024 and
1280 px. They are one `role="img"` whose name says they show who does each listed step (an Election Admin, an
Auditor, the worker or the members on the roll) and names the current step; inside, an action's status is a mark on
its corner (✓, ▶, –) and a band's before its name, as well as the colours and the dashed border of a way out or a step
not reached, and a legend under the lanes says so. They are drawn to the width of the card rather than scaled: 12 px
action text, 13 px lane names, 11 px lane notes at every width, with no sideways scrolling. At 320 px the diagram is
270 px wide, the lanes 57–76 px (each lane's share follows its longest word, "certification" in the Election Admin's
lane), and every line of every label was measured in the browser to fit its box with at least 2 px either side,
with no mark overlapping a label. The list (below the lanes on a phone, beside them on wider screens) holds every word
of them at full size.

The election editor's candidate field (design §6.5), a combobox checked on 2026-10-26, gave way on 2026-10-28 to
linking a member from a question's option in the ballot builder: the matches are buttons under the option, reached with
the down arrow or Tab, and announced (above, "the ballot builder and Preview as voter").

## Known gaps

- **No screen-reader pass yet** (next section). Live regions next to an open `aria-modal` dialog, and Quasar toasts
  shown while one is open, are announced inconsistently by some reader and browser pairs; the cast flow avoids depending
  on them by moving focus to the receipt.
- **Not exercised in a browser**: two-step sign-in and the authenticator QR step (the Auth emulator does not support
  authenticator apps), the rows of pending applications, photos and approval requests other than appointments (the
  seed has none), and the
  federated buttons' popups in the desktop app's browser pane (it opens popups in the same tab, so a federated
  newcomer was checked by signing in with an emulator Google credential instead). These were reviewed in code only.
- Quasar's radios, checkboxes and toggles are ARIA widgets on `div`s rather than native inputs. They behave correctly
  (roles, states, Space to toggle, roving focus in radio groups) but depend on Quasar staying that way.
- `QBadge` renders `role="status"`, so badges in long lists (ballots) are live regions and may be read out when a
  list reloads.
- Success messages in the admin console are toasts that disappear after 4 seconds (as alerts they are read when shown,
  and the list that changed reloads). The "Two-step verification required" toast stays until dismissed.
- Wide data tables (audit ledger, members, the navigation matrix) scroll sideways inside their card on phones, which
  WCAG allows for two-dimensional data.
- The ballot builder's drag handles were tried with a mouse only; touch dragging on a real phone, and Alt+arrow in
  each screen reader's modes (some readers take Alt+arrows in browse mode; in a field, focus mode passes them on), are
  untested. Every move also has buttons. Two Election Admins editing one draft at once each save over the other's
  question; a change to the questions made elsewhere is found when the order is next saved (409), and the bar then
  offers Reload the ballot.
- Sign-in with an authenticator code (3.3.8 Accessible authentication) relies on the alternatives: federated
  sign-in and email links are available, and the code field has `autocomplete="one-time-code"` so password managers can
  fill it.
- Captions in clickable list rows (the ballot list, the admin election list) keep Quasar's colour, black at 54%, which
  is 4.61:1 on white at rest and 4.46 under the light theme's hover and focus tint (3.54 before the tint was changed).
  Button, tab and menu-item text keeps 4.6:1 or more under it (contrast figures); dark-theme captions stay above 8.
- The link hub's Share copies the address where the device has no share sheet; the desktop app's browser pane
  refuses the clipboard, so there the toast gives the address to copy instead, which is all that was seen. A real
  browser's copy was reviewed in code only.
- The hub's default theme is dark (the System Admins' setting), so someone whose device asks for light gets dark until
  they press the theme button; their pick is then kept in that browser. A System Admin can set the default to the
  device's setting.
- Not addressed (AAA, outside the target): reduced motion for Quasar transitions, enhanced contrast, target size
  44 px.

## Screen-reader pass still needed

Test with **NVDA + Firefox and Chrome** on Windows and **VoiceOver + Safari** on macOS and iOS (TalkBack + Chrome on
Android if time allows), on staging or the emulators:

1. Page change: the new page title and `h1` are read; the skip link works.
2. Voting, each contest kind: the group name (contest title) is read with the first option; in a ranked contest each
   add, move and remove is announced and focus lands where expected; the choose-N limit is announced.
3. Review dialog: opens reading "Cast this ballot?", the summary can be read in order, Tab stays inside, Escape and Back
   return focus to "Review and cast"; after casting, "You voted on …" is read.
4. Verify: "Checking your receipt…" and the result summary are read; each step's status is read before its text.
5. Errors: a wrong password, an invalid form field and an API error toast are each read once.
6. Dialogs from the Dialog plugin (reasons, codes, confirmations): name and prompt label read; focus returns afterwards.
7. Admin console: tab and panel relationship, row action names, the status-history dialog.
8. Zoom to 200 % and 400 % (desktop) and large text on iOS: no clipped controls.
9. The menu bar at 320 px: More is read as a collapsed or expanded button in the "Main" navigation, and its list's
   links follow it, the current page announced.
10. The link hub: the icon row's links read by their names in their navigation, each section's links in their list,
    the theme button's pressed state; in Admin → Link hub, a row's switch and buttons read with its link's name, and
    the "Saved: …" toast after each change.
11. The ballot builder: each question read as a section with its heading, the option fields by number, the
    announcements after adding, moving, deleting and undoing, a failed save read once, and the member suggestions
    reached with the down arrow; Preview as voter read as the ballot with its banner first.
