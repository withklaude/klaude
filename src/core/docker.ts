import Dockerode from 'dockerode';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import type { KlaudeProjectConfig } from '../types/index.js';

const CONTAINER_LABEL = 'klaude-managed';

export interface ContainerOptions {
  name: string;
  repoPath: string;
  config: KlaudeProjectConfig;
  envVars: Record<string, string>;
  extraMounts?: string[];
  claudeConfigDir?: string;
}

export interface ContainerLogEvent {
  type: 'stdout' | 'stderr';
  data: string;
  timestamp: Date;
}

export class DockerManager extends EventEmitter {
  private docker: Dockerode;

  constructor() {
    super();
    // On Windows, connect via named pipe; on Linux/Mac, via socket
    if (process.platform === 'win32') {
      this.docker = new Dockerode({ socketPath: '//./pipe/docker_engine' });
    } else {
      this.docker = new Dockerode({ socketPath: '/var/run/docker.sock' });
    }
  }

  /** Get a dockerode Image object for tagging/inspecting */
  getImage(imageName: string) {
    return this.docker.getImage(imageName);
  }

  /** Check if Docker is available */
  async isAvailable(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  /** Build the klaude Docker image from the embedded Dockerfile */
  async buildImage(imageName: string): Promise<void> {
    const dockerfilePath = path.join(
      path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
      '..', 'templates', 'Dockerfile',
    );
    const wrapperPath = path.join(
      path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
      '..', 'templates', 'claude-wrapper.sh',
    );

    // Create a temp build context
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'klaude-build-'));
    fs.copyFileSync(dockerfilePath, path.join(tmpDir, 'Dockerfile'));
    fs.copyFileSync(wrapperPath, path.join(tmpDir, 'claude-wrapper.sh'));

    const stream = await this.docker.buildImage(
      { context: tmpDir, src: ['Dockerfile', 'claude-wrapper.sh'] },
      { t: imageName },
    );

