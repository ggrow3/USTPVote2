import '@quasar/extras/material-icons/material-icons.css';
import 'quasar/src/css/index.sass';
import { Dialog, Notify, Quasar } from 'quasar';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';

createApp(App)
  .use(Quasar, {
    plugins: { Dialog, Notify },
    config: { dark: 'auto', notify: { position: 'top', timeout: 4000 } },
  })
  .use(router)
  .mount('#app');
