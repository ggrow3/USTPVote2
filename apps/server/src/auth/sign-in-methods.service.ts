import { Injectable } from '@nestjs/common';
import { Collections, isSignInProvider, SIGN_IN_PROVIDERS, type SignInMethodRecord, type SignInProvider } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

const CACHE_MS = 60_000;

/** The admin "auth switches" (design §4). Cached briefly because every authenticated request consults them. */
@Injectable()
export class SignInMethodsService {
  private cache: { at: number; enabled: Readonly<Record<SignInProvider, boolean>> } | null = null;

  constructor(private readonly firebase: Firebase) {}

  /** Providers outside SIGN_IN_PROVIDERS (custom tokens, anonymous, phone) are never accepted. */
  async isEnabled(provider: string): Promise<boolean> {
    return isSignInProvider(provider) && (await this.current())[provider];
  }

  async current(): Promise<Readonly<Record<SignInProvider, boolean>>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.enabled;
    const snap = await this.firebase.db.collection(Collections.signInMethods).get();
    const enabled = Object.fromEntries(SIGN_IN_PROVIDERS.map((p) => [p, true])) as Record<SignInProvider, boolean>;
    for (const doc of snap.docs) {
      const record = doc.data() as SignInMethodRecord;
      if (isSignInProvider(record.provider)) enabled[record.provider] = record.enabled;
    }
    this.cache = { at: Date.now(), enabled };
    return enabled;
  }

  invalidate(): void {
    this.cache = null;
  }
}
