/**
 * Windows 등에서 8787 포트 Speech 서버 재시작
 */
const { execSync, spawn } = require('node:child_process');
const path = require('node:path');

const PORT = process.env.SPEECH_SERVER_PORT || 8787;
const serverDir = path.resolve(__dirname, '..');

try {
  if (process.platform === 'win32') {
    execSync(
      `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PORT}') do taskkill /F /PID %a`,
      { stdio: 'ignore', shell: 'cmd.exe' }
    );
  }
} catch {
  /* no process */
}

console.log(`[speech:restart] starting on port ${PORT}…`);
const child = spawn('node', ['index.js'], {
  cwd: serverDir,
  stdio: 'inherit',
  env: process.env
});
child.on('exit', (code) => process.exit(code ?? 0));
