// Runs the compiled worker against the local Firebase emulators (`npm run emulators -w apps/server`) and calls
// /tasks/tick on a timer, standing in for Cloud Scheduler. Anything already set in the environment wins over these
// defaults; DEV_TICK_SECONDS sets the interval (Cloud Scheduler ticks once a minute).
const defaults = {
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  GCLOUD_PROJECT: 'demo-ustpvote',
  PORT: '8081',
  DEV_TICK_SECONDS: '15',
};
for (const [key, value] of Object.entries(defaults)) process.env[key] ??= value;

await import('../dist/main-worker.js');

const idle = JSON.stringify({ blocksSealed: 0, rollsSigned: 0, anchored: 0 });
setInterval(async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${process.env.PORT}/tasks/tick`, { method: 'POST' });
    const body = await res.text();
    if (!res.ok || body !== idle) console.log(`tick ${res.status} ${body}`);
  } catch (e) {
    console.error(`tick failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}, Number(process.env.DEV_TICK_SECONDS) * 1000);
