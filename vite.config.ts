import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { generateShaders } from './scripts/build_shaders.mjs';

/**
 * 着色器模块生成：`src` 下的 `.wgsl` -> 所属 `shader/generated/` 下的 `.ts`
 * （展开 `#include` 后的字符串，与 `.wgsl` 源文件分开存放）。
 *
 * WGSL 没有预处理指令，`?raw` 这类打包器私有语法又会把库绑死在 Vite 上，
 * 所以生成物是普通 ESM 字符串：任何打包器、任何第三方都能直接用。
 *
 * 本插件只负责开发体验：
 *   - 启动/构建前先同步一次，避免读到过期生成物
 *   - dev 下改 `.wgsl`（含被 include 的片段）时重新生成并整页刷新：
 *     include 关系只存在于字符串层面，打包器看不见依赖，细粒度 HMR 无从谈起
 */
function wgslModulesPlugin(): Plugin {
  return {
    name: 'gpuid:wgsl-modules',
    async buildStart() {
      await generateShaders();
    },
    async hotUpdate({ file, server }) {
      if (!file.endsWith('.wgsl')) return;
      await generateShaders();
      server.ws.send({ type: 'full-reload', path: '*' });
      return [];
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [wgslModulesPlugin(), react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
