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

const ADMIN_ROLES: readonly Role[] = ['membership_admin', 'election_admin', 'auditor', 'system_admin'];

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
        { path: 'register', component: () => import('./pages/RegisterPage.vue') },
        { path: 'account', component: () => import('./pages/AccountPage.vue'), meta: { requiresAuth: true } },
        { path: 'ballot', component: () => import('./pages/BallotPage.vue'), meta: { requiresAuth: true } },
        { path: 'ballot/:id', component: () => import('./pages/VotePage.vue'), meta: { requiresAuth: true } },
        { path: 'verify', component: () => import('./pages/VerifyPage.vue') },
        { path: 'results/:id', component: () => import('./pages/ResultsPage.vue') },
        {
          path: 'admin',
          component: () => import('./pages/AdminPage.vue'),
          meta: { requiresAuth: true, roles: ADMIN_ROLES },
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
  if (to.meta.roles && !hasRole(...to.meta.roles)) return { path: '/' };
  return true;
});
