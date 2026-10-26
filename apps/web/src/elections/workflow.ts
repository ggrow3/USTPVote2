import {
  cancelledFrom,
  type ElectionProgress,
  type ElectionRecord,
  type ElectionStep,
  type StepStatus,
  type Waiting,
} from 'ustp-domain';
import { aRole } from '../approval-text.js';

/**
 * The election editor's workflow (design §6.1) in words and as a Mermaid flowchart. Where the election is and what it
 * waits on come from `electionProgress` in ustp-domain; this module only says it.
 */

export const STEP_LABELS: Record<ElectionStep, string> = {
  readiness: 'Readiness checks',
  roll: 'Voter roll',
  scheduling: 'Scheduling',
  scheduled: 'Scheduled',
  open: 'Open for voting',
  sealing: 'Ballots sealed',
  tally: 'Results computed',
  certification: 'Certification',
  certified: 'Certified',
  cancelled: 'Cancelled',
  deleted: 'Deleted',
};

/** Read before each step's name by screen readers; the list shows the same with its markers. */
export const STATUS_TEXT: Record<StepStatus, string> = {
  done: 'Done',
  current: 'Current step',
  upcoming: 'To come',
  possible: 'Possible',
  not_reached: 'Not reached',
};

/**
 * What happens at each step and who does it. `rehearsal`: a rehearsal where testing mode is on, which can be deleted
 * after voting too (design §10.4).
 */
export function stepNote(step: ElectionStep, election: Pick<ElectionRecord, 'secrecy'>, rehearsal = false): string {
  const secret = election.secrecy === 'secret';
  switch (step) {
    case 'readiness':
      return 'Contests, candidates, proposal texts and voting times pass every check.';
    case 'roll':
      return 'An Election Admin requests a snapshot of the Active members; an Auditor approves it. It can be done before the checks pass.';
    case 'scheduling':
      return 'An Election Admin requests it; an Auditor approves, which freezes the definition and the roll.';
    case 'scheduled':
      return secret
        ? 'The worker prepares the ballot encryption key, then opens voting at the opening time.'
        : 'The worker opens voting at the opening time.';
    case 'open':
      return 'Members on the roll vote. The worker closes voting at the closing time.';
    case 'sealing':
      return secret
        ? 'The worker seals every ballot into the published blocks.'
        : 'The worker seals the roll-call ballots into the published blocks.';
    case 'tally':
      return 'The worker counts the sealed ballots and publishes signed provisional results.';
    case 'certification':
      return 'An Election Admin requests it; an Auditor certifies exactly those results.';
    case 'certified':
      return secret
        ? 'The results are final; winners start any terms of office, and the worker destroys the ballot encryption key.'
        : 'The results are final; winners start any terms of office.';
    case 'cancelled':
      return 'A draft at once, by an Election Admin; a scheduled or open election with an Auditor’s approval.';
    case 'deleted':
      return rehearsal
        ? 'This rehearsal, once certified or cancelled, with its ballots and results, unless it seated anyone in an ' +
          'office; by an Election Admin, while testing mode is on. The ledger keeps its entries.'
        : 'A cancelled election nobody voted in, by an Election Admin. The ledger keeps its entries.';
  }
}

/** A cancelled election's line in the list, which says where it stopped. */
export function cancelledNote(election: Pick<ElectionRecord, 'scheduledAt' | 'openedAt' | 'cancelledAt'>): string {
  const from = { draft: 'as a draft', scheduled: 'while scheduled', open: 'while voting was open' }[
    cancelledFrom(election) as 'draft' | 'scheduled' | 'open'
  ];
  return `Cancelled ${from}${election.cancelledAt ? `, ${when(election.cancelledAt)}` : ''}.`;
}

const when = (iso: string) => new Date(iso).toLocaleString();

