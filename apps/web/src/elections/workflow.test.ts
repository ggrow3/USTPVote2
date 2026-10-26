import { ELECTION_STEPS, electionProgress, type ElectionRecord, type ProgressInput } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { cancelledNote, DARK_COLOURS, LIGHT_COLOURS, STEP_LABELS, waitingText, workflowDiagram } from './workflow.js';

const at = '2026-11-01T11:00:00Z';
const election: ElectionRecord = {
  electionId: 'e1',
  title: 'Officers "2026" ]) --> x',
  description: 'end',
  secrecy: 'secret',
  opensAt: at,
  closesAt: '2026-11-08T12:00:00Z',
  kAnonymity: 10,
  state: 'open',
  createdBy: 'ea',
  createdAt: at,
  updatedAt: at,
  definitionHash: '12'.repeat(32),
  rollSnapshotId: 'r1',
  tieBreakSeedCommitment: null,
  tieBreakSeedRef: null,
  scheduledAt: at,
  cancelledAt: null,
  poolKeyVersion: '1',
  openedAt: at,
  closedAt: null,
  sealedAt: null,
  certifiedAt: null,
  poolKeyDestroyedAt: null,
};
const detail: ProgressInput = { election, problems: [], roll: null, pending: [], results: null, ballotsCast: null };
const now = new Date('2026-11-02T00:00:00Z');

describe('workflowDiagram', () => {
  const progress = electionProgress(detail, now);
  const source = workflowDiagram(progress, LIGHT_COLOURS);

  it('draws every step once, with its status as a class', () => {
    for (const step of ELECTION_STEPS) {
      expect(source.match(new RegExp(`^ +step_${step}\\["`, 'gm'))).toHaveLength(1);
      expect(source).toContain(`class step_${step} ${progress.steps.find((s) => s.step === step)!.status}`);
    }
    expect(source.match(/^ +class step_\w+ current$/gm)).toEqual(['  class step_open current']);
  });

  it('marks status in the labels, not only by colour', () => {
    expect(source).toContain('step_open["▶ Open for<br/>voting"]');
    expect(source).toContain('step_scheduled["✓ Scheduled"]');
    expect(source).toContain('step_tally["Results<br/>computed"]');
  });

  it('holds only its own labels, never the election’s text', () => {
    expect(source).not.toContain(election.title);
    expect(source.startsWith('flowchart TD\n  accTitle: Steps of this election\n')).toBe(true);
  });

  it('highlights the group the current step is in', () => {
    const closed = electionProgress({ ...detail, election: { ...election, state: 'closed', closedAt: at } }, now);
    const dark = workflowDiagram(closed, DARK_COLOURS);
    expect(dark).toContain(`style closed fill:${DARK_COLOURS.cluster},stroke:${DARK_COLOURS.clusterCurrent},stroke-width:2px`);
    expect(dark).toContain(`style draft fill:${DARK_COLOURS.cluster},stroke:${DARK_COLOURS.border},stroke-width:1px`);
  });

  it('has a label for every step', () => {
    expect(Object.keys(STEP_LABELS).sort()).toEqual([...ELECTION_STEPS].sort());
  });
});

describe('workflow text', () => {
  it('says who an approval waits on and since when', () => {
    const text = waitingText({ for: 'approve_scheduling', step: 'scheduling', by: 'auditor', at }, 0);
    expect(text).toMatch(/^An Auditor approves scheduling \(requested .+\)\.$/);
    expect(waitingText({ for: 'fix_definition', step: 'readiness', by: 'election_admin', at: null }, 1)).toBe(
      'An Election Admin fixes the problem the readiness checks list.',
    );
    expect(waitingText({ for: 'fix_definition', step: 'readiness', by: 'election_admin', at: null }, 3)).toContain('the 3 problems');
  });

  it('says where a cancelled election stopped', () => {
    expect(cancelledNote({ scheduledAt: at, openedAt: null, cancelledAt: null })).toBe('Cancelled while scheduled.');
    expect(cancelledNote({ scheduledAt: null, openedAt: null, cancelledAt: null })).toBe('Cancelled as a draft.');
  });
});
