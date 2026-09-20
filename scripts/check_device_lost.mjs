/**
 * 设备丢失探针：destroy() → 断言 lost 回调触发且 reason=destroyed → 重新申请设备并建资源。
 * 这正是 initWebGPU 里挂的回调与「dispose 后可重建」所依赖的浏览器行为。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const page = `<!doctype html><html><body><pre id="out">PENDING</pre><script type="module">
async function run() {
  const result = {};
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const lost = new Promise((resolve) => device.lost.then((info) => resolve({ reason: info.reason, message: info.message })));
  device.destroy();
  result.lost = await lost;
  result.lostPromiseResolved = true;
  // 重建：适配器被旧设备消费过，必须重新 requestAdapter 再 requestDevice
  const adapter2 = await navigator.gpu.requestAdapter();
  const device2 = await adapter2.requestDevice();
  const buffer = device2.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const texture = device2.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device2.queue.writeBuffer(buffer, 0, new Float32Array(64));
  device2.queue.writeTexture({ texture }, new Uint8Array(64), { bytesPerRow: 16 }, [4, 4]);
  result.rebuildOk = !!buffer && !!texture;
  document.getElementById('out').textContent = JSON.stringify(result);
  await fetch('/result', { method: 'POST', body: JSON.stringify(result) }).catch(() => {});
}
run().catch(async (e) => { await fetch('/result', { method: 'POST', body: JSON.stringify({ fatal: String(e && e.message ? e.message : e) }) }).catch(() => {}); });
</script></body></html>
`;

const server = createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/result') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      response.end('ok');
      finish(JSON.parse(body));
    });
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(page);
});

const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'gpuid-lost-'));
let chrome;
let settled = false;
function finish(result) {
  if (settled) return;
  settled = true;
  server.close();
  chrome?.kill('SIGKILL');
  rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
chrome = spawn(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-unsafe-webgpu',
    `--user-data-dir=${userDataDir}`,
    `http://127.0.0.1:${port}/`,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
chrome.stderr.on('data', (chunk) => {
  const text = String(chunk);
  if (/GPUDevice|Uncaught/.test(text)) process.stderr.write(text);
});
setTimeout(() => finish({ fatal: 'timeout' }), 30_000);
