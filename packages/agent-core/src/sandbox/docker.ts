import { spawn, spawnSync } from 'child_process';

/**
 * Result of running a Docker CLI command.
 */
export interface DockerCommandResult {
  /** Exit code returned by the Docker CLI process. */
  exitCode: number;
  /** Captured stdout (UTF-8). */
  stdout: string;
  /** Captured stderr (UTF-8). */
  stderr: string;
}

/**
 * Checks whether a Docker image exists locally using `docker images -q <image>`.
 *
 * @param image Docker image name
 * @param timeoutMs Timeout in milliseconds
 * @returns True if the image exists locally
 */
export async function dockerImageExists(image: string, timeoutMs: number): Promise<boolean> {
  const result = await runDockerCommand(['images', '-q', image], { timeoutMs });
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

/**
 * Pulls a Docker image using `docker pull <image>`.
 *
 * @param image Docker image name
 * @param timeoutMs Timeout in milliseconds
 * @param onProgress Optional callback invoked with stdout/stderr chunks
 */
export async function dockerPullImage(
  image: string,
  timeoutMs: number,
  onProgress?: (chunk: string) => void
): Promise<void> {
  const result = await runDockerCommand(['pull', image], { timeoutMs, onProgress });
  if (result.exitCode !== 0) {
    throw new Error(`docker pull failed for ${image}: ${result.stderr || result.stdout}`);
  }
}

/**
 * Force-removes a container by name using `docker rm -f <name>`.
 *
 * This is intended for best-effort cleanup on process exit.
 *
 * @param containerName Docker container name
 */
export function dockerRmForceSync(containerName: string): void {
  spawnSync('docker', ['rm', '-f', containerName], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

interface RunDockerCommandOptions {
  timeoutMs: number;
  onProgress?: (chunk: string) => void;
}

/**
 * Runs a Docker CLI command safely (no shell), capturing stdout/stderr.
 *
 * @param args Docker arguments (excluding the `docker` binary)
 * @param options Run options
 * @returns Result containing exit code and collected output
 */
export function runDockerCommand(args: string[], options: RunDockerCommandOptions): Promise<DockerCommandResult> {
  return new Promise((resolve) => {
    const child = spawn('docker', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore.
      }
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      options.onProgress?.(chunk.toString('utf-8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      options.onProgress?.(chunk.toString('utf-8'));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: typeof code === 'number' ? code : 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    });

    child.on('error', () => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout: '', stderr: 'Failed to start docker command' });
    });
  });
}
