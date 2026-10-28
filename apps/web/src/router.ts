import { createRouter, createWebHistory, START_LOCATION } from 'vue-router';
import { startPagePath, type Role } from 'ustp-domain';
import { homeQuoteReady } from './governance/home-quote.js';
import { hubReady } from './governance/hub.js';
import { navigationReady, startPath } from './governance/navigation.js';
import MainLayout from './layouts/MainLayout.vue';
import { hasRole, session, sessionReady } from './session.js';

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
        { path: 'academy', component: () => import('./pages/AcademyPage.vue') },
        { path: 'vote', component: () => import('./pages/VotingPage.vue') },
        { path: 'signin', component: () => import('./pages/SignInPage.vue') },
        { path: 'register', component: () => import('./membership/RegisterPage.vue') },
        { path: 'account', component: () => import('./pages/AccountPage.vue'), meta: { requiresAuth: true } },
        { path: 'ballot', component: () => import('./pages/BallotPage.vue'), meta: { requiresAuth: true } },
        { path: 'ballot/:id', component: () => import('./pages/VotePage.vue'), meta: { requiresAuth: true } },
        { path: 'verify', component: () => import('./pages/VerifyPage.vue') },
        { path: 'bylaws/:version?', component: () => import('./pages/BylawsPage.vue') },
        { path: 'results/:id', component: () => import('./pages/ResultsPage.vue') },
        { path: 'offices', component: () => import('./offices/OfficesPage.vue') },
        // Open to anyone signed in: the page tells people without an admin role who it is for.
        { path: 'admin', component: () => import('./pages/AdminPage.vue'), meta: { requiresAuth: true } },
        {
          path: 'admin/members/:accountId',
          component: () => import('./membership/MemberPage.vue'),
          meta: { requiresAuth: true, roles: ['membership_admin'] },
        },
        {
          path: 'admin/elections/:id',
          component: () => import('./pages/ElectionEditorPage.vue'),
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
  // The admin console shows each person their own tools, or says who it is for (it has no roles of its own, so no loop).
  if (to.meta.roles && !hasRole(...to.meta.roles)) return { path: '/admin' };
  return true;
});
