import { describe, expect, it } from 'vitest';
import { describeQuoteChange } from './home-quote-text.js';

describe('home page quote wording', () => {
  it('describes each change in words', () => {
    expect(describeQuoteChange({ part: 'shown', to: false })).toBe('Hide the quote');
    expect(describeQuoteChange({ part: 'shown', to: true })).toBe('Show the quote');
    expect(describeQuoteChange({ part: 'text', to: 'Vote.' })).toBe('Quote: “Vote.”');
    expect(describeQuoteChange({ part: 'attribution', to: 'Lyndon B. Johnson' })).toBe('Who said it: Lyndon B. Johnson');
    expect(describeQuoteChange({ part: 'source', to: 'August 6, 1965' })).toBe('Source: August 6, 1965');
  });

  it('says when a part was emptied', () => {
    expect(describeQuoteChange({ part: 'text', to: '' })).toBe('Quote: left empty');
    expect(describeQuoteChange({ part: 'attribution', to: '' })).toBe('Who said it: left empty');
    expect(describeQuoteChange({ part: 'source', to: '' })).toBe('Source: removed');
  });
});
