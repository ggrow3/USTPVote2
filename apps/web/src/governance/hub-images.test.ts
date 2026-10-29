import { describe, expect, it } from 'vitest';
import { hubImageFileProblem } from './hub-images.js';

const file = (type: string, bytes = 1000) => new File([new Uint8Array(bytes)], 'image', { type });
const sized = (width: number, height: number) => async () => ({ width, height });
const unknown = async () => null;

describe('checking an image before it is uploaded', () => {
  it('takes PNG, JPEG and WebP up to 5 MB', async () => {
    expect(await hubImageFileProblem('cover', file('image/gif'), unknown)).toBe('Use a PNG, JPEG or WebP image.');
    expect(await hubImageFileProblem('background', file('image/jpeg', 5 * 1024 * 1024 + 1), unknown)).toBe(
      'The background photo must be 5 MB or smaller.',
    );
  });

  it('says what size is needed, as the server would', async () => {
    expect(await hubImageFileProblem('cover', file('image/png'), sized(1500, 500))).toBeNull();
    expect(await hubImageFileProblem('cover', file('image/png'), sized(1920, 1080))).toBe(
      'The cover banner must be 3:1 and at least 1120×374 pixels, such as 1500×500; this one is 1920×1080.',
    );
    expect(await hubImageFileProblem('background', file('image/webp'), sized(1280, 720))).toMatch(/^The background photo must be at least 1920×1080/);
    expect(await hubImageFileProblem('logo', file('image/png'), sized(32, 32))).toBe('The logo must be at least 64×64 pixels.');
  });

  it('leaves the size to the server when the browser cannot read the image', async () => {
    expect(await hubImageFileProblem('background', file('image/jpeg'), unknown)).toBeNull();
  });
});
