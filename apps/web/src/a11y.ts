import { nextTick, onUnmounted, reactive, readonly, toValue, watchEffect, type MaybeRefOrGetter } from 'vue';
import { APP_NAME } from './app-name.js';

/** Accessibility helpers shared by the pages (docs/ACCESSIBILITY.md). */

/** The document title for the current page (WCAG 2.4.2), e.g. "Your ballots · USTP Vote" (APP_NAME). */
export function usePageTitle(title: MaybeRefOrGetter<string>): void {
  const page = {};
  watchEffect(() => {
    titleOwner = page;
    document.title = `${toValue(title)} · ${APP_NAME}`;
  });
  // Unmount hooks run after the next page has set up, so only reset a title that no other page has set since.
  onUnmounted(() => {
    if (titleOwner === page) document.title = APP_NAME;
  });
}
let titleOwner: object | null = null;

const live = reactive({ polite: '', assertive: '' });
/** The text of the layout's two live regions. */
export const liveRegions = readonly(live);

/**
 * Has screen readers speak a message (WCAG 4.1.3) through the live regions in MainLayout, which are always in the
 * page, so messages are announced reliably, and repeated ones too. Use `assertive` for errors only.
 */
export function announce(message: string, politeness: 'polite' | 'assertive' = 'polite'): void {
  live[politeness] = '';
  setTimeout(() => (live[politeness] = message), 100);
}

/**
 * Moves keyboard focus to an element, making a non-interactive one (a heading, a result) focusable by script only.
 * Use it when the control that had focus goes away, or when a new view replaces the old one.
 */
export function focusElement(el: Element | null | undefined): void {
  if (!(el instanceof HTMLElement)) return;
  if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) {
    el.setAttribute('tabindex', '-1');
    el.classList.add('ustp-focus-target');
  }
  el.focus();
}

/** `focusElement` for a selector, once Vue has rendered the current change. */
export async function focusSoon(selector: string): Promise<void> {
  await nextTick();
  focusElement(document.querySelector(selector));
}

/** After a form fails validation: focus the first field Quasar marked invalid, so its message is read out. */
export function focusFirstInvalid(root: ParentNode = document): Promise<void> {
  return nextTick(() => {
    const field = root.querySelector<HTMLElement>('[aria-invalid="true"]');
    field?.focus();
  });
}
