import { quasar, transformAssetUrls } from '@quasar/vite-plugin';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue({ template: { transformAssetUrls } }), quasar()],
  server: {
    // Local API (npm run dev:api) during development; Firebase Hosting rewrites in deployed environments.
    proxy: { '/v1': 'http://localhost:8080' },
  },
});
