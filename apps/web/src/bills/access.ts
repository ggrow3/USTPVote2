import { reactive, readonly, watch } from 'vue';
import { administersSite, type BillsAccess } from 'ustp-domain';
import { session } from '../session.js';
import { billsAccess } from './api.js';

/**
 * Whether the person signed in has the legislative team's Bills tool (design §5.14). Being on a team the Bills setting
 * names is not a column of the navigation settings, so the menu asks the api and shows the Bills link only to people
 * who have the tool. Asked again whenever the account or the persona acted as changes.
 */
const state = reactive<{ access: BillsAccess | null; loadedFor: string | null }>({ access: null, loadedFor: null });
export const billsState = readonly(state);

/** Who the answer is for: the account, or the persona a System Admin acts as. */
const whoKey = () => (session.me?.account ? `${session.me.account.accountId}:${(session.me.roles ?? []).join(',')}:${session.me.member?.status ?? ''}` : null);

async function load(key: string | null): Promise<void> {
  if (!key) {
    Object.assign(state, { access: null, loadedFor: null });
    return;
  }
  // Only Active members and System and Site Admins can have it; nobody else is asked.
  const maybe = session.me?.member?.status === 'active' || administersSite(session.me?.roles ?? []);
  if (!maybe) {
    Object.assign(state, { access: null, loadedFor: key });
    return;
  }
  try {
    const access = await billsAccess();
    if (whoKey() === key) Object.assign(state, { access, loadedFor: key });
  } catch {
    if (whoKey() === key) Object.assign(state, { access: null, loadedFor: key });
  }
}

watch(whoKey, (key) => void load(key), { immediate: true });

/** Asks again, after a System Admin changes who has the tool. */
export function refreshBillsAccess(): Promise<void> {
  return load(whoKey());
}