/** One thing the election waits on, as a sentence; `problems` is how many the readiness checks list. */
export function waitingText(w: Waiting, problems: number): string {
  const requested = w.at ? ` (requested ${when(w.at)})` : '';
  const approver = w.by === 'worker' ? 'the worker' : aRole(w.by);
  switch (w.for) {
    case 'fix_definition':
      return `An Election Admin fixes ${problems === 1 ? 'the problem' : `the ${problems} problems`} the readiness checks list.`;
    case 'request_roll':
      return 'An Election Admin requests a voter roll snapshot.';
    case 'approve_roll':
      return `${cap(approver)} approves the voter roll${requested}.`;
    case 'request_scheduling':
      return 'An Election Admin requests scheduling.';
    case 'approve_scheduling':
      return `${cap(approver)} approves scheduling${requested}.`;
    case 'pool_key':
      return 'The worker prepares the ballot encryption key, within a minute. Voting cannot open without it.';
    case 'opening_time':
      return `Voting opens ${when(w.at!)}: the worker opens it on its first tick from then (it runs every minute).`;
    case 'open_tick':
      return `The opening time (${when(w.at!)}) has passed: the worker opens voting on its next tick, within a minute.`;
    case 'closing_time':
      return `Voting closes ${when(w.at!)}: the worker closes it on its first tick from then.`;
    case 'close_tick':
      return `The closing time (${when(w.at!)}) has passed: the worker closes voting on its next tick, within a minute.`;
    case 'seal':
      return 'The worker seals the remaining ballots, usually on the tick that closed voting.';
    case 'tally':
      return 'The worker computes the provisional results now that every ballot is sealed, usually within a minute.';
    case 'request_certification':
      return 'An Election Admin requests certification of the provisional results.';
    case 'approve_certification':
      return `${cap(approver)} certifies the results${requested}.`;
    case 'approve_cancellation':
      return `${cap(approver)} decides the request to cancel it${requested}.`;
    case 'destroy_pool_key':
      return 'The worker destroys the ballot encryption key, within a minute.';
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// --- the diagram ----------------------------------------------------------------------------------------------------

/** Colours for one theme; docs/ACCESSIBILITY.md has their contrast figures. */
export interface DiagramColours {
  readonly text: string;
  readonly node: string;
  readonly border: string;
  readonly done: string;
  readonly doneBorder: string;
  readonly current: string;
  readonly currentText: string;
  readonly muted: string;
  readonly line: string;
  readonly cluster: string;
  readonly clusterCurrent: string;
}

/** On a white card. */
export const LIGHT_COLOURS: DiagramColours = {
  text: '#000000',
  node: '#ffffff',
  border: '#757575',
  done: '#e8f5e9',
  doneBorder: '#2e7d32',
  current: '#bd4e00',
  currentText: '#ffffff',
  muted: '#757575',
  line: '#757575',
  cluster: '#f5f5f5',
  clusterCurrent: '#bd4e00',
};

/** On a dark card (#1d1d1d). Primary is too dark there, so the current step uses the accent, as links do. */
export const DARK_COLOURS: DiagramColours = {
  text: '#ffffff',
  node: '#1d1d1d',
  border: '#b0b0b0',
  done: '#203123',
  doneBorder: '#81c784',
  current: '#ff6900',
  currentText: '#000000',
  muted: '#b0b0b0',
  line: '#b0b0b0',
  cluster: '#262626',
  clusterCurrent: '#ff6900',
};

/** Shown before a step's name in the diagram, so its status does not rest on colour (WCAG 1.4.1). */
export const DIAGRAM_MARKS: Record<StepStatus, string> = {
  done: '✓ ',
  current: '▶ ',
  upcoming: '',
  possible: '',
  not_reached: '– ',
};

/** Long names on two lines, so the chart stays narrow enough for a phone. */
const DIAGRAM_LABELS: Partial<Record<ElectionStep, string>> = {
  readiness: 'Readiness<br/>checks',
  open: 'Open for<br/>voting',
  sealing: 'Ballots<br/>sealed',
  tally: 'Results<br/>computed',
};

const id = (step: ElectionStep) => `step_${step}`;
const DRAFT: readonly ElectionStep[] = ['readiness', 'roll', 'scheduling'];
const CLOSED: readonly ElectionStep[] = ['sealing', 'tally', 'certification'];

/**
 * The lifecycle as Mermaid flowchart source, with each step styled by its status. It holds only fixed labels, never an
 * election's own text, so nothing typed into an election reaches the diagram's parser.
 */
export function workflowDiagram(progress: ElectionProgress, c: DiagramColours): string {
  const status = new Map(progress.steps.map((s) => [s.step, s.status]));
  const node = (step: ElectionStep) =>
    `    ${id(step)}["${DIAGRAM_MARKS[status.get(step)!]}${DIAGRAM_LABELS[step] ?? STEP_LABELS[step]}"]`;
  const cluster = (name: string, steps: readonly ElectionStep[]) => {
    const here = steps.includes(progress.current);
    return `  style ${name} fill:${c.cluster},stroke:${here ? c.clusterCurrent : c.border},stroke-width:${here ? 2 : 1}px,color:${c.text}`;
  };
  const dashed = 'stroke-dasharray:5 4';
  return [
    'flowchart TD',
    '  accTitle: Steps of this election',
    `  accDescr: A flowchart of the steps listed beside it. The current step, ${STEP_LABELS[progress.current]}, is highlighted.`,
    '  subgraph draft["Draft"]',
    ...DRAFT.map(node),
    '  end',
    node('scheduled'),
    node('open'),
    '  subgraph closed["Closed"]',
    ...CLOSED.map(node),
    '  end',
    node('certified'),
    node('cancelled'),
    node('deleted'),
    // The states follow one another (design §6.1); the steps inside Draft and Closed follow one another within it.
    `  ${id('readiness')} --> ${id('roll')} --> ${id('scheduling')}`,
    `  ${id('sealing')} --> ${id('tally')} --> ${id('certification')}`,
    `  draft --> ${id('scheduled')} --> ${id('open')} --> closed --> ${id('certified')}`,
    `  draft -.-> ${id('cancelled')}`,
    `  ${id('scheduled')} -.-> ${id('cancelled')}`,
    `  ${id('open')} -.-> ${id('cancelled')}`,
    ...progress.deletedFrom.map((state) => `  ${id(state)} -.-> ${id('deleted')}`),
    `  classDef done fill:${c.done},stroke:${c.doneBorder},color:${c.text}`,
    `  classDef current fill:${c.current},stroke:${c.current},stroke-width:3px,color:${c.currentText},font-weight:bold`,
    `  classDef upcoming fill:${c.node},stroke:${c.border},color:${c.text}`,
    `  classDef possible fill:${c.node},stroke:${c.border},${dashed},color:${c.text}`,
    `  classDef not_reached fill:${c.node},stroke:${c.muted},${dashed},color:${c.muted}`,
    ...progress.steps.map((s) => `  class ${id(s.step)} ${s.status}`),
    cluster('draft', DRAFT),
    cluster('closed', CLOSED),
  ].join('\n');
}
