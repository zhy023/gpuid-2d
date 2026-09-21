# gpuid-2d

自研的 2D 底层 WebGPU 引擎：直接基于 WebGPU API 与 WGSL 搭建 2D 渲染管线，
不封装 three.js / pixi.js / babylon.js，定位是面向半导体 P&ID 图纸的大规模工业可视化底座。

- 渲染后端：WebGPU（WGSL 着色器）
- 语言与构建：TypeScript（严格模式）+ Vite
- 示例与调试界面：React 19，只用于 `src/demo/`，不参与引擎内核
- 包管理：pnpm（`pnpm@10.29.3`，见 `package.json` 的 `packageManager`）

> 强制约定见 [AGENTS.md](./AGENTS.md)。提交前必须 `pnpm run check` 全绿。

## 快速开始

```bash
pnpm install    # 安装依赖
pnpm dev        # 开发服务器（启动时自动展开着色器）
pnpm run check  # 完整检查：lint + 命名 + 着色器同步 + WGSL + 用例 + 格式 + 构建
```

## 脚本

| 命令                 | 说明                                                           |
| -------------------- | -------------------------------------------------------------- |
| `pnpm dev`           | 开发服务器（先跑着色器生成，再起 Vite）                        |
| `pnpm build`         | 类型检查并打包                                                 |
| `pnpm preview`       | 预览构建产物                                                   |
| `pnpm shaders`       | 由 `.wgsl` 生成 `shader/generated/*.ts` 字符串模块             |
| `pnpm shaders:check` | 校验生成物与 `.wgsl` 同步                                      |
| `pnpm test`          | Node 用例（75 个 / 21 组）                                     |
| `pnpm lint`          | ESLint                                                         |
| `pnpm lint:fix`      | ESLint 自动修复                                                |
| `pnpm lint:names`    | 文件名规范校验                                                 |
| `pnpm lint:wgsl`     | WGSL 编译校验（真实 Tint，需要 Chrome）                        |
| `pnpm check`         | 完整检查：lint + 命名 + 着色器同步 + WGSL + 用例 + 格式 + 构建 |
| `pnpm check:device`  | 掉设备重建检查（真实 WebGPU，不阻塞 `check`）                  |
| `pnpm format`        | Prettier 写入                                                  |
| `pnpm format:check`  | Prettier 校验                                                  |

需要浏览器实跑的两项（`lint:wgsl`、`check:device`）会用 `scripts/find_chrome.mjs`
在 macOS / Linux / Windows 常见路径下探测 Chrome：可用 `CHROME_PATH=/path/to/chrome` 指定，
也可用 `WGSL_CHECK_SKIP=1` / `DEVICE_CHECK_SKIP=1` 临时跳过。

## 定位与边界

- 业务层只关心设备 / 管线 / 工艺拓扑；渲染层负责 GPU 资源、批次与着色器，两者通过场景数据与状态字段连接。
- 内核与 UI 解耦：`src/core/` 可在无 React 环境下独立使用。
- 核心设计原则：分层解耦、实例化优先、显示与拾取双管线、状态驱动更新、视口剔除（AABB + 四叉树）、坐标口径统一。

不做：粒子、网格（Mesh）、九宫格、滤镜 / 遮罩、富文本排版、场景图父子变换、WebGL 后端、Worker 离屏渲染。

## 架构

### 分层

| 目录                          | 职责                                                                   | 约束                                           |
| ----------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| `src/core/`                   | 业务无关的引擎内核（设备、渲染器、拾取、相机、几何、通用图元与着色器） | **严禁** import `src/business/` 或 `src/demo/` |
| `src/business/pid_schematic/` | P&ID 业务层（管线、阀门、拓扑、状态与业务着色器）                      | 只依赖 `core`                                  |
| `src/demo/`                   | 示例与调试入口                                                         | 唯一允许同时依赖 `core` 与 `business` 的地方   |

### 目录

