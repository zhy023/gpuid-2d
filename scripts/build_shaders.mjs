/**
 * 把入口 WGSL 编译成「字符串模块」（着色器分发方案 A）。
 *
 * WGSL 没有 `#include`，打包器也看不见着色器之间的依赖，所以这里在仓库内
 * 先把 `#include` 展开、再落成普通的字符串模块：
 *
 *   src/core/shader/core_render/primitive_render.wgsl
 *     -> src/core/shader/generated/core_render/primitive_render.ts
 *         export default "…展开后的单文件 WGSL…";
 *
 * 这样第三方拿到的是普通 ESM 字符串，不需要 Vite、不需要 `?raw`、
 * 也不需要任何自定义插件；本仓库只是多一次「源文件 -> 生成物」的步骤。
 *
 * 约定：
 *   - 扫描 `src/` 下所有 `.wgsl` 作为入口，`*_include/` 目录里的片段不单独生成
 *   - 生成物统一放在所属「着色器根目录」（最近的名为 `shader` 的祖先目录）下的
 *     `generated/` 子目录，与 `.wgsl` 源文件分开，相对结构保持一致
 *   - 生成物内容、格式化（prettier）都是确定的，`--check` 用于 CI 校验是否同步
 *   - 源 WGSL 里的 `#include` 支持 `@/` 别名，展开逻辑见 `wgsl_include.mjs`
 *
 * 用法：
 *   node scripts/build_shaders.mjs           # 生成 / 更新
 *   node scripts/build_shaders.mjs --check   # 只校验是否与源 WGSL 一致
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { resolveWgslIncludes } from './wgsl_include.mjs';

/** 仓库根目录 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** 扫描根目录 */
const SRC_DIR = path.join(ROOT, 'src');
const WGSL_SUFFIX = '.wgsl';
/** 生成物：着色器根目录下的独立文件夹，不与 `.wgsl` 混放 */
const SHADER_ROOT_NAME = 'shader';
const GENERATED_DIR_NAME = 'generated';
const GENERATED_SUFFIX = '.ts';
/** 被 include 的片段目录（以 `_include` 结尾）不单独生成模块 */
const INCLUDE_DIR_SUFFIX = '_include';
/** 生成物首行标记：用于识别「本工具生成的」文件（同时保护手写文件不被清理） */
const GENERATED_MARKER = '// 本文件由 scripts/build_shaders.mjs 生成';
/** prettier 配置缓存（首次使用时从 `.prettierrc.json` 解析） */
let prettierOptions = null;

/** 相对仓库根目录的 posix 路径，便于日志与生成物里的注释 */
function toRelative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

/**
 * 递归收集入口着色器：`src/` 下所有 `.wgsl`，跳过 `*_include/` 片段目录。
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function collectEntryShaders(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const shaders = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith(INCLUDE_DIR_SUFFIX)) continue;
      shaders.push(...(await collectEntryShaders(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(WGSL_SUFFIX)) {
      shaders.push(fullPath);
    }
  }

  return shaders;
}

/**
 * 递归收集已经存在的生成物（`generated/` 目录下的 `.ts`）。
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function collectGeneratedFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectGeneratedFiles(fullPath)));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(GENERATED_SUFFIX) &&
      isInGeneratedDir(fullPath)
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

/** 判断文件是否位于某个 `generated/` 目录内 */
function isInGeneratedDir(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).includes(GENERATED_DIR_NAME);
}

/**
 * 找出口径内的「着色器根目录」：最近的名为 `shader` 的祖先目录。
 * 找不到（例如以后着色器换个地方放）就退回文件自己所在的目录。
 */
function shaderRootOf(entryPath) {
  let dir = path.dirname(entryPath);
  while (dir !== ROOT && dir.startsWith(ROOT)) {
    if (path.basename(dir) === SHADER_ROOT_NAME) return dir;
    dir = path.dirname(dir);
  }
  return path.dirname(entryPath);
}

/**
 * 入口着色器路径 -> 生成物路径：
 * `<着色器根目录>/generated/` 下保持相对结构，扩展名换成 `.ts`。
 */
