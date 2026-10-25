import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { LocalPhotoChecker } from './photos/checker.js';
import { normalizePhoto, PhotoInputError } from './photos/image.js';

function solid(width: number, height: number, gray: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: gray, g: gray, b: gray } } });
}

describe('normalizePhoto', () => {
  it('re-encodes as JPEG and drops all metadata, including EXIF', async () => {
    const input = await solid(400, 300, 128)
      .withExif({ IFD0: { Copyright: 'camera owner', ImageDescription: 'taken at home' } })
      .png()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const out = await normalizePhoto(input);
    const meta = await sharp(out.jpeg).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 400, height: 300 });
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(out.jpeg.includes(Buffer.from('taken at home'))).toBe(false);
  });

  it('applies EXIF orientation before measuring and storing', async () => {
    const rotated = await solid(400, 300, 128).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect(await normalizePhoto(rotated)).toMatchObject({ width: 300, height: 400 });
  });

  it('shrinks large photos to at most 1024 pixels on the long side', async () => {
    const out = await normalizePhoto(await solid(3000, 2000, 128).jpeg().toBuffer());
    expect([out.width, out.height]).toEqual([1024, 683]);
  });

  it('rejects files that are not images, unsupported formats and tiny images', async () => {
    await expect(normalizePhoto(Buffer.from('definitely not an image'))).rejects.toThrow(PhotoInputError);
    await expect(normalizePhoto(await solid(300, 300, 128).gif().toBuffer())).rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(normalizePhoto(await solid(150, 400, 128).png().toBuffer())).rejects.toThrow(/at least 200/);
  });
});

describe('LocalPhotoChecker (emulator stand-in)', () => {
  it('flags only dark images', async () => {
    const checker = new LocalPhotoChecker();
    expect((await checker.check(await solid(300, 300, 5).jpeg().toBuffer())).underExposed).toBe('VERY_LIKELY');
    expect((await checker.check(await solid(300, 300, 160).jpeg().toBuffer())).underExposed).toBe('VERY_UNLIKELY');
  });
});

describe('photo configuration', () => {
  const emulators = { FIRESTORE_EMULATOR_HOST: 'x', FIREBASE_AUTH_EMULATOR_HOST: 'y', GCLOUD_PROJECT: 'demo-p' };

  it('uses Cloud Vision in real projects and refuses the local stand-in there', () => {
    expect(loadConfig({}).photoChecker).toBe('vision');
    expect(() => loadConfig({ PHOTO_CHECKER: 'local' })).toThrow(/only allowed with the Firebase emulators/);
    expect(loadConfig({}).photosBucket).toBeNull();
    expect(loadConfig({ PHOTOS_BUCKET: 'ustp-voting-prod-photos' }).photosBucket).toBe('ustp-voting-prod-photos');
  });

  it('defaults to the local stand-in and a project bucket with the emulators', () => {
    expect(loadConfig(emulators)).toMatchObject({ photoChecker: 'local', photosBucket: 'demo-p-profile-photos' });
  });
});
