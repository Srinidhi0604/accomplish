import { randomBytes } from 'crypto';

/**
 * Minimal process interface used for testing signal handling without mutating
 * the real Node.js global process.
 */
export interface ProcessLike {
  on(event: 'exit', listener: (code: number) => void): unknown;
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  removeListener(event: 'exit', listener: (code: number) => void): unknown;
  removeListener(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  exit(code?: number): never;
  /** Matches Node.js `process.exitCode` typing in this repo. */
  exitCode?: NodeJS.Process['exitCode'];
  /** Optional process id (available on real `process`). */
  pid?: number;
  /** Optional kill function (available on real `process`). */
  kill?: (pid: number, signal: NodeJS.Signals) => boolean;
}

type CleanupCallback = () => void;

const cleanupCallbacks = new Set<CleanupCallback>();
const registeredProcesses = new WeakSet<object>();
let cleanupInProgress = false;

/**
 * Generates a unique Docker container name.
 *
 * @param prefix Container name prefix
 * @returns A container name safe to pass to Docker
 */
export function createSandboxContainerName(prefix: string): string {
  const suffix = randomBytes(8).toString('hex');
  return `${prefix}-${suffix}`;
}

/**
 * Registers a cleanup callback that will run on process exit and on SIGINT/SIGTERM.
 *
 * @param callback Cleanup callback
 */
export function registerSandboxCleanupCallback(callback: CleanupCallback): void {
  cleanupCallbacks.add(callback);
}

/**
 * Unregisters a previously registered sandbox cleanup callback.
 *
 * @param callback Cleanup callback
 */
export function unregisterSandboxCleanupCallback(callback: CleanupCallback): void {
  cleanupCallbacks.delete(callback);
}

/**
 * Ensures that process-level cleanup handlers are installed.
 *
 * Handlers are installed only once per process. When triggered, all registered
 * cleanup callbacks run exactly once.
 *
 * @param targetProcess Process object (defaults to global `process`)
 */
export function ensureSandboxProcessCleanupHandlers(targetProcess: ProcessLike = process): void {
  if (registeredProcesses.has(targetProcess as unknown as object)) {
    return;
  }
  registeredProcesses.add(targetProcess as unknown as object);

  const runCleanup = (): void => {
    if (cleanupInProgress) {
      return;
    }
    cleanupInProgress = true;

    const callbacks = Array.from(cleanupCallbacks);
    for (const callback of callbacks) {
      try {
        callback();
      } catch {
        // Best-effort cleanup.
      }
    }

    cleanupInProgress = false;
  };

  const onExit = (_code: number): void => {
    runCleanup();
  };

  const onSigint = (): void => {
    runCleanup();

    if (typeof targetProcess.exitCode !== 'number') {
      targetProcess.exitCode = 130;
    }

    // Prevent infinite recursion if we re-send the signal.
    targetProcess.removeListener('SIGINT', onSigint);

    if (typeof targetProcess.kill === 'function' && typeof targetProcess.pid === 'number') {
      try {
        targetProcess.kill(targetProcess.pid, 'SIGINT');
        return;
      } catch {
        // Fallback to exit.
      }
    }

    targetProcess.exit(targetProcess.exitCode);
  };

  const onSigterm = (): void => {
    runCleanup();

    if (typeof targetProcess.exitCode !== 'number') {
      targetProcess.exitCode = 143;
    }

    // Prevent infinite recursion if we re-send the signal.
    targetProcess.removeListener('SIGTERM', onSigterm);

    if (typeof targetProcess.kill === 'function' && typeof targetProcess.pid === 'number') {
      try {
        targetProcess.kill(targetProcess.pid, 'SIGTERM');
        return;
      } catch {
        // Fallback to exit.
      }
    }

    targetProcess.exit(targetProcess.exitCode);
  };

  targetProcess.on('exit', onExit);
  targetProcess.on('SIGINT', onSigint);
  targetProcess.on('SIGTERM', onSigterm);

  // If a consumer wants to remove handlers, they can clear the process by
  // removing listeners directly; we intentionally do not expose removers.
}

/**
 * Redacts Docker arguments that may contain secrets (e.g. values passed via `--env`).
 *
 * @param args Docker CLI argument array
 * @returns Redacted argument array suitable for logging
 */
export function redactDockerArgsForLogging(args: string[]): string[] {
  const redacted: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--env') {
      redacted.push(arg);
      const next = args[index + 1];
      if (typeof next === 'string') {
        const eqIndex = next.indexOf('=');
        const key = eqIndex >= 0 ? next.slice(0, eqIndex) : next;
        redacted.push(`${key}=<redacted>`);
        index += 1;
        continue;
      }
    }
    redacted.push(arg);
  }
  return redacted;
}
