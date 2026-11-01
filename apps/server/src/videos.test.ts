import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { byteRange, videoTypeOf } from './videos/videos.js';

/** The first bytes of real files: an MP4's `ftyp` box, and WebM and Matroska EBML headers. */
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42\0\0\0\0mp42isom', 'latin1')]);
const ebml = (docType: string) =>
  Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08]),
    Buffer.from([0x42, 0x82, 0x80 | docType.length]),
    Buffer.from(docType, 'latin1'),
    Buffer.from([0x42, 0x87, 0x81, 0x04, 0x42, 0x85, 0x81, 0x02]),
  ]);

describe('videoTypeOf', () => {
  it('knows an MP4 and a WebM by their first bytes', () => {
    expect(videoTypeOf(mp4)).toBe('video/mp4');
    expect(videoTypeOf(ebml('webm'))).toBe('video/webm');
  });

  it('refuses Matroska, other files and scraps', () => {
    expect(videoTypeOf(ebml('matroska'))).toBeNull();
    expect(videoTypeOf(Buffer.from('%PDF-1.7\n'))).toBeNull();
    expect(videoTypeOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(videoTypeOf(mp4.subarray(0, 8))).toBeNull();
    expect(videoTypeOf(Buffer.alloc(0))).toBeNull();
  });
});

describe('byteRange', () => {
  it('reads the ranges players ask for, ends included', () => {
    expect(byteRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
    expect(byteRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(byteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
    expect(byteRange('bytes=0-9, 20-29', 1000)).toEqual({ start: 0, end: 9 });
  });

  it('sends the whole file for no range or one it does not read, and nothing past the end', () => {
    expect(byteRange(undefined, 1000)).toBeNull();
    expect(byteRange('', 1000)).toBeNull();
    expect(byteRange('items=0-9', 1000)).toBeNull();
    expect(byteRange('bytes=-', 1000)).toBeNull();
    expect(byteRange('bytes=20-10', 1000)).toBeNull();
    expect(byteRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(byteRange('bytes=-0', 1000)).toBe('unsatisfiable');
  });
});

describe('videos bucket', () => {
  it('is unset outside the emulators until VIDEOS_BUCKET is given', () => {
    expect(loadConfig({}).videosBucket).toBeNull();
    expect(loadConfig({ VIDEOS_BUCKET: 'p-videos' }).videosBucket).toBe('p-videos');
  });

  it('defaults to a project bucket with the emulators', () => {
    const emulators = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', GOOGLE_CLOUD_PROJECT: 'demo-p' };
    expect(loadConfig(emulators).videosBucket).toBe('demo-p-videos');
  });
});
