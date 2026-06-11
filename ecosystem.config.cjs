module.exports = {
  apps: [
    {
      name: "repo-reporter",
      script: ".next/standalone/server.js",
      cwd: __dirname,
      env: {
        PORT: 4000,
        NODE_ENV: "production",
      },
      // 크래시 시 자동 재시작
      autorestart: true,
      // 재시작 간 딜레이 (ms)
      restart_delay: 3000,
      // 15초 내 10번 크래시하면 중단
      max_restarts: 10,
      min_uptime: "15s",
      // 로그 설정
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
