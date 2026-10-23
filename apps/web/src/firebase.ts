import { deleteApp, initializeApp, type FirebaseOptions } from 'firebase/app';
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import { connectAuthEmulator, getAuth, initializeRecaptchaConfig, type Auth } from 'firebase/auth';

const env = import.meta.env;
export const usingEmulators = env.VITE_USE_EMULATORS === 'true';

const options: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(options);
export const auth = withEmulator(getAuth(app));

const appCheck: AppCheck | null = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY
  ? initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    })
  : null;
if (!appCheck && !usingEmulators) console.error('App Check is not configured; the API will refuse requests.');

/** Current App Check token, or null when App Check is not configured (emulators only). */
export async function appCheckToken(): Promise<string | null> {
  return appCheck ? (await getToken(appCheck)).token : null;
}

/**
 * A throwaway Auth instance for proving control of a second login method (design §4 portability) without
 * replacing the user's current session. Call `dispose` when done.
 */
export function secondaryAuth(): { auth: Auth; dispose: () => Promise<void> } {
  const linkApp = initializeApp(options, `link-${crypto.randomUUID()}`);
  return { auth: withEmulator(getAuth(linkApp)), dispose: () => deleteApp(linkApp) };
}

/**
 * Points Auth at the emulator, or, in a real project, loads Identity Platform's reCAPTCHA Enterprise settings so that
 * email/password sign-up and sign-in and email links carry a bot-score token (design §4); the emulator has no reCAPTCHA.
 */
function withEmulator(a: Auth): Auth {
  if (usingEmulators) connectAuthEmulator(a, env.VITE_AUTH_EMULATOR_URL ?? 'http://127.0.0.1:9099', { disableWarnings: true });
  else void initializeRecaptchaConfig(a).catch((e: unknown) => console.warn('reCAPTCHA config for sign-in not loaded', e));
  return a;
}
