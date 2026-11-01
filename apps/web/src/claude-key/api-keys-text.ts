import type { ApiKeyName, ApiKeyStatus } from 'ustp-domain';

/** What Admin › API keys says about the tab as a whole, above the cards. */
export const KEYS_INTRO =
  'Keys for the services this site asks. Each one is optional. A key is kept in Google Secret Manager, and once it is ' +
  'saved nobody can see it here, System Admins included: only its last four characters are shown.';

/** Each card's heading. */
export const KEY_TITLES: Readonly<Record<ApiKeyName, string>> = {
  fec: 'FEC key (api.data.gov)',
  openstates: 'Open States key',
  civic: 'Google Civic Information key',
};

/** What each key is for, and where a System Admin gets one. */
export const KEY_USES: Readonly<Record<ApiKeyName, { readonly text: string; readonly where: string; readonly url: string }>> = {
  fec: {
    text: 'The Federal Election Commission’s candidates for Congress and President, on the Candidates and Your area pages.',
    where: 'Get a free key at api.data.gov',
    url: 'https://api.data.gov/signup/',
  },
  openstates: {
    text: 'Who sits in the state legislature for a member’s districts, on the Your area page.',
    where: 'Get a free key from your Open States account',
    url: 'https://openstates.org/account/profile/',
  },
  civic: {
    text: 'The ballot’s contests for a ZIP code, while Google has an election loaded, on the Candidates and Your area pages.',
    where: 'Create a key in Google Cloud with the Civic Information API turned on',
    url: 'https://console.cloud.google.com/apis/library/civicinfo.googleapis.com',
  },
};

/** What the site does with no key at all for the service. */
const WITHOUT: Readonly<Record<ApiKeyName, string>> = {
  fec: 'the FEC’s shared demo key is used, which allows only a few lookups an hour for the whole site, so candidates can be missing at busy times',
  openstates: 'state legislators are left out of the Your area page',
  civic: 'the ballot’s contests are left out of the Candidates and Your area pages',
};

/** What each key looks like, under its field. */
const SHAPES: Readonly<Record<ApiKeyName, string>> = {
  fec: '40 letters and digits.',
  openstates: '36 characters, like 1b2c3d4e-0000-….',
  civic: 'Starts with AIza.',
};

const day = (iso: string, locale?: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

/** Which key is in use: one added here (by whom, when it is known), the deployment's, or none and what that means. */
export function apiKeyStatusText(status: ApiKeyStatus, locale?: string): string {
  if (status.source === 'deployment') return 'The deployment’s own key is in use (set in Terraform). A key added here takes its place.';
  if (status.source === 'none') return `No key is set, so ${WITHOUT[status.name]}.`;
  const added = status.addedAt ? ` on ${day(status.addedAt, locale)}` : '';
  if (!status.addedBy) return `A key is set. It was added${added} outside this app, so who added it is not known here.`;
  return `A key is set. It ends in ${status.hint} and was added${added} by ${status.addedBy.name}.`;
}

export function apiKeyHintText(name: ApiKeyName, tried: boolean): string {
  const trial = tried
    ? 'A key is tried with its service before it is saved, and one the service does not accept is not kept.'
    : 'With the emulators a key is saved without being tried.';
  return `${SHAPES[name]} ${trial}`;
}

/** The confirmation before a key added here is removed: what is used instead, and that the key stays valid. */
export function removeConfirmText(status: ApiKeyStatus): string {
  const after = status.deploymentKey ? 'The deployment’s own key is used again.' : `Without a key, ${WITHOUT[status.name]}.`;
  return `${after} The key stays valid at the service: to revoke it, delete it there too.`;
}
