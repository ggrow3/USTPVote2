import { describe, expect, it } from 'vitest';
import { faceCheckMessage } from './photo-check.js';

describe('faceCheckMessage', () => {
  it('says the check passed when nothing was flagged', () => {
    expect(faceCheckMessage({ status: 'accepted', flags: [], decisionReason: null })).toEqual({
      tone: 'passed',
      text: 'The automatic check passed: one face, clearly visible, in focus and well lit.',
      advice: [],
    });
  });

  it('names what was found and what to do about it while the photo waits for review', () => {
    const message = faceCheckMessage({ status: 'needs_review', flags: ['no face found', 'too dark'], decisionReason: null });
    expect(message.tone).toBe('flagged');
    expect(message.text).toMatch(/found: no face found, too dark\. A Membership Admin will look at it/);
    expect(message.advice).toEqual(['Use a photo that shows your face.', 'Take the photo in better light.']);
  });

  it('gives the reviewer’s reason for a rejected photo, and credits an accepted flagged one to the reviewer', () => {
    const rejected = faceCheckMessage({ status: 'rejected', flags: ['more than one face'], decisionReason: 'Two people in it' });
    expect(rejected).toMatchObject({ tone: 'rejected', advice: ['Use a photo of just you.'] });
    expect(rejected.text).toMatch(/did not accept this photo: Two people in it\. Please upload a new one\./);
    const overruled = faceCheckMessage({ status: 'accepted', flags: ['blurry'], decisionReason: 'Fine' });
    expect(overruled).toMatchObject({ tone: 'passed', advice: [] });
    expect(overruled.text).toMatch(/accepted this photo after the automatic check found: blurry/);
  });
});
