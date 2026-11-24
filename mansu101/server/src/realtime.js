import { bus } from './bus.js';
import { BROWSER_PROFILES } from './config.js';

/**
 * Socket.IO wiring. No metric shown in the UI is synthesised here —
 * every payload is forwarded from the automation engine, browser manager or
 * host health sampler.
 */
export function initRealtime({ io, engine, auth, health, store }) {
  io.use(auth.socketAuthenticate.bind(auth));

  io.on('connection', async (socket) => {
    socket.emit('snapshot', engine.snapshot());
    if (health.latest) socket.emit('health', health.latest);
    socket.emit('config', {
      profiles: Object.entries(BROWSER_PROFILES).map(([id, profile]) => ({
        id,
        label: profile.label,
        userAgent: profile.userAgent,
        viewport: profile.viewport,
      })),
    });

    try {
      const logs = await store.listEvents({ limit: 300 });
      socket.emit('logs:init', logs);
    } catch {
      socket.emit('logs:init', []);
    }

    socket.emit('browser', engine.browser.snapshot());
    socket.emit('connected', { id: socket.id, at: new Date().toISOString() });
  });

  bus.on('state', (payload) => io.emit('state', payload));
  bus.on('run:update', (payload) => io.emit('run:update', payload));
  bus.on('session:update', (payload) => io.emit('session:update', payload));
  bus.on('browser', (payload) => io.emit('browser', payload));
  bus.on('health', (payload) => io.emit('health', payload));
  bus.on('settings:update', (payload) => io.emit('settings:update', payload));
  bus.on('urls:update', (payload) => io.emit('urls:update', payload));
  bus.on('notice', (payload) => io.emit('notice', payload));
  bus.on('logs:cleared', () => io.emit('logs:cleared'));
  bus.on('history:cleared', () => io.emit('history:cleared'));
  bus.on('log', (payload) => io.emit('log', payload));

  return io;
}
