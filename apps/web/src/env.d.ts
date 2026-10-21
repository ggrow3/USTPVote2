/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  /** App Check provider key. Leave empty only with the emulators (the API then runs without App Check). */
  readonly VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?: string;
  /** "true" to use the local Auth emulator. */
  readonly VITE_USE_EMULATORS?: string;
  readonly VITE_AUTH_EMULATOR_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
