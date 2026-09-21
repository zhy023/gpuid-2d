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

**内核（core，业务无关）**

- 装配与生命周期：`createRendererContext`（device/renderer/picker/surface/camera 一次装配）、`CanvasSurface`（resize 统一重配上下文 + 重建 MSAA/拾取纹理）、`dispose` 链路、`device.lost` 监听 + 自动重建（`recreateRendererContext`，重连必须重新 `requestAdapter`）
- 渲染：实例化绘制（16×f32 实例：变换 + 图集 uv + 逐实例颜色）、`renderComposite`（基础批次 + 多纹理批次 + 覆盖层，偏移内部累加）、4x MSAA + 标准 alpha 混合、层契约 `RENDER_LAYER`
- 拾取：`rgba32uint` 离屏拾取（`pick` / `pickAt`）、`createRendererPicker`（复用渲染器布局）、`pickFirst`（多图层按优先级试到命中）
- 纹理：`loadTextureFromUrl` / `createTextureFromBitmap` / 默认白纹理 / 采样器
- 文字：按需动态字形图集（shelf 打包 + 局部写入 + 满页自动扩容）、`layoutText`（字素簇排版、逐实例颜色、可选底板与描边 halo）、`splitGraphemes`
- 几何与空间：`Camera2d`、`QuadTree`（id→节点索引，拖动 0.67ms/帧）、`QuadTreeStore`（增删改 + 视口查询）、AABB 与折线包围盒、`composeTransform2d`（与 WGSL 同一套 2D 变换约定）
- 图形分层（`core/scene`）：`graphic/` 放图形本体——`base` `GraphicBase`（基础属性：id / 位置 / 大小 / 旋转 / 可见 / 变更标记 / 世界 AABB，实现 `QuadTreeItem`）、`graphic` `Graphic`（绘制属性：外观 `fill` / `stroke` / `atlasUv`、形状绘制命令 `rect` / `square` / `circle` / `ellipse` / `triangle` / `polyline`、唯一打包出口 `toInstance`）、`data` `DataGraphic`（用户自定义数据 `data`：纯属性，内核不解释、不参与绘制）；`capability/` 放它上层的两种互斥能力——`selectable` `SelectableGraphic`（图形：可选中 / 取消选中 + hover，无流动）与 `flow` `FlowGraphic`（管线：开关 + 流动动画 / 相位，不参与选中）；`spatial/` 放 `QuadTreeStore` 空间索引。业务层的阀门（`ValveGraphic`）长在 `SelectableGraphic` 上（开 / 关是它自己的业务状态），流动管线（`FlowPipe`）长在 `FlowGraphic` 上
- 内置图元模板是**一个三角形**（`triangle-list`，3 顶点）而不是方形：局部空间仍是单位方形 `[-0.5, 0.5]`，模板三角形覆盖它、多出的部分由 `unitSquareMask` 按屏幕像素抗锯齿裁掉；正方形/长方形/圆形最终都由三角形拼出来，符合图形学最小图元的口径
- 着色器工程：自研 `#include`（`@/` 别名）+ 生成期展开成字符串模块（`pnpm shaders`）+ `lint:wgsl` 用真实 Tint 校验 `src` 下全部着色器

**业务（business/pid_schematic）**

- 管线：按「每段一个实例」批量绘制（段中点/方向角/段长现算、拐点补方块、流动相位连续）、屏幕像素粗细档位（2~10px、步长 2px、不随缩放变化）、「流动 / 默认」两种样式由 `flowSpeed` 驱动
- 阀门：开关两态贴图精灵、拾取复用内核拾取着色器（业务只提供 bindGroup）、点击切换开闭
- 拓扑：`applyValveFlowState` 把阀门状态广播到下游管线（含环路保护）
- 场景：`PidScene` 统一增删改（`upsertDevice` / `upsertPipe` / `upsertValve` / `remove`）与视口可见集
- 图纸接入：`drawio/mx_document.ts` + `mx_style.ts`（零运行时依赖，`DOMParser` 注入）→ `to_pid_scene.ts` 把 mxGraphModel 翻译成 `PidScene`（绝对坐标按父链累加、折点在 `<Array as="points">`）：连线 → `FlowPipe`（flow 能力），内联图标命中阀门贴图的单元 → `ValveGraphic`（selectable 能力，自带开/关状态），其余 → `SelectableGraphic` 设备；`drawio_main.ts` 里阀门节点按开关态贴图绘制、管线走流动条纹（demo 打开 flow）

