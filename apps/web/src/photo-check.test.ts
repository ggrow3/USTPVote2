import { describe, expect, it } from 'vitest';
import { faceCheckMessage, gravatarProblem } from './photo-check.js';

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

describe('gravatarProblem', () => {
  it('says plainly why there is no Gravatar picture, and offers the upload', () => {
    expect(gravatarProblem(404, 'Gravatar has no picture for robin@example.test, or none rated G', 'robin@example.test')).toBe(
      'Gravatar has no picture for robin@example.test, or none rated G. You can upload a photo instead.',
    );
    expect(gravatarProblem(503, 'Gravatar is not answering; try again shortly', null)).toMatch(/^Gravatar is not answering right now\./);
    expect(gravatarProblem(409, 'sign in with a verified email address to use its Gravatar', null)).toBe(
      'Sign in with a verified email address to use its Gravatar. You can upload a photo instead.',
    );
    expect(gravatarProblem(0, 'Failed to fetch.', null)).toBe('Failed to fetch. You can upload a photo instead.');
  });
});
