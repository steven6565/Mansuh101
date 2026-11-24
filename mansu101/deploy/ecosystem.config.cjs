/**
 * PM2 process definition for Visitor.
 * Start:  pm2 start ecosystem.config.cjs
 * Save:   pm2 save && pm2 startup
 *
 * NOTE: run a single instance. Browser contexts and the queue live in this
 * process; clustering would split state and duplicate runs.
 */
module.exports = {
  apps: [
    {
      name: 'visitor',
      script: 'server/src/index.js',
      cwd: '/opt/visitor',
      node_args: '--enable-source-maps',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 30,
      min_uptime: '20s',
      restart_delay: 3000,
      kill_timeout: 20000,
      max_memory_restart: '1500M',
      time: true,
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      out_file: '/opt/visitor/data/logs/pm2-out.log',
      error_file: '/opt/visitor/data/logs/pm2-error.log',
      merge_logs: true,
    },
  ],
};
