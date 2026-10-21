import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes } from './hash.js';
import { inclusionPath, inclusionProofHex, merkleRoot, verifyInclusion, verifyInclusionHex } from './merkle.js';

// RFC 6962 reference leaves from the Certificate Transparency test suite. Expected values were produced by an
// independent Python implementation and match the published CT reference roots.
const LEAVES = ['', '00', '10', '2021', '3031', '40414243', '5051525354555657', '606162636465666768696a6b6c6d6e6f'].map(
  hexToBytes,
);

const ROOTS = [
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
  'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
  'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77',
  'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
  '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
  'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c',
  '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328',
];

const PATHS: Record<string, string[]> = {
  '0/8': [
    '96a296d224f285c67bee93c30f8a309157f0daa35dc5b87e410b78630a09cfc7',
    '5f083f0a1a33ca076a95279832580db3e0ef4584bdff1f54c8a360f50de3031e',
    '6b47aaf29ee3c2af9af889bc1fb9254dabd31177f16232dd6aab035ca39bf6e4',
  ],
  '5/8': [
    'bc1a0643b12e4d2d7c77918f44e0f4f79a838b6cf9ec5b5c283e1f4d88599e6b',
    'ca854ea128ed050b41b35ffc1b87b8eb2bde461e9e3b5596ece6b9d5975a0ae0',
    'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  ],
  '2/3': ['fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125'],
  '4/7': [
    '4271a26be0d8a84f0bd54c8c302e7cb3a3b5d1fa6780a40bcce2873477dab658',
    'b08693ec2e721597130641e8211e7eedccb4c26413963eee6c1e2ed16ffb1a5f',
    'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  ],
  '6/7': [
    '0ebc5d3437fbe2db158b9f126a1d118e308181031d0a949f8dededebc558ef6a',
    'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  ],
};

describe('RFC 9162 Merkle tree', () => {
  it('matches the reference roots for trees of size 0..8', () => {
    ROOTS.forEach((root, n) => expect(bytesToHex(merkleRoot(LEAVES.slice(0, n)))).toBe(root));
  });

  it('matches the reference inclusion paths', () => {
    for (const [key, expected] of Object.entries(PATHS)) {
      const [m, n] = key.split('/').map(Number) as [number, number];
      expect(inclusionPath(LEAVES.slice(0, n), m).map(bytesToHex), key).toEqual(expected);
    }
  });

  it('verifies every leaf of every tree up to 33 leaves', () => {
    const leaves = Array.from({ length: 33 }, (_, i) => Uint8Array.of(i, i * 7));
    for (let n = 1; n <= leaves.length; n++) {
      const tree = leaves.slice(0, n);
      const root = merkleRoot(tree);
      for (let m = 0; m < n; m++) {
        expect(verifyInclusion(tree[m]!, m, n, inclusionPath(tree, m), root), `${m}/${n}`).toBe(true);
      }
    }
  });

  it('rejects a wrong leaf, index, size, path or root', () => {
    const tree = LEAVES.slice(0, 7);
    const root = merkleRoot(tree);
    const proof = inclusionPath(tree, 4);
    expect(verifyInclusion(tree[4]!, 4, 7, proof, root)).toBe(true);
    expect(verifyInclusion(tree[3]!, 4, 7, proof, root)).toBe(false);
    expect(verifyInclusion(tree[4]!, 5, 7, proof, root)).toBe(false);
    // A size that changes the path's shape. (Size 8 walks the same shape as 7 for leaf 4 and reproduces the
    // root; that is why tree size and root are always taken together from a signed block header.)
    expect(verifyInclusion(tree[4]!, 4, 5, proof, root)).toBe(false);
    expect(verifyInclusion(tree[4]!, 4, 7, proof.slice(0, 2), root)).toBe(false);
    expect(verifyInclusion(tree[4]!, 4, 7, [...proof, root], root)).toBe(false);
    expect(verifyInclusion(tree[4]!, 4, 7, proof, merkleRoot(tree.slice(0, 6)))).toBe(false);
    expect(verifyInclusion(tree[4]!, 7, 7, proof, root)).toBe(false);
  });

  it('round-trips hex proofs and rejects malformed ones', () => {
    const commitments = ['aa', 'bb', 'cc', 'dd', 'ee'];
    const proof = inclusionProofHex(commitments, 2);
    expect(proof.treeSize).toBe(5);
    expect(verifyInclusionHex('cc', proof)).toBe(true);
    expect(verifyInclusionHex('cd', proof)).toBe(false);
    expect(verifyInclusionHex('not-hex', proof)).toBe(false);
    expect(verifyInclusionHex('cc', { ...proof, path: ['zz'] })).toBe(false);
  });

  it('refuses out-of-range leaf indexes when building a path', () => {
    expect(() => inclusionPath(LEAVES, 8)).toThrow(RangeError);
    expect(() => inclusionPath([], 0)).toThrow(RangeError);
  });
});
