import { describe, expect, it } from 'vitest';

import { resolveSandboxConfig } from '../config.js';

describe('sandbox/config', () => {
  it('applies secure defaults for resources and network', () => {
    const resolved = resolveSandboxConfig({
      enabled: true,
      image: 'alpine:3.19',
      user: { uid: 1000, gid: 1000 },
    });

    expect(resolved.network).toBe('none');
    expect(resolved.resources.memory).toBe('512m');
    expect(resolved.resources.cpus).toBe(0.5);
    expect(resolved.resources.pidsLimit).toBe(50);
    expect(resolved.user).toEqual({ uid: 1000, gid: 1000 });
  });

  it('rejects root user mapping (uid=0)', () => {
    expect(() =>
      resolveSandboxConfig({
        enabled: true,
        image: 'alpine:3.19',
        user: { uid: 0, gid: 1000 },
      })
    ).toThrow(/must be > 0|root/i);
  });
});