```text
src/
├─ core/                        # 引擎内核：业务无关
│  ├─ gpu/                      # device / context（装配与重建）/ renderer / picker
│  │                            #   / surface / texture / render_state / render_layer
│  ├─ geometry/                 # 顶点模板、AABB、四叉树、折线包围盒
│  │                            #   transform_2d.ts = 2D 变换口径唯一来源
│  ├─ scene/                    # graphic（图形本体：base / graphic / data）
│  │                            #   capability（能力：selectable / flow）
│  │                            #   spatial（空间索引 QuadTreeStore）
│  ├─ text/                     # GlyphAtlas（按需字形图集）+ layoutText / layoutTextBlock
│  ├─ shader/                   # core_include + core_render；generated/ 为展开后的字符串模块
│  ├─ camera.ts                 # 正交相机（只持视口中心 / 缩放 / 画布尺寸）
│  └─ types.ts                  # AABB / QuadItem / PrimitiveInstance（16×f32 实例契约）
├─ business/pid_schematic/      # P&ID 业务层
│  ├─ shader/                   # 管线、阀门着色器；generated/ 为展开后的字符串模块
│  ├─ pid_scene.ts              # 设备 / 管线 / 阀门统一增删改与视口可见集
│  ├─ flow_pipe.ts              # 流动管线（FlowGraphic 的业务实现：静止虚线、流速三态）
│  ├─ pipe_*.ts                 # 管线样式、实例化、pipeline、模块入口、压测数据
│  ├─ valve_*.ts                # 阀门图元、pipeline、实例 / 精灵、位号、示例链
│  ├─ topology.ts               # 管线-设备拓扑与下游状态广播
│  ├─ drawio/                   # mxGraphModel → PidScene 翻译层
│  │                            #   （mx_document / mx_style / to_pid_scene）
│  └─ device_stress_test.ts     # 设备图元压测数据
├─ demo/                        # 示例组装（唯一同时依赖 core 与 business 的地方）
│  ├─ main.ts                   # 阀门示例 + 压测：装配 → 资源 → 场景 → 输入 → 帧循环 → 卸载
│  ├─ drawio_main.ts            # 图纸模式入口（真实 drawio 图纸）
│  ├─ drawio_frame.ts           # 图纸每帧的批次与层序
│  ├─ scene.ts / resources.ts   # 示例场景数据 / 示例所需 GPU 资源
│  ├─ input.ts / drawio_input.ts # 拾取优先级与交互绑定
│  ├─ frame.ts                  # 阀门示例每帧的批次与层序
│  └─ label_atlases.ts          # 位号图集缓存（键 = 字号 + 字体 + 行高倍率）
├─ tests/                       # Node 用例（tests/*.test.ts）
├─ scripts/                     # 文件名、着色器生成、WGSL、测试运行器、掉设备检查
└─ app.tsx                      # React 示例入口
```

### 关键契约

- **实例契约**：`PrimitiveInstance` 16×f32 = 64B（变换 8 + 图集 uv 4 + 逐实例颜色 4）。
  逐实例颜色的 `a <= 0.5` 表示"没指定颜色" → 渲染不画、拾取也不命中；`fillColor = null` 就是不绘制。
- **变换口径**：只有 `core/geometry/transform_2d.ts` 一处——模型矩阵 `composeTransform2d`（T·R·S、单位方块模板）、
  正交投影 `composeProjection2d`（3×3，12 个 float 直接喂 WGSL `mat3x3f`）、
  屏幕↔世界 `screenToWorld2d` / `worldToScreen2d`。GPU 侧对应 `vertex_math.wgsl`（模型）
  与 `primitive_uniforms.wgsl`（投影，48B UBO），改约定要两边同步。
- **图元模板**：内核只上传一个覆盖单位方形的三角形（`triangle-list`，3 顶点），方形之外的部分由
  `unitSquareMask` 按屏幕像素抗锯齿裁掉；渲染与拾取共用同一套掩码，所以"看到什么就能点什么"。
- **着色器生成物**：`.wgsl` 是唯一手写源（支持 `#include` 与 `@/` 别名），`pnpm shaders` 展开成
  `shader/generated/*.ts` 字符串模块，代码里只 import 生成物——不用 `?raw` 之类的打包器私有语法。
- **内核绑定槽固定四个**：`0` 正交投影 UBO（3×3，48B）/ `1` 实例变换 Storage / `3` 图集纹理 / `4` 采样器。
  业务要额外 storage（阀门开关、管线流速）就自己建 `bindGroupLayout` + pipeline。

## 当前已完成

### 内核（core，业务无关）

