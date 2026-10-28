import { onUnmounted, reactive } from 'vue';
import { ELECTION_CHECK_TIMEOUT_MINUTES, type ElectionCheckView } from 'ustp-domain';
import { announce } from '../a11y.js';
import { errorMessage } from '../api.js';
import { electionCheckState, requestElectionCheck } from './api.js';
import { finishedAnnouncement } from './election-check-text.js';

const POLL_MS = 3_000;

/**
 * The election setup check (design §6.9) in the editor: whether the server offers it, the election's latest check,
 * asking for a new one, and polling while the worker runs it, as the bylaws and consistency checks do. A check someone
 * else started, or one asked for before the page was opened, is followed to its end too.
 */
export function useElectionCheck(electionId: string) {
  const state = reactive({
    /** Null until the server has said. */
    enabled: null as boolean | null,
    check: null as ElectionCheckView | null,
    loading: true,
    requesting: false,
    /** Why loading, asking or polling failed (the check's own failure is `check.error`). */
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

  const running = (check: ElectionCheckView | null) => check?.status === 'queued' || check?.status === 'running';

  /** Reads the latest check again, e.g. after an edit, which can leave it out of date. */
  async function load() {
    stop();
    const mine = generation;
    try {
      const current = await electionCheckState(electionId);
      if (mine !== generation) return;
      state.enabled = current.enabled;
      state.check = current.check;
      if (running(current.check)) poll(mine, Date.now());
    } catch (e) {
      if (mine === generation) state.error = errorMessage(e);
    } finally {
      state.loading = false;
    }
  }

  async function start() {
    stop();
    const mine = generation;
    Object.assign(state, { requesting: true, error: '', gaveUp: false });
    try {
      state.check = await requestElectionCheck(electionId);
      announce('Checking the election against the bylaws. This usually takes a minute or two.');
      poll(mine, Date.now());
    } catch (e) {
      state.error = errorMessage(e);
    } finally {
      state.requesting = false;
    }
  }

  function poll(mine: number, since: number) {
    timer = setTimeout(async () => {
      if (mine !== generation) return;
      try {
        const current = await electionCheckState(electionId);
        if (mine !== generation) return;
        state.enabled = current.enabled;
        state.check = current.check;
        if (!running(current.check)) {
          if (current.check?.status === 'done') announce(finishedAnnouncement(current.check));
          return;
        }
      } catch (e) {
        if (mine !== generation) return;
        state.error = errorMessage(e);
      }
      if (Date.now() - since > (ELECTION_CHECK_TIMEOUT_MINUTES + 2) * 60_000) state.gaveUp = true;
      else poll(mine, since);
    }, POLL_MS);
  }

  onUnmounted(stop);
  return { state, load, start };
}