**质量保障**

- `tests/` 31 个用例 / 12 组（几何等价性、四叉树一致性、QuadTreeStore、PidScene、拓扑广播、文字排版与字素切分、drawio 解析与翻译）
- `pnpm run check`（lint + 文件名 + 着色器模块同步 + WGSL + 用例 + format + build）与 `pnpm run check:device`（掉设备探针：destroy → lost → 新适配器 → 建管线并渲染一帧）
- GitHub Actions：`check` job 跑完整检查，`device` job 单独跑掉设备用例（不阻塞）
- 性能基线：5 万设备图元 + 800 管线，拖动渲染中位 16.7ms、p95 17.7ms

### 近期开发顺序

1. **符号图集与状态变体**：泵/仪表/接线端等符号进同一张图集，按状态切换 uv（阀门已用两张贴图验证通路）。
2. **图集淘汰与显存上限**：字形图集目前按需扩容，需要 LRU 或页数上限，保证长跑不涨内存。
3. **文字 LOD**：大图缩小时隐藏位号或切换字号。
4. **数据接入**：drawio（mxGraphModel）已接入 `PidScene`（含图标贴图与位号批次）；DXF / 后端图纸 JSON 待接。
5. **性能面板**：draw call / 实例数 / 剔除数 / 帧时间。

### 后续扩展

- 框选、多选、悬浮预览和更细粒度的拾取层级
- DXF/XML 图纸解析与导入
- 图元数量、draw call、GPU 时间等性能面板
- 图纸快照导出和在线 Demo

> 定位是**工业可视化底座**，不追求通用引擎能力：粒子、网格（Mesh）、九宫格、滤镜/遮罩、
> 富文本排版、场景图父子变换、WebGL 后端、Worker 离屏渲染都不在计划内。

### 目标架构

```text
src/
├─ core/                        # 引擎内核：业务无关
│  ├─ gpu/                      # device / context（装配与重建）/ renderer / picker / surface / texture / render_state / render_layer
│  ├─ geometry/                 # 顶点模板、AABB、四叉树、折线包围盒、2D 变换
│  ├─ scene/                    # graphic（图形本体：base / graphic / data）/ capability（能力：selectable / flow）/
│  │                            #   spatial（空间索引 QuadTreeStore）
│  ├─ text/                     # GlyphAtlas（按需字形图集）+ layoutText
│  ├─ shader/                   # core_include + core_render；generated/ 为展开后的字符串模块
│  ├─ camera.ts                 # 正交相机
│  └─ types.ts                  # AABB / QuadItem / PrimitiveInstance（16×f32 实例契约）
├─ business/pid_schematic/      # P&ID 业务层
│  ├─ shader/                   # 管线、阀门渲染着色器；generated/ 为展开后的字符串模块
│  ├─ pid_scene.ts              # 设备/管线/阀门统一增删改与可见集
│  ├─ flow_pipe.ts              # 流动管线（图形基类的业务实现：静止虚线、流速三态）
│  ├─ pipe_*.ts                 # 样式、实例化、pipeline、模块入口、压测数据
│  ├─ valve_*.ts                # 阀门图元（图形基类的业务实现）、pipeline、实例/精灵、位号、示例链
│  ├─ topology.ts               # 管线-设备拓扑与下游样式广播
│  ├─ drawio/                   # mxGraphModel → PidScene 翻译层（mx_document / mx_style / to_pid_scene）
│  └─ device_stress_test.ts     # 设备图元压测数据
├─ demo/                        # 示例组装（唯一同时依赖 core 与 business 的地方）
│  ├─ main.ts                   # 入口：装配 → 资源 → 场景 → 输入 → 帧循环 → 卸载；掉设备自动重建
│  ├─ drawio_main.ts            # 图纸模式入口（真实 drawio 图纸 + 帧组装）
│  ├─ scene.ts / resources.ts   # 示例场景数据 / 示例所需 GPU 资源
│  ├─ input.ts                  # 拾取优先级（设备优先 → 基础图元）
│  └─ frame.ts                  # 每帧批次与层序提交
├─ tests/                       # Node 用例（tests/*.test.ts）
├─ scripts/                     # 文件名、着色器生成、WGSL、测试运行器、掉设备检查
└─ app.tsx                      # React 示例入口
```

