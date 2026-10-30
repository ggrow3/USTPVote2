import { describe, expect, it } from 'vitest';
import {
  checkRegistrationForm,
  DEFAULT_REGISTRATION_FORM,
  introParagraphs,
  memberClass,
  REGISTRATION_FORM_LIMITS,
  registrationFormChanges,
  registrationFormSchema,
  resolveRegistrationForm,
  tidyIntro,
  tipsAddressProblem,
  type RegistrationForm,
} from './registration-form.js';

const form = (change: Partial<RegistrationForm>): RegistrationForm => ({ ...DEFAULT_REGISTRATION_FORM, ...change });

describe('member classes', () => {
  it('are fixed by the answer: Yes a United States Member, No an Allied Member', () => {
    expect(memberClass(true)).toBe('united_states');
    expect(memberClass(false)).toBe('allied');
  });

  it('are unknown for someone never asked', () => {
    expect(memberClass(null)).toBeNull();
    expect(memberClass(undefined)).toBeNull();
  });
});

describe('the default', () => {
  it("is the party's wording, without the sentence about a separate page", () => {
    expect(DEFAULT_REGISTRATION_FORM.title).toBe('Register as a member');
    expect(introParagraphs(DEFAULT_REGISTRATION_FORM.intro)).toEqual([
      'Become a member of the U.S. Transhumanist Party for free by filling out this concise Membership Application Form.',
      expect.stringMatching(/^As a bonus for completing this form, you will receive a link to a free compilation of Tips/),
      expect.stringMatching(/^Members also become eligible for discounts on certain procedures from AmpliCell Medical/),
    ]);
    expect(DEFAULT_REGISTRATION_FORM.intro).not.toMatch(/separate page/);
    expect(DEFAULT_REGISTRATION_FORM.usVoterQuestion).toBe('Are you eligible to vote in any United States elections?');
    expect(DEFAULT_REGISTRATION_FORM.usVoterHelp).toMatch(/You will not be rejected due to a "No" answer\.\)$/);
    expect(DEFAULT_REGISTRATION_FORM.ideals).toHaveLength(3);
    expect(DEFAULT_REGISTRATION_FORM.ideals[0]).toBe(
      'The Transhumanist Party supports significant life extension achieved through the progress of science and technology.',
    );
    expect(DEFAULT_REGISTRATION_FORM.coreIdealsQuestion).toMatch(/^Do you agree with the Core Ideals/);
    expect(DEFAULT_REGISTRATION_FORM.coreIdealsHelp).toMatch(/at the Chairman's discretion/);
  });

  it('has no address for the bonus link, which is never guessed', () => {
    expect(DEFAULT_REGISTRATION_FORM.tipsTitle).toBe('Tips for Advancing a Brighter Future');
    expect(DEFAULT_REGISTRATION_FORM.tipsAddress).toBe('');
  });

  it('is tidy and can be saved', () => {
    expect(resolveRegistrationForm(DEFAULT_REGISTRATION_FORM)).toEqual(DEFAULT_REGISTRATION_FORM);
    expect(checkRegistrationForm(DEFAULT_REGISTRATION_FORM)).toEqual({ ok: true });
  });

  it('stands in for anything never saved', () => {
    expect(resolveRegistrationForm(null)).toEqual(DEFAULT_REGISTRATION_FORM);
    expect(resolveRegistrationForm({ intro: '', ideals: 'not a list' })).toEqual(form({ intro: '' }));
  });

  it('gives wording saved before the heading could be changed the default heading', () => {
    const { title: _, ...older } = form({ intro: 'Join us.' });
    expect(resolveRegistrationForm(older)).toEqual(form({ intro: 'Join us.' }));
  });
});

describe('tidying', () => {
  it('keeps paragraphs apart and puts each on one line', () => {
    expect(tidyIntro('  First line\nstill first.  \r\n\r\n\n  Second.\n \n')).toBe('First line still first.\n\nSecond.');
    expect(introParagraphs('')).toEqual([]);
  });

  it('puts the heading, questions, help and ideals on one line and drops empty ideals', () => {
    const tidied = resolveRegistrationForm(
      form({
        title: '  Join the\n party ',
        usVoterQuestion: ' Can you\n vote? ',
        ideals: ['  One.\n', '', '   ', 'Two.'],
        tipsAddress: ' https://example.org/tips ',
      }),
    );
    expect(tidied).toMatchObject({
      title: 'Join the party',
      usVoterQuestion: 'Can you vote?',
      ideals: ['One.', 'Two.'],
      tipsAddress: 'https://example.org/tips',
    });
  });
});

