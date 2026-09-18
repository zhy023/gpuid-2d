# 项目规则

## 0. 项目定位

gpuid-2d 是**自研的 2D 底层 WebGPU 引擎**，直接基于 WebGPU API 实现渲染，
不封装 three.js、pixi.js、babylon.js 等第三方渲染库。所有代码改动都必须服务于这个定位。

- 渲染后端固定为 WebGPU，着色器用 WGSL
- React 仅用于示例页面与调试面板，不参与引擎内核
- 引擎内核不得依赖第三方渲染/框架库；确需引入其他依赖时必须先确认
- 引擎代码应保持与 UI 解耦，可在无 React 环境下独立使用

本文件是项目的强制约定。**任何代码改动都必须严格遵守，不得例外**；
提交前必须通过 `pnpm run check`。

## 1. 文件命名：全部小写 + 下划线（snake_case）

适用范围：`src/`、`scripts/` 以及所有新增的源码与资源文件。

- 只使用小写字母、数字和下划线，单词之间用 `_` 连接
- 禁止大驼峰、小驼峰、中划线和空格
- 组件文件名同样遵守，组件本身仍用大驼峰导出

```
正确：app.tsx  main.tsx  user_card.tsx  api_client.ts  check_file_names.mjs  hero.png
错误：App.tsx  userCard.tsx  user-card.tsx  UserCard.tsx
```

目录名同样使用小写 + 下划线，例如 `src/user_profile/`。
根目录的惯例文件（`README.md`、`AGENTS.md`、`package.json`、`eslint.config.js` 等）不受此限制。

## 2. 路径别名：`@` 指向 `src`

已在 `vite.config.ts` 与 `tsconfig.app.json` 中配置，两端必须保持一致。

```ts
import App from '@/app.tsx'
import UserCard from '@/components/user_card'
import '@/index.css'
import heroImg from '@/assets/hero.png'
```

- 跨目录引用一律使用 `@/...`
- 同目录内可用 `./xxx`
- 禁止 `../../` 及更多层的相对路径（已由 ESLint `no-restricted-imports` 拦截）
- 修改别名时，`vite.config.ts` 与 `tsconfig.app.json` 必须同步修改

## 3. 代码风格

- Prettier：无分号、单引号、尾逗号、100 字符宽、2 空格缩进
- ESLint（flat config）负责代码质量，`eslint-plugin-prettier` 已打通，格式问题会在 lint 中报告
- 使用函数式组件 + Hooks，遵循 `react-hooks` 规则
- TypeScript 严格类型，避免 `any`；无法确定类型时使用 `unknown` 并做收窄

## 4. 技术栈

- 构建：Vite
- 框架：React 19 + TypeScript
- 渲染：WebGPU（WGSL 着色器），自研 2D 底层引擎
- 质量：ESLint 9 + Prettier 3
- 包管理器：pnpm（禁止使用 npm / yarn 安装依赖，禁止提交 `package-lock.json`、`yarn.lock`）

## 5. 常用命令

| 命令                | 说明                                      |
| ------------------- | ----------------------------------------- |
| `pnpm install`      | 安装依赖                                  |
| `pnpm dev`          | 启动开发服务器                            |
| `pnpm build`        | 类型检查并打包                            |
| `pnpm lint`         | ESLint 检查                               |
| `pnpm lint:fix`     | ESLint 自动修复                           |
| `pnpm format`       | Prettier 写入                             |
| `pnpm format:check` | Prettier 校验                             |
| `pnpm lint:names`   | 文件名规范校验                            |
| `pnpm check`        | 完整检查：lint + 文件名规范 + 格式 + 构建 |

## 6. 完成前自查

1. `pnpm run check` 全部通过
2. 新增文件符合小写 + 下划线命名
3. 跨目录引用使用 `@` 别名
4. 依赖变更使用 pnpm，锁文件只保留 `pnpm-lock.yaml`
5. 没有残留的调试代码和 `console.log`
