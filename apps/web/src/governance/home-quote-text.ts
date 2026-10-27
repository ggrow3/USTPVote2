import type { HomeQuoteChange } from 'ustp-domain';

/** Wording for the home page quote's settings (design §10.5). */

/** One unsaved change in words: "Hide the quote", "Who said it: Lyndon B. Johnson". */
export function describeQuoteChange(change: HomeQuoteChange): string {
  switch (change.part) {
    case 'shown':
      return change.to ? 'Show the quote' : 'Hide the quote';
    case 'text':
      return change.to ? `Quote: “${change.to}”` : 'Quote: left empty';
    case 'attribution':
      return change.to ? `Who said it: ${change.to}` : 'Who said it: left empty';
    case 'source':
      return change.to ? `Source: ${change.to}` : 'Source: removed';
  }
}
