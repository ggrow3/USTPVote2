import { describe, expect, it } from 'vitest';
import { planMemberImport, type ExistingEmail, type MemberImportRow } from 'ustp-domain';
import { sentence, skippedText } from './import-text.js';

describe('skippedText', () => {
  it('counts the skipped rows by cause, in a fixed order, leaving out causes with none', () => {
    expect(skippedText({ missing: 2, bad_email: 1, invalid: 0, duplicate: 1, on_site: 3 })).toBe(
      '7 rows skipped: 2 missing a needed field, 1 with an email address that is not one, 1 repeating an address from an earlier row, 3 already on the site',
    );
    expect(skippedText({ missing: 0, bad_email: 0, invalid: 1, duplicate: 0, on_site: 0 })).toBe(
      '1 row skipped: 1 with another field that breaks the rules',
    );
    expect(skippedText({ missing: 0, bad_email: 0, invalid: 0, duplicate: 0, on_site: 0 })).toBe('no rows skipped');
    expect(sentence('no rows skipped')).toBe('No rows skipped.');
  });

  it('says what a preview found in a file', () => {
    const rows: MemberImportRow[] = [
      { line: 2, email: 'a@example.test', legalName: 'A', state: 'NY' },
      { line: 3, email: 'A@example.test', legalName: 'A again', state: 'NY' },
      { line: 4, email: 'nope', legalName: 'B', state: 'NY' },
      { line: 5, email: 'c@example.test', legalName: '', state: 'NY' },
      { line: 6, email: 'd@example.test', legalName: 'D', state: 'NY', phone: '12' },
      { line: 7, email: 'e@example.test', legalName: 'E', state: 'NY' },
    ];
    const plan = planMemberImport(rows, new Map<string, ExistingEmail>([['e@example.test', { kind: 'login' }]]));
    expect(plan.adding).toBe(1);
    expect(skippedText(plan.skippedBy)).toBe(
      '5 rows skipped: 1 missing a needed field, 1 with an email address that is not one, 1 with another field that breaks the rules, 1 repeating an address from an earlier row, 1 already on the site',
    );
  });
});
