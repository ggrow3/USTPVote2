import { leadTeamSettingsSchema } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { fromForm, toForm } from './settings-form.js';
import { emptySettings, hasRoom, leadsLine, membersLine, slugFrom, standingLabel } from './team-text.js';

describe('team wording', () => {
  it('names the leads and counts the members against the limit', () => {
    expect(leadsLine({ leads: [] })).toBe('No lead');
    expect(leadsLine({ leads: [{ accountId: 'a', name: 'Lea Ortiz' }] })).toBe('Led by Lea Ortiz');
    expect(leadsLine({ leads: ['Ada', 'Bo', 'Cy'].map((name) => ({ accountId: name, name })) })).toBe('Led by Ada, Bo and Cy');
    expect(membersLine({ members: 1, team: { capacity: null } })).toBe('1 member');
    expect(membersLine({ members: 4, team: { capacity: 12 } })).toBe('4 of 12 members');
    expect(hasRoom({ members: 12, team: { capacity: 12 } })).toBe(false);
    expect(hasRoom({ members: 12, team: { capacity: null } })).toBe(true);
  });

  it('says where the person stands', () => {
    expect(standingLabel({ mine: { role: 'lead', request: null } })).toBe('You lead this team');
    expect(standingLabel({ mine: { role: null, request: null } })).toBeNull();
    const asked = { teamId: 't', accountId: 'a', status: 'pending' as const, message: null, question: null, answer: null, askedAt: '', decidedAt: null, decidedBy: null, note: null };
    expect(standingLabel({ mine: { role: null, request: asked } })).toBe('You asked to join');
  });

  it('makes an ID from a name', () => {
    expect(slugFrom('Field Outreach!')).toBe('field-outreach');
    expect(slugFrom('  Política & Médias  ')).toBe('politica-medias');
    expect(slugFrom('a'.repeat(60))).toHaveLength(48);
  });

  it('edits only the settings of a team, which its lead schema accepts as they are', () => {
    const team = { ...emptySettings(), name: 'Media', teamId: 'media', version: 3, archived: false, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '' };
    const { name: _, ...rest } = fromForm(toForm(team));
    expect(Object.keys(toForm(team)).sort()).toEqual(Object.keys(emptySettings()).sort());
    expect(leadTeamSettingsSchema.safeParse({ ...rest, basedOn: 3 }).success).toBe(true);
  });

  it('sends blank texts and an empty limit as none, and the question only when leads decide', () => {
    const form = { ...toForm(emptySettings()), name: 'Media', capacity: '' as const, joinQuestion: 'Why?' };
    expect(fromForm(form)).toMatchObject({ capacity: null, joinQuestion: 'Why?', memberLink: '' });
    expect(fromForm({ ...form, joinPolicy: 'open' }).joinQuestion).toBeNull();
    expect(fromForm({ ...form, capacity: 8 }).capacity).toBe(8);
  });
});
