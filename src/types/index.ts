// ─── Global Config ───────────────────────────────────────────────

export interface KlaudeGlobalConfig {
  anthropic?: {
    api_key?: string;
    max_tokens_per_run?: number;
  };
  git?: {
    token?: string;
    user?: string;
    email?: string;
  };
  docker?: {
    image?: string;
    registry_image?: string; // ghcr.io image to pull from (default: ghcr.io/withklaude/klaude)
    memory?: string;
    cpus?: number;
    rebuild_after_hours?: number; // rebuild image if older than this (default: 24)
  };
  mounts?: string[]; // extra files/dirs to mount in container
  env?: Record<string, string>; // extra env vars injected into the container
}

// ─── Project Config (.klaude/config.yaml) ────────────────────────

export interface KlaudeProjectConfig extends KlaudeGlobalConfig {
  tasks_dir?: string; // default: "tasks"
}

// ─── Task ────────────────────────────────────────────────────────

export interface TaskSettings {
  max_tokens?: number;
}

export interface TaskDefinition {
  name: string;
  priority?: number;
  resources?: string[];
  settings?: TaskSettings;
  prompt: string; // the prompt for Claude Code
  source_path: string; // where this task was loaded from
}

export type TaskStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed';

export interface TaskState {
  task: TaskDefinition;
  status: TaskStatus;
  container_id?: string;
  started_at?: string;
  completed_at?: string;
  rate_limits_hit: number;
  network_errors: number;
  error?: string;
}

// ─── Run ─────────────────────────────────────────────────────────

export interface RunOptions {
  overnight: boolean;
  dryRun: boolean;
  resume: boolean;
}

export interface RunState {
  id: string; // timestamp-based
  started_at: string;
  completed_at?: string;
  tasks: TaskState[];
  options: RunOptions;
}

// ─── Persistent Task State (.klaude/state.yaml) ─────────────────

export type PersistentTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PersistentTaskState {
  status: PersistentTaskStatus;
  last_run_id?: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
  attempts: number;
}

/** Maps task name → persistent state */
export type ProjectState = Record<string, PersistentTaskState>;

// ─── Rate Limit ──────────────────────────────────────────────────

export interface RateLimitEvent {
  timestamp: string;
  type: 'rate_limit' | 'network_error';
  message: string;
  retry_after_seconds?: number;
}

// ─── Container Status ────────────────────────────────────────────

export interface ContainerStatus {
  task_name: string;
  status: 'running' | 'rate_limited' | 'network_wait' | 'completed' | 'failed';
  message?: string;
  retry_at?: string;
  tokens_used?: number;
}
