import type { InjectionKey, Ref } from 'vue';
import type { AccountSummary } from 'ustp-domain';

/**
 * How the People tab hands someone to the role-change form in the Approvals tab. AdminPage provides it; the
 * Approvals panel watches `target`, which is a new object on every choice, so choosing the same person again counts.
 */
export interface RoleChangeHandoff {
  readonly target: Readonly<Ref<{ readonly account: AccountSummary } | null>>;
  choose(account: AccountSummary): void;
}

export const ROLE_CHANGE: InjectionKey<RoleChangeHandoff> = Symbol('role-change');