| 方向           | 现状                                                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 装配与生命周期 | `createRendererContext`（device / renderer / picker / surface / camera 一次装配）、`CanvasSurface`（resize 统一重配上下文与 MSAA / 拾取纹理）、`recreateRendererContext`（掉设备重建，必须重新 `requestAdapter`）、`dispose` 链路           |
| 渲染           | 实例化绘制；`renderComposite` = 基础批次 + 多纹理批次 + 覆盖层（偏移内部累加）；4x MSAA + 标准 alpha 混合；层契约 `RENDER_LAYER`；片元先判遮罩再采样（遮罩为 0 或没指定颜色直接早退，省一次纹理采样）                                       |
| 拾取           | `rgba32uint` 离屏拾取（`pick` / `pickAt`）；`createRendererPicker` 复用渲染器布局；`pickFirst` 多图层按优先级试到命中；只读 1 个像素，用 `setScissorRect` 把光栅化收到目标像素                                                              |
| 纹理           | `loadTextureFromUrl` / `createTextureFromBitmap` / 默认白纹理 / 采样器                                                                                                                                                                      |
| 文字           | 按需动态字形图集（shelf 打包 + 局部写入 + 满页扩容 + 超采样烘焙）；`layoutText` / `layoutTextBlock`（行盒高 = 字号 × `lineHeightRatio`、同一行共用一条基线、水平 / 垂直锚点对齐、可选底板与描边 halo）；`measureTextLine`、`splitGraphemes` |
| 几何与空间     | `QuadTree`（id→节点索引，拖动 0.67ms/帧）、`QuadTreeStore`（增删改 + 视口查询）、AABB 与折线包围盒                                                                                                                                          |
| 图形分层       | `scene/graphic` 图形本体（`base` 基础属性 / `graphic` 绘制属性与唯一打包出口 `toInstance` / `data` 用户自定义数据）；`scene/capability` 两种互斥能力（`selectable` 可选中、`flow` 流动）；`scene/spatial` 空间索引                          |
| 着色器工程     | 自研 `#include`（`@/` 别名）+ 生成期展开成字符串模块（`pnpm shaders`）+ `lint:wgsl` 用真实 Tint 校验                                                                                                                                        |

业务侧的 `ValveGraphic` 长在 `SelectableGraphic` 上（开 / 关是它自己的业务状态），`FlowPipe` 长在 `FlowGraphic` 上。

### 业务（business/pid_schematic）

| 方向     | 现状                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 管线     | 按"每段一个实例"批量绘制（段中点 / 方向角 / 段长现算、拐点补方块、流动相位连续）；粗细完全按图纸 `strokeWidth`（世界单位，跟图元一起缩放）；"流动 / 默认"由 `flowSpeed` 三态驱动   |
| 阀门     | 开关两态贴图精灵；拾取复用内核拾取着色器与图元模板（业务只提供自己的 bindGroup）                                                                                                   |
| 拓扑     | `applyValveFlowState` 把阀门状态广播到下游管线（含环路保护）                                                                                                                       |
| 场景     | `PidScene` 统一增删改（`upsertDevice` / `upsertPipe` / `upsertValve` / `remove`）与视口可见集                                                                                      |
| 图纸接入 | `drawio/mx_document.ts` + `mx_style.ts`（零运行时依赖，`DOMParser` 注入）→ `to_pid_scene.ts` 把 mxGraphModel 翻译成 `PidScene`（绝对坐标按父链累加、折点在 `<Array as="points">`） |

### 示例（demo）

- `main.ts`：阀门示例与 5 万设备 + 800 管线压测；掉设备自动重建。
- `drawio_main.ts`：图纸模式（按图纸 `bounds` 取景）。
- 图纸交互：单击阀门 = 选中 / 取消选中（一次只选中一个，日志打印图元 id 与 drawio cellId）；
  双击阀门 = 开 / 关，并按拓扑把下游管线切到流动 / 默认样式。

### 图纸绘制口径

**图纸是唯一事实来源**，渲染端不自作主张：

| 项           | 口径                                                                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 颜色 / 填充  | `fillColor` 有值才画；`fill=none` 或没写填充的单元保持透明（与导出的 SVG 一致）；`group` 单元不会补白底                                                                                                            |
| 图标         | 图片单元一律用图纸自己的内联图，按 `aspect=fixed` 等比缩放居中，不拉伸、不换贴图                                                                                                                                   |
| 文字版式     | 字体 / 字号 / 行高都按图纸（不写 `fontFamily` 时是 drawio 默认的 Helvetica + `line-height: 1.2`，中文字形挂回退链）；换行只由图纸的 `<div>` / `<br>` 决定；对齐按 drawio 的"每行水平居中 + 整块垂直居中于图元中心" |
| 颜色主题     | 图纸颜色是 `light-dark(浅色, 深色)` 双主题，`theme` 决定取哪一支（默认深色，即设计人员在图纸里看到的那套）                                                                                                         |
| 管线横平竖直 | 绘图员手画的线不是 100% 正交（实测 154 段里 145 段偏差 <5°，中位数 0.5°、p90 3.2°），按 `orthogonalizePolyline()` 纠正：≤5° 拉正，更大插一个肘点                                                                   |
| 图元微调     | 端口差 ≤12 世界单位时优先把相连图元整体挪一点去对齐正交轴，一个单元连多条边取平均诉求并迭代几轮                                                                                                                    |
| 接头不断开   | 正交化只动中间点，首末点（吸附在设备 / 连接点上的端口）原样保留；`shape=waypoint` 的连接点不建图元，只保留 id 给拓扑                                                                                               |

