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
设备符号、管线、仪表状态和交互拾取。当前使用 `core` 目录承载引擎核心，React 只用于示例页面。

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
- 管线按「每段一个实例」批量绘制：段中点/方向角/段长现算，拐点流动相位连续；管线之间只有粗细不同（2~10px、步长 2px 的屏幕像素档位，不随缩放变化），条纹周期/速度/配色全局统一
- 管线支持「流动 / 默认」两种样式：`flowSpeed > 0` 为流动条纹，`0` 恢复默认（纯管身色），供阀门开关按拓扑驱动
- 画布通路开启 4x MSAA（渲染到多重采样目标再 resolve 到画布）与标准 alpha 混合，核心与业务 pipeline 统一取 `core/gpu/render_state.ts`
- WGSL 自动校验和 TypeScript/ESLint/Prettier 检查脚本

### 近期开发顺序

1. **实例图元扩展**：加入阀门、泵、仪表等符号模板，以及阀门开关状态的 shader 分支。
2. **管线拾取补齐**：主渲染已按段实例化 + 视口剔除，拾取通路还需接入管线并区分图元 ID 空间。
3. **阀门状态驱动流动**：两种样式与 `flowSpeed` 开关已就绪，待接入阀门开关状态的广播。
4. **业务拓扑管理**：维护管线的 source-target 关系，阀门关闭时把下游管线切回默认样式。
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
├─ core/                        # 引擎内核：业务无关，不知道 P&ID 的存在
│  ├─ gpu/                      # 设备、渲染器、拾取
│  ├─ geometry/                 # 顶点几何、AABB、四叉树、折线膨胀
│  ├─ shader/                   # 通用 WGSL：core_include（可被 #include 复用）+ core_render
│  ├─ camera.ts                 # 正交相机
│  └─ types.ts                  # 引擎数据类型（AABB / 实例图元 / RectInstance）
├─ business/pid_schematic/      # P&ID 业务层：管线、阀门等设备图元、拓扑与状态
│  ├─ shader/                   # 业务着色器（管线渲染/拾取、阀门渲染/拾取）
│  ├─ pipe_style.ts             # 管线视觉规格：粗细档位、流动条纹、配色口径
│  ├─ pipe_line.ts              # 管线图元、几何缓存、流动样式开关
│  ├─ pipe_instances.ts         # 按段展开实例 + 两套 StorageBuffer + 绘制通路
│  ├─ pipe_pipeline.ts          # 管线 pipeline / bindGroupLayout
│  ├─ pipe_manager.ts           # 管线模块入口（初始化、逐帧渲染、拾取通路）
│  ├─ pipe_stress_test.ts       # 管线压测数据
│  ├─ device_stress_test.ts     # 设备图元压测数据
│  ├─ topology.ts               # 管线-设备拓扑关系
│  └─ element_state.ts          # 设备状态
├─ demo/run_app.ts              # 示例运行入口（唯一同时依赖 core 与 business 的地方）
├─ scene/                       # 通用场景图，与业务无关
└─ app.tsx                      # React 示例入口
```

### 底层工程技术要点

- 设备符号使用实例化渲染，重复几何只上传一次。
- 管线使用预计算的带宽多段线，动画只更新时间 Uniform，不重建顶点缓冲区。
- GPU 拾取通过离屏整数纹理输出实例 ID，避免 CPU 遍历全部图元。
- AABB/四叉树用于快速筛选候选对象，精确几何命中检测作为后续补充。
- 业务拓扑不进入渲染底层，通过状态字段驱动管线显示和流动效果。
- 分层：`core` 不下沉业务概念，管线/阀门等业务代码与其着色器全部在 `business/pid_schematic`；
  `core` 与 `business` 通过通用图元契约（`QuadItem` + `InstanceTransform`）对接，示例入口 `demo/run_app.ts` 负责组装。
- WGSL 支持自研 `#include`：构建期由 vite 插件展开，`pnpm lint:wgsl` 用同一套逻辑校验展开后的代码。

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
import shaderCode from '@/core/shader/shader.wgsl?raw';
```

## 编辑器

项目内置 `.vscode/settings.json`，保存时自动格式化并执行 ESLint 修复；
推荐扩展见 `.vscode/extensions.json`。
