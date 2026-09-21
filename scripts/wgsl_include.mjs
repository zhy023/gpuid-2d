/**
 * WGSL 自研 `#include` 预处理（无第三方依赖）。
 *
 * WGSL 语言本身没有预处理指令，`#include` 会在 Tint 编译时报
 * `invalid character found`。构建期（vite 插件）与校验期（check_wgsl.mjs）
 * 都通过本模块把 include 展开成单文件着色器。
 *
 * 规则：
 *   - 只识别整行 `#include "相对路径"`（可带结尾分号、允许前后空白）
 *   - 路径相对「当前文件所在目录」解析；`@/` 前缀与 TS 侧 alias 一致，指向 src/
 *   - 同一文件重复 include 只展开一次（等效 `#pragma once`），避免结构体重定义
 *   - 循环 include 直接报错，而不是让 Tint 抛出难懂的信息
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INCLUDE_LINE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*;?[ \t]*\r?$/gm;
/** `@/` 别名根目录（src/），与 vite.config.ts / tsconfig 的 alias 保持一致 */
const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url));
const ALIAS_PREFIX = '@/';

/** 把 include 里的路径解析成绝对路径：支持 `@/` 别名与相对路径 */
function resolveIncludePath(specifier, fromDir) {
  if (specifier.startsWith(ALIAS_PREFIX)) {
    return path.join(SRC_ROOT, specifier.slice(ALIAS_PREFIX.length));
  }
  return path.resolve(fromDir, specifier);
}

async function readSourceFromDisk(filePath) {
  return await readFile(filePath, 'utf8');
}

/**
 * 展开入口 WGSL 文件里的全部 `#include`。
 * @param {string} entryFilePath 入口着色器绝对路径（或相对 cwd 的路径）
 * @param {{ readSource?: (filePath: string) => Promise<string> }} [options]
 * @returns {Promise<{ code: string, dependencies: string[] }>} 展开后的代码与依赖文件（含入口文件）
 */
export async function resolveWgslIncludes(entryFilePath, options = {}) {
  const readSource = options.readSource ?? readSourceFromDisk;
  const dependencies = [];
  const emitted = new Set();

  async function inline(filePath, stack) {
    const resolvedPath = path.resolve(filePath);

    /** 先判环：真正成环时报错，菱形依赖（同一文件被两条路径各自 include）只算重复 */
    if (stack.includes(resolvedPath)) {
      const cycle = [...stack, resolvedPath].map((item) => path.relative(process.cwd(), item));
      throw new Error(`WGSL #include 存在循环引用：${cycle.join(' -> ')}`);
    }
    if (emitted.has(resolvedPath)) return '';

    emitted.add(resolvedPath);
    dependencies.push(resolvedPath);

    const source = await readSource(resolvedPath);
    /** 正则必须是本次调用的局部实例：嵌套 include 会打断复用的 lastIndex */
    const includeLine = new RegExp(INCLUDE_LINE.source, 'gm');
    const chunks = [];
    let cursor = 0;
    let match = includeLine.exec(source);

    while (match !== null) {
      chunks.push(source.slice(cursor, match.index));
      const includedPath = resolveIncludePath(match[1], path.dirname(resolvedPath));
      chunks.push(`// >>> include: ${path.relative(process.cwd(), includedPath)}\n`);
      chunks.push(await inline(includedPath, [...stack, resolvedPath]));
      cursor = match.index + match[0].length;
      if (!source.slice(cursor).startsWith('\n')) chunks.push('\n');
      match = includeLine.exec(source);
    }

    chunks.push(source.slice(cursor));
    return chunks.join('');
  }

  const code = await inline(entryFilePath, []);
  return { code, dependencies };
}
