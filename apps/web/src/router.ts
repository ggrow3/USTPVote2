import { createRouter, createWebHistory, START_LOCATION } from 'vue-router';
import { startPagePath, type Role } from 'ustp-domain';
import { homeQuoteReady } from './governance/home-quote.js';
import { hubReady } from './governance/hub.js';
import { navigationReady, startPath } from './governance/navigation.js';
import MainLayout from './layouts/MainLayout.vue';
import { applyRouteSeo } from './seo.js';
import { hasRole, secondFactorMissing, session, sessionReady } from './session.js';

declare module 'vue-router' {
  interface RouteMeta {
    /** Redirect to /signin when signed out. */
    requiresAuth?: boolean;
    /** Any one of these roles. */
    roles?: readonly Role[];
    /** A page of its own, without the app's header and menu (the hub). */
    bare?: boolean;
  }
}

/** The four surfaces from spec §2.1, served by one SPA, plus sign-in and account management. */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: MainLayout,
      children: [
        // The party's link hub, for everyone (design §10.6).
        { path: '', component: () => import('./pages/HubPage.vue'), meta: { bare: true } },
        // The voting home: signed out, sign in under the party's quote; signed in, what the person can do (§10.5).
        // Courses, for everyone: the map and list, then each course; quizzes need a sign-in (design §10.8).
        { path: 'academy', redirect: '/courses' },
        { path: 'courses', component: () => import('./academy/CoursesPage.vue') },
        { path: 'course/certificates/:id', component: () => import('./pages/CertificateVerifyPage.vue') },
        { path: 'course/:courseId', component: () => import('./academy/CoursePage.vue') },
        { path: 'vote', component: () => import('./pages/VotingPage.vue') },
        { path: 'signin', component: () => import('./pages/SignInPage.vue') },
        // Where the account emails' links lead: password resets are handled here, other links go on (design §4).
        { path: 'email-action', component: () => import('./pages/EmailActionPage.vue') },
        { path: 'register', component: () => import('./membership/RegisterPage.vue') },
        { path: 'set-password', component: () => import('./membership/SetPasswordPage.vue') },
        // Where an email's Unsubscribe link leads, with no sign-in (design §10.12).
        { path: 'unsubscribe', component: () => import('./notifications/UnsubscribePage.vue') },
        // The newsletter's sign-up form for people not ready to join, and where its confirmation email leads (§10.15).
        { path: 'newsletter', component: () => import('./notifications/NewsletterPage.vue') },
        { path: 'newsletter/confirm', component: () => import('./notifications/NewsletterConfirmPage.vue') },
        { path: 'account', component: () => import('./pages/AccountPage.vue'), meta: { requiresAuth: true } },
        { path: 'notifications', component: () => import('./inbox/NotificationsPage.vue'), meta: { requiresAuth: true } },
        { path: 'messages', component: () => import('./inbox/MessagesPage.vue'), meta: { requiresAuth: true } },
        { path: 'messages/team/:threadId', component: () => import('./inbox/TeamThreadPage.vue'), meta: { requiresAuth: true } },
        { path: 'messages/:threadId', component: () => import('./inbox/MessagesPage.vue'), meta: { requiresAuth: true } },
        { path: 'ballot', component: () => import('./pages/BallotPage.vue'), meta: { requiresAuth: true } },
        { path: 'ballot/:id', component: () => import('./pages/VotePage.vue'), meta: { requiresAuth: true } },
        { path: 'verify', component: () => import('./pages/VerifyPage.vue') },
        // Walkthroughs for a Voter, an Election Admin and an Auditor, page by page, for everyone (design §10.11).
        { path: 'guide', component: () => import('./guide/GuidePage.vue') },
        { path: 'bylaws/:version?', component: () => import('./pages/BylawsPage.vue') },
        { path: 'results/:id', component: () => import('./pages/ResultsPage.vue') },
        { path: 'offices', component: () => import('./offices/OfficesPage.vue') },
        // Members running for public office, for everyone; declaring and editing need a sign-in (design §5.8).
        { path: 'candidates', component: () => import('./candidacies/CandidatesPage.vue') },
        { path: 'candidates/declare', component: () => import('./candidacies/CandidacyFormPage.vue'), meta: { requiresAuth: true } },
        { path: 'candidates/area', component: () => import('./candidacies/AreaPage.vue'), meta: { requiresAuth: true } },
        {
          path: 'candidates/:candidacyId/edit',
          component: () => import('./candidacies/CandidacyFormPage.vue'),
          props: true,
          meta: { requiresAuth: true },
        },
        { path: 'candidates/:id', component: () => import('./candidacies/CandidatePage.vue') },
        // Teams are for Active members; the pages say so to anyone else signed in (design §5.7).
        { path: 'teams', component: () => import('./teams/TeamsPage.vue'), meta: { requiresAuth: true } },
        { path: 'teams/:teamId', component: () => import('./teams/TeamPage.vue'), meta: { requiresAuth: true } },
        // The forum is for Active members; its pages say so to anyone else signed in (design §5.9).
        { path: 'forum', component: () => import('./forum/ForumPage.vue'), meta: { requiresAuth: true } },
        { path: 'forum/:postId', component: () => import('./forum/ForumPostPage.vue'), meta: { requiresAuth: true } },
        // The members' room is for Active members who accept its terms; the page is the door (design §5.10).
        { path: 'room', component: () => import('./room/RoomPage.vue'), meta: { requiresAuth: true } },
        // The legislative team's Bills page: the teams a System Admin names, and System Admins; it says so to anyone else (design §5.14).
        { path: 'bills', component: () => import('./bills/BillsPage.vue'), meta: { requiresAuth: true } },
        { path: 'bills/:congress/:type/:number', component: () => import('./bills/BillPage.vue'), meta: { requiresAuth: true } },
        // News, the press kit and the suggestions form are for everyone; the share kit for Active members (design §10.9).
        { path: 'news', component: () => import('./communications/NewsPage.vue') },
        { path: 'news/:slug', component: () => import('./communications/NewsPostPage.vue') },
        { path: 'press', component: () => import('./communications/PressPage.vue') },
        { path: 'suggest', component: () => import('./communications/SuggestPage.vue') },
        { path: 'share', component: () => import('./communications/SharePage.vue'), meta: { requiresAuth: true } },
        // Open to anyone signed in: the page tells people without an admin role who it is for.
        { path: 'admin', component: () => import('./pages/AdminPage.vue'), meta: { requiresAuth: true } },
        // A conversation in the membership inbox (design §10.13).
        {
          path: 'admin/inbox/:threadId',
          component: () => import('./inbox/InboxThreadPage.vue'),
          meta: { requiresAuth: true, roles: ['membership_admin'] },
        },
        {
          path: 'admin/members/:accountId',
          component: () => import('./membership/MemberPage.vue'),
          meta: { requiresAuth: true, roles: ['membership_admin'] },
        },
        // The team page itself, with a Membership Admin's tools (design §5.7).
        {
          path: 'admin/teams/:teamId',
          component: () => import('./teams/TeamPage.vue'),
          props: { admin: true },
          meta: { requiresAuth: true, roles: ['membership_admin'] },
        },
        // A post as moderators see it, and where Election Admins put proposals on ballots (design §5.9).
        {
          path: 'admin/forum/posts/:postId',
          component: () => import('./forum/ForumPostPage.vue'),
          props: { admin: true },
          meta: { requiresAuth: true, roles: ['membership_admin', 'election_admin'] },
        },
        {
          path: 'admin/elections/:id',
          component: () => import('./pages/ElectionEditorPage.vue'),
          meta: { requiresAuth: true, roles: ['election_admin', 'auditor'] },
        },
        // The ballot page itself, showing the editor's draft as voters will get it (design §6.5).
        {
          path: 'admin/elections/:id/preview',
          component: () => import('./pages/VotePage.vue'),
          props: { preview: true },
          meta: { requiresAuth: true, roles: ['election_admin', 'auditor'] },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

const OPENED = 'ustp-opened';
/** Where the voting app starts: the navigation settings' "home" start page. */
const VOTING_HOME = startPagePath('home');

/** True the first time it is asked in a browser tab; a reload keeps the answer, so reloading home stays on home. */
function firstOpenInTab(): boolean {
  try {
    if (sessionStorage.getItem(OPENED)) return false;
    sessionStorage.setItem(OPENED, '1');
    return true;
  } catch {
    return false; // storage blocked: home stays home
  }
}

router.beforeEach(async (to, from) => {
  // The hub comes first everywhere, since its default theme applies to every page; the voting home waits for its quote
  // too, so the sign-in card does not move down when the quote arrives.
  await Promise.all([sessionReady, navigationReady, hubReady(), to.path === VOTING_HOME && homeQuoteReady()]);
  // A tab that opens the voting home, signed in, starts where the navigation settings say (design §10.5); the hub
  // stays the hub.
  if (from === START_LOCATION && firstOpenInTab() && to.path === VOTING_HOME && session.user) {
    const start = startPath();
    if (start !== VOTING_HOME) return start;
  }
  if ((to.meta.requiresAuth || to.meta.roles) && !session.user) return { path: '/signin', query: { redirect: to.fullPath } };
  // Without the second factor the site requires of them (design §4), the account page, where it is set up, comes first.
  if ((to.meta.requiresAuth || to.meta.roles) && to.path !== '/account' && secondFactorMissing()) return { path: '/account' };
  // The admin console shows each person their own tools, or says who it is for (it has no roles of its own, so no loop).
  if (to.meta.roles && !hasRole(...to.meta.roles)) return { path: '/admin' };
  return true;
});

// What search engines are told about the page arrived at (design §15).
router.afterEach((to, _from, failure) => {
  if (!failure) applyRouteSeo(to);
});
