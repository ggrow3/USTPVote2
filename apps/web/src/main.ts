import '@quasar/extras/material-icons/material-icons.css';
import 'quasar/src/css/index.sass';
import './app.css';
import { Dialog, Notify, Quasar } from 'quasar';
import { createApp } from 'vue';
import App from './App.vue';
import { setUpPwa } from './pwa.js';
import { router } from './router.js';

createApp(App)
  .use(Quasar, {
    plugins: { Dialog, Notify },
    config: {
      dark: 'auto',
      // Quasar's default green (#21ba45) has 2.6:1 contrast with white text; this one has 5.1:1.
      brand: { positive: '#2e7d32' },
      notify: { position: 'top', timeout: 4000 },
    },
  })
  .use(router)
  .mount('#app');

setUpPwa();
