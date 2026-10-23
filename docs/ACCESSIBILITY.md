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
- **Added 2026-10-22, profile photo from Gravatar** (account page, against the emulators with a Gravatar stand-in):
  keyboard only from "Use Gravatar" through "Get my Gravatar" to the review dialog and the upload; Escape returns
  focus to "Use Gravatar"; both dialogs are named by their titles; "Asking Gravatar for your picture…" goes to the
  status region and a missing or slow picture is a `role="alert"` message in the dialog with an "Upload a photo"
  alternative; nothing can be dismissed half-way through the request. At 320 px the card's buttons wrap with no
  horizontal scrolling; the new text is 4.94:1 or better in both themes (primary on white and white on primary 4.94,
  error text 6.41 light / 7.83 dark, accent on the dark card 5.84).
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

## What was fixed

| WCAG 2.2 | Before | Now |
| --- | --- | --- |
| 1.3.1 Info and relationships | Titles were styled `div`s, no headings at all; the main navigation was a tab list; contest controls and ranked lists had no group names; receipt table had no header row | One `h1` per page, `h2`/`h3` below it; nav is a `<nav>` of links; each contest is a named `section`, its radio/checkbox group is labelled by the contest title, the ranking is a named list; table headers and captions added |
| 1.4.1 Use of colour | Verify steps showed passed / failed / pending only as a coloured icon | Each step starts with hidden text "Passed:", "Failed:" or "Not checked yet:" |
| 1.4.3 Contrast (minimum) | Green (Quasar positive) with white text 2.6:1; dark theme: grey captions 3.0:1, primary-coloured text 4.1:1, red text 2.9:1, links 2.0:1; orange text 3.1:1; a light banner left white text on cream (1.1:1); the emulator badge 2.2:1; Quasar's hover and focus tint took button and tab text down to 3.55:1 | Brand positive `#2e7d32` (5.1:1); dark-theme overrides for `text-primary` (and the focused field label and current menu item, which Quasar colours with primary directly), `text-positive`, `text-negative`, `text-grey-7` and links (all ≥ 5.8:1); warning text uses `deep-orange-10` (5.6:1); badges and banners get dark text where the background is light; the tint darkens the header and filled buttons and is lighter on page and card surfaces, so text keeps 4.6:1 or more under it (table below) |
| 1.4.10 Reflow | At 320 px the header cut the site name to "U" and pushed the account button off screen; on Verify the Check buttons were cut off, and long receipt titles widened cards past the screen; the review and status-history dialogs had minimum widths wider than a phone | Account button becomes an icon on phones (its name keeps the account); fields take a full row on phones; page `.column` stacks no longer wrap (that is what sized cards to their widest content); dialog minimum widths capped at 95vw |
| 1.4.11 Non-text contrast | Outlined field borders 1.8:1; toggle track 2.7:1; focus shown only as a faint tint | Borders 4.6:1; toggle track 4.6:1; focus ring below |
| 2.1.1 Keyboard | The bylaws text sat in a scroll area that could not be scrolled from the keyboard | A focusable, named scroll region |
| 2.4.1 Bypass blocks | Header and navigation before every page | "Skip to main content" link, first in the tab order |
| 2.4.2 Page titled | Every page was "USTP Vote" | "Page · USTP Vote", with the election title on ballot and editor pages (`usePageTitle`) |
| 2.4.3 Focus order | After a route change focus stayed on the old link; adding or removing a ranked candidate, clearing a contest, casting (the dialog's opener disappears) and submitting the application all dropped focus to the page body | Focus moves to the new page's `h1`; ranked-choice controls move focus to the next sensible control (next "Add" button, the moved row's button, the neighbouring row); after casting focus lands on the receipt heading; invalid forms focus the first invalid field |
| 2.4.4 / 2.4.6 Link purpose, labels | Many identical names: "Move up", "Remove", "Approve", "Reject", "Check", "Edit", "History", "Change", "Refresh", "Review" | Names say what they act on ("Move Casey Okafor up", "Approve Ada Brooks", "Check the saved receipt", "Change status of Ben Cruz"); the visible text always comes first (2.5.3) |
| 2.4.7 Focus visible | Quasar's focus tint, nearly invisible on many controls | A 2 px ring with 3:1 or better on every surface: primary on light, accent on dark, white in the header, on coloured banners and on toasts, darker orange on light banners |
| 2.4.11 Focus not obscured | The fixed header could cover a control the browser scrolled to | `scroll-padding-top` follows the header's height |
| 2.5.8 Target size (minimum) | "Copy definition hash" 19 × 19 px, the members' copy buttons extra-small, "Clear (skip this contest)" 23 px tall | 24 × 24 px or larger (the Clear button is 32 px tall) |
| 3.3.1 Error identification | Errors were shown, but focus stayed on the submit button | Focus goes to the first invalid field; Quasar links its message with `aria-describedby` |
| 4.1.2 Name, role, value | Prompt dialogs (reasons, codes, passwords) had unnamed inputs and unnamed dialogs; the app's own dialogs were unnamed; sign-in method toggles had no name; filter toggles had no group name | Every dialog is named by its title (`dialog()` in `dialogs.ts` for Quasar's Dialog plugin, `aria-labelledby` elsewhere); prompt inputs are labelled; toggles named; toggle groups named (Quasar already sets `aria-pressed`) |
| 4.1.3 Status messages | Ranking changes, the limit in choose-N contests and casting were silent (result banners and toasts were already `role="alert"` in Quasar, but the ledger result banner was not re-inserted, so a second run was not read) | Announced through two live regions in the layout (`announce()` in `a11y.ts`), plus "Checking your receipt…"; the ledger result is cleared before each run so its alert is read every time |

Also: the review-and-cast dialog now opens with focus on its title, so a screen reader reads the summary from the top
(Tab then reaches Back and Cast ballot); destructive confirmations (remove contest, login, device, photo) open with
focus on Cancel.

### Contrast figures

The brand colours are those of the party's site, transhumanist-party.org, read from its theme's colour-scheme CSS
on 2026-10-22: primary `#bd4e00` (its header and links), accent `#ff6900` (its hover colour and buttons) and a black
menu bar. They are set once, in `apps/web/src/main.ts`; `app.css` refers to them as `var(--q-primary)` and
`var(--q-accent)`. The figures below were recomputed for them; the first audit's figures for Quasar's blue are in git
history. The page background is white in the light theme; in the dark theme Quasar's page is `#121212` and cards,
menus and dialogs `#1d1d1d`.

| Foreground on background | Colours | Ratio |
| --- | --- | --- |
| White on primary (header, filled buttons, primary badges and banners) | `#fff` on `#bd4e00` | 4.94 |
| Primary text on white (flat buttons, tabs, outlines, focused fields) | `#bd4e00` on `#fff` | 4.94 |
| Primary-coloured text in the dark theme: accent instead (`text-primary`, the focused field's label, the current menu item), on the page / a card | `#ff6900` on `#121212` / `#1d1d1d` | 6.49 / 5.84 (primary itself: 3.79 / 3.41) |
| Primary as non-text in the dark theme, on a card (ticked checkboxes, radios, toggles) | `#bd4e00` on `#1d1d1d` | 3.41 |
| Links in page content, light page | `#bd4e00` on `#fff` | 4.94 |
| Links in page content, dark page | `#ff6900` on `#121212` | 6.49 |
| Links in light banners, both themes (`orange-2` / `orange-1` / `grey-3`) | `#aa4600` on `#ffe0b2` / `#fff3e0` / `#eeeeee` | 4.62 / 5.34 / 5.05 |
| Menu bar: white links on black; the current page's underline (accent) on black | `#fff` / `#ff6900` on `#000` | 21.0 / 7.27 |
| White on positive (badges, Approve, success banners and toasts); positive text on white | `#2e7d32` | 5.13 |
| Positive text on the dark page | `#81c784` on `#121212` | 9.31 |
| White on negative | `#fff` on `#c10015` | 6.41 |
| Negative text on the dark page | `#ef9a9a` on `#121212` | 8.71 |
| A field's error message in the dark theme, on a card (Quasar uses negative itself: `#c10015`, 2.63) | `#ef9a9a` on `#1d1d1d` | 7.83 |
| `text-grey-7` captions on white | `#757575` on `#fff` | 4.61 |
| `text-grey-7` captions on the dark page / dark card | `#b0b0b0` on `#121212` / `#1d1d1d` | 8.64 / 7.77 |
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
| App icon: white ballot box on primary | `#fff` on `#bd4e00` | 4.94 |

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

The bylaws check (design §5.4) was checked on 2026-10-22 against the emulators' stand-in, in both themes and at 320 px:
a flagged line in the draft editor has a bar, a flag icon and a worded label ("Finding 2"), hidden text with the
severity and source ("Flagged by the check: finding 2, likely conflict with the US Constitution"), and an edit button
named "Edit line 6 (flagged)"; each finding gives its severity in words ("Clear conflict", "Likely conflict",
"Possible tension"), and its line buttons ("Go to line 6") switch to the line list, scroll the line into view and move
focus to its edit button. Start and finish are announced through the live region; a failure is a banner.

## Known gaps

- **No screen-reader pass yet** (next section). Live regions next to an open `aria-modal` dialog, and Quasar toasts
  shown while one is open, are announced inconsistently by some reader and browser pairs; the cast flow avoids depending
  on them by moving focus to the receipt.
- **Not exercised in a browser**: two-step sign-in and the authenticator QR step (the Auth emulator does not support
  authenticator apps), the rows of pending applications, photos and approval requests (the seed has none), and the
  federated buttons' popups in the desktop app's browser pane (it opens popups in the same tab, so a federated
  newcomer was checked by signing in with an emulator Google credential instead). These were reviewed in code only.
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
- Captions in clickable list rows (the ballot list, the admin election list) keep Quasar's colour, black at 54%, which
  is 4.61:1 on white at rest and 4.46 under the light theme's hover and focus tint (3.54 before the tint was changed).
  Button, tab and menu-item text keeps 4.6:1 or more under it (contrast figures); dark-theme captions stay above 8.
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
9. Profile photo from Gravatar: the dialog's name and its explanation are read; "Asking Gravatar for your picture…"
   and a "no picture" message are each read once; the review dialog reads "Review your photo" and the picture as
   "Your Gravatar picture".
