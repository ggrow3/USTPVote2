import { Inject, Injectable, Logger } from '@nestjs/common';
import { SET_PASSWORD_PATH } from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';

/**
 * Identity Platform's email sign-in links for the welcome email (design §5.13, the owner's decision of 2026-11-13: one
 * email, not two). The worker asks for the link the address would get from the set-password page and puts it in the
 * welcome itself, so opening it proves the address and signs the member in at once. The link opens the set-password
 * page on `WEB_ORIGIN`; it works once and for some hours.
 *
 * It needs `firebaseauth.users.sendEmail` (Terraform's `ustpSignInLinkMaker`, the worker's only). Where the worker
 * cannot get a link, it says why in a code and the welcome goes as before, leading to the page that emails one.
 */
@Injectable()
export class SignInLinks {
  private readonly logger = new Logger(SignInLinks.name);

  constructor(
    private readonly firebase: Firebase,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** The sign-in link for `email`, opening the set-password page; null when Identity Platform would not give one. */
  async forSetPassword(email: string): Promise<string | null> {
    if (!this.config.webOrigin) return null;
    try {
      return await this.firebase.auth.generateSignInWithEmailLink(email, { url: `${this.config.webOrigin}${SET_PASSWORD_PATH}`, handleCodeInApp: true });
    } catch (e) {
      // Never the error's text, which can quote the address.
      const code = (e as { code?: unknown } | null)?.code;
      this.logger.warn(`no sign-in link for a welcome email (${typeof code === 'string' ? code : e instanceof Error ? e.name : 'error'}): it leads to the set-password page instead`);
      return null;
    }
  }
}
