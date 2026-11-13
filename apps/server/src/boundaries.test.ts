import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Context boundaries (docs/DOMAIN-MODEL.md §2): only the context that owns a collection reads or writes it, through its
 * repositories, and other contexts use the port it publishes. A context is listed here once it has that structure.
 */
const CONTEXTS: Readonly<Record<string, { readonly collections: readonly string[]; readonly repositories: readonly string[] }>> = {
  membership: {
    collections: ['members', 'memberStatusHistory', 'applications', 'registrationForm', 'registrationFormVersions', 'firstSteps', 'firstStepTicks'],
    repositories: ['member.repository', 'application.repository', 'first-steps.repository'],
  },
  notifications: {
    collections: ['notices', 'noticeOutbox', 'noticeSettings', 'noticeReceipts', 'noticeTests', 'noticeVerifications', 'mailMessages', 'mailSuppressions', 'mailHealth', 'mailRequests', 'mailPreferences', 'broadcasts', 'broadcastRecipients', 'mailDigest', 'newsletterSubscribers', 'newsletterLimits'],
    repositories: ['notice.repository', 'mail.repository', 'broadcast.repository', 'newsletter.repository'],
  },
  inbox: {
    collections: ['appNotifications', 'inboxPreferences', 'memberThreads', 'memberMessages', 'memberBlocks', 'messageReports', 'membershipThreads', 'membershipMessages'],
    repositories: ['inbox.repository', 'membership-inbox.repository'],
  },
  candidacies: {
    collections: ['candidacies'],
    repositories: ['candidacy.repository'],
  },
  teams: {
    collections: ['teams', 'teamMembers', 'teamRequests'],
    repositories: ['team.repository'],
  },
  referrals: {
    collections: ['referralCodes', 'referralLinks'],
    repositories: ['referral.repository'],
  },
  forum: {
    collections: ['forumPosts', 'forumComments', 'forumVotes', 'forumReports'],
    repositories: ['forum.repository'],
  },
  room: {
    collections: ['roomConsents', 'roomMessages', 'roomMemory', 'roomJobs', 'roomState'],
    repositories: ['room.repository'],
  },
  bills: {
    collections: ['billSettings', 'billWatch', 'billNotes'],
    repositories: ['bill.repository'],
  },
  communications: {
    collections: ['newsPosts', 'pressKit', 'pressAssets', 'sharePosts', 'shareCounts', 'calendarItems', 'suggestions', 'suggestionLimits', 'bots'],
    repositories: ['communications.repository'],
  },
};

const SRC = import.meta.dirname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('context boundaries', () => {
  const files = sources(SRC).map((path) => ({ path: relative(SRC, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8') }));

  for (const [context, owns] of Object.entries(CONTEXTS)) {
    it(`only ${context} touches its collections and repositories`, () => {
      const outside = files.filter((f) => !f.path.startsWith(`${context}/`));
      const leaks = outside.flatMap((f) => [
        ...owns.collections.filter((c) => new RegExp(`Collections\\.${c}\\b`).test(f.text)).map((c) => `${f.path}: Collections.${c}`),
        ...owns.repositories.filter((r) => f.text.includes(`/${context}/${r}.js'`)).map((r) => `${f.path}: imports ${r}`),
      ]);
      expect(leaks).toEqual([]);
    });
  }
});