### 底层工程技术要点

- 设备符号使用实例化渲染，重复几何只上传一次。
- 管线按「每段一个单位方块实例」绘制（平移 × 旋转 × 缩放铺满该段），动画只更新时间 Uniform，不重建顶点缓冲区。
- GPU 拾取通过离屏整数纹理输出实例 ID，避免 CPU 遍历全部图元。
- AABB/四叉树用于快速筛选候选对象，精确几何命中检测作为后续补充。
- 业务拓扑不进入渲染底层，通过状态字段驱动管线显示和流动效果。
- 分层：`core` 不下沉业务概念，管线/阀门等业务代码与其着色器全部在 `business/pid_schematic`；
  `core` 与 `business` 通过通用图元契约（`QuadItem` + `InstanceTransform`）对接，示例入口 `demo/main.ts` 负责组装。
- WGSL 支持自研 `#include`：`pnpm shaders`（`scripts/build_shaders.mjs`）在生成期展开成
  `<shader>/generated/*.ts` 字符串模块，`pnpm lint:wgsl` 用同一套展开逻辑校验源码。

## 脚本

| 命令                 | 说明                                                              |
| -------------------- | ----------------------------------------------------------------- |
| `pnpm install`       | 安装依赖                                                          |
| `pnpm dev`           | 启动开发服务器                                                    |
| `pnpm build`         | 类型检查并打包                                                    |
| `pnpm preview`       | 预览构建产物                                                      |
| `pnpm lint`          | ESLint 检查                                                       |
| `pnpm lint:fix`      | ESLint 自动修复                                                   |
| `pnpm lint:names`    | 文件名规范校验                                                    |
| `pnpm shaders`       | 由 `.wgsl` 生成 `shader/generated/*.ts` 字符串模块                |
| `pnpm shaders:check` | 校验生成物与 `.wgsl` 是否同步                                     |
| `pnpm lint:wgsl`     | WGSL 编译校验                                                     |
| `pnpm test`          | Node 用例（31 个 / 12 组）                                        |
| `pnpm check`         | 完整检查：lint + 命名 + 着色器模块 + WGSL + 用例 + format + build |
| `pnpm check:device`  | 掉设备重建检查（需真实 WebGPU）                                   |
| `pnpm format`        | Prettier 写入                                                     |
| `pnpm format:check`  | Prettier 校验                                                     |
| `pnpm check`         | 完整检查                                                          |

需要浏览器实跑的两项（`pnpm lint:wgsl`、`pnpm check:device`）会在 macOS / Linux / Windows 的常见
路径里自动探测 Chrome / Chromium（逻辑在 `scripts/find_chrome.mjs`）：可用
`CHROME_PATH=/path/to/chrome` 指定，找不到时也可用 `WGSL_CHECK_SKIP=1` / `DEVICE_CHECK_SKIP=1` 临时跳过。

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

WGSL 以「源文件 + 生成物」两层存在：`.wgsl` 是唯一手写源（可拆片段、用 `#include`），
`pnpm shaders` 把每个入口着色器展开成 `<shader>/generated/*.ts` 里的普通字符串模块，
代码里 import 的是生成物：

```ts
import primitiveRenderWgsl from '@/core/shader/generated/core_render/primitive_render';
```

这样第三方不需要 `?raw` 之类的打包器私有语法，也不需要任何自定义插件（Vite 只是本仓库的
开发工具）。生成物随源码一起提交，`pnpm shaders:check` 在 `pnpm check` 里保证两者同步；
改完 `.wgsl` 执行 `pnpm shaders`（dev 下改着色器会自动重新生成并整页刷新）。

## 编辑器

项目内置 `.vscode/settings.json`，保存时自动格式化并执行 ESLint 修复；
推荐扩展见 `.vscode/extensions.json`。
