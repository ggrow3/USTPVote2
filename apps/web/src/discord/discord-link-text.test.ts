import { describe, expect, it } from 'vitest';
import type { DiscordLinkView } from 'ustp-domain';
import { returnProblem, roleText, showsDiscordCard } from './discord-link-text.js';

const linked = (over: Partial<NonNullable<DiscordLinkView['link']>> = {}, facts: Partial<DiscordLinkView> = {}): DiscordLinkView => ({
  blocker: null,
  rolesSet: true,
  activeMember: true,
  link: { discordName: 'Ada', linkedAt: '2026-11-16T12:00:00.000Z', celebrate: false, role: 'none', roleProblem: null, ...over },
  ...facts,
});

describe('the Connect Discord card', () => {
  it('is hidden where linking is not set up, unless the account is linked already', () => {
    expect(showsDiscordCard({ blocker: 'no_secret', rolesSet: false, activeMember: true, link: null })).toBe(false);
    expect(showsDiscordCard({ blocker: null, rolesSet: false, activeMember: true, link: null })).toBe(true);
    expect(showsDiscordCard(linked({}, { blocker: 'no_secret' }))).toBe(true);
  });

  it('says where the Member role stands', () => {
    expect(roleText(linked({ role: 'given' }))).toContain('You hold the Member role');
    expect(roleText(linked())).toContain('on its way');
    expect(roleText(linked({ roleProblem: 'not_in_server' }))).toContain('could not find you');
    expect(roleText(linked({ roleProblem: 'not_allowed' }))).toContain('permissions on the server need fixing');
    expect(roleText(linked({}, { activeMember: false }))).toContain('for Active members');
    expect(roleText(linked({}, { rolesSet: false }))).toContain('has not set a Member role');
  });
});

describe('coming back from Discord', () => {
  it('goes on only with a code and the word this tab started with', () => {
    expect(returnProblem({ code: 'c', state: 'word' }, 'word')).toBeNull();
    expect(returnProblem({ code: 'c', state: 'word' }, 'another')).toContain('not started in this browser tab');
    expect(returnProblem({ code: 'c', state: 'word' }, null)).toContain('not started in this browser tab');
    expect(returnProblem({}, 'word')).toContain('Start from your Account page');
  });

  it('says so when the member chose Cancel at Discord', () => {
    expect(returnProblem({ error: 'access_denied' }, 'word')).toContain('Cancel');
    expect(returnProblem({ error: 'server_error' }, 'word')).toContain('did not finish');
  });
});
