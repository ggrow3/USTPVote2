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

## What was fixed

| WCAG 2.2 | Before | Now |
| --- | --- | --- |
| 1.3.1 Info and relationships | Titles were styled `div`s, no headings at all; the main navigation was a tab list; contest controls and ranked lists had no group names; receipt table had no header row | One `h1` per page, `h2`/`h3` below it; nav is a `<nav>` of links; each contest is a named `section`, its radio/checkbox group is labelled by the contest title, the ranking is a named list; table headers and captions added |
| 1.4.1 Use of colour | Verify steps showed passed / failed / pending only as a coloured icon | Each step starts with hidden text "Passed:", "Failed:" or "Not checked yet:" |
| 1.4.3 Contrast (minimum) | Green (Quasar positive) with white text 2.6:1; dark theme: grey captions 3.0:1, primary-coloured text 4.1:1, red text 2.9:1, links 2.0:1; orange text 3.8:1; a light banner left white text on cream (1.1:1); the emulator badge 2.2:1 | Brand positive `#2e7d32` (5.1:1); dark-theme overrides for `text-primary`, `text-positive`, `text-negative`, `text-grey-7` and links (all ≥ 7:1); orange text uses `orange-10` (5.6:1); badges and banners get dark text where the background is light (table below) |
| 1.4.10 Reflow | At 320 px the header cut the site name to "U" and pushed the account button off screen; on Verify the Check buttons were cut off, and long receipt titles widened cards past the screen; the review and status-history dialogs had minimum widths wider than a phone | Account button becomes an icon on phones (its name keeps the account); fields take a full row on phones; page `.column` stacks no longer wrap (that is what sized cards to their widest content); dialog minimum widths capped at 95vw |
| 1.4.11 Non-text contrast | Outlined field borders 1.8:1; toggle track 2.7:1; focus shown only as a faint tint | Borders 4.6:1; toggle track 4.6:1; focus ring below |
| 2.1.1 Keyboard | The bylaws text sat in a scroll area that could not be scrolled from the keyboard | A focusable, named scroll region |
| 2.4.1 Bypass blocks | Header and navigation before every page | "Skip to main content" link, first in the tab order |
| 2.4.2 Page titled | Every page was "USTP Vote" | "Page · USTP Vote", with the election title on ballot and editor pages (`usePageTitle`) |
| 2.4.3 Focus order | After a route change focus stayed on the old link; adding or removing a ranked candidate, clearing a contest, casting (the dialog's opener disappears) and submitting the application all dropped focus to the page body | Focus moves to the new page's `h1`; ranked-choice controls move focus to the next sensible control (next "Add" button, the moved row's button, the neighbouring row); after casting focus lands on the receipt heading; invalid forms focus the first invalid field |
| 2.4.4 / 2.4.6 Link purpose, labels | Many identical names: "Move up", "Remove", "Approve", "Reject", "Check", "Edit", "History", "Change", "Refresh", "Review" | Names say what they act on ("Move Casey Okafor up", "Approve Ada Brooks", "Check the saved receipt", "Change status of Ben Cruz"); the visible text always comes first (2.5.3) |
| 2.4.7 Focus visible | Quasar's focus tint, nearly invisible on many controls | A 2 px ring with 3:1 or better on every surface: blue on light, light blue on dark, white in the header, on coloured banners and on toasts |
| 2.4.11 Focus not obscured | The fixed header could cover a control the browser scrolled to | `scroll-padding-top` follows the header's height |
| 2.5.8 Target size (minimum) | "Copy definition hash" 19 × 19 px, the members' copy buttons extra-small, "Clear (skip this contest)" 23 px tall | 24 × 24 px or larger (the Clear button is 32 px tall) |
| 3.3.1 Error identification | Errors were shown, but focus stayed on the submit button | Focus goes to the first invalid field; Quasar links its message with `aria-describedby` |
| 4.1.2 Name, role, value | Prompt dialogs (reasons, codes, passwords) had unnamed inputs and unnamed dialogs; the app's own dialogs were unnamed; sign-in method toggles had no name; filter toggles had no group name | Every dialog is named by its title (`dialog()` in `dialogs.ts` for Quasar's Dialog plugin, `aria-labelledby` elsewhere); prompt inputs are labelled; toggles named; toggle groups named (Quasar already sets `aria-pressed`) |
| 4.1.3 Status messages | Ranking changes, the limit in choose-N contests and casting were silent (result banners and toasts were already `role="alert"` in Quasar, but the ledger result banner was not re-inserted, so a second run was not read) | Announced through two live regions in the layout (`announce()` in `a11y.ts`), plus "Checking your receipt…"; the ledger result is cleared before each run so its alert is read every time |

Also: the review-and-cast dialog now opens with focus on its title, so a screen reader reads the summary from the top
(Tab then reaches Back and Cast ballot); destructive confirmations (remove contest, login, device, photo) open with
focus on Cancel.

### Contrast figures

| Foreground on background | Before | After |
| --- | --- | --- |
| White on positive (badges, Approve, success banners and toasts) | 2.57 (`#21ba45`) | 5.13 (`#2e7d32`) |
| Positive text on white | 2.57 | 5.13 |
| Positive text on the dark page | 7.29 | 9.31 (`#81c784`) |
| Negative text on the dark page | 2.92 | 8.71 (`#ef9a9a`) |
| Primary text (flat buttons, tabs, outlines) on the dark page / dark card | 4.07 / 3.66 | 10.71 / 9.63 (`#90caf9`) |
| `text-grey-7` captions on the dark page / dark card | 3.02 / 2.72 | 8.64 / 7.77 (`#b0b0b0`) |
| Links in page content, dark page | 2.0 (browser default) | 10.71 |
| Links in page content, light page | 9.4 (browser default) | 5.75 (`#1565c0`) |
| Orange warning text on white (`orange-9` → `orange-10`) | 3.79 | 5.60 |
| Warning badge (photo "waiting for review") | 1.70 | 12.37 (black text) |
| Outlined field border on white | 1.78 | 4.61 |
| Toggle track (off) on white | 2.68 | 4.6 |
| Focus ring: blue on white / light blue on dark / white on header blue | — | 4.60 / 10.71 / 4.60 |

Unchanged and passing: white on primary 4.60, white on negative 6.41, `text-grey-7` on white 6.19, black on the orange
emulator badge 9.74.

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
- Colour classes: use `text-orange-10`, not `orange-9`, for warning text; light badge or banner backgrounds need
  `text-color="black"` / `text-black`. `app.css` fixes the dark theme for `text-primary`, `-positive`, `-negative`,
  `-grey-7` and `-orange-10`; another palette class used for text needs the same check.

## Known gaps

- **No screen-reader pass yet** (next section). Live regions next to an open `aria-modal` dialog, and Quasar toasts
  shown while one is open, are announced inconsistently by some reader and browser pairs; the cast flow avoids depending
  on them by moving focus to the receipt.
- **Not exercised in a browser**: two-step sign-in and the authenticator QR step (the Auth emulator does not support
  authenticator apps), the application form itself (every seeded voter is already a member), and the rows of pending
  applications, photos and approval requests (the seed has none). These were reviewed in code only.
- Quasar's radios, checkboxes and toggles are ARIA widgets on `div`s rather than native inputs. They behave correctly
  (roles, states, Space to toggle, roving focus in radio groups) but depend on Quasar staying that way.
- `QBadge` renders `role="status"`, so badges in long lists (ballots, members) are live regions and may be read out
  when a list reloads.
- Success messages in the admin console are toasts that disappear after 4 seconds (as alerts they are read when shown,
  and the list that changed reloads). The "Two-step verification required" toast stays until dismissed.
- Wide data tables (audit ledger, members) scroll sideways inside their card on phones, which WCAG allows for
  two-dimensional data.
- Sign-in with an authenticator code (3.3.8 Accessible authentication) relies on the alternatives: federated
  sign-in and email links are available, and the code field has `autocomplete="one-time-code"` so password managers can
  fill it.
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
7. Admin console: tab and panel relationship, row action names, the status-history dialog, the contest dialog.
8. Zoom to 200 % and 400 % (desktop) and large text on iOS: no clipped controls.
