import { describe, expect, it } from 'vitest';
import { DEFAULT_REGISTRATION_FORM } from 'ustp-domain';
import { describeFormChange } from './registration-form-text.js';

describe('describeFormChange', () => {
  it('names the part and gives its new words, shortened when long', () => {
    expect(describeFormChange({ part: 'usVoterQuestion', to: 'Can you vote in a US election?' })).toBe(
      'First question: “Can you vote in a US election?”',
    );
    const help = describeFormChange({ part: 'coreIdealsHelp', to: DEFAULT_REGISTRATION_FORM.coreIdealsHelp });
    expect(help).toMatch(/^Second question's help: “\(Answer "Yes" or "No"\..*…”$/);
    expect(help.length).toBeLessThan(130);
  });

  it('counts the ideals and the intro paragraphs', () => {
    expect(describeFormChange({ part: 'ideals', to: ['One.'] })).toBe('Core Ideals: 1 ideal');
    expect(describeFormChange({ part: 'ideals', to: ['One.', 'Two.'] })).toBe('Core Ideals: 2 ideals');
    expect(describeFormChange({ part: 'intro', to: 'Join us.\n\nIt is free.' })).toBe('Intro: 2 paragraphs, “Join us.\n\nIt is free.”');
  });

  it('says when a part is left empty or the bonus link removed', () => {
    expect(describeFormChange({ part: 'intro', to: '' })).toBe('Intro: left empty');
    expect(describeFormChange({ part: 'usVoterHelp', to: '' })).toBe("First question's help: left empty");
    expect(describeFormChange({ part: 'tipsAddress', to: '' })).toBe("Bonus link's address: removed, so no link is shown");
    expect(describeFormChange({ part: 'tipsAddress', to: 'https://example.org/tips' })).toBe(
      "Bonus link's address: https://example.org/tips",
    );
  });
});
