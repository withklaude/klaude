import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import type { KlaudeGlobalConfig, KlaudeProjectConfig } from '../types/index.js';

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.klaude');
const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, 'config.yaml');
const PROJECT_DIR_NAME = '.klaude';
const PROJECT_CONFIG_FILE = 'config.yaml';

// Keys that contain secrets and should be masked in output
const SECRET_KEYS = ['api_key', 'token'];

export class ConfigManager {
  private globalConfig: KlaudeGlobalConfig = {};
  private projectConfig: KlaudeProjectConfig = {};
  private projectRoot: string | null = null;

  constructor() {
    this.loadGlobalConfig();
    this.detectProjectRoot();
    if (this.projectRoot) {
      this.loadProjectConfig();
    }
  }

  // ─── Loading ─────────────────────────────────────────────────

  private loadGlobalConfig(): void {
    if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
      const raw = fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf-8');
      this.globalConfig = YAML.parse(raw) || {};
    }
  }

  private loadProjectConfig(): void {
    if (!this.projectRoot) return;
    const configPath = path.join(this.projectRoot, PROJECT_DIR_NAME, PROJECT_CONFIG_FILE);
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      this.projectConfig = YAML.parse(raw) || {};
    }
  }

  private detectProjectRoot(): void {
    let dir = process.cwd();
    while (true) {
      if (fs.existsSync(path.join(dir, PROJECT_DIR_NAME))) {
        this.projectRoot = dir;
        return;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // ─── Merged Config ───────────────────────────────────────────

  /** Returns merged config: project overrides global */
  getMergedConfig(): KlaudeProjectConfig {
    return deepMerge(
      this.globalConfig as unknown as Record<string, unknown>,
      this.projectConfig as unknown as Record<string, unknown>,
    ) as unknown as KlaudeProjectConfig;
  }

  // ─── API Key Resolution ──────────────────────────────────────

  /** Resolve API key: explicit config > env var > Claude Code config on host */
  resolveApiKey(): string | undefined {
    const merged = this.getMergedConfig();

    // 1. Explicit config
    if (merged.anthropic?.api_key) {
      return merged.anthropic.api_key;
    }

    // 2. Environment variable
    if (process.env.ANTHROPIC_API_KEY) {
      return process.env.ANTHROPIC_API_KEY;
    }

    // 3. Claude Code config on host (~/.claude/)
    const claudeCredentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');
    if (fs.existsSync(claudeCredentialsPath)) {
      try {
        const raw = fs.readFileSync(claudeCredentialsPath, 'utf-8');
        const data = JSON.parse(raw);
        // Claude Code Max uses OAuth tokens
        if (data.claudeAiOauth?.accessToken) {
          return data.claudeAiOauth.accessToken;
        }
        // Fallback for direct API key formats
        if (data.apiKey) return data.apiKey;
        if (data.api_key) return data.api_key;
      } catch {
        // skip unreadable
      }
    }

    return undefined;
  }

  /** Check if Claude Code auth directory exists (for mounting into container) */
  getClaudeConfigDir(): string | undefined {
    const claudeDir = path.join(os.homedir(), '.claude');
    if (fs.existsSync(claudeDir)) {
      return claudeDir;
    }
    return undefined;
  }

  // ─── Getters ─────────────────────────────────────────────────

  get<T = unknown>(keyPath: string): T | undefined {
    const merged = this.getMergedConfig();
    return getNestedValue(merged as unknown as Record<string, unknown>, keyPath) as T | undefined;
  }

  getProjectRoot(): string | null {
    return this.projectRoot;
  }

  getProjectDir(): string | null {
    if (!this.projectRoot) return null;
    return path.join(this.projectRoot, PROJECT_DIR_NAME);
  }

  getTasksDir(): string | null {
    if (!this.projectRoot) return null;
    const tasksDir = this.projectConfig.tasks_dir || 'tasks';
    return path.join(this.projectRoot, PROJECT_DIR_NAME, tasksDir);
  }

  // ─── Setters ─────────────────────────────────────────────────

  /** Set a value in global config */
  setGlobal(keyPath: string, value: unknown): void {
    setNestedValue(this.globalConfig as unknown as Record<string, unknown>, keyPath, value);
    this.saveGlobalConfig();
  }

  /** Set a value in project config */
  setProject(keyPath: string, value: unknown): void {
    if (!this.projectRoot) {
      throw new Error('Not inside a klaude project. Run "klaude init" first.');
    }
    setNestedValue(this.projectConfig as unknown as Record<string, unknown>, keyPath, value);
    this.saveProjectConfig();
  }

  // ─── Saving ──────────────────────────────────────────────────

  private saveGlobalConfig(): void {
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(GLOBAL_CONFIG_FILE, YAML.stringify(this.globalConfig), 'utf-8');
  }

  private saveProjectConfig(): void {
    if (!this.projectRoot) return;
    const dir = path.join(this.projectRoot, PROJECT_DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, PROJECT_CONFIG_FILE),
      YAML.stringify(this.projectConfig),
      'utf-8',
    );
  }

  // ─── Init Project ────────────────────────────────────────────

  initProject(targetDir: string): string {
    const klaudeDir = path.join(targetDir, PROJECT_DIR_NAME);
    const tasksDir = path.join(klaudeDir, 'tasks');

    fs.mkdirSync(tasksDir, { recursive: true });

    // Create default project config
    const defaultConfig: KlaudeProjectConfig = {
      tasks_dir: 'tasks',
      docker: {
        image: 'klaude-ubuntu',
        memory: '4g',
        cpus: 2,
      },
    };

    fs.writeFileSync(
      path.join(klaudeDir, PROJECT_CONFIG_FILE),
      YAML.stringify(defaultConfig),
      'utf-8',
    );

    this.projectRoot = targetDir;
    this.projectConfig = defaultConfig;

    return klaudeDir;
  }

  // ─── Display ─────────────────────────────────────────────────

  /** Returns config as flat key-value pairs for display, masking secrets */
  listConfig(): Array<{ key: string; value: string; source: 'global' | 'project' }> {
    const entries: Array<{ key: string; value: string; source: 'global' | 'project' }> = [];

    const flatten = (obj: Record<string, unknown>, prefix: string, source: 'global' | 'project') => {
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          flatten(v as Record<string, unknown>, key, source);
        } else {
          const isSecret = SECRET_KEYS.some(s => key.includes(s));
          const display = isSecret && v ? maskSecret(String(v)) : String(v);
          entries.push({ key, value: display, source });
        }
      }
    };

    flatten(this.globalConfig as unknown as Record<string, unknown>, '', 'global');
    flatten(this.projectConfig as unknown as Record<string, unknown>, '', 'project');
    return entries;
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof result[key] === 'object' &&
      result[key] !== null
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

function getNestedValue(obj: Record<string, unknown>, keyPath: string): unknown {
  const keys = keyPath.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, keyPath: string, value: unknown): void {
  const keys = keyPath.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}
