import { firstStepsProgress, type FirstStepItem } from 'ustp-domain';

/** "2 of 5 done. Each is ticked once you have done it." — how the steps on the list get ticked (design §5.16). */
export function firstStepsCaption(items: readonly FirstStepItem[]): string {
  const own = items.filter((i) => i.check === 'self').length;
  const how =
    own === 0
      ? 'Each is ticked once you have done it.'
      : own === items.length
        ? 'Tick each box once you have done that step.'
        : 'Tick a box yourself once you have done that step; the others are ticked once you have done them.';
  return `${firstStepsProgress(items)}. ${how}`;
}

/** A new step's id: unlikely to be taken, and checked by the API all the same. */
export function newFirstStepId(taken: readonly string[]): string {
  for (;;) {
    const id = `step-${Math.random().toString(36).slice(2, 10)}`;
    if (!taken.includes(id)) return id;
  }
}
