import type { Auth } from 'firebase/auth';

/**
 * The page Identity Platform's account emails link to (design §4). Its action URL is one setting for every email
 * template, so the page reads each link's `mode`: a password reset is handled here, where the new password gets the
 * same checks as at sign-up; any other link (confirming an address, an email sign-in link, undoing an email change)
 * goes on, query and all, to Identity Platform's own page, which handled every link before the action URL pointed here.
 */
export type EmailAction =
  /** A password-reset link: choose the new password here. */
  | { readonly kind: 'reset-password'; readonly oobCode: string }
  /** Any other link, for Identity Platform's own page at `url`. */
  | { readonly kind: 'elsewhere'; readonly url: string }
  /** No mode or code: a link copied in part, or the page opened by hand. */
  | { readonly kind: 'incomplete' };

/** What to do with the link opened at `href`; `handler` is Identity Platform's own action page. */
export function emailAction(href: string, handler: string): EmailAction {
  const url = new URL(href);
  const mode = url.searchParams.get('mode');
  const oobCode = url.searchParams.get('oobCode');
  if (!mode || !oobCode) return { kind: 'incomplete' };
  if (mode === 'resetPassword') return { kind: 'reset-password', oobCode };
  return { kind: 'elsewhere', url: `${handler}${url.search}` };
}

/** Identity Platform's own action page: the Auth emulator's, or the one on the project's auth domain. */
export function identityPlatformActionPage(auth: Pick<Auth, 'config' | 'emulatorConfig'>): string {
  const emulator = auth.emulatorConfig;
  if (!emulator) return `https://${auth.config.authDomain}/__/auth/action`;
  return `${emulator.protocol}://${emulator.host}${emulator.port === null ? '' : `:${emulator.port}`}/emulator/action`;
}
