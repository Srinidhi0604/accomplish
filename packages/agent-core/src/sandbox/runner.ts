import path from 'path';

import type { SandboxConfig, ResolvedSandboxConfig } from './config.js';
import { resolveSandboxConfig, toContainerCommand } from './config.js';
import { dockerImageExists, dockerPullImage, dockerRmForceSync } from './docker.js';
import {
  createSandboxContainerName,
  ensureSandboxProcessCleanupHandlers,
  redactDockerArgsForLogging,
  registerSandboxCleanupCallback,
  unregisterSandboxCleanupCallback,
} from './utils.js';

/**
 * Options for executing a command inside the Docker sandbox.
 */
export interface SandboxRunOptions {
  /** Host working directory to mount and use as container workdir. */
  cwd: string;
  /** Command to execute in the container. */
  command: string;
  /** Arguments for the command to execute in the container. */
  args: string[];
  /** Environment variables to pass through into the container. */
  env: NodeJS.ProcessEnv;
}

/**
 * Docker CLI invocation spec used by the PTY adapter.
 */
export interface DockerRunSpec {
  /** Executable (always `docker`). */
  command: string;
  /** Docker arguments including `run` and image/command. */
  args: string[];
  /** Generated container name (used for cleanup). */
  containerName: string;
  /** Redacted arguments safe for logging. */
  redactedArgs: string[];
  /** Cleanup function registered for this container. */
  cleanup: () => void;
}

/**
 * Ensures the configured Docker image exists locally; pulls it if missing.
 *
 * @param config Sandbox configuration
 * @param log Optional logger for progress output
 * @returns Resolved sandbox configuration
 */
export async function prepareDockerSandbox(
  config: SandboxConfig,
  log?: (message: string) => void
): Promise<ResolvedSandboxConfig> {
  const resolved = resolveSandboxConfig(config);

  ensureSandboxProcessCleanupHandlers();

  log?.(`[Sandbox] Checking Docker image: ${resolved.image}`);
  const exists = await dockerImageExists(resolved.image, resolved.preflightTimeoutMs);

  if (!exists) {
    log?.(`[Sandbox] Image missing; pulling: ${resolved.image}`);
    await dockerPullImage(resolved.image, resolved.pullTimeoutMs, (chunk) => {
      const cleaned = chunk.trim();
      if (cleaned) {
        log?.(`[Sandbox] ${cleaned}`);
      }
    });
  }

  return resolved;
}

/**
 * Builds the Docker `run` invocation for running a command inside the sandbox.
 *
 * This function performs no IO. It only constructs arguments in a safe array form.
 *
 * @param sandbox Sandbox configuration (resolved)
 * @param options Command execution options
 * @returns Docker run specification
 */
export function buildDockerRunSpec(sandbox: ResolvedSandboxConfig, options: SandboxRunOptions): DockerRunSpec {
  const containerName = createSandboxContainerName(sandbox.containerNamePrefix);

  const mountHostPath = path.resolve(options.cwd);
  const mountContainerPath = sandbox.mount.containerPath;
  const mountMode = sandbox.mount.readOnly ? ':ro' : ':rw';
  const volumeArg = `${mountHostPath}:${mountContainerPath}${mountMode}`;

  const dockerArgs: string[] = [
    'run',
    '--rm',
    '--name',
    containerName,
    '--user',
    `${sandbox.user.uid}:${sandbox.user.gid}`,
    '--memory',
    sandbox.resources.memory,
    '--cpus',
    String(sandbox.resources.cpus),
    '--pids-limit',
    String(sandbox.resources.pidsLimit),
    '--network',
    sandbox.network,
    '--volume',
    volumeArg,
    '--workdir',
    sandbox.workdir,
  ];

  const mergedEnv: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(options.env)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => [key, value as string])
    ),
    ...sandbox.env,
  };

  for (const [key, value] of Object.entries(mergedEnv)) {
    if (!key || key.includes('=') || /\0/u.test(key)) {
      continue;
    }
    dockerArgs.push('--env', `${key}=${value}`);
  }

  const containerCommand = toContainerCommand(options.command);
  dockerArgs.push(sandbox.image, containerCommand, ...options.args);

  const cleanup = (): void => {
    dockerRmForceSync(containerName);
  };

  registerSandboxCleanupCallback(cleanup);

  return {
    command: 'docker',
    args: dockerArgs,
    containerName,
    redactedArgs: redactDockerArgsForLogging(dockerArgs),
    cleanup,
  };
}

/**
 * Disposes a `DockerRunSpec` created by `buildDockerRunSpec`.
 *
 * This removes the process-exit cleanup callback and performs a best-effort
 * container removal.
 *
 * @param spec Docker run spec
 */
export function disposeDockerRunSpec(spec: DockerRunSpec): void {
  unregisterSandboxCleanupCallback(spec.cleanup);
  spec.cleanup();
}
