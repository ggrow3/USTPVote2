import { ref } from 'vue';
import { mapsConfig } from './api.js';

/**
 * Google Maps for the Candidates pages (design §5.8), loaded once, on the first page that shows a map, with the browser
 * key the api gives. Pages work without it: where no key is set, or the script cannot load, they show their lists only.
 */

declare global {
  interface Window {
    __ustpMapsReady?: () => void;
    /** Google calls this when the key is refused (wrong referrer, API not enabled). */
    gm_authFailure?: () => void;
  }
}

/** Set when Google refused the key after loading; maps already drawn turn grey, so pages say why. */
export const mapsRefused = ref(false);

let loading: Promise<typeof google.maps | null> | null = null;

function injectScript(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    window.__ustpMapsReady = () => resolve();
    window.gm_authFailure = () => (mapsRefused.value = true);
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key, v: 'weekly', loading: 'async', callback: '__ustpMapsReady' })}`;
    script.async = true;
    script.onerror = () => reject(new Error('Google Maps did not load'));
    document.head.append(script);
  });
}

/** The Maps library, or null where the map is not set up or did not load (a later call tries again). */
export function loadGoogleMaps(): Promise<typeof google.maps | null> {
  loading ??= (async () => {
    const { googleMapsKey } = await mapsConfig();
    if (!googleMapsKey) return null;
    if (typeof google === 'undefined' || !google.maps?.importLibrary) await injectScript(googleMapsKey);
    // `core` has the bounds and symbols, `maps` the map, its data layer and pop-ups.
    await Promise.all([google.maps.importLibrary('core'), google.maps.importLibrary('maps')]);
    return google.maps;
  })().catch(() => {
    loading = null;
    return null;
  });
  return loading;
}
