import { describe, expect, it } from 'vitest';
import {
  CERTIFICATE_ISSUER,
  certificateDate,
  certificateHolderSchema,
  certificateNameProblem,
  certificatePagePath,
  certificateSettingsSchema,
  linkedInAddToProfileUrl,
  shownHolderName,
} from './course-certificates.js';

describe('certificate names', () => {
  it('takes a person’s name and refuses an email address, a blank, two lines or one too long', () => {
    expect(certificateNameProblem('Ada Lovelace')).toBeNull();
    expect(certificateNameProblem('  Zoë Ñúñez-O’Brien  ')).toBeNull();
    expect(certificateNameProblem('ada@example.test')).toMatch(/not an email/);
    expect(certificateNameProblem('   ')).toMatch(/give the name/);
    expect(certificateNameProblem('Ada\nLovelace')).toMatch(/one line/);
    expect(certificateNameProblem('a'.repeat(101))).toMatch(/at most 100/);
    expect(certificateNameProblem('a'.repeat(100))).toBeNull();
  });

  it('shows the holder’s name only while they show it, and never an email address', () => {
    expect(shownHolderName({ recipientName: 'Ada Lovelace', nameShown: true })).toBe('Ada Lovelace');
    expect(shownHolderName({ recipientName: 'Ada Lovelace', nameShown: false })).toBeNull();
    expect(shownHolderName({ recipientName: 'Ada Lovelace' })).toBeNull();
    expect(shownHolderName({ recipientName: 'ada@example.test', nameShown: true })).toBeNull();
  });

  it('changes the name, whether it is shown, or both, trimmed', () => {
    expect(certificateHolderSchema.parse({ recipientName: '  Ada Lovelace ' })).toEqual({ recipientName: 'Ada Lovelace' });
    expect(certificateHolderSchema.parse({ nameShown: true })).toEqual({ nameShown: true });
    expect(certificateHolderSchema.safeParse({}).success).toBe(false);
    expect(certificateHolderSchema.safeParse({ recipientName: 'me@example.test' }).error?.issues[0]?.message).toMatch(/not an email/);
    expect(certificateHolderSchema.safeParse({ nameShown: true, other: 1 }).success).toBe(false);
  });
});

describe('LinkedIn Add to profile', () => {
  const certificate = {
    courseTitle: 'Transhumanism: Human Flourishing & Democratic Futures',
    certificateId: '019a7b2c-1d2e-7f00-8a00-0123456789ab',
    issuedAt: '2026-01-31T23:30:00.000Z',
    certificateUrl: 'https://vote.example/course/certificates/019a7b2c-1d2e-7f00-8a00-0123456789ab',
  };

  it('names the party by its organization ID when set, else by name, with the month issued and the credential', () => {
    const byName = new URL(linkedInAddToProfileUrl({ ...certificate, organizationId: null }));
    expect(byName.origin + byName.pathname).toBe('https://www.linkedin.com/profile/add');
    expect(Object.fromEntries(byName.searchParams)).toEqual({
      startTask: 'CERTIFICATION_NAME',
      name: certificate.courseTitle,
      organizationName: CERTIFICATE_ISSUER,
      issueYear: '2026',
      issueMonth: '1',
      certUrl: certificate.certificateUrl,
      certId: certificate.certificateId,
    });
    const byId = new URL(linkedInAddToProfileUrl({ ...certificate, organizationId: '1234567' }));
    expect(byId.searchParams.get('organizationId')).toBe('1234567');
    expect(byId.searchParams.has('organizationName')).toBe(false);
    // Something that is no organization ID is never sent.
    expect(new URL(linkedInAddToProfileUrl({ ...certificate, organizationId: 'x&y=1' })).searchParams.get('organizationName')).toBe(CERTIFICATE_ISSUER);
  });

  it('takes the digits of an organization ID, or none', () => {
    expect(certificateSettingsSchema.parse({ linkedInOrganizationId: ' 1234567 ' })).toEqual({ linkedInOrganizationId: '1234567' });
    expect(certificateSettingsSchema.parse({ linkedInOrganizationId: null })).toEqual({ linkedInOrganizationId: null });
    expect(certificateSettingsSchema.safeParse({ linkedInOrganizationId: 'ustp' }).success).toBe(false);
    expect(certificateSettingsSchema.safeParse({ linkedInOrganizationId: '' }).success).toBe(false);
  });
});

describe('certificate pages', () => {
  it('are at /course/certificates/{id}, dated in words in UTC', () => {
    expect(certificatePagePath('a b')).toBe('/course/certificates/a%20b');
    expect(certificateDate('2026-11-12T23:59:00.000Z')).toBe('November 12, 2026');
  });
});
