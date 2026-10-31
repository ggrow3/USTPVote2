/**
 * The room's slash commands (design §5.10), typed in the composer. The page turns each into its API call or form; the
 * API has a route per action and never parses commands itself.
 */
export const ROOM_COMMANDS = ['ask', 'decide', 'todo', 'memory', 'forget', 'joke', 'assistant', 'leave-room'] as const;
export type RoomCommand = (typeof ROOM_COMMANDS)[number];

/** What each command does, as the composer's hints say it. */
export const ROOM_COMMAND_HELP: Readonly<Record<RoomCommand, { readonly usage: string; readonly does: string }>> = {
  ask: { usage: '/ask question', does: 'Ask the assistant; it answers from the room’s memory, with links to its sources' },
  decide: { usage: '/decide text', does: 'Log a decision, the group’s' },
  todo: { usage: '/todo task', does: 'Add an action item, with its owner and due date' },
  memory: { usage: '/memory [search]', does: 'See everything the assistant keeps, or search it' },
  forget: { usage: '/forget', does: 'Delete a decision or action item you added' },
  joke: { usage: '/joke', does: 'The assistant tells a lame joke, out loud to anyone in the call' },
  assistant: { usage: '/assistant on|off', does: 'Switch the assistant on or off (Membership Admins)' },
  'leave-room': { usage: '/leave-room', does: 'Withdraw your consent and leave the room, at once' },
};

export type ParsedRoomInput =
  | { readonly kind: 'message'; readonly text: string }
  | { readonly kind: 'command'; readonly command: RoomCommand; readonly args: string }
  | { readonly kind: 'unknown'; readonly command: string };

/**
 * What the composer's text is: a command (`/name` at the very start, then its arguments), an unknown command, or a
 * message. Two slashes (`//…`) send a message starting with one slash.
 */
export function parseRoomInput(input: string): ParsedRoomInput {
  const text = input.trim();
  if (text.startsWith('//')) return { kind: 'message', text: text.slice(1) };
  const match = /^\/([a-z-]+)(?:\s+([\s\S]*))?$/i.exec(text);
  if (!match) return { kind: 'message', text };
  const name = match[1]!.toLowerCase();
  const args = (match[2] ?? '').trim();
  return (ROOM_COMMANDS as readonly string[]).includes(name)
    ? { kind: 'command', command: name as RoomCommand, args }
    : { kind: 'unknown', command: name };
}
