/**
 * 查找可用的 Chrome / Chromium，供各检查脚本复用。
 *
 * 之前各脚本各自写死 macOS 路径，CI（ubuntu runner）上会直接
 * `spawn ... ENOENT`，所以统一在这里按平台探测，并支持环境变量覆盖：
 *   - `CHROME_PATH`：显式指定浏览器可执行文件（推荐）
 *   - `WGSL_CHECK_CHROME`：历史变量，优先顺序低于 `CHROME_PATH`
 *
 * 通过 `CHROME_PATH` / `WGSL_CHECK_CHROME` 指定但文件不存在时返回 null，
 * 由调用方给出带上下文的报错。
 */
import { existsSync } from 'node:fs';

/** 常见安装路径：macOS / Linux / Windows */
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

/**
 * 找到可用的 Chrome / Chromium。
 * @returns {string | null} 可执行文件路径；找不到返回 null
 */
export function findChrome() {
  const fromEnv = process.env.CHROME_PATH || process.env.WGSL_CHECK_CHROME;
  if (fromEnv) {
    return existsSync(fromEnv) ? fromEnv : null;
  }
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * 以 root 运行时（容器 / CI）需要额外放开 Chrome 沙箱。
 * @param {string[]} args
 * @returns {string[]}
 */
export function withSandboxFlags(args) {
  return process.getuid?.() === 0 ? ['--no-sandbox', ...args] : args;
}