### 着色器工程

- 手写源：`src/core/shader/`、`src/business/pid_schematic/shader/` 下的 `.wgsl`，支持 `#include "..."` 与 `@/` 别名。
- 生成物：`pnpm shaders`（`scripts/build_shaders.mjs`）把每个入口展开成 `shader/generated/**/*.ts`
  字符串模块，与 `.wgsl` 分开存放、随源码提交。
- 同步：`pnpm shaders:check` 已接进 `pnpm check`；dev 下改 `.wgsl`（含被 include 的片段）自动重新生成并整页刷新。
- 校验：`pnpm lint:wgsl` 用真实 Tint 校验 `src` 下全部 7 个着色器（展开后的代码）。

## 质量保障

| 项       | 现状                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用例     | `tests/` 75 个 / 21 组（几何等价性与变换口径、四叉树一致性、QuadTreeStore、PidScene、拓扑广播、文字排版与字素切分、drawio 解析与翻译、颜色 / 主题取支）       |
| 检查门   | `pnpm run check`（lint + 命名 + 着色器同步 + WGSL + 用例 + 格式 + 构建）、`pnpm run check:device`（掉设备探针：destroy → lost → 新适配器 → 建管线并渲染一帧） |
| CI       | GitHub Actions：`check` job 跑完整检查，`device` job 单独跑且不阻塞                                                                                           |
| 性能基线 | 5 万设备图元 + 800 管线：拖动渲染中位 16.7ms / p95 17.7ms，四叉树更新 0.67ms/帧                                                                               |

## 路线图

### 下一步

1. **口径守卫脚本**：`scripts/check_transform_parity.mjs`（CPU 算的屏幕包围盒 vs GPU 渲染出来的像素包围盒）、
   注释风格检查（统一块注释，规则见 AGENTS.md）。
2. **符号图集与状态变体**：泵 / 仪表 / 接线端等符号进同一张图集，按状态切换 uv（阀门已用两张贴图验证通路）。
3. **图集淘汰与显存上限**：字形图集按需扩容，需要 LRU 或页数上限，保证长跑不涨内存。
4. **文字 LOD**：大图缩小时隐藏位号或切换字号。
5. **数据接入**：drawio（mxGraphModel）已接入 `PidScene`；DXF / 后端图纸 JSON 待接。
6. **性能面板**：draw call / 实例数 / 剔除数 / 帧时间。
7. **渲染微优化**（都要实测取舍）：形状遮罩只算被选中的那一个 `smoothstep`、圆遮罩用一阶距离场去掉 `sqrt`、
   填充与描边合并成一趟（要扩实例通道）、大图元改用方形模板（片元减半、顶点翻倍）。

### 后续扩展

- 框选、多选、悬浮预览与更细粒度的拾取层级
- 图纸快照导出与在线 Demo

## 代码约定

完整约定见 [AGENTS.md](./AGENTS.md)，这里只列最容易踩的几条：

| 项         | 约定                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| 路径别名   | `@` 指向 `src`（`vite.config.ts` 与 `tsconfig.app.json` 同步配置）；跨目录引用一律 `@/...`，禁止 `../../`         |
| 文件命名   | 全部小写 + 下划线（snake_case），目录同样如此；组件文件也遵守，组件本身仍用大驼峰导出                             |
| 代码风格   | Prettier（分号、单引号、尾逗号、100 字符宽、2 空格）+ ESLint（`eslint-plugin-prettier` 已打通）                   |
| 注释       | 统一块注释：跟声明写的用 `/** … */`，代码内部（含行尾）用 `/* … */`；只描述当前实现，不写历史                     |
| TypeScript | `strict`；`lib.dom` 缺的 WebGPU 类型由 `@webgpu/types` 补齐（`canvas.getContext('webgpu')`、`GPUBufferUsage` 等） |
| 依赖       | 包管理器只用 pnpm，锁文件只保留 `pnpm-lock.yaml`；内核不引入第三方渲染 / 框架库                                   |

## 编辑器

项目内置 `.vscode/settings.json`（保存时自动格式化 + ESLint 修复），推荐扩展见 `.vscode/extensions.json`。

## 相关文档

- [AGENTS.md](./AGENTS.md)：强制约定（命名、分层、着色器、注释、检查门）
- [docs/handoff.md](./docs/handoff.md)：当前进度、下一步、已知坑
- [docs/impl_plan_pixel_coordinate.md](./docs/impl_plan_pixel_coordinate.md)：像素 / 世界坐标换算契约与测试页方案
