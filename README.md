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

项目定位为面向半导体工艺流程图（P&ID）的自研底层 2D 工业可视化引擎，重点支持大规模图纸、
设备符号、管线、仪表状态和交互拾取。当前使用 `engine` 目录承载引擎核心，React 只用于示例页面。

引擎直接使用 WebGPU API 和 WGSL 构建设备管理、GPU Buffer、RenderPipeline、实例化绘制、
离屏拾取与空间剔除能力，不依赖 three.js、pixi.js、babylon.js 等第三方渲染引擎。

## 开发路线图

### 总体目标

打造专门服务于半导体产线 P&ID 图纸的 WebGPU 2D 引擎，而不是通用 3D 引擎。业务层只关心设备、
管线和工艺拓扑，渲染层负责 GPU 资源、批次和着色器，二者通过场景数据与状态字段连接。

核心设计原则：

1. **分层解耦**：WebGPU 底层、图元/几何层、P&ID 业务层分离。
2. **实例化优先**：阀门、泵、仪表等重复符号共用顶点模板，通过实例数据批量绘制。
3. **双渲染管线**：主可视化管线负责显示，GPU 离屏拾取管线负责返回图元 ID。
4. **状态驱动**：选中、阀门开关和介质流动等状态变化时才更新 GPU 数据。
5. **视口剔除**：通过 AABB 和四叉树减少 5 万级图纸的实际提交量，主渲染与拾取复用剔除结果。
6. **坐标统一**：使用正交相机管理世界坐标、屏幕坐标和画布像素坐标的转换。

### 当前已完成

- WebGPU 设备、Canvas 上下文和基础渲染管线初始化
- 正交相机、平移、缩放和世界坐标转换
- 矩形模板的 GPU 实例化渲染
- 实例状态 StorageBuffer 与选中高亮
- `rgba32uint` 离屏 GPU 拾取和实例 ID 读回
- AABB 工具、旋转矩形/折线包围盒和四叉树空间索引
- 视口剔除：5 万测试图元中仅提交当前视口内实例
- 管线多段线膨胀几何的基础实现
- WGSL 自动校验和 TypeScript/ESLint/Prettier 检查脚本

### 近期开发顺序

1. **实例图元扩展**：加入阀门、泵、仪表等符号模板，以及阀门开关状态的 shader 分支。
2. **管线批次完善**：将多段线几何组织为独立批次，补齐管线拾取和视口剔除。
3. **介质流动动画**：预计算管线 UV，通过时间 Uniform 和 `fract(uv.x + time * speed)` 实现流动。
4. **业务拓扑管理**：维护管线的 source-target 关系，根据阀门状态控制 `flowEnable`。
5. **状态更新优化**：将实例状态变更与几何变更分开，避免无变化时重复上传 StorageBuffer。

### 后续扩展

- P&ID 位号、设备编号和文字渲染
- 框选、多选、悬浮预览和更细粒度的拾取层级
- DXF/XML 图纸解析与导入
- 图元数量、draw call、GPU 时间等性能面板
- 图纸快照导出和在线 Demo

### 目标架构

```text
src/
├─ engine/               # WebGPU 引擎核心
│  ├─ gpu/               # 设备、渲染器、拾取和 GPU 管线
│  ├─ geometry/           # 顶点几何、AABB、四叉树和多段线
│  ├─ shader/             # WGSL 着色器
│  ├─ camera.ts           # 正交相机
│  ├─ types.ts            # 引擎数据类型
│  └─ engine.ts           # 引擎示例运行入口
├─ scene/                # 场景、实例和管线图元
├─ business/             # P&ID 拓扑与设备状态
└─ app.tsx               # React 示例入口
```

### 底层工程技术要点

- 设备符号使用实例化渲染，重复几何只上传一次。
- 管线使用预计算的带宽多段线，动画只更新时间 Uniform，不重建顶点缓冲区。
- GPU 拾取通过离屏整数纹理输出实例 ID，避免 CPU 遍历全部图元。
- AABB/四叉树用于快速筛选候选对象，精确几何命中检测作为后续补充。
- 业务拓扑不进入渲染底层，通过状态字段驱动管线显示和流动效果。

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
| `pnpm lint:wgsl`    | WGSL 编译校验   |
| `pnpm format`       | Prettier 写入   |
| `pnpm format:check` | Prettier 校验   |
| `pnpm check`        | 完整检查        |

## 代码约定

### 路径别名

`@` 指向 `src` 目录，已在 `vite.config.ts` 与 `tsconfig.app.json` 中同时配置：

```ts
import App from '@/app.tsx';
import '@/index.css';
import heroImg from '@/assets/hero.png';
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

Prettier 负责格式（带分号、单引号、尾逗号、100 字符宽），ESLint 负责代码质量。
两者通过 `eslint-plugin-prettier` 打通，`pnpm lint` 会一并报告格式问题。

### WebGPU 类型

TypeScript 6.0 内置的 `lib.dom` 已经包含 `GPUDevice`、`GPUCanvasContext`、`GPUQueue` 等 WebGPU 接口，
但缺 `canvas.getContext('webgpu')` 重载和 `GPUBufferUsage` 这类常量对象。
项目通过 `@webgpu/types` 提供完整的 WebGPU 类型声明，配置位于 `tsconfig.app.json`。

```ts
const canvas = document.querySelector<HTMLCanvasElement>('canvas');
const context = canvas?.getContext('webgpu'); // GPUCanvasContext | null

const vertexBuffer = device.createBuffer({
  size: vertices.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
```

引擎代码在 `strict` 下开发（见 `tsconfig.app.json`），可空值必须显式收窄后再使用。

WGSL 着色器文件通过 Vite 的 `?raw` 以字符串引入，类型由 `vite/client` 提供：

```ts
import shaderCode from '@/engine/shader/shader.wgsl?raw';
```

## 编辑器

项目内置 `.vscode/settings.json`，保存时自动格式化并执行 ESLint 修复；
推荐扩展见 `.vscode/extensions.json`。
