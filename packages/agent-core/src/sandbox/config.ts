import path from 'path';

/**
 * Docker network isolation modes supported by the sandbox.
 *
 * - `none`: No network access (secure default)
 * - `bridge`: Default Docker bridge networking (less secure)
 */
export type SandboxNetworkMode = 'none' | 'bridge';

/**
 * Resource limits applied to the sandbox container.
 */
export interface SandboxResourceLimits {
  /**
   * Memory limit passed to Docker (e.g. `512m`).
   */
  memory: string;
  /**
   * CPU limit passed to Docker (e.g. `0.5`).
   */
  cpus: number;
  /**
   * Max number of processes inside the container.
   */
  pidsLimit: number;
}

/**
 * Host UID/GID mapping used for `docker run --user uid:gid`.
 */
export interface SandboxUserMapping {
  /** Host user id */
  uid: number;
  /** Host group id */
  gid: number;
}

/**
 * Volume mount mapping between host and container.
 */
export interface SandboxMount {
  /** Absolute path on the host */
  hostPath: string;
  /** Absolute path in the container */
  containerPath: string;
  /** Whether the mount is read-only */
  readOnly?: boolean;
}

/**
 * Configuration for running commands inside a Docker sandbox.
 */
export interface SandboxConfig {
  /** Enables sandboxed execution when true. */
  enabled: boolean;

  /** Docker image name (e.g. `alpine:3.19`). */
  image: string;

  /** Network isolation mode (default: `none`). */
  network?: SandboxNetworkMode;

  /** Resource limits (defaults: 512m, 0.5 CPUs, 50 pids). */
  resources?: Partial<SandboxResourceLimits>;

  /** Optional explicit user mapping override. */
  user?: SandboxUserMapping;

  /** Optional mount mapping (defaults to mounting the task working directory at `/workspace`). */
  mount?: Partial<SandboxMount>;

  /** Optional container working directory (default: mount.containerPath). */
  workdir?: string;

  /** Optional environment variables to pass to the container. */
  env?: Record<string, string>;

  /** Timeout (ms) for `docker images -q` preflight (default: 10_000). */
  preflightTimeoutMs?: number;

  /** Timeout (ms) for `docker pull` when the image is missing (default: 300_000). */
  pullTimeoutMs?: number;

  /** Prefix used for generated container names (default: `accomplish-sandbox`). */
  containerNamePrefix?: string;
}

/**
 * Fully-resolved sandbox configuration with defaults applied.
 */
export interface ResolvedSandboxConfig {
  enabled: true;
  image: string;
  network: SandboxNetworkMode;
  resources: SandboxResourceLimits;
  user: SandboxUserMapping;
  mount: SandboxMount;
  workdir: string;
  env: Record<string, string>;
  preflightTimeoutMs: number;
  pullTimeoutMs: number;
  containerNamePrefix: string;
}

const DEFAULT_LIMITS: SandboxResourceLimits = {
  memory: '512m',
  cpus: 0.5,
  pidsLimit: 50,
};

const DEFAULT_CONTAINER_PATH = '/workspace';
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 10_000;
const DEFAULT_PULL_TIMEOUT_MS = 300_000;
const DEFAULT_CONTAINER_NAME_PREFIX = 'accomplish-sandbox';

/**
 * Resolves and validates the sandbox configuration, applying secure defaults.
 *
 * @param config Sandbox configuration input
 * @returns Resolved sandbox configuration
 */
