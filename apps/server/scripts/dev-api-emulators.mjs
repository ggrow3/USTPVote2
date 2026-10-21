// Runs the compiled API against the local Firebase emulators (`npm run emulators -w apps/server`).
// Anything already set in the environment wins over these defaults. `--require-mfa` keeps the production admin
// MFA policy on; the Auth emulator then only offers SMS second factors (it does not support TOTP).
const defaults = {
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  GCLOUD_PROJECT: 'demo-ustpvote',
  APP_CHECK_ENFORCED: 'false',
  ADMIN_MFA_REQUIRED: process.argv.includes('--require-mfa') ? 'true' : 'false',
  BOOTSTRAP_SYSTEM_ADMIN_EMAILS: 'admin1@example.test,admin2@example.test',
};
for (const [key, value] of Object.entries(defaults)) process.env[key] ??= value;

await import('../dist/main-api.js');
