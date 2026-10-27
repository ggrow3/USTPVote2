import { computed, reactive, readonly } from 'vue';
import {
  DEFAULT_NAVIGATION,
  membershipAudience,
  shownTo,
  startPageFor,
  startPagePath,
  type NavigationSettings,
  type PublicNavigation,
  type Viewer,
} from 'ustp-domain';
import { session } from '../session.js';
import { navigation } from './api.js';

/**
 * Who sees which link (design §10.5): the settings this web app follows, and what they show the person signed in. The
 * defaults apply until the settings arrive, and stay if they cannot be loaded; they are the menu as it was before.
 */
const state = reactive<{ settings: NavigationSettings; version: number; loaded: boolean }>({
  settings: DEFAULT_NAVIGATION,
  version: 0,
  loaded: false,
});
export const navigationState = readonly(state);

/** Puts settings in force in this tab: on loading, and when a System Admin saves them here. */
export function applyNavigation({ version, menu, sections, startsOn }: PublicNavigation): void {
  Object.assign(state, { version, settings: { menu, sections, startsOn } });
}

/** Resolves once the settings have loaded, or failed to. */
export const navigationReady: Promise<void> = navigation()
  .then(applyNavigation, () => undefined)
  .finally(() => (state.loaded = true));

/** The person looking: signed out, or their membership state (or a test persona's) and roles. */
export const viewer = computed<Viewer>(() => ({
  membership: membershipAudience(!!session.user, session.me?.member?.status),
  roles: session.me?.roles ?? [],
}));

/** The menu links and admin sections the settings give them. */
export const shown = computed(() => shownTo(state.settings, viewer.value));

/** The path they start on after signing in. */
export function startPath(): string {
  return startPagePath(startPageFor(state.settings, viewer.value));
}
