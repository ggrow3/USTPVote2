import { sha256Hex } from 'ustp-audit';
import { amendmentProblems, applyAmendments, planTestBallots, validateDefinition } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { exampleBylaws, exampleElection, examplesManifest, exampleVotes, packageDefinition, readExample } from './testing/examples.js';

/**
 * Every file in `examples/` (design §6.7, §10.4) parses, imports as a draft ready to schedule against the example
 * bylaws, and plans its votes; an amended bylaws file is what the amendments its votes pass give. They are run end to
 * end in examples.int.test.ts.
 */

const bylaws = exampleBylaws();

describe.each(examplesManifest.elections)('$file', ({ file, votes }) => {
  const { definition, texts } = packageDefinition(exampleElection(file));
  const amending = definition.contests.flatMap((c) => {
    const amendment = texts.find((t) => t.snapshotId === c.proposal?.snapshotId)?.amendment;
    return amendment ? [{ contestId: c.contestId, title: c.title, amendment }] : [];
  });

  it('imports as a draft ready to schedule against the example bylaws', () => {
    expect(validateDefinition(definition)).toEqual([]);
    expect(amendmentProblems(amending, bylaws)).toEqual([]);
  });

  it.each(votes ?? [])('$file plans valid ballots and gives the bylaws it expects', (entry) => {
    const file = exampleVotes(entry.file);
    expect(planTestBallots(file, definition)).toMatchObject({ ok: true });
    if (!entry.amendedBylaws) return expect(file.expectBylawsSha256).toBeUndefined();
    const passed = amending.filter((c) => file.expect?.[c.contestId] === 'passed' || file.expect?.[c.title] === 'passed');
    const amended = readExample(entry.amendedBylaws);
    expect(applyAmendments(bylaws, passed.map((c) => ({ id: c.contestId, amendment: c.amendment })))).toEqual({ ok: true, text: amended });
    expect(sha256Hex(amended)).toBe(file.expectBylawsSha256);
  });
});
