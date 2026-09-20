import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { resolveWgslIncludes } from './scripts/wgsl_include.mjs';

/**
 * 构建期展开 WGSL 的 `#include`。
 *
 * WGSL 没有预处理指令，`?raw` 导入会把 `#include` 原样丢给 Tint 并报
 * `invalid character found`。这里在 load 阶段先把 include 展开成单文件代码，
 * 保证「源码可拆分复用」与「运行期单文件着色器」同时成立。
 *
 * enforce: 'pre' —— 必须早于 Vite 内置的 `?raw` 处理。
 */
function wgslIncludePlugin(): Plugin {
  return {
    name: 'gpuid:wgsl-include',
    enforce: 'pre',
    async load(id) {
      const [filePath, query = ''] = id.split('?');
      if (!filePath.endsWith('.wgsl')) return null;
      if (query && !query.split('&').includes('raw')) return null;

      const { code } = await resolveWgslIncludes(filePath);
      return `export default ${JSON.stringify(code)};`;
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [wgslIncludePlugin(), react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
