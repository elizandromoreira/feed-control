module.exports = {
  apps: [
    {
      name: 'feedcontrol-backend',
      script: './index.js',
      cwd: '/opt/feed-control',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 7005
      },
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      log_file: './logs/backend-combined.log',
      time: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000
    },
    {
      name: 'feedcontrol-frontend',
      script: 'serve',
      args: '-s build -l 8080',
      cwd: '/opt/feed-control-frontend',
      instances: 1,
      exec_mode: 'fork',
      error_file: './logs/frontend-error.log',
      out_file: './logs/frontend-out.log',
      log_file: './logs/frontend-combined.log',
      time: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
};
