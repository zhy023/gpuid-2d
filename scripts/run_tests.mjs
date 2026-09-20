/**
 * 测试入口：用 vite 把 tests/ 下的用例按 SSR 目标 bundle 到临时目录，再用 node:test 跑。
 * 这样用例可以像源码一样写 TypeScript 并用 `@/` 别名，且不引入任何新依赖。
 *
 * 用法：node scripts/run_tests.mjs
 */
import { spawn } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const testsDir = path.join(projectRoot, 'tests');
const outDir = path.join(projectRoot, 'node_modules/.tmp/tests');

const entries = (await readdir(testsDir))
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => path.join(testsDir, name));

if (entries.length === 0) {
  console.log('未发现测试用例（tests/*.test.ts）');
  process.exit(0);
}

await rm(outDir, { recursive: true, force: true });
await build({
  root: projectRoot,
  logLevel: 'warn',
  build: {
    ssr: true,
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: entries,
      output: { entryFileNames: '[name].test.js' },
    },
  },
});

const bundles = (await readdir(outDir)).filter((name) => name.endsWith('.test.js')).sort();
const child = spawn(
  process.execPath,
  ['--test', ...bundles.map((name) => path.join(outDir, name))],
  {
    cwd: outDir,
    stdio: 'inherit',
  },
);
child.on('exit', (code) => process.exit(code ?? 1));