function toGeneratedPath(entryPath) {
  const shaderRoot = shaderRootOf(entryPath);
  const relative = path.relative(shaderRoot, entryPath);
  const generatedName = `${relative.slice(0, -WGSL_SUFFIX.length)}${GENERATED_SUFFIX}`;
  return path.join(shaderRoot, GENERATED_DIR_NAME, generatedName);
}

/** 读文件，不存在返回 null */
async function readIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 渲染生成物的文本内容。
 * 用 prettier 格式化（与仓库同一份 `.prettierrc.json`），保证 `format:check` 无需特殊忽略。
 * @param {string} entryPath
 * @param {string} code 已展开 include 的 WGSL
 */
async function renderModule(entryPath, code) {
  const generatedPath = toGeneratedPath(entryPath);
  const relative = toRelative(entryPath);
  const source =
    `// 本文件由 scripts/build_shaders.mjs 生成，请勿手动修改。\n` +
    `// 源着色器：${relative}（#include 已在生成期展开，运行期直接交给 createShaderModule）。\n\n` +
    `export default ${JSON.stringify(code)};\n`;

  /* format() 不会自己去读 `.prettierrc.json`（那是 CLI 的行为），这里显式解析 */
  prettierOptions ??= (await resolveConfig(generatedPath)) ?? {};
  return await format(source, { ...prettierOptions, filepath: generatedPath });
}

/**
 * 生成（或校验）所有 WGSL 字符串模块。
 * @param {{ check?: boolean }} [options] check 为 true 时只比对、不写盘
 * @returns {Promise<{
 *   entryCount: number,
 *   shaderFileCount: number,
 *   written: string[],
 *   removed: string[],
 *   stale: string[],
 * }>} `stale` 仅校验模式下有意义
 */
export async function generateShaders(options = {}) {
  const check = options.check === true;
  const entries = await collectEntryShaders(SRC_DIR);
  const expected = new Map();
  const shaderFiles = new Set();

  for (const entry of entries) {
    const { code, dependencies } = await resolveWgslIncludes(entry);
    for (const dependency of dependencies) shaderFiles.add(dependency);
    expected.set(toGeneratedPath(entry), await renderModule(entry, code));
  }

  const written = [];
  const stale = [];

  for (const [filePath, content] of expected) {
    if ((await readIfExists(filePath)) === content) continue;
    if (check) {
      stale.push(filePath);
      continue;
    }
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
    written.push(filePath);
  }

  /** 清理孤儿生成物（源着色器改名/删除后遗留的模块），只删带生成标记的文件 */
  const removed = [];
  const orphans = (await collectGeneratedFiles(SRC_DIR)).filter(
    (filePath) => !expected.has(filePath),
  );

  for (const filePath of orphans) {
    const content = await readIfExists(filePath);
    if (content === null || !content.startsWith(GENERATED_MARKER)) continue;
    if (check) {
      stale.push(filePath);
      continue;
    }
    await rm(filePath);
    removed.push(filePath);
  }

  return {
    entryCount: entries.length,
    shaderFileCount: shaderFiles.size,
    written,
    removed,
    stale,
  };
}

/** CLI 入口 */
async function runCli() {
  const check = process.argv.includes('--check');
  const result = await generateShaders({ check });

  if (check) {
    if (result.stale.length > 0) {
      console.error('以下着色器模块与源 WGSL 不同步：');
      for (const filePath of result.stale) console.error(`  ${toRelative(filePath)}`);
      console.error('\n请运行 `pnpm run shaders` 重新生成后提交。');
      process.exit(1);
    }
    console.log(
      `着色器模块已同步（${result.entryCount} 个入口 / ${result.shaderFileCount} 个 wgsl 文件）`,
    );
    return;
  }

  for (const filePath of result.written) console.log(`生成 ${toRelative(filePath)}`);
  for (const filePath of result.removed) console.log(`删除 ${toRelative(filePath)}`);
  console.log(
    `着色器模块已生成（${result.entryCount} 个入口 / ${result.shaderFileCount} 个 wgsl 文件，` +
      `更新 ${result.written.length} 个）`,
  );
}

const invokedPath = process.argv[1];
const isMain =
  invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    await runCli();
  } catch (error) {
    console.error(`着色器模块生成失败：${error.message}`);
    process.exit(1);
  }
}
