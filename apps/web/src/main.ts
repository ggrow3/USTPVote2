import '@quasar/extras/material-icons/material-icons.css';
import 'quasar/src/css/index.sass';
import './app.css';
import './layout.css';
import { Dialog, Notify, Quasar } from 'quasar';
import { createApp } from 'vue';
import App from './App.vue';
import { setUpPwa } from './pwa.js';
import { router } from './router.js';
import { restoreTheme } from './theme.js';

const app = createApp(App).use(Quasar, {
    plugins: { Dialog, Notify },
    config: {
      dark: 'auto',
      // The colours of transhumanist-party.org (its theme's colour-scheme CSS): primary is its header and link colour,
      // accent its hover and button colour. app.css builds the focus ring, links and dark-theme text on these;
      // docs/ACCESSIBILITY.md has the contrast figures, so recheck them when changing either.
      // Quasar's default green (#21ba45) has 2.6:1 contrast with white text; this one has 5.1:1.
      brand: { primary: '#bd4e00', accent: '#ff6900', positive: '#2e7d32' },
      notify: { position: 'top', timeout: 4000 },
    },
  });
// Before the first render, so a theme picked on the hub does not flash the other one.
restoreTheme();
app.use(router).mount('#app');

setUpPwa();