describe('checking', () => {
  it("needs the page's heading, both questions, the Core Ideals' heading and at least one ideal", () => {
    expect(checkRegistrationForm(form({ title: '' }))).toMatchObject({ ok: false, reason: 'the page needs a heading' });
    expect(checkRegistrationForm(form({ usVoterQuestion: '' }))).toMatchObject({ ok: false, reason: /first question/ });
    expect(checkRegistrationForm(form({ coreIdealsQuestion: '' }))).toMatchObject({ ok: false, reason: /second question/ });
    expect(checkRegistrationForm(form({ idealsTitle: '' }))).toMatchObject({ ok: false, reason: /Core Ideals need a heading/ });
    expect(checkRegistrationForm(form({ ideals: [] }))).toMatchObject({ ok: false, reason: /at least one/ });
  });

  it('lets the intro and the help texts be empty', () => {
    expect(checkRegistrationForm(form({ intro: '', usVoterHelp: '', coreIdealsHelp: '' })).ok).toBe(true);
  });

  it('holds each part to its limit', () => {
    const L = REGISTRATION_FORM_LIMITS;
    expect(checkRegistrationForm(form({ title: 'x'.repeat(L.title) })).ok).toBe(true);
    expect(checkRegistrationForm(form({ title: 'x'.repeat(L.title + 1) }))).toMatchObject({ ok: false, reason: /page's heading/ });
    expect(checkRegistrationForm(form({ intro: 'x'.repeat(L.intro) })).ok).toBe(true);
    expect(checkRegistrationForm(form({ intro: 'x'.repeat(L.intro + 1) }))).toMatchObject({ ok: false, reason: /intro/ });
    expect(checkRegistrationForm(form({ usVoterQuestion: 'x'.repeat(L.question + 1) })).ok).toBe(false);
    expect(checkRegistrationForm(form({ coreIdealsHelp: 'x'.repeat(L.help + 1) })).ok).toBe(false);
    expect(checkRegistrationForm(form({ ideals: Array(L.ideals + 1).fill('An ideal.') }))).toMatchObject({ ok: false, reason: /at most/ });
    expect(checkRegistrationForm(form({ ideals: ['Fine.', 'x'.repeat(L.ideal + 1)] }))).toMatchObject({
      ok: false,
      reason: /Ideal 2/,
    });
  });

  it('takes a bonus link only at an https:// address, with a title', () => {
    expect(tipsAddressProblem('')).toBeNull();
    expect(tipsAddressProblem('https://transhumanist-party.org/tips/')).toBeNull();
    expect(tipsAddressProblem('http://example.org')).toBe('use the https:// address');
    expect(tipsAddressProblem('javascript:alert(1)')).toBe('use an https:// address');
    expect(tipsAddressProblem('/tips')).toBe('use an https:// address');
    expect(tipsAddressProblem('https://example.org/a b')).toMatch(/spaces/);
    expect(checkRegistrationForm(form({ tipsAddress: 'https://example.org/tips', tipsTitle: '' }))).toMatchObject({
      ok: false,
      reason: /needs a title/,
    });
    expect(checkRegistrationForm(form({ tipsAddress: 'ftp://example.org' }))).toMatchObject({ ok: false, reason: /bonus link/ });
  });
});

describe('changes', () => {
  it('list every part that differs, with its new value, in the settings order', () => {
    const after = form({
      tipsAddress: 'https://example.org/tips',
      ideals: [...DEFAULT_REGISTRATION_FORM.ideals, 'A fourth.'],
      intro: '',
      title: 'Join the USTP',
    });
    expect(registrationFormChanges(DEFAULT_REGISTRATION_FORM, after)).toEqual([
      { part: 'title', to: 'Join the USTP' },
      { part: 'intro', to: '' },
      { part: 'ideals', to: after.ideals },
      { part: 'tipsAddress', to: 'https://example.org/tips' },
    ]);
  });

  it('see a reordered list of ideals, and nothing when nothing changed', () => {
    const reordered = form({ ideals: [...DEFAULT_REGISTRATION_FORM.ideals].reverse() });
    expect(registrationFormChanges(DEFAULT_REGISTRATION_FORM, reordered).map((c) => c.part)).toEqual(['ideals']);
    expect(registrationFormChanges(DEFAULT_REGISTRATION_FORM, form({}))).toEqual([]);
  });
});

describe('the settings request', () => {
  it('is the whole wording and the version it was edited from', () => {
    expect(registrationFormSchema.safeParse({ basedOn: 0, ...DEFAULT_REGISTRATION_FORM }).success).toBe(true);
    expect(registrationFormSchema.safeParse({ ...DEFAULT_REGISTRATION_FORM }).success).toBe(false);
    expect(registrationFormSchema.safeParse({ basedOn: 0, ...DEFAULT_REGISTRATION_FORM, extra: 1 }).success).toBe(false);
  });
});
