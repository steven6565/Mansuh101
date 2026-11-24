import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies API + Socket.IO traffic to the backend. The backend
// port is configurable (PORT in ../.env, or the shell), so resolve it the same
// way the server does instead of hardcoding 4000.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, '..', ''), ...process.env };
  const port = Number.parseInt(env.PORT || '4000', 10) || 4000;
  const host = env.HOST && env.HOST !== '0.0.0.0' ? env.HOST : '127.0.0.1';
  const target = `http://${host === '::' ? '127.0.0.1' : host}:${port}`;

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': { target, changeOrigin: true },
        '/socket.io': { target, ws: true, changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 900,
    },
  };
});
