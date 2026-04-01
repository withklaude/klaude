import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { PersistentTaskState, PersistentTaskStatus, ProjectState } from '../types/index.js';

const STATE_FILE = 'state.yaml';

export class StateManager {
  private statePath: string;
  private state: ProjectState = {};

  constructor(projectDir: string) {
    this.statePath = path.join(projectDir, STATE_FILE);
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.statePath)) {
      const raw = fs.readFileSync(this.statePath, 'utf-8');
      this.state = YAML.parse(raw) || {};
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, YAML.stringify(this.state), 'utf-8');
  }

  /** Get state for a task, returns default pending state if not tracked */
  get(taskName: string): PersistentTaskState {
    return this.state[taskName] || { status: 'pending', attempts: 0 };
  }

  /** Get all tracked task states */
  getAll(): ProjectState {
    return { ...this.state };
  }

  /** Update a task's status */
  update(taskName: string, updates: Partial<PersistentTaskState>): void {
    const current = this.get(taskName);
    this.state[taskName] = { ...current, ...updates };
    this.save();
  }

  /** Mark a task as running */
  markRunning(taskName: string, runId: string): void {
    const current = this.get(taskName);
    this.update(taskName, {
      status: 'running',
      last_run_id: runId,
      started_at: new Date().toISOString(),
      completed_at: undefined,
      error: undefined,
      attempts: current.attempts + 1,
    });
  }

  /** Mark a task as completed */
  markCompleted(taskName: string): void {
    this.update(taskName, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      error: undefined,
    });
  }

  /** Mark a task as failed */
  markFailed(taskName: string, error?: string): void {
    this.update(taskName, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error,
    });
  }

  /** Reset a task to pending */
  reset(taskName: string): void {
    this.update(taskName, {
      status: 'pending',
      started_at: undefined,
      completed_at: undefined,
      error: undefined,
      attempts: 0,
    });
  }

  /** Reset all tasks to pending */
  resetAll(): void {
    for (const name of Object.keys(this.state)) {
      this.reset(name);
    }
  }

  /** Mark a task as skipped */
  skip(taskName: string): void {
    this.update(taskName, { status: 'skipped' });
  }

  /** Set status directly */
  setStatus(taskName: string, status: PersistentTaskStatus): void {
    this.update(taskName, { status });
  }

  /** Remove a task from state (when task file is deleted) */
  remove(taskName: string): void {
    delete this.state[taskName];
    this.save();
  }

  /** Reset any tasks stuck in 'running' state back to 'pending' (interrupted run) */
  recoverInterrupted(): string[] {
    const recovered: string[] = [];
    for (const [name, state] of Object.entries(this.state)) {
      if (state.status === 'running') {
        this.update(name, { status: 'pending', error: 'Interrupted — will retry' });
        recovered.push(name);
      }
    }
    return recovered;
  }

  /** Should this task be executed in a run? */
  shouldRun(taskName: string): boolean {
    const s = this.get(taskName);
    return s.status === 'pending' || s.status === 'failed' || s.status === 'running';
  }
}
