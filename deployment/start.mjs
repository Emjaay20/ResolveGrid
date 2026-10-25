import { spawn } from 'node:child_process';

const children = [];

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  });
  children.push(child);
  return child;
}

function stopAll(signal = 'SIGTERM') {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on('SIGTERM', () => stopAll());
process.on('SIGINT', () => stopAll('SIGINT'));

// The public web process is the container entrypoint. The API and ML service
// stay on loopback and are reached through Next's same-origin rewrite.
start('python3', ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', process.env.ML_PORT || '8000'], {
  cwd: '/app/apps/ml-engine',
});
start('node', ['apps/api/dist/index.js'], {
  env: { PORT: process.env.API_PORT || '4000' },
});
const web = start('node', ['node_modules/next/dist/bin/next', 'start', '--port', process.env.PORT || '3000'], {
  cwd: '/app/apps/web',
});

web.on('exit', (code) => {
  stopAll();
  process.exit(code ?? 1);
});
