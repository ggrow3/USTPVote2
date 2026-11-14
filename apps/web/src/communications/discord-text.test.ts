import { DEFAULT_DISCORD_SETTINGS, type DiscordAdminView, type DiscordTokenStatus } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import {
  commandsText,
  discordBlockers,
  discordStateText,
  linkBlockerText,
  linkProblems,
  linksText,
  postStatusText,
  questionStatusText,
  startHereText,
  testText,
  tokenStatusText,
} from './discord-text.js';

const settings = { ...DEFAULT_DISCORD_SETTINGS, version: 0, updatedAt: null, updatedBy: null };
const ready: Pick<DiscordAdminView, 'mode' | 'tokenSet' | 'canLink' | 'settings' | 'botName'> = {
  mode: 'live',
  tokenSet: true,
  canLink: true,
  botName: 'USTP Bot',
  settings: { ...settings, enabled: true, channels: { ...settings.channels, news: '100000000000000001' } },
};

describe('where the Discord bot stands', () => {
  it('says what is missing before it can post', () => {
    expect(discordBlockers(ready)).toEqual([]);
    expect(discordBlockers({ ...ready, tokenSet: false, settings })).toEqual([
      'The bot’s token has not been added. A System Admin adds it under Admin › API keys.',
      'No channel is chosen yet, so there is nowhere to post.',
    ]);
    expect(discordBlockers({ ...ready, mode: 'off', canLink: false, tokenSet: null })).toHaveLength(3);
  });

  it('says in a sentence whether it posts', () => {
    expect(discordStateText(ready)).toBe('The bot (USTP Bot) is switched on and posts within a minute of each thing happening.');
    expect(discordStateText({ ...ready, tokenSet: false })).toBe('The bot (USTP Bot) is switched on, but cannot post yet.');
    expect(discordStateText({ ...ready, botName: null, settings })).toBe('The bot is switched off: nothing is posted.');
    expect(discordStateText({ ...ready, mode: 'stub' })).toContain('stand-in');
  });

  it('says what became of a test post and of each post', () => {
    const test = { kind: 'news', channelId: '1', requestedBy: 'a', requestedAt: '2026-11-12T10:00:00.000Z', problem: null, doneAt: null } as const;
    expect(testText({ ...test, status: 'waiting' })).toContain('within a minute');
    expect(testText({ ...test, status: 'failed', problem: 'Discord knows no such channel' })).toBe('The test post was not sent: Discord knows no such channel.');
    expect(postStatusText({ status: 'failed', sentAt: null, createdAt: '2026-11-12T10:00:00.000Z', problem: 'no permission' })).toBe('Not posted: no permission');
    expect(postStatusText({ status: 'sent', sentAt: '2026-11-12T10:00:00.000Z', createdAt: '2026-11-12T10:00:00.000Z', problem: null }, 'en-US')).toMatch(/^Posted Nov 1[12]/);
  });
});

describe('the slash commands, in words', () => {
  const told = { endpoint: 'https://discord.example/interactions', registered: true, endpointSet: true, problem: null, triedAt: '2026-11-13T12:00:00.000Z' };

  it('says where they stand', () => {
    expect(commandsText({ ...told, endpoint: null }, true)).toBe('This deployment has no commands service yet, so the bot has no commands.');
    expect(commandsText(told, false)).toBe('Discord is told of the commands once the bot’s token is added.');
    expect(commandsText({ ...told, registered: false, triedAt: null }, true)).toBe('Discord is being told of the commands; that takes a minute or two.');
    expect(commandsText({ ...told, registered: false, problem: 'Discord could not be reached' }, true)).toBe(
      'Discord has not taken the commands yet: Discord could not be reached. The site tries again every two minutes.',
    );
    expect(commandsText(told, true, 'en-GB')).toMatch(/^Discord was told of the commands on 13 Nov/);
  });
});

