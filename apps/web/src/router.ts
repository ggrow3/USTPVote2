import { createRouter, createWebHistory } from 'vue-router';
import type { Role } from 'ustp-domain';
import MainLayout from './layouts/MainLayout.vue';
import { hasRole, session, sessionReady } from './session.js';

declare module 'vue-router' {
  interface RouteMeta {
    /** Redirect to /signin when signed out. */
    requiresAuth?: boolean;
    /** Any one of these roles. */
    roles?: readonly Role[];
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
        { path: '', component: () => import('./pages/HomePage.vue') },
        { path: 'signin', component: () => import('./pages/SignInPage.vue') },
        { path: 'register', component: () => import('./membership/RegisterPage.vue') },
        { path: 'account', component: () => import('./pages/AccountPage.vue'), meta: { requiresAuth: true } },
        { path: 'ballot', component: () => import('./pages/BallotPage.vue'), meta: { requiresAuth: true } },
        { path: 'ballot/:id', component: () => import('./pages/VotePage.vue'), meta: { requiresAuth: true } },
        { path: 'verify', component: () => import('./pages/VerifyPage.vue') },
        { path: 'bylaws/:version?', component: () => import('./pages/BylawsPage.vue') },
        { path: 'results/:id', component: () => import('./pages/ResultsPage.vue') },
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

router.beforeEach(async (to) => {
  await sessionReady;
  if ((to.meta.requiresAuth || to.meta.roles) && !session.user) return { path: '/signin', query: { redirect: to.fullPath } };
  // The admin console shows each person their own tools, or says who it is for (it has no roles of its own, so no loop).
  if (to.meta.roles && !hasRole(...to.meta.roles)) return { path: '/admin' };
  return true;
});
