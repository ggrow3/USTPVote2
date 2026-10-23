import { onUnmounted, reactive } from 'vue';
import { BYLAWS_CHECK_TIMEOUT_MINUTES, splitLines, type BylawsCheckView, type RequestBylawsCheckInput } from 'ustp-domain';
import { announce } from './a11y.js';
import { api, errorMessage } from './api.js';

const POLL_MS = 3_000;

/**
 * The advisory bylaws check of a draft (design §5.2): asks the api for a check, then polls it while the worker runs it.
 * Keeps the lines as they were sent, so highlights can follow the draft as it is edited.
 */
export function useBylawsCheck() {
  const state = reactive({
    check: null as BylawsCheckView | null,
    /** The draft's lines when it was sent for checking. */
    checkedLines: [] as string[],
    requesting: false,
    /** Why the request or the polling failed (the check's own failure is `check.error`). */
    error: '',
    /** Waiting longer than a check should take. */
    gaveUp: false,
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    generation++;
  }

  function reset() {
    stop();
    Object.assign(state, { check: null, checkedLines: [], requesting: false, error: '', gaveUp: false });
  }

  async function start(input: RequestBylawsCheckInput) {
    reset();
    const mine = generation;
    state.requesting = true;
    const lines = splitLines(input.text);
    try {
      state.check = await api<BylawsCheckView>('POST', '/v1/admin/bylaws/checks', input);
      state.checkedLines = lines;
      announce('Checking the draft. This usually takes a minute or two.');
      poll(mine, Date.now());
    } catch (e) {
      state.error = errorMessage(e);
    } finally {
      state.requesting = false;
    }
  }

  function poll(mine: number, since: number) {
    timer = setTimeout(async () => {
      if (mine !== generation || !state.check) return;
      try {
        const check = await api<BylawsCheckView>('GET', `/v1/admin/bylaws/checks/${state.check.checkId}`);
        if (mine !== generation) return;
        state.check = check;
        if (check.status === 'done') {
          const n = check.findings.length;
          announce(n ? `Check finished: ${n} ${n === 1 ? 'finding' : 'findings'}.` : 'Check finished: no conflicts found.');
          return;
        }
        if (check.status === 'failed') {
          announce('The check failed.', 'assertive');
          return;
        }
      } catch (e) {
        if (mine !== generation) return;
        state.error = errorMessage(e);
      }
      if (Date.now() - since > (BYLAWS_CHECK_TIMEOUT_MINUTES + 2) * 60_000) state.gaveUp = true;
      else poll(mine, since);
    }, POLL_MS);
  }

  onUnmounted(stop);
  return { state, start, reset };
}
