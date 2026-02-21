/**
 * Docker sandbox execution module.
 *
 * Provides secure, resource-isolated command execution inside Docker containers.
 *
 * @module sandbox
 */

export type {
  SandboxNetworkMode,
  SandboxResourceLimits,
  SandboxUserMapping,
  SandboxMount,
  SandboxConfig,
  ResolvedSandboxConfig,
} from './config.js';

export {
  resolveSandboxConfig,
  getHostUserMapping,
  toContainerCommand,
} from './config.js';

export type {
  DockerCommandResult,
} from './docker.js';

export {
  dockerImageExists,
  dockerPullImage,
  dockerRmForceSync,
  runDockerCommand,
} from './docker.js';

export type {
  SandboxRunOptions,
  DockerRunSpec,
} from './runner.js';

export {
  prepareDockerSandbox,
  buildDockerRunSpec,
  disposeDockerRunSpec,
} from './runner.js';

export type {
  ProcessLike,
} from './utils.js';

export {
  createSandboxContainerName,
  registerSandboxCleanupCallback,
  unregisterSandboxCleanupCallback,
  ensureSandboxProcessCleanupHandlers,
  redactDockerArgsForLogging,
} from './utils.js';
