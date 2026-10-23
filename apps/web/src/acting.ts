import { reactive } from 'vue';

/**
 * Testing mode (design §10.4): the test persona this tab acts as, if any. It lives in sessionStorage, so a reload keeps
 * it and each tab can be a different persona (the Election Admin in one, the Auditor in another).
 */
export interface ActingAs {
  readonly accountId: string;
  readonly label: string;
}

const KEY = 'ustp-acting-as';

function stored(): ActingAs | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    const persona = value as Partial<ActingAs> | null;
    return typeof persona?.accountId === 'string' && typeof persona.label === 'string'
      ? { accountId: persona.accountId, label: persona.label }
      : null;
  } catch {
    return null; // storage blocked or unreadable
  }
}

export const acting = reactive<{ persona: ActingAs | null }>({ persona: stored() });

/** Only the session calls this, so the account it shows always matches. */
export function setActing(persona: ActingAs | null): void {
  acting.persona = persona;
  try {
    if (persona) sessionStorage.setItem(KEY, JSON.stringify(persona));
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: acting lasts until the page is reloaded
  }
}
