import { describe, expect, it, vi } from 'vitest';
import { AcademyController } from './academy/academy.controller.js';
import type { Firebase } from './infra/firebase.js';
import type { RequestContext } from './auth/principal.js';

const ids = ['foundations','history','longevity','enhancement','intelligence','democracy','ethics','earth','space','future'];
const ctx = { accountId:'learner-1', operator:null, principal:{name:'Test Learner',email:'learner@example.test'} } as RequestContext;

function fixture({ missing = '', failed = '', existing = false, revoked = false } = {}) {
  const sections = ids.filter(id => id !== missing).map(id => ({id,data:() => ({completed:true,lessonVersion:1})}));
  const attempts = ids.filter(id => id !== failed).map(id => ({data:() => ({section:id,correct:true,assessmentVersion:1,questionVersion:1})}));
  const cert = { exists:existing,data:() => ({certificateId:'existing-id'}) };
  const certificate = { data:() => ({learnerName:'Test Learner',courseTitle:'Introduction to Transhumanism',courseVersion:1,issuedAt:'2026-10-28',revoked}) };
  const reads = {sections:{docs:sections},attempts:{docs:attempts}};
  const create = vi.fn();
  const tx = {get:vi.fn(async () => cert),create};
  const collections = (name:string):any => ({
    doc:(id:string):any => ({
      id,
      collection:collections,
      get:async () => name === 'academyCertificates' ? certificate : cert,
    }),
    get:async () => reads[name as keyof typeof reads] ?? {docs:[]},
  });
  const db = {collection:collections,runTransaction:vi.fn(async (fn:(transaction:{get:typeof tx.get;create:typeof tx.create})=>Promise<unknown>) => fn(tx))};
  return { controller:new AcademyController({db} as unknown as Firebase),db,create,tx };
}

describe('academy certificate eligibility', () => {
  it('refuses a missing reading completion', async () => {
    const {controller,create} = fixture({missing:'space'});
    await expect(controller.issueCertificate(ctx)).rejects.toThrow('Complete all ten');
    expect(create).not.toHaveBeenCalled();
  });
  it('refuses a missing correct assessment', async () => {
    const {controller,create} = fixture({failed:'earth'});
    await expect(controller.issueCertificate(ctx)).rejects.toThrow('Complete all ten');
    expect(create).not.toHaveBeenCalled();
  });
  it('issues a certificate with a unique ID after all requirements', async () => {
    const {controller,create} = fixture();
    const result = await controller.issueCertificate(ctx);
    expect(result.existing).toBe(false);
    expect(result.certificateId).toMatch(/^[0-9a-f-]{36}$/);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('returns an existing certificate without issuing a duplicate', async () => {
    const {controller,create} = fixture({existing:true});
    await expect(controller.issueCertificate(ctx)).resolves.toEqual({certificateId:'existing-id',existing:true});
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects issuance while acting as a test persona', async () => {
    const {controller} = fixture();
    await expect(controller.issueCertificate({...ctx,operator:'admin'})).rejects.toThrow();
  });
  it('verifies active certificates and refuses revoked ones', async () => {
    const id='9c11e6c1-34f1-42b3-a28d-0bd58c5a7210';
    expect(await fixture().controller.verifyCertificate(id)).toMatchObject({valid:true,certificateId:id});
    expect(await fixture({revoked:true}).controller.verifyCertificate(id)).toEqual({valid:false});
  });
  it('rejects malformed verification IDs', async () => {
    await expect(fixture().controller.verifyCertificate('not-a-uuid')).rejects.toThrow('Invalid certificate ID');
  });
});
