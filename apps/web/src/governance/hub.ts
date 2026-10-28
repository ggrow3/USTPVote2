import { reactive, readonly } from 'vue';
import { DEFAULT_HUB, publicHub, type Hub, type PublicHub } from 'ustp-domain';
import { applyDefaultTheme } from '../theme.js';
import { hub } from './api.js';

/**
 * The home page hub (design §10.6), loaded when a tab opens the app, since its default theme applies to every page, and
 * kept for the tab's life. If it cannot be loaded, the party's name and its pages in this app stand in: never the
 * default's outside addresses, which System Admins may have taken down since.
 */
export const FALLBACK_HUB: PublicHub = (() => {
  const shown = publicHub(DEFAULT_HUB, 0);
  return {
    ...shown,
    icons: [],
    sections: shown.sections
      .map((s) => ({ ...s, links: s.links.filter((l) => l.url.startsWith('/')) }))
      .filter((s) => s.links.length > 0),
  };
})();

const state = reactive<{ hub: PublicHub | null; loaded: boolean }>({ hub: null, loaded: false });
export const hubState = readonly(state);

function apply(shown: PublicHub): void {
  state.hub = shown;
  applyDefaultTheme(shown.profile.theme);
}

let loading: Promise<void> | null = null;

/** Resolves once the hub has loaded, or failed to; the router waits for it before the first page. */
export function hubReady(): Promise<void> {
  loading ??= hub()
    .then(apply, () => apply(FALLBACK_HUB))
    .finally(() => (state.loaded = true));
  return loading;
}

/** Puts a saved hub in force in this tab, when a System Admin saves it here. */
export function applyHub(saved: Hub & { readonly version: number }): void {
  apply(publicHub(saved, saved.version));
}
