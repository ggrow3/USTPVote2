import { describe, expect, it } from 'vitest';
import { cameraProblem } from './camera.js';

describe('cameraProblem', () => {
  it('says what to do for each way getUserMedia fails', () => {
    expect(cameraProblem({ name: 'NotAllowedError' })).toMatch(/blocked\. Allow the camera/);
    expect(cameraProblem({ name: 'NotFoundError' })).toMatch(/No camera was found/);
    expect(cameraProblem({ name: 'NotReadableError' })).toMatch(/busy/);
    expect(cameraProblem(new Error('anything else'))).toMatch(/could not be started/);
    expect(cameraProblem(null)).toMatch(/could not be started/);
  });
});