describe("the bot's token, in words", () => {
  const none: DiscordTokenStatus = { set: false, addedAt: null, addedBy: null, hint: null, botName: null, tried: true, unavailable: null };

  it('says whether one is set, whose bot it is and who added it, never the token', () => {
    expect(tokenStatusText(none)).toBe('No token is set, so the bot cannot post.');
    const set = { ...none, set: true, addedAt: '2026-11-12T18:00:00.000Z', hint: 'WXYZ', botName: 'USTP Bot', addedBy: { accountId: 'a', name: 'Ada' } };
    expect(tokenStatusText(set, 'en-US')).toBe('A token is set for the bot USTP Bot. It ends in WXYZ and was added on Nov 12, 2026 by Ada.');
    expect(tokenStatusText({ ...set, addedBy: null, hint: null }, 'en-US')).toContain('outside this app');
    expect(tokenStatusText({ ...none, unavailable: 'this server may not look at the secret yet' })).toBe('This server may not look at the secret yet.');
  });
});

describe('linking and the weekly posts, for the admins', () => {
  const none = { linked: 0, withRole: 0, notInServer: 0, refused: 0, celebrating: 0 };

  it('says why members cannot link yet', () => {
    expect(linkBlockerText(null)).toBeNull();
    expect(linkBlockerText('no_secret')).toContain('client secret under Admin › API keys');
    expect(linkBlockerText('no_application')).toContain('token');
  });

  it('counts linked members, never naming them', () => {
    expect(linksText(none, true)).toBe('No member has connected Discord yet.');
    expect(linksText({ ...none, linked: 3, withRole: 1, celebrating: 2 }, true)).toBe(
      '3 members have connected Discord; 1 of them holds the Member role; 2 have chosen to be named in the Friday post.',
    );
    expect(linksText({ ...none, linked: 1 }, false)).toBe('1 member has connected Discord.');
  });

  it('says what stands between linked members and their role', () => {
    expect(linkProblems(none, true)).toEqual([]);
    expect(linkProblems(none, false)).toEqual(['No server and Member role are saved above, so no role is given.']);
    const problems = linkProblems({ ...none, linked: 3, refused: 2, notInServer: 1 }, true);
    expect(problems[0]).toContain('could not change the role for 2 members');
    expect(problems[1]).toContain('1 linked member is not on the server');
  });

  it('says where the Start here message stands', () => {
    const asked = { status: 'waiting' as const, channelId: '1', messageId: null, postedIn: null, pinned: false, problem: null, requestedBy: 'a', requestedAt: '2026-11-16T12:00:00.000Z', doneAt: null };
    expect(startHereText(null)).toBe('It has not been posted yet.');
    expect(startHereText(asked)).toContain('on its way');
    expect(startHereText({ ...asked, status: 'posted', pinned: true, doneAt: '2026-11-16T12:01:00.000Z' }, 'en-US')).toMatch(/^It was posted or brought up to date .*, and is pinned\.$/);
    expect(startHereText({ ...asked, status: 'posted', problem: 'it was posted, but not pinned: the bot may not pin in this channel: give it Pin Messages there', doneAt: '2026-11-16T12:01:00.000Z' }, 'en-US')).toContain(
      ', but not pinned: the bot may not pin',
    );
    expect(startHereText({ ...asked, status: 'failed', problem: 'Discord knows no such channel' })).toBe('It was not posted: Discord knows no such channel.');
  });

  it('says where each question is in line', () => {
    const q = { questionId: 'q', question: 'Q?', answers: ['A', 'B'], status: 'waiting' as const, createdAt: '', createdBy: 'a', week: null, postedAt: null, messageId: null, problem: null };
    expect(questionStatusText(q, 0)).toBe('Next');
    expect(questionStatusText(q, 1)).toBe('Waiting, number 2 in line');
    expect(questionStatusText(q, 4)).toBe('Waiting, number 5 in line');
    expect(questionStatusText({ ...q, status: 'posted', postedAt: '2026-11-18T16:00:00.000Z' }, -1, 'en-US')).toMatch(/^Posted /);
  });
});
