import { EventEmitter } from 'node:events';

/**
 * Central event bus. Everything the dashboard shows originates here:
 * engine -> bus -> (Socket.IO broadcast + persistence + stdout log).
 */
class Bus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  log(message, options = {}) {
    const event = {
      level: options.level ?? 'info',
      type: options.type ?? 'engine',
      runId: options.runId ?? null,
      sessionId: options.sessionId ?? null,
      message,
      at: new Date().toISOString(),
    };
    this.emit('log', event);
    return event;
  }

  status(message, level = 'info') {
    return this.log(message, { level, type: 'status' });
  }
}

export const bus = new Bus();
