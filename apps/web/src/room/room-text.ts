import {
  ROOM_COMMAND_HELP,
  ROOM_COMMANDS,
  type RoomAssistantView,
  type RoomCommand,
  type RoomMessageView,
  type RoomPerson,
  type RoomSettingsView,
  type RoomSource,
} from 'ustp-domain';

/** Wording for the members' room (design §5.10). */

/** "3:04 PM" today, "Yesterday 3:04 PM", then "Oct 20, 3:04 PM". */
export function messageTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = dayLabel(iso, now);
  return day === 'Today' ? time : `${day === 'Yesterday' ? day : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
}

/** The separator over each day's messages: "Today", "Yesterday", "Tuesday, October 20". */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return at.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(at.getFullYear() !== now.getFullYear() && { year: 'numeric' }) });
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Whether a day separator goes above message `i`. */
export function startsDay(messages: readonly RoomMessageView[], i: number): boolean {
  return i === 0 || startOfDay(new Date(messages[i]!.createdAt)) !== startOfDay(new Date(messages[i - 1]!.createdAt));
}

/** "Nov 5, 2026" for an action item's due date (YYYY-MM-DD, a calendar date with no time zone). */
export function dueLabel(due: string): string {
  const [y, m, d] = due.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Whether an open action item is past its due date. */
export function overdue(due: string | null, now: Date = new Date()): boolean {
  if (!due) return false;
  const [y, m, d] = due.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getTime() < startOfDay(now);
}

export const SOURCE_LABELS: Readonly<Record<RoomSource['kind'], string>> = { message: 'Message', decision: 'Decision', action: 'Action item' };

/** The assistant's state in the room's header. */
export function assistantLine(a: RoomAssistantView): { readonly label: string; readonly caption: string; readonly on: boolean } {
  if (a.model === 'off') return { label: 'Assistant not set up', caption: 'This deployment has no model for the room yet; the chat and memory work.', on: false };
  if (!a.server) {
    return { label: 'Assistant’s server off', caption: 'A System Admin has switched the room’s model server off. The chat and memory still work.', on: false };
  }
  if (!a.on) {
    return {
      label: 'Assistant off',
      caption: `${a.switchedBy ? `${a.switchedBy.name} switched it off` : 'Switched off'}. Decisions, action items and the chat still work.`,
      on: false,
    };
  }
  return {
    label: 'Assistant on',
    caption:
      a.model === 'self-hosted'
        ? 'It runs on the party’s own servers: nothing said here goes to an AI company.'
        : 'A stand-in for testing: it quotes the room’s memory instead of thinking.',
    on: true,
  };
}

/** The commands a composer starting with `/` suggests: those starting with what was typed, Membership Admins' last. */
export function commandHints(text: string, moderator: boolean): { readonly command: RoomCommand; readonly usage: string; readonly does: string }[] {
  const typed = /^\/([a-z-]*)$/i.exec(text.trim())?.[1]?.toLowerCase();
  if (typed === undefined) return [];
  return ROOM_COMMANDS.filter((c) => c.startsWith(typed) && (moderator || c !== 'assistant')).map((command) => ({ command, ...ROOM_COMMAND_HELP[command] }));
}

/** "Ada, Bo and 3 others". */
export function peopleLine(names: readonly string[]): string {
  if (names.length <= 3) return names.length === 0 ? 'Nobody yet' : names.join(names.length === 2 ? ' and ' : ', ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`;
}

/**
 * An answer's text in runs, with each `[n]` citation as its own part so the page can link it to source `n`.
 */
export function answerParts(text: string, sources: number): { readonly text: string; readonly cite?: number }[] {
  const parts: { text: string; cite?: number }[] = [];
  let at = 0;
  for (const match of text.matchAll(/\[(\d{1,3})\]/g)) {
    const n = Number(match[1]);
    if (n < 1 || n > sources) continue;
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    parts.push({ text: `[${n}]`, cite: n });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** "by Ada Brooks, Oct 20 3:04 PM", or empty when nobody has changed it yet. */
export function changedLine(by: RoomPerson | null, at: string | null, now: Date = new Date()): string {
  if (!at) return '';
  return `${by ? `by ${by.name}, ` : ''}${messageTime(at, now)}`;
}

/** The model server's card in Admin › Members' room. */
export function serverLine(server: RoomSettingsView['server']): { readonly title: string; readonly caption: string; readonly running: boolean } {
  if (server.model === 'off') {
    return {
      title: 'No model server yet',
      caption: 'Terraform creates it once (room_model_enabled); until then the assistant does not answer and this switch does nothing.',
      running: false,
    };
  }
  if (!server.on) {
    return { title: 'The model server is off', caption: 'Nothing goes to the model, so its GPU costs nothing. The chat and memory work.', running: false };
  }
  return {
    title: 'The model server is on',
    caption:
      server.model === 'stand-in'
        ? 'A stand-in for testing answers here; a real deployment starts its GPU for each question.'
        : 'It starts for a question and stops after about 15 quiet minutes; about $1.05 an hour while it runs.',
    running: true,
  };
}
