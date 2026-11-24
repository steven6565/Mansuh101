import os from 'node:os';
import fs from 'node:fs/promises';
import { config, dirs } from './config.js';

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const [key, value] of Object.entries(cpu.times)) {
      total += value;
      if (key === 'idle') idle += value;
    }
  }
  return { idle, total };
}

/**
 * Real host metrics — CPU, memory, disk, load and process footprint.
 * Emitted to every connected dashboard every few seconds.
 */
export class HealthMonitor {
  constructor({ bus }) {
    this.bus = bus;
    this.timer = null;
    this.previous = cpuTimes();
    this.lastCpuPercent = 0;
    this.disk = null;
    this.latest = null;
    this.startedAt = new Date().toISOString();
  }

  async sample() {
    const current = cpuTimes();
    const idleDelta = current.idle - this.previous.idle;
    const totalDelta = current.total - this.previous.total;
    this.previous = current;
    if (totalDelta > 0) {
      this.lastCpuPercent = Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
    }

    if (!this.disk || Date.now() - this.disk.at > 60000) {
      try {
        const stats = await fs.statfs(dirs.data);
        const total = stats.blocks * stats.bsize;
        const free = stats.bavail * stats.bsize;
        this.disk = {
          at: Date.now(),
          totalBytes: total,
          freeBytes: free,
          usedPercent: total ? ((total - free) / total) * 100 : 0,
        };
      } catch {
        this.disk = this.disk ?? { totalBytes: 0, freeBytes: 0, usedPercent: 0, at: Date.now() };
      }
    }

    const memory = process.memoryUsage();
    const load = os.loadavg();
    const cpuCount = os.cpus().length || 1;

    const payload = {
      at: new Date().toISOString(),
      host: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      uptimeSeconds: Math.round(os.uptime()),
      processUptimeSeconds: Math.round(process.uptime()),
      cpu: {
        cores: cpuCount,
        load1: Number(load[0].toFixed(2)),
        load5: Number(load[1].toFixed(2)),
        load15: Number(load[2].toFixed(2)),
        usagePercent: Number(this.lastCpuPercent.toFixed(1)),
      },
      memory: {
        totalBytes: os.totalmem(),
        freeBytes: os.freemem(),
        usedPercent: Number((((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(1)),
        processRssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
      },
      disk: {
        totalBytes: this.disk.totalBytes,
        freeBytes: this.disk.freeBytes,
        usedPercent: Number(this.disk.usedPercent.toFixed(1)),
      },
      node: process.version,
      pid: process.pid,
      limits: {
        maxConcurrency: config.maxConcurrency,
        retentionDays: config.retentionDays,
      },
    };

    this.latest = payload;
    this.bus.emit('health', payload);
    return payload;
  }

  start(intervalMs = 5000) {
    if (this.timer) return;
    this.sample().catch(() => {});
    this.timer = setInterval(() => {
      this.sample().catch(() => {});
    }, intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
