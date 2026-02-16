import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { describe, expect, it } from 'vitest';

import { resolveSandboxConfig } from '../config.js';
import { prepareDockerSandbox, buildDockerRunSpec, disposeDockerRunSpec } from '../runner.js';

function isDockerAvailable(): boolean {
  try {
    execFileSync('docker', ['version'], { stdio: 'ignore', timeout: 5000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

describe('sandbox file permissions (integration)', () => {
  it('preserves file ownership via --user uid:gid on mounted volume', async () => {
    const getuid = (process as unknown as { getuid?: () => number }).getuid;
    const getgid = (process as unknown as { getgid?: () => number }).getgid;

    if (process.platform === 'win32' || !getuid || !getgid) {
      return;
    }
    if (!isDockerAvailable()) {
      return;
    }

    const uid = getuid();
    const gid = getgid();
    if (uid === 0) {
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accomplish-sandbox-'));

    const sandbox = await prepareDockerSandbox({
      enabled: true,
      image: 'alpine:3.19',
      user: { uid, gid },
      network: 'none',
    });

    const spec = buildDockerRunSpec(sandbox, {
      cwd: tempDir,
      command: 'sh',
      args: ['-lc', 'touch testfile'],
      env: {},
    });

    try {
      execFileSync(spec.command, spec.args, { stdio: 'ignore', timeout: 60_000, windowsHide: true });
    } finally {
      disposeDockerRunSpec(spec);
    }

    const stat = fs.statSync(path.join(tempDir, 'testfile'));
    expect(stat.uid).toBe(uid);
    expect(stat.gid).toBe(gid);
  });
});
