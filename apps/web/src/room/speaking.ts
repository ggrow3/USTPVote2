/**
 * Who is speaking in the room's call (design §5.10), worked out in each browser from the sound it hears: a voice is
 * speaking while its level stays over a threshold, and for a moment after, so the ring around a name does not flicker
 * between words. Nothing about it is sent anywhere.
 */

/** The loudness of a block of samples (-1…1): its root mean square. */
export function rms(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

/**
 * Speech after the browser's noise suppression sits well above 0.02; a quiet room well below 0.01. Starting needs the
 * higher level and carrying on only the lower, and speaking lasts `holdMs` past the last loud block.
 */
export class SpeakingDetector {
  speaking = false;
  private lastLoud = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly start = 0.02,
    private readonly keep = 0.01,
    private readonly holdMs = 400,
  ) {}

  /** The level heard at time `now` (ms); whether the voice is speaking. */
  update(level: number, now: number): boolean {
    if (level >= (this.speaking ? this.keep : this.start)) this.lastLoud = now;
    this.speaking = now - this.lastLoud < this.holdMs;
    return this.speaking;
  }
}
