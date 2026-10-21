<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-toolbar-title>
          <router-link to="/" class="text-white" style="text-decoration: none">USTP Vote</router-link>
        </q-toolbar-title>
      </q-toolbar>
      <q-tabs align="left" dense>
        <q-route-tab to="/register" label="Register" />
        <q-route-tab to="/ballot" label="Ballot" />
        <q-route-tab to="/verify" label="Verify" />
        <q-route-tab to="/admin" label="Admin" />
      </q-tabs>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>
