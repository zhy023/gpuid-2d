# gpuid-2d

自研的 2D 底层 WebGPU 引擎。

> 项目强制约定见 [AGENTS.md](./AGENTS.md)，提交前请确保 `pnpm run check` 通过。

包管理器统一使用 **pnpm**（`pnpm@10.29.3`，已写入 `package.json` 的 `packageManager` 字段）。

## 项目简介

gpuid-2d 是一个自研的 2D 底层 WebGPU 引擎，直接基于 WebGPU API 搭建 2D 渲染管线，
不封装 three.js、pixi.js 等第三方渲染库，目标是提供一个体积小、行为可控的 2D 渲染底座。

- 渲染后端：WebGPU，着色器使用 WGSL
- 语言与构建：TypeScript + Vite
- 示例与调试界面：React，仅承载演示页面与调试面板，不参与引擎内核

当前处于项目初始化阶段，引擎内核（适配器与设备管理、渲染管线与着色器、资源管理、
批次与绘制调度等）尚未实现。

## 脚本

| 命令                | 说明            |
| ------------------- | --------------- |
| `pnpm install`      | 安装依赖        |
| `pnpm dev`          | 启动开发服务器  |
| `pnpm build`        | 类型检查并打包  |
| `pnpm preview`      | 预览构建产物    |
| `pnpm lint`         | ESLint 检查     |
| `pnpm lint:fix`     | ESLint 自动修复 |
| `pnpm lint:names`   | 文件名规范校验  |
| `pnpm format`       | Prettier 写入   |
| `pnpm format:check` | Prettier 校验   |
| `pnpm check`        | 完整检查        |

## 代码约定

### 路径别名

`@` 指向 `src` 目录，已在 `vite.config.ts` 与 `tsconfig.app.json` 中同时配置：

```ts
import App from '@/app.tsx'
import '@/index.css'
import heroImg from '@/assets/hero.png'
```

### 文件命名

所有文件名使用小写 + 下划线（snake_case），例如 `user_profile.tsx`、`api_client.ts`。
组件文件遵循同一规则，组件本身仍使用大驼峰导出名。

```
src/
  app.tsx
  main.tsx
  index.css
  assets/
  components/
    user_card.tsx
```

### 代码风格

Prettier 负责格式（无分号、单引号、尾逗号、100 字符宽），ESLint 负责代码质量。
两者通过 `eslint-plugin-prettier` 打通，`pnpm lint` 会一并报告格式问题。

## 编辑器

项目内置 `.vscode/settings.json`，保存时自动格式化并执行 ESLint 修复；
推荐扩展见 `.vscode/extensions.json`。
