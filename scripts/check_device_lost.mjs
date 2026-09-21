/**
 * 设备丢失探针：destroy() → 断言 lost 回调触发且 reason=destroyed → 重新申请设备并建资源。
 * 这正是 initWebGPU 里挂的回调与「dispose 后可重建」所依赖的浏览器行为。
 *
 * 用法：
 *   node scripts/check_device_lost.mjs
 *   CHROME_PATH=/path/to/chrome node scripts/check_device_lost.mjs   # 指定浏览器
 *   DEVICE_CHECK_SKIP=1 node scripts/check_device_lost.mjs           # 跳过检查
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findChrome, withSandboxFlags } from './find_chrome.mjs';

const page = `<!doctype html><html><body><pre id="out">PENDING</pre><script type="module">
async function run() {
  const result = {};
  /** 无 GPU 的 runner（CI）只有 fallback adapter 可用，两种都试 */
  const adapter =
    (await navigator.gpu.requestAdapter()) ??
    (await navigator.gpu.requestAdapter({ forceFallbackAdapter: true }));
  if (!adapter) throw new Error('没有拿到 GPUAdapter');
  const device = await adapter.requestDevice();
  const lost = new Promise((resolve) => device.lost.then((info) => resolve({ reason: info.reason, message: info.message })));
  device.destroy();
  result.lost = await lost;
  result.lostPromiseResolved = true;
  /** 重建：适配器被旧设备消费过，必须重新 requestAdapter 再 requestDevice */
  const adapter2 =
    (await navigator.gpu.requestAdapter()) ??
    (await navigator.gpu.requestAdapter({ forceFallbackAdapter: true }));
  if (!adapter2) throw new Error('重建时没有拿到 GPUAdapter');
  const device2 = await adapter2.requestDevice();
  const buffer = device2.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const texture = device2.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device2.queue.writeBuffer(buffer, 0, new Float32Array(64));
  device2.queue.writeTexture({ texture }, new Uint8Array(64), { bytesPerRow: 16 }, [4, 4]);
  result.rebuildOk = !!buffer && !!texture;

  /** 重建后还要能建管线并真的渲染一帧（不只是能建 buffer/纹理） */
  const module = device2.createShaderModule({
    code: \`
      @vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
        return vec4f(0.0, 0.0, 0.0, 1.0);
      }
      @fragment fn fs_main() -> @location(0) vec4f {
        return vec4f(0.1, 0.2, 0.3, 1.0);
      }
    \`,
  });
  const pipeline = device2.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs_main' },
    fragment: { module, entryPoint: 'fs_main', targets: [{ format: 'rgba8unorm' }] },
  });
  const target = device2.createTexture({
    size: [4, 4],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const encoder = device2.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: target.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.draw(3);
  pass.end();
  device2.queue.submit([encoder.finish()]);
  await device2.queue.onSubmittedWorkDone();
  result.renderAfterRebuild = true;
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

/** 探针结果是否满足「掉设备可重建并重新出图」的全部断言 */
function isPassing(result) {
  return (
    result?.lost?.reason === 'destroyed' &&
    result.lostPromiseResolved === true &&
    result.rebuildOk === true &&
    result.renderAfterRebuild === true
  );
}

function finish(result) {
  if (settled) return;
  settled = true;
  server.close();
  chrome?.kill('SIGKILL');
  rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify(result, null, 2));
  if (!isPassing(result)) {
    console.error('设备丢失探针未通过：见上面的 result（fatal 字段为失败原因）');
    /* 子进程可能还占着 stdio，显式退出避免脚本挂住 */
    process.exit(1);
  }
  console.log('设备丢失探针通过：destroy → lost(destroyed) → 重建 → 建管线并渲染一帧');
  process.exit(0);
}

if (process.env.DEVICE_CHECK_SKIP === '1') {
  console.log('已跳过设备丢失探针（DEVICE_CHECK_SKIP=1）');
  process.exit(0);
}

const chromePath = findChrome();

if (!chromePath) {
  console.error('未找到 Chrome / Chromium，无法运行设备丢失探针。');
  console.error('  · 用 CHROME_PATH=/path/to/chrome 指定浏览器');
  console.error('  · 或设置 DEVICE_CHECK_SKIP=1 临时跳过');
  process.exit(1);
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
chrome = spawn(
  chromePath,
  withSandboxFlags([
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-unsafe-webgpu',
    `--user-data-dir=${userDataDir}`,
    `http://127.0.0.1:${port}/`,
  ]),
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
/* 浏览器起不来（路径不对、权限不足）时给出可读的失败信息，而不是未捕获的 error 事件 */
chrome.on('error', (error) => {
  finish({ fatal: `无法启动浏览器：${error.message}`, chrome: chromePath });
});
chrome.stderr.on('data', (chunk) => {
  const text = String(chunk);
  if (/GPUDevice|Uncaught/.test(text)) process.stderr.write(text);
});
setTimeout(() => finish({ fatal: 'timeout' }), 30_000);
