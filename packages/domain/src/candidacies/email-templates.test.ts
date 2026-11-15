import { describe, expect, it } from 'vitest';
import {
  addEmailTemplate,
  changeEmailTemplate,
  EMAIL_TEMPLATE_LIMITS,
  emailTemplateChangeSchema,
  emailTemplateHash,
  emailTemplateInputSchema,
  emailTemplateList,
  fillTemplate,
  isPublicLedgerEvent,
  placeholderValues,
  removeEmailTemplate,
  STARTING_EMAIL_TEMPLATES,
  templateProblem,
  templatesFor,
  type EmailTemplate,
  type EmailTemplateInput,
} from '../index.js';

const AT = '2026-11-01T12:00:00.000Z';
const INPUT: EmailTemplateInput = { name: 'Invite to a forum', offices: ['county', 'local'], audience: 'anyone', subject: 'An invitation', body: 'Dear {name},\n\n{myName}' };

function value<T>(outcome: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.value;
}

describe('email templates', () => {
  it('start as three ready-made templates, until the list is saved', () => {
    expect(emailTemplateList(null)).toBe(STARTING_EMAIL_TEMPLATES);
    expect(STARTING_EMAIL_TEMPLATES.map((t) => [t.name, t.audience, t.version])).toEqual([
      ['Where they stand on longevity and science', 'anyone', 0],
      ['Ask for a meeting', 'holder', 0],
      ['Questions for a candidate', 'candidate', 0],
    ]);
    for (const { templateId: _id, version: _v, ...t } of STARTING_EMAIL_TEMPLATES) expect(emailTemplateInputSchema.parse(t)).toEqual(t);
    expect(emailTemplateList({ templates: [], updatedAt: AT, updatedBy: 'a' })).toEqual([]);
  });

  it('allow only the placeholders the page fills in, a one-line name and subject, and known offices', () => {
    expect(templateProblem('Dear {name}, {myName}')).toBeNull();
    expect(templateProblem('Dear {candidate}')).toMatch(/^\{candidate\} is not a placeholder/);
    const issue = (input: Record<string, unknown>) => emailTemplateInputSchema.safeParse({ ...INPUT, ...input }).error?.issues[0]?.path;
    expect(issue({ subject: 'Hi {nme}' })).toEqual(['subject']);
    expect(issue({ subject: 'Hi\nthere' })).toEqual(['subject']);
    expect(issue({ name: 'Two\nlines' })).toEqual(['name']);
    expect(issue({ name: ' ' })).toEqual(['name']);
    expect(issue({ offices: ['mayor'] })).toEqual(['offices', 0]);
    expect(issue({ audience: 'everyone' })).toEqual(['audience']);
    expect(emailTemplateInputSchema.parse({ ...INPUT, offices: ['local', 'us_house', 'local'] }).offices).toEqual(['us_house', 'local']);
    expect(emailTemplateInputSchema.parse({ name: 'N', subject: 'S', body: 'B' })).toMatchObject({ offices: [], audience: 'anyone' });
    expect(emailTemplateChangeSchema.safeParse({ template: INPUT, basedOn: -1 }).success).toBe(false);
  });

  it('suit their offices and people: a member is offered only those', () => {
    const list: EmailTemplate[] = [
      { ...INPUT, templateId: 'local', version: 1 },
      { ...INPUT, templateId: 'any', offices: [], version: 1 },
      { ...INPUT, templateId: 'running', offices: [], audience: 'candidate', version: 1 },
    ];
    const ids = (office: EmailTemplate['offices'][number], role: 'holder' | 'candidate') => templatesFor(list, { office, role }).map((t) => t.templateId);
    expect(ids('county', 'holder')).toEqual(['local', 'any']);
    expect(ids('us_house', 'holder')).toEqual(['any']);
    expect(ids('us_house', 'candidate')).toEqual(['any', 'running']);
    expect(templatesFor(STARTING_EMAIL_TEMPLATES, { office: 'state_lower', role: 'holder' }).map((t) => t.templateId)).toEqual(['starting-stance', 'starting-meeting']);
  });

  it('are added at the end with unique names, at most 50, each ledgered with its hash', () => {
    const added = value(addEmailTemplate(STARTING_EMAIL_TEMPLATES, INPUT, 'new-1', 'admin', AT));
    expect(added.record).toMatchObject({ updatedAt: AT, updatedBy: 'admin' });
    expect(added.record.templates.map((t) => t.templateId)).toEqual(['starting-stance', 'starting-meeting', 'starting-questions', 'new-1']);
    expect(added.template).toMatchObject({ templateId: 'new-1', version: 1 });
    expect(added.event).toMatchObject({
      type: 'email_template.changed',
      actor: 'admin',
      subject: 'new-1',
      payload: { templateId: 'new-1', change: 'added', name: 'Invite to a forum', version: 1, contentHash: emailTemplateHash(INPUT) },
    });
    expect(emailTemplateHash(INPUT)).toMatch(/^[0-9a-f]{64}$/);
    expect(isPublicLedgerEvent('email_template.changed')).toBe(false);
    expect(addEmailTemplate(added.record.templates, { ...INPUT, name: 'INVITE to a forum' }, 'new-2', 'admin', AT)).toMatchObject({ ok: false, refusal: 'conflict' });
    const full = Array.from({ length: EMAIL_TEMPLATE_LIMITS.templates }, (_, i): EmailTemplate => ({ ...INPUT, name: `T${i}`, templateId: `t${i}`, version: 1 }));
    expect(addEmailTemplate(full, INPUT, 'one-more', 'admin', AT)).toMatchObject({ ok: false, reason: expect.stringMatching(/at most 50/) });
  });

  it('are changed from the version edited, keeping their place; a change of nothing is refused', () => {
    const starting = STARTING_EMAIL_TEMPLATES[1]!;
    const input = { ...starting, subject: 'Could we meet?' };
    const changed = value(changeEmailTemplate(STARTING_EMAIL_TEMPLATES, starting.templateId, input, 0, 'admin', AT));
    expect(changed.template).toMatchObject({ templateId: 'starting-meeting', subject: 'Could we meet?', version: 1 });
    expect(changed.record.templates.map((t) => t.templateId)).toEqual(['starting-stance', 'starting-meeting', 'starting-questions']);
    expect(changed.event.payload).toMatchObject({ change: 'changed', version: 1, contentHash: emailTemplateHash(input) });
    const list = changed.record.templates;
    expect(changeEmailTemplate(list, starting.templateId, { ...input, body: 'B' }, 0, 'admin', AT)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/changed this template/),
    });
    expect(changeEmailTemplate(list, starting.templateId, input, 1, 'admin', AT)).toMatchObject({ ok: false, reason: 'nothing changed' });
    expect(changeEmailTemplate(list, starting.templateId, { ...input, name: 'questions for a candidate' }, 1, 'admin', AT)).toMatchObject({
      ok: false,
      reason: 'a template already has that name',
    });
    expect(changeEmailTemplate(list, 'missing', input, 1, 'admin', AT)).toMatchObject({ ok: false, refusal: 'not_found' });
  });

  it('are removed, ledgered without a hash', () => {
    const removed = value(removeEmailTemplate(STARTING_EMAIL_TEMPLATES, 'starting-questions', 'admin', AT));
    expect(removed.record.templates.map((t) => t.templateId)).toEqual(['starting-stance', 'starting-meeting']);
    expect(removed.event.payload).toEqual({ templateId: 'starting-questions', change: 'removed', name: 'Questions for a candidate', version: 0, contentHash: null });
    expect(removeEmailTemplate(removed.record.templates, 'starting-questions', 'admin', AT)).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(value(removeEmailTemplate(removed.record.templates.slice(1), 'starting-meeting', 'admin', AT)).record.templates).toEqual([]);
  });

  it('fill in each person', () => {
    const holder = placeholderValues({ name: 'Mike Levin', officeTitle: 'U.S. Representative', role: 'holder' }, 'Congressional District 49, California', 'Ada');
    expect(fillTemplate('Dear {name}, I write {asRole} from {district}. {myName} {other}', holder)).toBe(
      'Dear Mike Levin, I write as my U.S. Representative from Congressional District 49, California. Ada {other}',
    );
    expect(placeholderValues({ name: 'Eli Stern', officeTitle: 'U.S. Representative', role: 'candidate' }, 'x', 'Ada').asRole).toBe('as a candidate for U.S. Representative');
  });
});
