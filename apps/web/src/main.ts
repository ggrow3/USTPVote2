import '@quasar/extras/material-icons/material-icons.css';
import 'quasar/src/css/index.sass';
import { Quasar } from 'quasar';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';

createApp(App).use(Quasar, {}).use(router).mount('#app');
