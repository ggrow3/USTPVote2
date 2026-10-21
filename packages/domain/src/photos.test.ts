import { describe, expect, it } from 'vitest';
import { photoVerdict, type PhotoSignals } from './photos.js';

const good: PhotoSignals = {
  faceCount: 1,
  faceConfidence: 0.95,
  blurred: 'VERY_UNLIKELY',
  underExposed: 'UNLIKELY',
  adult: 'VERY_UNLIKELY',
  violence: 'VERY_UNLIKELY',
  racy: 'UNLIKELY',
};

describe('photo verdict', () => {
  it('passes one clear, well-lit, appropriate face', () => {
    expect(photoVerdict(good)).toEqual({ verdict: 'pass', reasons: [] });
  });

  it('flags missing, multiple or unclear faces', () => {
    expect(photoVerdict({ ...good, faceCount: 0, faceConfidence: 0 }).reasons).toEqual(['no face found']);
    expect(photoVerdict({ ...good, faceCount: 2 }).reasons).toEqual(['more than one face']);
    expect(photoVerdict({ ...good, faceConfidence: 0.4 }).reasons).toEqual(['face not clearly visible']);
  });

  it('flags quality and SafeSearch problems at LIKELY or above, but not at POSSIBLE', () => {
    expect(photoVerdict({ ...good, blurred: 'POSSIBLE', racy: 'POSSIBLE' }).verdict).toBe('pass');
    expect(photoVerdict({ ...good, blurred: 'LIKELY', underExposed: 'VERY_LIKELY' }).reasons).toEqual([
      'blurry',
      'too dark',
    ]);
    expect(photoVerdict({ ...good, violence: 'LIKELY' })).toEqual({ verdict: 'flag', reasons: ['may be inappropriate'] });
  });

  it('treats UNKNOWN as not detected', () => {
    expect(photoVerdict({ ...good, blurred: 'UNKNOWN', adult: 'UNKNOWN' }).verdict).toBe('pass');
  });
});