    // Wait for build to complete
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err: Error | null) => {
        // Clean up temp dir
        fs.rmSync(tmpDir, { recursive: true, force: true });
        if (err) reject(err);
        else resolve();
      }, (event: { stream?: string }) => {
        if (event.stream) {
          this.emit('build-log', event.stream.trim());
        }
      });
    });
  }

  /** Pull an image from a registry. Returns true if successful, false if not found/failed. */
  async pullImage(imageName: string): Promise<boolean> {
    try {
      const stream = await this.docker.pull(imageName);
      await new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }, (event: { status?: string }) => {
          if (event.status) {
            this.emit('pull-log', event.status);
          }
        });
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Check if image exists locally */
  async imageExists(imageName: string): Promise<boolean> {
    try {
      await this.docker.getImage(imageName).inspect();
      return true;
    } catch {
      return false;
    }
  }

  /** Get image age in hours, or null if image doesn't exist */
  async imageAgeHours(imageName: string): Promise<number | null> {
    try {
      const info = await this.docker.getImage(imageName).inspect();
      const created = new Date(info.Created);
      return (Date.now() - created.getTime()) / 3_600_000;
    } catch {
      return null;
    }
  }

  /** Create and start a container for a task */
  async createContainer(options: ContainerOptions): Promise<string> {
    const {
      name,
      repoPath,
      config,
      envVars,
      extraMounts = [],
      claudeConfigDir,
    } = options;

    const imageName = config.docker?.image || 'klaude-ubuntu';
    const memory = parseMemory(config.docker?.memory || '4g');
    const cpus = config.docker?.cpus || 2;

    // Build binds (volume mounts)
    const binds: string[] = [
      `${repoPath}:/workspace`,
    ];

    // Mount Claude Code config from host (into non-root user home)
    if (claudeConfigDir) {
      binds.push(`${claudeConfigDir}:/home/klaude/.claude`);
    }

    // Extra mounts from config
    for (const mount of extraMounts) {
      const absPath = path.isAbsolute(mount) ? mount : path.join(os.homedir(), mount);
      if (fs.existsSync(absPath)) {
        const containerPath = `/mnt/${path.basename(mount)}`;
        binds.push(`${absPath}:${containerPath}:ro`);
      }
    }

    // Environment variables
    const env = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);

    const container = await this.docker.createContainer({
      Image: imageName,
      name: `klaude-${name}`,
      Labels: { [CONTAINER_LABEL]: 'true', 'klaude-task': name },
      Env: env,
      WorkingDir: '/workspace',
      HostConfig: {
        Binds: binds,
        Memory: memory,
        NanoCpus: cpus * 1e9,
        AutoRemove: false,
      },
      Tty: false,
      OpenStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      // Keep container running — claude-wrapper.sh will be exec'd
      Cmd: ['tail', '-f', '/dev/null'],
    });

    await container.start();
    return container.id;
  }

  /** Execute a command in a running container */
  async exec(containerId: string, cmd: string[]): Promise<{ stream: NodeJS.ReadableStream; exec: Dockerode.Exec }> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    return { stream, exec };
  }

  /** Stream logs from a container */
  async streamLogs(containerId: string, callback: (event: ContainerLogEvent) => void): Promise<void> {
    const container = this.docker.getContainer(containerId);
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: true,
    });

    stream.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      callback({
        type: 'stdout',
        data: text,
        timestamp: new Date(),
      });
    });
  }

  /** Stop a container */
  async stopContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: 10 });
    } catch (err) {
      // Container may already be stopped
      if (!(err as Error).message?.includes('not running')) {
        throw err;
      }
    }
  }

  /** Remove a container */
  async removeContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.remove({ force: true });
    } catch {
      // May already be removed
    }
  }

  /** List all klaude-managed containers */
  async listContainers(): Promise<Array<{ id: string; name: string; task: string; state: string }>> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: [CONTAINER_LABEL] },
    });

    return containers.map(c => ({
      id: c.Id,
      name: c.Names[0]?.replace(/^\//, '') || '',
      task: c.Labels['klaude-task'] || 'unknown',
      state: c.State,
    }));
  }

  /** Read a file from inside a container */
  async readFile(containerId: string, filePath: string): Promise<string | null> {
    try {
      const { stream } = await this.exec(containerId, ['cat', filePath]);
      const demuxed = demuxExecStream(stream);
      return await new Promise<string>((resolve, reject) => {
        const parts: string[] = [];
        demuxed.on('data', ({ data }: { type: 'stdout' | 'stderr'; data: string }) => parts.push(data));
        demuxed.on('end', () => resolve(parts.join('')));
        demuxed.on('error', reject);
      });
    } catch {
      return null;
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function parseMemory(mem: string): number {
  const match = mem.match(/^(\d+)([kmg]?)b?$/i);
  if (!match) return 4 * 1024 * 1024 * 1024; // default 4GB
  const num = parseInt(match[1], 10);
  switch (match[2]?.toLowerCase()) {
    case 'k': return num * 1024;
    case 'm': return num * 1024 * 1024;
    case 'g': return num * 1024 * 1024 * 1024;
    default: return num;
  }
}

/**
 * Demultiplexes a Docker exec stream into separate stdout/stderr events.
 *
 * Docker multiplexing protocol: each frame has an 8-byte header where
 * byte 0 is the stream type (1=stdout, 2=stderr) and bytes 4-7 are the
 * payload size as a big-endian uint32. Handles partial frames correctly.
 */
export function demuxExecStream(stream: NodeJS.ReadableStream): EventEmitter {
  const emitter = new EventEmitter();
  let buf = Buffer.alloc(0);

  stream.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);

    while (buf.length >= 8) {
      const frameSize = buf.readUInt32BE(4);
      if (buf.length < 8 + frameSize) break;

      const streamType = buf[0];
      const payload = buf.slice(8, 8 + frameSize);
      buf = buf.slice(8 + frameSize);

      const type: 'stdout' | 'stderr' = streamType === 2 ? 'stderr' : 'stdout';
      emitter.emit('data', { type, data: payload.toString('utf-8') });
    }
  });

  stream.on('end', () => emitter.emit('end'));
  stream.on('error', (err: Error) => emitter.emit('error', err));

  return emitter;
}

function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', reject);
  });
}
