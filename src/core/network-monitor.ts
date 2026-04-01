import https from 'node:https';
import { EventEmitter } from 'node:events';

const CHECK_URL = 'https://api.anthropic.com/';
const CHECK_INTERVAL_MS = 15_000; // 15 seconds
const TIMEOUT_MS = 10_000;

export type NetworkState = 'online' | 'offline' | 'unknown';

export class NetworkMonitor extends EventEmitter {
  private state: NetworkState = 'unknown';
  private timer?: ReturnType<typeof setInterval>;
  private offlineSince?: Date;

  /** Start monitoring network connectivity */
  start(): void {
    this.check(); // immediate first check
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
  }

  /** Stop monitoring */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Get current network state */
  getState(): NetworkState {
    return this.state;
  }

  /** Get how long we've been offline (ms), or 0 if online */
  getOfflineDuration(): number {
    if (!this.offlineSince) return 0;
    return Date.now() - this.offlineSince.getTime();
  }

  /** Perform a single connectivity check */
  async check(): Promise<boolean> {
    const online = await this.ping();
    const previousState = this.state;

    if (online) {
      this.state = 'online';
      if (previousState === 'offline') {
        const downtime = this.offlineSince
          ? Math.round((Date.now() - this.offlineSince.getTime()) / 1000)
          : 0;
        this.offlineSince = undefined;
        this.emit('online', { downtimeSeconds: downtime });
      }
    } else {
      this.state = 'offline';
      if (previousState !== 'offline') {
        this.offlineSince = new Date();
        this.emit('offline');
      }
    }

    return online;
  }

  /** Wait until network comes back online */
  async waitForOnline(maxWaitMs: number = 30 * 60 * 1000): Promise<boolean> {
    if (this.state === 'online') return true;

    const deadline = Date.now() + maxWaitMs;
    const backoffs = [30_000, 60_000, 120_000, 300_000]; // 30s, 1m, 2m, 5m
    let attempt = 0;

    while (Date.now() < deadline) {
      const backoff = backoffs[Math.min(attempt, backoffs.length - 1)];
      this.emit('waiting', { nextCheckIn: backoff / 1000, attempt });

      await sleep(backoff);
      const online = await this.ping();

      if (online) {
        this.state = 'online';
        this.emit('online', {
          downtimeSeconds: this.offlineSince
            ? Math.round((Date.now() - this.offlineSince.getTime()) / 1000)
            : 0,
        });
        this.offlineSince = undefined;
        return true;
      }

      attempt++;
    }

    return false;
  }

  /** Ping the Anthropic API endpoint */
  private ping(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = https.get(CHECK_URL, { timeout: TIMEOUT_MS }, (res) => {
        // Any response (even 401/403) means network is up
        res.resume(); // consume response
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
