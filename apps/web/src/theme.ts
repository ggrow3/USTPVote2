import { Dark } from 'quasar';
import type { HubTheme } from 'ustp-domain';

/**
 * Light or dark theme (design §10.6): the default System Admins choose for the hub (dark, light or the device's
 * setting) until someone picks one with the toggle, then their pick, kept in this browser. Quasar's dark mode is
 * page-wide, so both apply to the whole app.
 */
const KEY = 'ustp-theme';

/**
 * Tells the browser which theme is in force, so its canvas, scrollbars and default text match the app's: the page
 * declares both (index.html), and a device in dark mode would otherwise draw the light theme on a dark canvas.
 */
function setTheme(dark: boolean | 'auto'): void {
  Dark.set(dark);
  document.documentElement.style.colorScheme = dark === 'auto' ? '' : dark ? 'dark' : 'light';
}

function stored(): 'light' | 'dark' | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null; // storage blocked: the default applies
  }
}

/** Applies a pick made earlier in this browser; called once at start-up, before the first render. */
export function restoreTheme(): void {
  const pick = stored();
  if (pick) setTheme(pick === 'dark');
}

/** The hub's default, for someone who has not picked a theme here. */
export function applyDefaultTheme(theme: HubTheme): void {
  if (stored()) return;
  setTheme(theme === 'device' ? 'auto' : theme === 'dark');
}

/** Switches to the other theme and remembers it. */
export function toggleTheme(): void {
  const dark = !Dark.isActive;
  setTheme(dark);
  try {
    localStorage.setItem(KEY, dark ? 'dark' : 'light');
  } catch {
    // storage blocked: the pick lasts until the page is reloaded
  }
}
