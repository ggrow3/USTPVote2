import { createRouter, createWebHistory } from 'vue-router';
import MainLayout from './layouts/MainLayout.vue';

/** The four surfaces from spec §2.1, served by one SPA. */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: MainLayout,
      children: [
        { path: '', component: () => import('./pages/HomePage.vue') },
        { path: 'register', component: () => import('./pages/RegisterPage.vue') },
        { path: 'ballot', component: () => import('./pages/BallotPage.vue') },
        { path: 'verify', component: () => import('./pages/VerifyPage.vue') },
        { path: 'admin', component: () => import('./pages/AdminPage.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
