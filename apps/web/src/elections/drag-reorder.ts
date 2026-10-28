import { onBeforeUnmount, reactive } from 'vue';

/**
 * Reordering a list by dragging its handles, with a mouse, pen or finger (design §6.5). Dragging is a pointer
 * convenience: every move it makes is also a button and a key (WCAG 2.5.7), so the handles are hidden from screen
 * readers and out of the tab order.
 */

/** Where the dragged item lands: one place for each other item whose middle is above the dragged item's middle. */
export function dropIndex(middles: readonly number[], from: number, middle: number): number {
  return middles.reduce((n, m, i) => (i !== from && middle > m ? n + 1 : n), 0);
}

/** How far an item moves to make room while item `from` is held over place `to`. */
export function shiftFor(index: number, from: number, to: number, size: number): number {
  if (index === from) return 0;
  if (from < to && index > from && index <= to) return -size;
  if (to < from && index >= to && index < from) return size;
  return 0;
}

const EDGE = 48;

export function useDragReorder(options: {
  /** The list's items, in order. */
  readonly items: () => readonly HTMLElement[];
  readonly onMove: (from: number, to: number) => void;
}) {
  const state = reactive({ from: -1, to: -1, offset: 0, size: 0 });
  let middles: number[] = [];
  let startY = 0;
  let startScroll = 0;
  let lastY = 0;
  let frame = 0;

  function update() {
    state.offset = lastY + window.scrollY - (startY + startScroll);
    state.to = dropIndex(middles, state.from, middles[state.from]! + state.offset);
  }

  /** Scrolls while the pointer is held near the top or bottom of the window. */
  function scrollNearEdges() {
    const by = lastY < EDGE ? -12 : lastY > window.innerHeight - EDGE ? 12 : 0;
    if (by) {
      window.scrollBy(0, by);
      update();
    }
    frame = requestAnimationFrame(scrollNearEdges);
  }

  function start(event: PointerEvent, index: number) {
    if (event.button !== 0 || state.from >= 0) return;
    const items = options.items();
    const rects = items.map((el) => el.getBoundingClientRect());
    if (!rects[index]) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    middles = rects.map((r) => r.top + window.scrollY + r.height / 2);
    // Room for the held item: its height and the gap after it.
    const next = rects[index + 1] ?? rects[index - 1];
    const gap = next ? Math.max(0, index + 1 < rects.length ? next.top - rects[index]!.bottom : rects[index]!.top - next.bottom) : 0;
    Object.assign(state, { from: index, to: index, offset: 0, size: rects[index]!.height + gap });
    startY = lastY = event.clientY;
    startScroll = window.scrollY;
    frame = requestAnimationFrame(scrollNearEdges);
  }

  function move(event: PointerEvent) {
    if (state.from < 0) return;
    lastY = event.clientY;
    update();
  }

  function end(event: PointerEvent, cancelled = false) {
    if (state.from < 0) return;
    cancelAnimationFrame(frame);
    const { from, to } = state;
    Object.assign(state, { from: -1, to: -1, offset: 0, size: 0 });
    (event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId);
    if (!cancelled && to !== from) options.onMove(from, to);
  }

  onBeforeUnmount(() => cancelAnimationFrame(frame));

  /** The style of item `index`: the held one follows the pointer, the others make room. */
  function itemStyle(index: number): Record<string, string> {
    if (state.from < 0) return {};
    if (index === state.from) return { transform: `translateY(${state.offset}px)`, zIndex: '2', position: 'relative' };
    return { transform: `translateY(${shiftFor(index, state.from, state.to, state.size)}px)`, transition: 'transform 150ms ease' };
  }

  /** Listeners for a handle, for `v-on`. */
  const handle = (index: number): Record<string, (e: PointerEvent) => void> => ({
    pointerdown: (e) => start(e, index),
    pointermove: move,
    pointerup: (e) => end(e),
    pointercancel: (e) => end(e, true),
  });

  return { state, itemStyle, handle };
}
