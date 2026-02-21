import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';

class MockProcess extends EventEmitter {
  exitCode: number | undefined;
  exitedWith: number | undefined;

  exit(code?: number): never {
    this.exitedWith = code;
    throw new Error('process.exit');
  }
}

describe('sandbox/utils signal handling', () => {
  it('runs cleanup callbacks on SIGINT and exits with code 130', async () => {
    vi.resetModules();
    const utils = await import('../utils.js');

    const mockProcess = new MockProcess();
    let cleanupRuns = 0;

    utils.registerSandboxCleanupCallback(() => {
      cleanupRuns += 1;
    });

    utils.ensureSandboxProcessCleanupHandlers(mockProcess as any);

    try {
      mockProcess.emit('SIGINT');
    } catch {
      // Expected from MockProcess.exit
    }

    expect(cleanupRuns).toBe(1);
    expect(mockProcess.exitedWith).toBe(130);
  });
});
