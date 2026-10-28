// THROWAWAY #525. One command runs the existing sample server and a dev-only board page.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite-plus';

if (Number(process.versions.node.split('.')[0]) < 24) {
  throw new Error('Use Node 24, as required by this workspace. On this Mac: PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm prototype:525');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const webRoot = `${root}apps/web`;
const boardPort = Number(process.env.BOARD_PORT || 4525);
const webPort = Number(process.env.WEB_PORT || 4526);
const origin = `http://127.0.0.1:${boardPort}`;

await build({ root: webRoot, logLevel: 'warn' });
// Vite's build sets NODE_ENV for this process. The comparison itself is a dev page.
process.env.NODE_ENV = 'development';
const sample = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.ts'], {
  cwd: `${root}apps/server`, stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, BOARD_PORT: String(boardPort), BOARD_DATA_FILE: '../../packages/shared/test/sample.json',
    T3_SETTINGS: 'test/t3-settings.sample.json', T3_MODEL_MANIFEST: 'test/model-manifest.sample.json' },
});
let dev;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await dev?.close();
  sample.kill('SIGTERM');
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
sample.once('exit', () => { if (!stopping) void stop(); });
try {
  // The sample server reports only after it owns the port. Never attach to an existing board.
  await new Promise((resolve, reject) => {
    sample.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      if (String(chunk).includes(`board on ${origin}`)) resolve();
    });
    sample.once('exit', (code) => reject(new Error(`Sample server exited with ${code}`)));
  });
  dev = await createServer({
    root: webRoot,
    define: { 'import.meta.env.VITE_PROTOTYPE_525': '"1"' },
    server: { host: '127.0.0.1', port: webPort, strictPort: true,
      proxy: { '/api': { target: origin, changeOrigin: true } } },
    plugins: [{
      name: 'throwaway-525-sample-page',
      async transformIndexHtml(html) {
        const data = await (await fetch(`${origin}/api/board`)).text();
        return html.replace('<!--board-data-->', data.replaceAll('<', '\\u003c'));
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.method === 'POST' && req.url?.startsWith('/api/')) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Throwaway prototype. Mutations are stubbed.' }));
          } else next();
        });
      },
    }],
  });
  await dev.listen();
  console.log(`\nTHROWAWAY #525: http://127.0.0.1:${webPort}/?variant=A&queue=soft&update=available\nCtrl+C stops both servers. No issues or threads change.\n`);
  await once(sample, 'exit');
} finally {
  await stop();
}
