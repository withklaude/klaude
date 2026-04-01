import type { RateLimitEvent, ContainerStatus } from '../types/index.js';

/** Patterns that indicate a rate limit */
const RATE_LIMIT_PATTERNS = [
  /rate.?limit.*(exceeded|hit|error|retry)/i,
  /HTTP 429/,
  /too many requests/i,
  /resource.+exhausted/i,
  /overloaded/i,
  /retry.?after.*\d+/i,
  /hit your limit/i,
  /limit.+resets/i,
];

/** Patterns that indicate a network error */
const NETWORK_ERROR_PATTERNS = [
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /socket hang up/i,
  /network error/i,
  /connection refused/i,
  /getaddrinfo/i,
  /EHOSTUNREACH/i,
  /ECONNREFUSED/i,
  /fetch failed/i,
];

export type LogEventType = 'rate_limit' | 'network_error' | 'output' | 'completion' | 'error';

export interface ParsedLogEvent {
  type: LogEventType;
  raw: string;
  timestamp: Date;
  retryAfterSeconds?: number;
}

export class RateLimitDetector {
  private events: RateLimitEvent[] = [];
  private rateLimitCount = 0;
  private networkErrorCount = 0;
  private totalWaitTimeMs = 0;
  private lastWaitStart?: Date;

  /** Parse a log line and classify it */
  parseLogLine(line: string): ParsedLogEvent {
    const timestamp = new Date();

    // Check rate limit
    for (const pattern of RATE_LIMIT_PATTERNS) {
      if (pattern.test(line)) {
        this.rateLimitCount++;
        const retryAfter = this.extractRetryAfter(line);
        this.events.push({
          timestamp: timestamp.toISOString(),
          type: 'rate_limit',
          message: line.trim(),
          retry_after_seconds: retryAfter,
        });
        this.lastWaitStart = timestamp;
        return { type: 'rate_limit', raw: line, timestamp, retryAfterSeconds: retryAfter };
      }
    }

    // Check network error
    for (const pattern of NETWORK_ERROR_PATTERNS) {
      if (pattern.test(line)) {
        this.networkErrorCount++;
        this.events.push({
          timestamp: timestamp.toISOString(),
          type: 'network_error',
          message: line.trim(),
        });
        this.lastWaitStart = timestamp;
        return { type: 'network_error', raw: line, timestamp };
      }
    }

    // Track when waiting ends
    if (this.lastWaitStart && /resum|restart|retry|attempt/i.test(line)) {
      this.totalWaitTimeMs += timestamp.getTime() - this.lastWaitStart.getTime();
      this.lastWaitStart = undefined;
    }

    // Check completion
    if (/completed|success|done|finished/i.test(line) && !/not completed/i.test(line)) {
      return { type: 'completion', raw: line, timestamp };
    }

    // Check error
    if (/error|failed|fatal|panic/i.test(line) && !RATE_LIMIT_PATTERNS.some(p => p.test(line)) && !NETWORK_ERROR_PATTERNS.some(p => p.test(line))) {
      return { type: 'error', raw: line, timestamp };
    }

    return { type: 'output', raw: line, timestamp };
  }

  /** Try to extract retry-after seconds from a log line */
  private extractRetryAfter(line: string): number | undefined {
    // Look for patterns like "retry after 60s", "retry-after: 60", "wait 120 seconds"
    const match = line.match(/(?:retry.?after|wait)\s*:?\s*(\d+)\s*(?:s|sec|seconds)?/i);
    if (match) return parseInt(match[1], 10);
    return undefined;
  }

  /** Parse a container status JSON file content */
  parseContainerStatus(json: string): ContainerStatus | null {
    try {
      return JSON.parse(json) as ContainerStatus;
    } catch {
      return null;
    }
  }

  /** Get statistics */
  getStats(): {
    rateLimitsHit: number;
    networkErrors: number;
    totalWaitTimeMs: number;
    events: RateLimitEvent[];
  } {
    return {
      rateLimitsHit: this.rateLimitCount,
      networkErrors: this.networkErrorCount,
      totalWaitTimeMs: this.totalWaitTimeMs,
      events: [...this.events],
    };
  }

  /** Reset counters */
  reset(): void {
    this.events = [];
    this.rateLimitCount = 0;
    this.networkErrorCount = 0;
    this.totalWaitTimeMs = 0;
    this.lastWaitStart = undefined;
  }
}
