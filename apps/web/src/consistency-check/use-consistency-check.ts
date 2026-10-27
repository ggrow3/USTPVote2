import { onUnmounted, reactive } from 'vue';
import {
  CONSISTENCY_CHECK_TIMEOUT_MINUTES,
  type ConsistencyCheckResult,
  type ConsistencyCheckView,
  type ConsistencyDocument,
} from 'ustp-domain';
import { announce } from '../a11y.js';
import { errorMessage } from '../api.js';
import { chooseConsistencyDocuments, consistencyCheckState, requestConsistencyCheck } from './api.js';
import { documentsAnnouncement, finishedAnnouncement } from './consistency-check-text.js';

const POLL_MS = 3_000;

/**
 * The caller's platform consistency check of one election (design §5.5): whether the server offers it, what it compares
 * with, their check if they have had it, asking for it once, and polling while the worker runs it, as the bylaws check
 * does; in the editor, choosing what it compares with.
 */
export function useConsistencyCheck(electionId: string, view: ConsistencyCheckView) {
  const state = reactive({
    /** Null until the server has said. */
    enabled: null as boolean | null,
    /** What the election's checks compare the questions with now. */
    documents: [] as ConsistencyDocument[],
    check: null as ConsistencyCheckResult | null,
    /** Saving a change to the documents. */
    choosing: false,
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

  const running = (check: ConsistencyCheckResult | null) => check?.status === 'queued' || check?.status === 'running';

  async function load() {
    stop();
    try {
      const current = await consistencyCheckState(electionId, view);
      state.enabled = current.enabled;
      state.documents = [...current.documents];
      state.check = current.check;
      // A check asked for before this page was opened (another tab, a reload) is followed to its end too.
      if (running(current.check)) poll(generation, Date.now());
    } catch (e) {
      state.error = errorMessage(e);
    }
  }

  async function start() {
    stop();
    const mine = generation;
    Object.assign(state, { requesting: true, error: '', gaveUp: false });
    try {
      state.check = await requestConsistencyCheck(electionId, view);
      announce('Checking the proposals with Claude. This usually takes a minute or two.');
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
        const current = await consistencyCheckState(electionId, view);
        if (mine !== generation) return;
        state.check = current.check;
        if (!running(current.check)) {
          if (current.check?.status === 'done') announce(finishedAnnouncement(current.check));
          return;
        }
      } catch (e) {
        if (mine !== generation) return;
        state.error = errorMessage(e);
      }
      if (Date.now() - since > (CONSISTENCY_CHECK_TIMEOUT_MINUTES + 2) * 60_000) state.gaveUp = true;
      else poll(mine, since);
    }, POLL_MS);
  }

  /** Saves the documents an Election Admin chose; on failure the choice goes back to what the server has. */
  async function choose(documents: ConsistencyDocument[]) {
    const before = state.documents;
    Object.assign(state, { documents, choosing: true, error: '' });
    try {
      state.documents = await chooseConsistencyDocuments(electionId, documents);
      announce(documentsAnnouncement(state.documents));
    } catch (e) {
      state.documents = before;
      state.error = errorMessage(e);
    } finally {
      state.choosing = false;
    }
  }

  onUnmounted(stop);
  return { state, load, start, choose };
}
