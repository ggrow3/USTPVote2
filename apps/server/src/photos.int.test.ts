import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let admin: Member;
let robin: Member;

const BUCKET = 'demo-ustpvote-profile-photos';

function photo(gray: number, size = 400) {
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: gray, g: gray, b: gray } } });
}

async function applyForMembership(user: Member) {
  const { body: bylaws } = await api.call('GET', '/v1/bylaws/current');
  const res = await api.call('POST', '/v1/registration/applications', user, {
    bylawsVersion: bylaws.version,
    bylawsHash: bylaws.contentHash,
    legalName: user.email,
    dateOfBirth: '1990-04-01',
    attestsAge: true,
    formVersion: 0,
    usVoteEligible: true,
    agreesWithCoreIdeals: true,
    state: 'CA',
    city: 'Oakland',
    postalCode: '94612',
  });
  expect(res.status).toBe(201);
}

async function objectExists(path: string): Promise<boolean> {
  const [exists] = await api.firebase.storage.bucket(BUCKET).file(path).exists();
  return exists;
}

beforeEach(async () => {
  await resetEmulators();
  const [sa1, sa2] = await api.systemAdmins();
  admin = await api.member('membership.admin@example.test');
  await api.grant(admin.accountId, 'membership_admin', sa1);
  await api.call('POST', '/v1/admin/bylaws', admin, { version: '2026.1', title: 'Bylaws', text: 'Article I.' });
  robin = await api.member('robin@example.test');
  await applyForMembership(robin);
});

describe('uploading a profile photo', () => {
  it('normalizes, checks and stores it, without metadata', async () => {
    const original = await photo(128).withExif({ IFD0: { ImageDescription: 'my house' } }).png().toBuffer();
    const res = await api.upload('/v1/me/photo', robin, original, 'image/png');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'accepted', flags: [], width: 400, height: 400, accountId: robin.accountId });

    expect((await api.call('GET', '/v1/me/photo', robin)).body.photoId).toBe(res.body.photoId);
    const image = await api.bytes('/v1/me/photo/image', robin);
    expect(image).toMatchObject({ status: 200, contentType: 'image/jpeg' });
    const meta = await sharp(image.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();

    const check = await api.firebase.db.collection('photo_checks').doc(res.body.checkId).get();
    expect(check.data()).toMatchObject({ checker: 'local', verdict: 'pass', photoId: res.body.photoId });
  });

  it('requires a membership application first', async () => {
    const outsider = await api.member('outsider@example.test');
    const res = await api.upload('/v1/me/photo', outsider, await photo(128).png().toBuffer(), 'image/png');
    expect(res).toMatchObject({ status: 409, body: { detail: 'apply for membership before adding a photo' } });
  });

  it('refuses non-images, tiny images, other formats and oversized uploads', async () => {
    expect((await api.upload('/v1/me/photo', robin, Buffer.from('not an image'), 'image/png')).status).toBe(400);
    const tiny = await api.upload('/v1/me/photo', robin, await photo(128, 100).png().toBuffer(), 'image/png');
    expect(tiny).toMatchObject({ status: 400, body: { detail: expect.stringMatching(/at least 200/) } });
    expect((await api.upload('/v1/me/photo', robin, await photo(128).gif().toBuffer(), 'image/gif')).status).toBe(415);
    expect((await api.upload('/v1/me/photo', robin, Buffer.alloc(5 * 1024 * 1024 + 1), 'image/jpeg')).status).toBe(413);
  });

  it('replaces the previous photo and deletes its image', async () => {
    const first = (await api.upload('/v1/me/photo', robin, await photo(128).png().toBuffer(), 'image/png')).body;
    const second = (await api.upload('/v1/me/photo', robin, await photo(150).png().toBuffer(), 'image/png')).body;
    expect(await objectExists(first.storagePath)).toBe(false);
    expect(await objectExists(second.storagePath)).toBe(true);
    const old = await api.firebase.db.collection('profile_photos').doc(first.photoId).get();
    expect(old.data()).toMatchObject({ status: 'superseded', storagePath: null });
    expect((await api.call('GET', '/v1/me/photo', robin)).body.photoId).toBe(second.photoId);
  });

  it('can be removed by the member', async () => {
    const uploaded = (await api.upload('/v1/me/photo', robin, await photo(128).png().toBuffer(), 'image/png')).body;
    expect((await api.call('DELETE', '/v1/me/photo', robin)).status).toBe(204);
    expect((await api.call('GET', '/v1/me/photo', robin)).status).toBe(404);
    expect(await objectExists(uploaded.storagePath)).toBe(false);
  });
});

describe('reviewing flagged photos', () => {
  it('queues flagged photos; only an admin rejects, with a reason, and the image is deleted', async () => {
    const flagged = (await api.upload('/v1/me/photo', robin, await photo(5).png().toBuffer(), 'image/png')).body;
    expect(flagged).toMatchObject({ status: 'needs_review', flags: ['too dark'] });

    expect((await api.call('GET', '/v1/admin/photos', robin)).status).toBe(403);
    const queue = (await api.call('GET', '/v1/admin/photos?status=needs_review', admin)).body;
    expect(queue.map((p: { photoId: string }) => p.photoId)).toEqual([flagged.photoId]);
    const preview = await api.bytes(`/v1/admin/photos/${flagged.photoId}/image`, admin);
    expect(preview).toMatchObject({ status: 200, contentType: 'image/jpeg' });

    const url = `/v1/admin/photos/${flagged.photoId}/decision`;
    expect((await api.call('POST', url, admin, { decision: 'reject' })).status).toBe(400);
    const rejected = await api.call('POST', url, admin, { decision: 'reject', reason: 'Face is not visible' });
    expect(rejected.body).toMatchObject({ status: 'rejected', storagePath: null, decidedBy: admin.accountId });

    // The member sees why; the image is gone.
    expect((await api.call('GET', '/v1/me/photo', robin)).body).toMatchObject({
      status: 'rejected',
      decisionReason: 'Face is not visible',
    });
    expect((await api.bytes('/v1/me/photo/image', robin)).status).toBe(404);
    expect(await objectExists(flagged.storagePath)).toBe(false);

    const ledger = await api.firebase.db.collection('audit_events').where('type', '==', 'photo.decided').get();
    expect(ledger.docs.map((d) => d.data().payload)).toEqual([
      { photoId: flagged.photoId, decision: 'reject', reason: 'Face is not visible', flags: ['too dark'] },
    ]);
  });

  it('lets an admin accept a flagged photo, but not decide their own', async () => {
    const flagged = (await api.upload('/v1/me/photo', robin, await photo(5).png().toBuffer(), 'image/png')).body;
    const accepted = await api.call('POST', `/v1/admin/photos/${flagged.photoId}/decision`, admin, {
      decision: 'accept',
      reason: 'Dark but recognisable',
    });
    expect(accepted.body).toMatchObject({ status: 'accepted', storagePath: flagged.storagePath });

    await applyForMembership(admin);
    const own = (await api.upload('/v1/me/photo', admin, await photo(5).png().toBuffer(), 'image/png')).body;
    const res = await api.call('POST', `/v1/admin/photos/${own.photoId}/decision`, admin, { decision: 'accept', reason: 'x' });
    expect(res.status).toBe(403);
  });
});
