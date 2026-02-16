import { describe, expect, it } from 'vitest';

import { resolveSandboxConfig } from '../config.js';
import { buildDockerRunSpec } from '../runner.js';

describe('sandbox/runner', () => {
  it('includes UID/GID mapping, resource limits, and network isolation in docker run args', () => {
    const sandbox = resolveSandboxConfig({
      enabled: true,
      image: 'alpine:3.19',
      user: { uid: 1001, gid: 1002 },
    });

    const spec = buildDockerRunSpec(sandbox, {
      cwd: 'C:\\temp',
      command: '/usr/local/bin/opencode',
      args: ['--version'],
      env: { FOO: 'bar' },
    });

    const argsStr = spec.args.join(' ');
    expect(argsStr).toContain('run');
    expect(argsStr).toContain('--rm');
    expect(argsStr).toContain('--user 1001:1002');
    expect(argsStr).toContain('--memory 512m');
    expect(argsStr).toContain('--cpus 0.5');
    expect(argsStr).toContain('--pids-limit 50');
    expect(argsStr).toContain('--network none');
  });
});
