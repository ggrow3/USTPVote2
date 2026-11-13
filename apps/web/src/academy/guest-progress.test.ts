import { describe, expect, it } from 'vitest';
import { allGuestProgress, claimOf, forgetGuestProgress, keepGuestPass, readGuestProgress } from './guest-progress.js';

/** A Storage held in memory, as localStorage behaves. */
function memoryStore(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    key: (i: number) => [...items.keys()][i] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, String(value)),
    removeItem: (key: string) => void items.delete(key),
    items,
  };
}

const intro = { courseId: 'transhumanism', title: 'Transhumanism', version: 1 };

describe('a guest’s progress in this browser', () => {
  it('keeps each lesson passed, with its answers, for the version the page shows', () => {
    const store = memoryStore();
    expect(keepGuestPass(intro, 'foundations', { answers: [1, 0, 2], score: 100 }, store)).toBe(true);
    expect(keepGuestPass(intro, 'longevity', { answers: [3], score: 80 }, store)).toBe(true);
    expect(readGuestProgress('transhumanism', store)).toEqual({
      ...intro,
      passed: { foundations: { answers: [1, 0, 2], score: 100 }, longevity: { answers: [3], score: 80 } },
    });
    expect(claimOf(readGuestProgress('transhumanism', store)!)).toEqual({
      version: 1,
      lessons: [
        { lessonId: 'foundations', answers: [1, 0, 2] },
        { lessonId: 'longevity', answers: [3] },
      ],
    });
  });

  it('starts again when the course has a new version, since only that one can be claimed', () => {
    const store = memoryStore();
    keepGuestPass(intro, 'foundations', { answers: [1], score: 100 }, store);
    keepGuestPass({ ...intro, version: 2 }, 'ethics', { answers: [0], score: 100 }, store);
    expect(readGuestProgress('transhumanism', store)).toEqual({ ...intro, version: 2, passed: { ethics: { answers: [0], score: 100 } } });
  });

  it('lists every course with a lesson passed, and forgets one once claimed', () => {
    const store = memoryStore({ 'ustp.other': 'x', 'ustp.course-guest.broken': '{nope' });
    keepGuestPass(intro, 'foundations', { answers: [1], score: 100 }, store);
    keepGuestPass({ courseId: 'fundamental-questions', title: 'The Fundamental Questions', version: 3 }, 'basics-101', { answers: [2], score: 80 }, store);
    expect(allGuestProgress(store).map((p) => p.courseId).sort()).toEqual(['fundamental-questions', 'transhumanism']);
    forgetGuestProgress('transhumanism', store);
    expect(allGuestProgress(store).map((p) => p.courseId)).toEqual(['fundamental-questions']);
    expect(store.items.get('ustp.other')).toBe('x');
  });

  it('reads an entry edited by hand, or for another course, as nothing, and drops lessons that are not answers', () => {
    const entry = (value: unknown) => memoryStore({ 'ustp.course-guest.transhumanism': JSON.stringify(value) });
    expect(readGuestProgress('transhumanism', entry({ ...intro, courseId: 'other', passed: {} }))).toBeNull();
    expect(readGuestProgress('transhumanism', entry({ ...intro, version: 'one', passed: {} }))).toBeNull();
    expect(readGuestProgress('transhumanism', entry({ ...intro, passed: { a: { answers: [-1], score: 1 }, b: { answers: [], score: 1 }, c: { answers: [0], score: 90 } } }))).toEqual({
      ...intro,
      passed: { c: { answers: [0], score: 90 } },
    });
  });

  it('keeps nothing where the browser keeps nothing, and never throws', () => {
    expect(keepGuestPass(intro, 'foundations', { answers: [1], score: 100 }, null)).toBe(false);
    expect(readGuestProgress('transhumanism', null)).toBeNull();
    expect(allGuestProgress(null)).toEqual([]);
    const full = { ...memoryStore(), setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(keepGuestPass(intro, 'foundations', { answers: [1], score: 100 }, full)).toBe(false);
  });
});
