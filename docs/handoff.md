# 交接说明（当前进度与后续）

## 状态

- 远端 `main`：`88edee4 refactor(shader): WGSL 生成期展开为字符串模块，去掉 ?raw 依赖`（已推送）
- 工作区：**不干净**——图纸 WIP 未提交，涉及 `drawio/to_pid_scene.ts`、`demo/drawio_frame.ts`、
  `demo/drawio_main.ts`、`demo/scene.ts`、`tests/drawio_scene.test.ts`、`pipe_line.ts`、
  `pipe_instances.ts`、`types.ts`、`device_stress_test.ts`、`camera.ts`、`geometry/`
  （AABB / 折线 / 精灵）、`gpu/`（context / device / surface / texture），以及两个新文件
  `pid_schematic/drawio/icon_textures.ts`、`demo/label_atlases.ts`
- 质量门：`pnpm run check`（lint + 文件名 + 着色器模块同步 + WGSL/Tint + 用例 + format + build）、
  `pnpm run check:device`（真实 WebGPU 掉设备重建）
- CI：`.github/workflows/check.yml`（`check` job 跑完整检查，`device` job 单独跑且不阻塞）
- 性能基线：5 万设备图元 + 800 管线，拖动渲染中位 16.7ms / p95 17.7ms；四叉树更新 0.67ms/帧

## 已建成能力

### core（业务无关）

- 装配与生命周期：`createRendererContext`、`CanvasSurface`（resize 统一处理）、`recreateRendererContext`（掉设备重建，必须重新 `requestAdapter`）、`dispose` 链路
- 渲染：`Renderer2D`（16×f32 实例 = 变换 + 图集 uv + 逐实例颜色；`renderComposite` 批次偏移内部累加；4x MSAA + alpha 混合；层契约 `RENDER_LAYER`）
- 拾取：`WebGpuPicker.pick` / `pickAt`、`createRendererPicker`、`pickFirst`
- 纹理：`loadTextureFromUrl`、`createTextureFromBitmap`、默认白纹理、采样器
- 文字：`GlyphAtlas`（按需图集、shelf 打包、局部写入、满页扩容）、`layoutText`（字素排版、颜色、底板、描边 halo）、`splitGraphemes`
- 几何与空间：`Camera2d`、`QuadTree`、`QuadTreeStore`、AABB/折线膨胀、`composeTransform2d`、`spriteInstance`

### business/pid_schematic

- 管线：分段实例化（拐点补方块、流动相位连续）、像素宽度档位 2–10、「流动 / 默认」两态
- 阀门：开关两态贴图精灵、拾取器托管
- 拓扑：`applyValveFlowState` 下游广播
- 场景：`PidScene` 统一增删改与可见集
- 数据源解析：`drawio/mx_style.ts` + `drawio/mx_document.ts`（零运行时依赖，`DOMParser` 注入；绝对坐标按父链累加、折点在 `<Array as="points">`）→ `to_pid_scene.ts` 翻译成 `PidScene`

### demo

`main.ts`（装配 → 资源 → 场景 → 输入 → 帧循环 → 卸载，含掉设备自动重建）、`drawio_main.ts`
（图纸模式入口）、`scene.ts`、`resources.ts`、`input.ts`、`frame.ts`、`drawio_frame.ts`

### 着色器工程（本次落地）

- 手写源：`src/core/shader/`、`src/business/pid_schematic/shader/` 下的 `.wgsl`，支持 `#include "..."` 与 `@/` 别名
- 生成物：`pnpm shaders`（`scripts/build_shaders.mjs`）把每个入口展开成 `<shader>/generated/**/*.ts` 的
  `export default '…'` 字符串模块，与 `.wgsl` 分开存放、随源码提交
- TS 侧只 import 生成物（`@/core/shader/generated/core_render/primitive_render`），**不要再用 `?raw`**：
  `?raw` 是 Vite 私有语法，会把内核绑死在 Vite 上
- `pnpm shaders:check` 已接进 `pnpm check`；dev 下改 `.wgsl`（含被 include 的片段）自动重新生成并整页刷新
- `pnpm lint:wgsl` 用真实 Tint 校验 `src` 下全部 9 个着色器（展开后的代码）

## 下一步

（按已确认顺序：先收尾工作区里的图纸 WIP，再提交）

1. 修 `pipe_instances.ts` 的 `writeInstanceTransform`：新写入的逐实例颜色（offset 12–15）紧接着被
   旧的四行 `= 0` 覆盖，`strokeColor` 目前是空操作
2. 图标贴图：**不需要新增 API**——mxCell 里的内联 base64 直接喂 `loadTextureFromUrl()`
   （实测 `fetch(dataURL)` 与 `blob()` 均正常，唯一失败点是 Node 缺 `createImageBitmap`，页面里没这个问题）
3. 位号批次 `demo/label_atlases.ts` 与 `demo/drawio_frame.ts` 的帧组装跑通
4. 验证：`pnpm run check` + CDP 冒烟（图元数、剔除数、拖动帧率）后提交

样例数据：`public/assets/graph/meta_demo.xml`（532 个 mxCell）

## 已知坑（避免重复踩）

- `copyExternalImageToTexture` 的目标纹理必须带 `RENDER_ATTACHMENT`，否则整张上传被拒、采样全透明
- 额外实例（文字/贴图）必须只由图集批次绘制：`setInstances` 的数量只算基础批次，否则会被白纹理批次画成实心方块
- 实例结构体 64B：变换 8 + 图集 uv 4 + 逐实例颜色 4
- wgpu-matrix 的 `mat3` 是 12 个元素（不是 9）
- `erasableSyntaxOnly`：禁止构造参数属性；嵌套函数声明拿不到外层收窄（用 `const canvasEl` 之类中转）
- `sed` 按行号删代码出过两次事故（多删 `const camera`、留下孤立 `/**`）：大段删除先读全文再 `apply_patch`
- 改任何 `.wgsl`（**包括 `*_include/` 里的公共片段**）后生成物都要重展开：跑 `pnpm shaders`，
  或交给 dev（自动重新生成 + 整页刷新）；`pnpm shaders:check` 会拦住忘记重新生成的情况
- `shader/generated/` 下的文件是生成物：勿手改，改源 `.wgsl`；生成器按首行标记识别，并会清理没有
  对应 `.wgsl` 的孤儿文件
- include 关系只存在于字符串层面，打包器看不见着色器之间的依赖，所以 dev 只能整页刷新，
  不要指望细粒度 HMR
- 需要浏览器的检查（`lint:wgsl`、`check:device`）统一走 `scripts/find_chrome.mjs` 探测，
  **别在脚本里写死 Chrome 路径**（CI 是 ubuntu，浏览器在 `/usr/bin/google-chrome`）；
  可用 `CHROME_PATH` 覆盖，`WGSL_CHECK_SKIP=1` / `DEVICE_CHECK_SKIP=1` 临时跳过
