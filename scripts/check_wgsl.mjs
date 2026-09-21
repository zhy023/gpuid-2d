/**
 * 用真实 WGSL 编译器（Chrome / Chromium 内置的 Tint）校验 src 下所有 WGSL 着色器。
 *
 * 用法：
 *   node scripts/check_wgsl.mjs
 *   WGSL_CHECK_CHROME=/path/to/chrome node scripts/check_wgsl.mjs   # 指定浏览器
 *   WGSL_CHECK_SKIP=1 node scripts/check_wgsl.mjs                    # 跳过校验
 *
 * 校验前会先展开 `#include`（与 vite 插件同一套逻辑），保证校验对象
 * 就是运行期真正送进 createShaderModule 的代码。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { findChrome, withSandboxFlags } from './find_chrome.mjs';
import { resolveWgslIncludes } from './wgsl_include.mjs';

const TARGET_DIR = 'src';
const SHADER_SUFFIX = '.wgsl';
const TIMEOUT_MS = 90_000;

/**
 * 收集 src 下所有 .wgsl 文件，并展开各自的 `#include`（支持 `@/` 别名）。
 * 展开结果与 vite 插件送给 GPU 的代码一致，校验才有意义。
 */
async function collectShaders(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const shaders = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      shaders.push(...(await collectShaders(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(SHADER_SUFFIX)) {
      const { code } = await resolveWgslIncludes(fullPath);
      shaders.push({ file: fullPath, code });
    }
  }

  return shaders.sort((a, b) => a.file.localeCompare(b.file));
}

/** 构造在浏览器里逐个编译着色器、再把诊断回传的页面。 */
function buildPage(shaders) {
  const payload = JSON.stringify(shaders.map(({ file, code }) => ({ file, code })));

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>wgsl check</title>
  </head>
  <body>
    <pre id="out">PENDING</pre>
    <script type="module">
      const SHADERS = ${payload};

      async function requestAdapter() {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) return adapter;
        return navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
      }

      async function run() {
        const result = { ok: false, reason: '', shaders: [] };
        try {
          if (!navigator.gpu) throw new Error('navigator.gpu 不可用');
          const adapter = await requestAdapter();
          if (!adapter) throw new Error('没有拿到 GPUAdapter');
          const device = await adapter.requestDevice();

          for (const shader of SHADERS) {
            const module = device.createShaderModule({ code: shader.code });
            const info = await module.getCompilationInfo();
            result.shaders.push({
              file: shader.file,
              messages: info.messages.map((message) => ({
                type: message.type,
                line: message.lineNum,
                pos: message.linePos,
                message: message.message,
              })),
            });
          }
          result.ok = true;
        } catch (error) {
          result.reason = String(error && error.message ? error.message : error);
        }

        document.getElementById('out').textContent = JSON.stringify(result, null, 2);
        await fetch('/result', { method: 'POST', body: JSON.stringify(result) }).catch(() => {});
      }

      run();
    </script>
  </body>
</html>
`;
}

/** 启动 Chrome，编译全部着色器，返回诊断结果。 */
async function compileShaders(chromePath, shaders) {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'gpuid-wgsl-check-'));

  return await new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      if (request.method === 'POST' && request.url === '/result') {
        let body = '';
        request.on('data', (chunk) => {
          body += chunk;
        });
        request.on('end', () => {
          response.writeHead(200, { 'content-type': 'text/plain' });
          response.end('ok');
          cleanup();
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('浏览器回传的结果不是合法 JSON'));
          }
        });
        return;
      }

      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(buildPage(shaders));
    });

    const pageUrl = new URL('http://127.0.0.1/');
    let chrome;
    let timer;
    let settled = false;
    const chromeStderr = [];

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      if (chrome?.pid) {
        try {
          process.kill(-chrome.pid, 'SIGKILL');
        } catch {
          chrome.kill('SIGKILL');
        }
      }
      void rm(userDataDir, { recursive: true, force: true });
    }

    function fail(error) {
      cleanup();
      reject(error);
    }

    server.on('error', fail);

    server.listen(0, '127.0.0.1', () => {
      pageUrl.port = String(server.address().port);

      const args = withSandboxFlags([
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--enable-unsafe-webgpu',
        `--user-data-dir=${userDataDir}`,
        pageUrl.href,
      ]);

      chrome = spawn(chromePath, args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
      chrome.stderr.on('data', (chunk) => {
        if (chromeStderr.length < 20) chromeStderr.push(String(chunk).trim());
      });
      chrome.on('error', fail);
      chrome.on('exit', (code) => {
        if (!settled) {
          fail(new Error(`浏览器提前退出（code=${code}）\n${chromeStderr.join('\n')}`));
        }
      });

      timer = setTimeout(() => {
        fail(new Error(`等待浏览器编译着色器超时（${TIMEOUT_MS / 1000}s）`));
      }, TIMEOUT_MS);
    });
  });
}

let shaders;
try {
  shaders = await collectShaders(TARGET_DIR);
} catch (error) {
  console.error(`WGSL 预处理失败：#include 展开不成功`);
  console.error(`  ${error.message}`);
  process.exit(1);
}

if (shaders.length === 0) {
  console.log(`未发现 ${SHADER_SUFFIX} 着色器，跳过 WGSL 校验`);
  process.exit(0);
}

if (process.env.WGSL_CHECK_SKIP === '1') {
  console.log(`已跳过 WGSL 校验（${shaders.length} 个着色器）`);
  process.exit(0);
}

const chromePath = findChrome();

if (!chromePath) {
  console.error('未找到 Chrome / Chromium，无法校验 WGSL。');
  console.error('  · 用 CHROME_PATH=/path/to/chrome 指定浏览器');
  console.error('  · 或设置 WGSL_CHECK_SKIP=1 临时跳过');
  process.exit(1);
}

let outcome;
try {
  outcome = await compileShaders(chromePath, shaders);
} catch (error) {
  console.error(`WGSL 校验无法完成：${error.message}`);
  console.error('  · 若当前环境不支持 headless WebGPU，可设置 WGSL_CHECK_SKIP=1 跳过');
  process.exit(1);
}

if (!outcome.ok) {
  console.error(`WGSL 校验无法完成：${outcome.reason}`);
  console.error('  · 若当前环境不支持 headless WebGPU，可设置 WGSL_CHECK_SKIP=1 跳过');
  process.exit(1);
}

let errorCount = 0;

for (const shader of outcome.shaders) {
  const errors = shader.messages.filter((message) => message.type === 'error');
  const warnings = shader.messages.filter((message) => message.type !== 'error');
  errorCount += errors.length;

  if (errors.length > 0) {
    console.error(`${shader.file}`);
  }
  for (const message of errors) {
    console.error(`  L${message.line}:${message.pos} error: ${message.message}`);
  }
  for (const message of warnings) {
    console.warn(
      `  ${shader.file} L${message.line}:${message.pos} ${message.type}: ${message.message}`,
    );
  }
}

if (errorCount > 0) {
  console.error(`\nWGSL 校验失败：${errorCount} 个错误`);
  process.exit(1);
}

console.log(`WGSL 检查通过（${shaders.length} 个着色器）`);
