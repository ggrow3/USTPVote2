import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PROBLEM_TYPES, type PersonaSummary } from 'ustp-domain';
import { describe, expect, it, vi } from 'vitest';
import type { ApprovalsService } from './administration/approvals.service.js';
import { ROLES_KEY } from './auth/decorators.js';
import type { RequestContext } from './auth/principal.js';
import type { ServerConfig } from './config.js';
import type { ElectionsService } from './elections/elections.service.js';
import { DEMO_REASON, DemoElectionsController, DemoElectionsService } from './personas/demo-elections.js';
import type { PersonasService } from './personas/personas.service.js';

/** The demo election endpoint (design §10.4) up to the services it calls, which the integration tests run for real. */

const ctx = (authAgeSeconds = 60): RequestContext => ({
  principal: {
    uid: 'uid-sa',
    email: 'sa@example.test',
    emailVerified: true,
    name: null,
    provider: 'password',
    mfa: true,
    authTime: Math.floor(Date.now() / 1000) - authAgeSeconds,
  },
  accountId: 'sa',
  roles: ['system_admin'],
  operator: null,
});

const persona = (accountId: string, kind: PersonaSummary['kind'], memberStatus: PersonaSummary['memberStatus'] = null): PersonaSummary => ({
  accountId,
  kind,
  label: accountId,
  number: null,
  createdBy: 'sa',
  createdAt: '2026-10-28T00:00:00Z',
  roles: kind === 'voter' ? [] : [kind],
  memberStatus,
});
const ADMINS = [persona('tma', 'membership_admin'), persona('tea', 'election_admin'), persona('ta', 'auditor')];
const voters = (n: number, status: PersonaSummary['memberStatus'] = 'active') => Array.from({ length: n }, (_, i) => persona(`v${i}-${status}`, 'voter', status));

function demos({ testingMode = true, personas = [...ADMINS, ...voters(5)] } = {}) {
  const fakes = {
    personas: { create: vi.fn(async () => personas) },
    elections: {
      importPackage: vi.fn(async () => ({ election: { electionId: 'e1' } })),
      requestRoll: vi.fn(async () => ({ approvalId: 'roll-request' })),
      requestSchedule: vi.fn(async () => ({ id: 'schedule-request' })),
      detail: vi.fn(async () => ({ election: { electionId: 'e1', state: 'scheduled' } })),
      cancel: vi.fn(async () => ({ cancelled: true, request: null })),
      delete: vi.fn(async () => undefined),
    },
    approvals: { decide: vi.fn(async () => ({})) },
  };
  const service = new DemoElectionsService(
    fakes.personas as unknown as PersonasService,
    fakes.elections as unknown as ElectionsService,
    fakes.approvals as unknown as ApprovalsService,
    { testingMode, adminMfaRequired: true } as ServerConfig,
  );
  const nothingWritten = () => {
    expect(fakes.personas.create).not.toHaveBeenCalled();
    expect(fakes.elections.importPackage).not.toHaveBeenCalled();
  };
  return { service, ...fakes, nothingWritten };
}

