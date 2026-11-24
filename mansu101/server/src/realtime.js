import { bus } from './bus.js';

/**
 * Socket.IO wiring.
 *
 * The realtime channel is intentionally read-only: it pushes scheduler
 * status, host health and activity events. Analytics numbers are fetched over
 * REST (with caching) because they come from Google, not from a live stream.
 */
export function initRealtime({ io, auth, health, scheduler, audits }) {
  io.use(auth.socketAuthenticate.bind(auth));

  io.on('connection', (socket) => {
    socket.emit('connected', { id: socket.id, at: new Date().toISOString() });
    socket.emit('scheduler', scheduler.status());
    if (health.latest) socket.emit('health', health.latest);
    socket.emit('browser', audits.browserSnapshot());
  });

  bus.on('health', (payload) => io.emit('health', payload));
  bus.on('browser', (payload) => io.emit('browser', payload));
  bus.on('log', (payload) => io.emit('activity', payload));
  bus.on('notice', (payload) => io.emit('notice', payload));

  const statusTimer = setInterval(() => {
    io.emit('scheduler', scheduler.status());
  }, 15000);
  statusTimer.unref?.();
  io.on('close', () => clearInterval(statusTimer));

  return io;
}
