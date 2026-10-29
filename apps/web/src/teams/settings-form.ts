import type { TeamColor, TeamIcon, TeamJoinPolicy, TeamSettings } from 'ustp-domain';

/** A team's settings as the form edits them: texts never null, the size limit empty while there is none. */
export interface SettingsForm {
  name: string;
  description: string;
  joinPolicy: TeamJoinPolicy;
  joinQuestion: string;
  capacity: number | '' | null;
  memberLink: string;
  color: TeamColor;
  icon: TeamIcon;
}

/** The settings of a team (or of a new one) as the form edits them; nothing else of the team's record comes along. */
export function toForm(settings: TeamSettings): SettingsForm {
  return {
    name: settings.name,
    description: settings.description,
    joinPolicy: settings.joinPolicy,
    joinQuestion: settings.joinQuestion ?? '',
    capacity: settings.capacity,
    memberLink: settings.memberLink ?? '',
    color: settings.color,
    icon: settings.icon,
  };
}

/**
 * What the form sends, for the shared schemas to check: blank texts are none there, an empty limit is none, and the
 * question goes only with a team whose leads decide.
 */
export function fromForm(form: SettingsForm) {
  return {
    ...form,
    joinQuestion: form.joinPolicy === 'approval' ? form.joinQuestion : null,
    capacity: form.capacity === '' || form.capacity === null ? null : Number(form.capacity),
  };
}
