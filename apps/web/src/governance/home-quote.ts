import { reactive, readonly } from 'vue';
import type { PublicHomeQuote } from 'ustp-domain';
import { homeQuote } from './api.js';

/**
 * The quote on the home page (design §10.5), loaded the first time a tab opens the home page and kept for the tab's
 * life. Until it arrives, and if it cannot be loaded, there is no quote: a quote the party switched off never shows.
 */
const state = reactive<{ quote: PublicHomeQuote | null; loaded: boolean }>({ quote: null, loaded: false });
export const homeQuoteState = readonly(state);

let loading: Promise<void> | null = null;

/** Resolves once the quote has loaded, or failed to; the router waits for it before showing the home page. */
export function homeQuoteReady(): Promise<void> {
  loading ??= homeQuote()
    .then(applyHomeQuote, () => undefined)
    .finally(() => (state.loaded = true));
  return loading;
}

/** Puts a quote in force in this tab: on loading, and when a System Admin saves it here. */
export function applyHomeQuote({ version, shown, text, attribution, source }: PublicHomeQuote): void {
  state.quote = { version, shown, text, attribution, source };
}
