# 项目规则

## 0. 项目定位

gpuid-2d 是**自研的 2D 底层 WebGPU 引擎**，直接基于 WebGPU API 实现渲染，
不封装 three.js、pixi.js、babylon.js 等第三方渲染库。所有代码改动都必须服务于这个定位。

- 渲染后端固定为 WebGPU，着色器用 WGSL
- React 仅用于示例页面与调试面板，不参与引擎内核
- 引擎内核不得依赖第三方渲染/框架库；确需引入其他依赖时必须先确认
- 引擎代码应保持与 UI 解耦，可在无 React 环境下独立使用

分层约定（管线、阀门等设备图元属于上层业务，必须与内核分离）：

- `src/core/`：业务无关的引擎内核（设备、渲染器、拾取、相机、几何、通用 `InstanceTransform` 与通用着色器）
- `src/business/pid_schematic/`：P&ID 业务层（管线、阀门等设备图元、拓扑、状态），含业务着色器
- `src/demo/`：示例运行入口，是唯一允许同时依赖 core 与 business 的地方
- **`src/core/` 严禁 import `src/business/` 或 `src/demo/`**；自查：`rg -n "@/business|@/demo" src/core` 应无输出
- 通用着色器放 `src/core/shader/`，业务着色器放 `src/business/pid_schematic/shader/`；
  展开后的字符串模块放各自 `shader/generated/`（生成物，勿手改，随源码提交）
- WGSL 的 `#include` 支持 `@/` 别名（`pnpm shaders` 生成期展开，逻辑见 `scripts/build_shaders.mjs`），跨目录 include 用 `@/...`，不要写 `../../`
- TS 侧只 import 生成物（`shader/generated/*.ts`），不要用 `?raw` 等打包器私有语法引入 `.wgsl`
- 用例与检查脚本分工：Node 可跑的逻辑用例放 `tests/*.test.ts`（`pnpm test` 运行，已并入 `pnpm run check`）；
  需要真实 WebGPU 的检查放 `scripts/check_*.mjs`（如 `pnpm run check:device`），按需运行、不阻塞 `check`
- `src/` 之外的文件（`README.md`、`AGENTS.md`、`.github/`、`scripts/` 等）改动同样要过 `pnpm run format:check`

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
import App from '@/app.tsx';
import UserCard from '@/components/user_card';
import '@/index.css';
import heroImg from '@/assets/hero.png';
```

- 跨目录引用一律使用 `@/...`
- 同目录内可用 `./xxx`
- 禁止 `../../` 及更多层的相对路径（已由 ESLint `no-restricted-imports` 拦截）
- 修改别名时，`vite.config.ts` 与 `tsconfig.app.json` 必须同步修改

## 3. 代码风格

- Prettier：分号、单引号、尾逗号、100 字符宽、2 空格缩进
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

| 命令                | 说明                                         |
| ------------------- | -------------------------------------------- |
| `pnpm install`      | 安装依赖                                     |
| `pnpm dev`          | 启动开发服务器                               |
| `pnpm build`        | 类型检查并打包                               |
| `pnpm lint`         | ESLint 检查                                  |
| `pnpm lint:fix`     | ESLint 自动修复                              |
| `pnpm format`       | Prettier 写入                                |
| `pnpm format:check` | Prettier 校验                                |
| `pnpm lint:names`   | 文件名规范校验                               |
| `pnpm lint:wgsl`    | WGSL 着色器编译校验                          |
| `pnpm check`        | 完整检查：lint + 文件名 + WGSL + 格式 + 构建 |

## 6. 完成前自查

1. `pnpm run check` 全部通过
2. 新增文件符合小写 + 下划线命名
3. 跨目录引用使用 `@` 别名
4. 依赖变更使用 pnpm，锁文件只保留 `pnpm-lock.yaml`
5. 没有残留的调试代码和 `console.log`
