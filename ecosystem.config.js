/**
 * PM2: rodar Next.js + Scheduler Python na VPS igual à sua máquina (npm run dev).
 * Uso: na raiz do projeto, depois de npm run build:
 *   pm2 start ecosystem.config.js
 * Ver: docs/RODAR_NA_VPS_IGUAL_MAQUINA.md
 */
module.exports = {
  apps: [
    {
      name: "next",
      cwd: "./frontend",
      script: "node_modules/.bin/next",
      args: "start",
      env: { NODE_ENV: "production" },
      instances: 1,
      autorestart: true,
      watch: false,
    },
    {
      name: "scheduler",
      cwd: ".",
      script: "scheduler_sync.py",
      interpreter: "python3",
      interpreter_args: "-u",
      autorestart: true,
      watch: false,
    },
  ],
};
