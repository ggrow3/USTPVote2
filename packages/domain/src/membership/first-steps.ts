import type { MenuLink } from '../governance/navigation.js';
import { FIRST_STEPS, type FirstStep } from './join-funnel.js';

/**
 * A new member's first steps (design §5.16): a short list on the voting home of things to do, each ticked from a record
 * that says they did it, the same records the join funnel counts (§5.15). It is there until every step shown is done
 * or the member hides it.
 */

/** `GET /v1/me/first-steps` */
export interface FirstStepsView {
  /** When they first became a member; null for someone who is not an Active member, who has no list. */
  readonly memberSince: string | null;
  readonly done: readonly FirstStep[];
}

interface StepGuide {
  /** The menu link the step needs: a step whose page the navigation settings hide from the member is left out. */
  readonly menu: MenuLink;
  readonly to: string;
  readonly label: string;
  readonly why: string;
}

export const FIRST_STEP_GUIDE: Readonly<Record<FirstStep, StepGuide>> = {
  course: { menu: 'course', to: '/courses', label: 'Take a first course', why: 'Short lessons on what the party stands for, with a quiz after each.' },
  team: { menu: 'teams', to: '/teams', label: 'Join a team', why: 'Teams are where the party’s work is done: pick one that fits what you want to do.' },
  room: { menu: 'room', to: '/room', label: 'Say hello in the members’ room', why: 'A chat room for members, with an assistant you can ask about the party.' },
  posted: { menu: 'forum', to: '/forum', label: 'Post or comment in the forum', why: 'Where members raise ideas and discuss them at more length.' },
  voted: { menu: 'ballot', to: '/ballot', label: 'Cast your first ballot', why: 'Your ballots are listed there whenever a vote is open to you.' },
};

/** The order the list shows them in: what can be done today first, voting last, since a vote may not be open. */
export const FIRST_STEP_ORDER: readonly FirstStep[] = ['course', 'team', 'room', 'posted', 'voted'];

export interface FirstStepItem extends StepGuide {
  readonly step: FirstStep;
  readonly done: boolean;
}

/** The member's list: the steps whose pages their menu has, in order, each done or not. Empty for a non-member. */
export function firstStepsList(view: FirstStepsView, menu: readonly MenuLink[]): FirstStepItem[] {
  if (!view.memberSince) return [];
  return FIRST_STEP_ORDER.filter((step) => FIRST_STEPS.includes(step) && menu.includes(FIRST_STEP_GUIDE[step].menu)).map((step) => ({
    step,
    ...FIRST_STEP_GUIDE[step],
    done: view.done.includes(step),
  }));
}

/** "2 of 5 done". */
export function firstStepsProgress(items: readonly FirstStepItem[]): string {
  return `${items.filter((i) => i.done).length} of ${items.length} done`;
}

/** The list is worth showing while something on it is left to do. */
export function firstStepsLeft(items: readonly FirstStepItem[]): boolean {
  return items.some((i) => !i.done);
}
