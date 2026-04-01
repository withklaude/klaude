import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import matter from 'gray-matter';
import type { TaskDefinition } from '../types/index.js';

/**
 * Loads tasks from the .klaude/tasks/ directory.
 * Supports multiple formats:
 * - .md files with YAML frontmatter (recommended)
 * - .yaml / .yml files
 * - .json files
 * - Directories with prompt.md + optional config.yaml
 */
export class TaskLoader {
  constructor(private tasksDir: string) {}

  /** Load all tasks from the tasks directory */
  loadAll(): TaskDefinition[] {
    if (!fs.existsSync(this.tasksDir)) {
      return [];
    }

    const entries = fs.readdirSync(this.tasksDir, { withFileTypes: true });
    const tasks: TaskDefinition[] = [];

    for (const entry of entries) {
      const fullPath = path.join(this.tasksDir, entry.name);
      try {
        if (entry.isDirectory()) {
          const task = this.loadDirectory(fullPath);
          if (task) tasks.push(task);
        } else if (entry.isFile()) {
          const task = this.loadFile(fullPath);
          if (task) tasks.push(task);
        }
      } catch (err) {
        console.warn(`Warning: Failed to load task from ${entry.name}: ${(err as Error).message}`);
      }
    }

    // Sort by priority (lower number = higher priority)
    return tasks.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  }

  /** Load a single task by name */
  loadByName(name: string): TaskDefinition | undefined {
    const all = this.loadAll();
    return all.find(t => t.name === name);
  }

  /** Load a task from a single file */
  private loadFile(filePath: string): TaskDefinition | null {
    const ext = path.extname(filePath).toLowerCase();
    const content = fs.readFileSync(filePath, 'utf-8');

    switch (ext) {
      case '.md':
        return this.parseMarkdown(content, filePath);
      case '.yaml':
      case '.yml':
        return this.parseYaml(content, filePath);
      case '.json':
        return this.parseJson(content, filePath);
      default:
        return null; // skip unknown formats
    }
  }

  /** Load a task from a directory (prompt.md + config.yaml) */
  private loadDirectory(dirPath: string): TaskDefinition | null {
    const promptPath = path.join(dirPath, 'prompt.md');
    if (!fs.existsSync(promptPath)) {
      return null;
    }

    const prompt = fs.readFileSync(promptPath, 'utf-8');
    const name = path.basename(dirPath);
    let config: Record<string, unknown> = {};

    // Load optional config
    const configPath = path.join(dirPath, 'config.yaml');
    if (fs.existsSync(configPath)) {
      config = YAML.parse(fs.readFileSync(configPath, 'utf-8')) || {};
    }

    // Check for resources directory
    const resourcesDir = path.join(dirPath, 'resources');
    let resources: string[] = (config.resources as string[]) || [];
    if (fs.existsSync(resourcesDir)) {
      const files = fs.readdirSync(resourcesDir).map(f => path.join('resources', f));
      resources = [...resources, ...files];
    }

    return {
      name: (config.name as string) || name,
      priority: config.priority as number | undefined,
      resources,
      settings: config.settings as TaskDefinition['settings'],
      prompt,
      source_path: dirPath,
    };
  }

  /** Parse markdown with YAML frontmatter */
  private parseMarkdown(content: string, filePath: string): TaskDefinition {
    const { data, content: prompt } = matter(content);
    const name = (data.name as string) || path.basename(filePath, path.extname(filePath));

    return {
      name,
      priority: data.priority,
      resources: data.resources || [],
      settings: data.settings,
      prompt: prompt.trim(),
      source_path: filePath,
    };
  }

  /** Parse YAML task definition */
  private parseYaml(content: string, filePath: string): TaskDefinition {
    const data = YAML.parse(content) || {};
    const name = data.name || path.basename(filePath, path.extname(filePath));

    if (!data.prompt) {
      throw new Error('YAML task must have a "prompt" field');
    }

    return {
      name,
      priority: data.priority,
      resources: data.resources || [],
      settings: data.settings,
      prompt: data.prompt,
      source_path: filePath,
    };
  }

  /** Parse JSON task definition */
  private parseJson(content: string, filePath: string): TaskDefinition {
    const data = JSON.parse(content);
    const name = data.name || path.basename(filePath, path.extname(filePath));

    if (!data.prompt) {
      throw new Error('JSON task must have a "prompt" field');
    }

    return {
      name,
      priority: data.priority,
      resources: data.resources || [],
      settings: data.settings,
      prompt: data.prompt,
      source_path: filePath,
    };
  }

  /** Validate a task definition, returning errors */
  validate(task: TaskDefinition): string[] {
    const errors: string[] = [];

    if (!task.name || task.name.trim() === '') {
      errors.push('Task must have a name');
    }

    if (!task.prompt || task.prompt.trim() === '') {
      errors.push('Task must have a prompt');
    }

    if (task.name && !/^[a-zA-Z0-9_-]+$/.test(task.name)) {
      errors.push('Task name must contain only alphanumeric characters, hyphens, and underscores');
    }

    if (task.priority !== undefined && (task.priority < 0 || !Number.isInteger(task.priority))) {
      errors.push('Priority must be a non-negative integer');
    }

    // Check resources exist
    if (task.resources) {
      for (const res of task.resources) {
        const resPath = path.isAbsolute(res) ? res : path.join(path.dirname(task.source_path), res);
        if (!fs.existsSync(resPath)) {
          errors.push(`Resource not found: ${res}`);
        }
      }
    }

    return errors;
  }
}
