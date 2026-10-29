import type { Router } from 'vue-router';
import { analyticsAllowed, MEASUREMENT_ID_PATTERN } from 'ustp-domain';
import { publicSiteAnalytics } from './security/api.js';
import { pageView } from './security/sign-ins.js';

/**
 * Google Analytics 4 on the public pages (design §10.7), only once a System Admin has set a measurement ID. It is
 * loaded on the first page it may see, never on the ballot, receipts, sign-in, account or admin pages, and each page
 * view sends the path alone: no query string, nobody's identity, no Google signals or ad personalization. Browsers
 * that send Global Privacy Control get none of it.
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
}

let loaded: string | null = null;

function load(measurementId: string): void {
  if (loaded) return;
  loaded = measurementId;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // gtag.js reads the arguments object itself, as Google's snippet pushes it; an array is ignored.
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
}

export function startAnalytics(router: Router): void {
  if (navigator.globalPrivacyControl) return;
  let measurementId: string | null = null;
  const ready = publicSiteAnalytics()
    .then((s) => {
      measurementId = s.measurementId && MEASUREMENT_ID_PATTERN.test(s.measurementId) ? s.measurementId : null;
    })
    .catch(() => undefined);
  router.afterEach(async (to) => {
    await ready;
    if (!measurementId || !analyticsAllowed(to.path)) return;
    load(measurementId);
    // After the page's title is set (usePageTitle runs as the page mounts).
    setTimeout(() => window.gtag?.('event', 'page_view', pageView(to.path, window.location.origin, document.title)));
  });
}
