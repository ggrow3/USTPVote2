import { describe, expect, it } from 'vitest';
import { jokeLines, pickVoice } from './joke-voice.js';
import { rms, SpeakingDetector } from './speaking.js';

describe('speaking', () => {
  it('measures a block’s loudness', () => {
    expect(rms([])).toBe(0);
    expect(rms([0, 0, 0])).toBe(0);
    expect(rms([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5);
  });

  it('starts on a loud block, carries on over quieter ones, and stops a moment after', () => {
    const d = new SpeakingDetector(0.02, 0.01, 400);
    expect(d.update(0.015, 0)).toBe(false);
    expect(d.update(0.05, 100)).toBe(true);
    // Between words: quieter, but over the level that keeps it going.
    expect(d.update(0.012, 200)).toBe(true);
    // Silence: still speaking for the hold, then not.
    expect(d.update(0.001, 500)).toBe(true);
    expect(d.update(0.001, 600)).toBe(false);
    // Once stopped, the quieter level does not start it again.
    expect(d.update(0.015, 700)).toBe(false);
  });
});

describe('the assistant’s spoken joke', () => {
  it('reads the setup, then the punchline', () => {
    expect(jokeLines('Why did the AI go back to school?\nTo work on its learning rate.')).toEqual([
      'Why did the AI go back to school?',
      'To work on its learning rate.',
    ]);
    expect(jokeLines('  One line  \n\n')).toEqual(['One line']);
  });

  it('prefers an English voice that runs on the device', () => {
    const voices = [
      { name: 'Google US English', lang: 'en-US', localService: false, default: false },
      { name: 'Microsoft Zira', lang: 'en-US', localService: true, default: false },
      { name: 'Microsoft Hedda', lang: 'de-DE', localService: true, default: true },
    ];
    expect(pickVoice(voices)?.name).toBe('Microsoft Zira');
    expect(pickVoice(voices.slice(0, 1))?.name).toBe('Google US English');
    expect(pickVoice([voices[2]!])).toBeNull();
  });
});