export function resolveSandboxConfig(config: SandboxConfig): ResolvedSandboxConfig {
  if (!config.enabled) {
    throw new Error('resolveSandboxConfig called with sandbox disabled');
  }

  validateDockerImageName(config.image);

  const user = config.user ?? getHostUserMapping();
  validateUserMapping(user);

  const resources: SandboxResourceLimits = {
    memory: config.resources?.memory ?? DEFAULT_LIMITS.memory,
    cpus: config.resources?.cpus ?? DEFAULT_LIMITS.cpus,
    pidsLimit: config.resources?.pidsLimit ?? DEFAULT_LIMITS.pidsLimit,
  };

  validateResourceLimits(resources);

  const network: SandboxNetworkMode = config.network ?? 'none';
  if (network !== 'none' && network !== 'bridge') {
    throw new Error(`Invalid sandbox network mode: ${String(network)}`);
  }

  const containerNamePrefix = config.containerNamePrefix ?? DEFAULT_CONTAINER_NAME_PREFIX;
  validateContainerNamePrefix(containerNamePrefix);

  const mountHostPath = config.mount?.hostPath;
  const hostPath = mountHostPath ? path.resolve(mountHostPath) : '';
  const containerPath = config.mount?.containerPath ?? DEFAULT_CONTAINER_PATH;
  if (!containerPath.startsWith('/')) {
    throw new Error('Sandbox mount.containerPath must be an absolute container path (e.g. /workspace)');
  }

  const mount: SandboxMount = {
    hostPath,
    containerPath,
    readOnly: config.mount?.readOnly ?? false,
  };

  const workdir = config.workdir ?? containerPath;
  if (!workdir.startsWith('/')) {
    throw new Error('Sandbox workdir must be an absolute container path (e.g. /workspace)');
  }

  return {
    enabled: true,
    image: config.image,
    network,
    resources,
    user,
    mount,
    workdir,
    env: config.env ?? {},
    preflightTimeoutMs: config.preflightTimeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS,
    pullTimeoutMs: config.pullTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS,
    containerNamePrefix,
  };
}

/**
 * Returns the host UID/GID mapping using `process.getuid()` / `process.getgid()`.
 *
 * Containers MUST NOT run as root. If the host user is root (uid=0) or UID/GID
 * are unavailable (e.g. Windows), this function throws unless an explicit user
 * mapping override is provided via `SandboxConfig.user`.
 *
 * @returns Host user mapping
 */
export function getHostUserMapping(): SandboxUserMapping {
  const getuid = (process as unknown as { getuid?: () => number }).getuid;
  const getgid = (process as unknown as { getgid?: () => number }).getgid;

  if (!getuid || !getgid) {
    throw new Error(
      'Sandbox UID/GID mapping is not available on this platform. Provide SandboxConfig.user explicitly to avoid running as root.'
    );
  }

  const uid = getuid();
  const gid = getgid();

  if (uid === 0) {
    throw new Error('Refusing to run sandbox container as root (uid=0).');
  }

  return { uid, gid };
}

/**
 * Converts a host-resolved command into a command name suitable for execution
 * in a container.
 *
 * If the command is a path (contains `/` or `\\`), it is reduced to its basename.
 *
 * @param command Host command (may be absolute path)
 * @returns Container command name
 */
export function toContainerCommand(command: string): string {
  if (command.includes('/') || command.includes('\\')) {
    return path.basename(command);
  }
  return command;
}

function validateDockerImageName(image: string): void {
  if (!image || typeof image !== 'string') {
    throw new Error('SandboxConfig.image must be a non-empty string');
  }
  if (/[\s\0]/u.test(image)) {
    throw new Error('SandboxConfig.image must not contain whitespace or NUL characters');
  }
}

function validateUserMapping(user: SandboxUserMapping): void {
  if (!Number.isInteger(user.uid) || !Number.isInteger(user.gid)) {
    throw new Error('SandboxConfig.user uid/gid must be integers');
  }
  if (user.uid <= 0 || user.gid <= 0) {
    throw new Error('SandboxConfig.user uid/gid must be > 0 (containers must not run as root)');
  }
}

function validateResourceLimits(limits: SandboxResourceLimits): void {
  if (!limits.memory || typeof limits.memory !== 'string') {
    throw new Error('Sandbox resource limit memory must be a non-empty string');
  }
  if (!Number.isFinite(limits.cpus) || limits.cpus <= 0) {
    throw new Error('Sandbox resource limit cpus must be a positive number');
  }
  if (!Number.isInteger(limits.pidsLimit) || limits.pidsLimit <= 0) {
    throw new Error('Sandbox resource limit pidsLimit must be a positive integer');
  }
}

function validateContainerNamePrefix(prefix: string): void {
  if (!prefix || typeof prefix !== 'string') {
    throw new Error('Sandbox containerNamePrefix must be a non-empty string');
  }
  // Docker container name constraints are broader, but we keep it strict.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u.test(prefix)) {
    throw new Error('Sandbox containerNamePrefix contains invalid characters');
  }
}