describe('the demo election endpoint', () => {
  it('is for System and Site Admins (the guard answers 403 to anyone else; requireTestingAccess to personas)', () => {
    expect(new Reflector().get(ROLES_KEY, DemoElectionsController)).toEqual(['system_admin', 'site_admin']);
  });

  it('does not exist without testing mode, whatever is sent', async () => {
    const { service, nothingWritten } = demos({ testingMode: false });
    for (const body of [{}, { votingMinutes: 1 }, 'nonsense', undefined]) {
      await expect(service.create(ctx(), body)).rejects.toBeInstanceOf(NotFoundException);
    }
    nothingWritten();
  });

  it('refuses a request it cannot make, and a stale sign-in, before writing anything', async () => {
    const { service, nothingWritten } = demos();
    await expect(service.create(ctx(), { votingMinutes: 2 })).rejects.toBeInstanceOf(BadRequestException);
    const stale = service.create(ctx(16 * 60), {});
    await expect(stale).rejects.toBeInstanceOf(ForbiddenException);
    await expect(stale).rejects.toMatchObject({ response: { type: PROBLEM_TYPES.reauthRequired } });
    nothingWritten();
  });

  it('refuses before importing anything while a persona’s role is revoked', async () => {
    const revoked = { ...ADMINS[1]!, roles: [] };
    const { service, elections } = demos({ personas: [ADMINS[0]!, revoked, ADMINS[2]!, ...voters(5)] });
    await expect(service.create(ctx(), {})).rejects.toBeInstanceOf(ConflictException);
    expect(elections.importPackage).not.toHaveBeenCalled();
  });

  it('builds the election as the Test Election Admin and approves it as the Test Auditor, the System Admin their operator', async () => {
    const { service, elections, approvals } = demos();
    const result = await service.create(ctx(), { seed: 'fixed', votingMinutes: 30, opens: 'soon', secrecy: 'open' });
    expect(result).toEqual({ seed: 'fixed', election: { election: { electionId: 'e1', state: 'scheduled' } } });

    const as = (accountId: string, role: string) => expect.objectContaining({ accountId, roles: [role], operator: 'sa', principal: ctx().principal });
    const [[admin, pkg]] = elections.importPackage.mock.calls as unknown as [[RequestContext, { title: string; secrecy: string; window: object }]];
    expect(admin).toEqual(as('tea', 'election_admin'));
    expect(pkg.title).toMatch(/^\[Demo\] /);
    expect(pkg.secrecy).toBe('open');
    expect(pkg.window).toEqual({ opensInSeconds: 300, votingSeconds: 1800 });
    expect(elections.requestRoll).toHaveBeenCalledWith(as('tea', 'election_admin'), 'e1', DEMO_REASON, 'test_voters');
    expect(elections.requestSchedule).toHaveBeenCalledWith(as('tea', 'election_admin'), 'e1', DEMO_REASON);
    expect(approvals.decide.mock.calls).toEqual([
      [as('ta', 'auditor'), 'roll-request', { decision: 'approve', reason: DEMO_REASON }],
      [as('ta', 'auditor'), 'schedule-request', { decision: 'approve', reason: DEMO_REASON }],
    ]);
  });

  it('makes the same election from the same seed, and a random seed otherwise', async () => {
    const packages: string[] = [];
    for (const seed of ['same', 'same', undefined, undefined]) {
      const { service, elections } = demos();
      const { seed: used } = await service.create(ctx(), seed ? { seed } : {});
      expect(used).toMatch(seed ?? /^[0-9a-f]{16}$/);
      packages.push(JSON.stringify((elections.importPackage.mock.calls[0] as unknown[])[1]));
    }
    // The window counts from now, so the same seed a moment later differs only in that.
    const strip = (pkg: string) => pkg.replace(/"window":\{[^}]*\}/, '');
    expect(strip(packages[0]!)).toBe(strip(packages[1]!));
    expect(packages[2]).not.toBe(packages[3]);
  });

  it('adds test voters until five are Active, within the deployment limit', async () => {
    const few = demos({ personas: [...ADMINS, ...voters(2), ...voters(1, 'resigned')] });
    await few.service.create(ctx(), {});
    expect(few.personas.create.mock.calls.map((c) => (c as unknown[])[1])).toEqual([{ voters: 0 }, { voters: 3 }]);

    const enough = demos();
    await enough.service.create(ctx(), {});
    expect(enough.personas.create.mock.calls.map((c) => (c as unknown[])[1])).toEqual([{ voters: 0 }]);

    const full = demos({ personas: [...ADMINS, ...voters(2), ...voters(48, 'resigned')] });
    await full.service.create(ctx(), {});
    expect(full.personas.create.mock.calls.map((c) => (c as unknown[])[1])).toEqual([{ voters: 0 }]);
  });

  it('removes a demo that fails on the way, as a cancelled draft, and says why it failed', async () => {
    const { service, elections, approvals } = demos();
    approvals.decide.mockResolvedValueOnce({}).mockRejectedValueOnce(new ForbiddenException('sign in again to approve'));
    await expect(service.create(ctx(), {})).rejects.toThrow('sign in again to approve');
    expect(elections.cancel).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'tea' }), 'e1', DEMO_REASON);
    expect(elections.delete).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'tea' }), 'e1', DEMO_REASON);
  });
});
