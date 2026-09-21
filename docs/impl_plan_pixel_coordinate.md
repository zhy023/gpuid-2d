# 像素坐标换算：实现方案（画布元素坐标空间 ↔ 2D 正交相机世界坐标）

> 目标读者：后续接手实现的 agent / 开发者。
> 本文只描述「怎么做、怎么验」，代码位置都指向当前工作区的真实文件。

## 0. 现状核对（先读这一节）

我在 gpuid-2d 工作区里核对到的事实：

- **不存在** `src/drawio/`（没有 `test.html`、没有对应入口 ts）、**不存在** `test.cpp`，
  `public/assets/` 下只有 `meta_demo.xml`，没有 plant DXZ 图纸。
- 仓库里已有一张「图纸测试页」，形态与上面描述的不同：
  `src/demo/drawio_main.ts`（`runDrawioApp`）+ `src/demo/drawio_frame.ts`，
  数据来自 `src/demo/scene.ts` 的 `createDrawioScene()`（`DRAWIO_URL = '/assets/graph/meta_demo.xml'`），
  由 `src/app.tsx` 里注释切换的 `runApp()` / `runDrawioApp()` 二选一跑，`src/main.tsx` 是唯一 React 入口。
- 页面上目前**没有** Grid / BBox 这类开关控件。

因此本方案按「**新建** `src/drawio/test.html` + 复用 gpuid-2d 内核」来写，plant DXZ 图纸作为测试数据
放进 `public/assets/graph/`。如果那张页其实在另一个仓库（`~/www/*` 下我没找到），把路径给我，
我按那边的现状改写第 3、4 节。

## 1. 目标与验收标准

目标：给「画布元素坐标 ↔ 世界坐标」的换算一个可交互、可自动核验的测试页，并把换算口径固化成契约。

验收（全部可自动断言）：

1. **往返一致**：世界点 → 画布像素 → `screenToWorld()` 反算，误差 ≤ 0.5 世界单位。
2. **拾取一致**：对已知图元的世界坐标换算成画布像素后拾取，命中 id == 期望 id；
   图元包围盒外的点必须不命中。
3. **CSS 缩放一致**：`canvas` 的 CSS 尺寸 ≠ 后备尺寸（`width`/`height` 属性）时，1、2 仍成立。
4. **开关生效**：`show Grid` / `show BBox` 打开后，网格线与包围盒边框确实出现在画面里
   （抽样像素比较，或退化为「实例数增加」的结构断言）。

## 2. 三套坐标空间与换算契约

| 空间     | 定义                                   | 换算                                                     | 代码位置                                          |
| -------- | -------------------------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| 世界坐标 | 图纸坐标（drawio x/y，**y 向下为正**） | —                                                        | `toPidScene` 产出的坐标                           |
| 画布像素 | `canvas` 元素内的像素（后备像素）      | `px = (clientX - rect.left) * canvas.width / rect.width` | `WebGpuPicker.pickAt`（`src/core/gpu/picker.ts`） |
| NDC      | WebGPU 裁剪空间                        | `ndcX = 2·px/w - 1`，`ndcY = 1 - 2·py/h`                 | `Camera2d.screenToWorld`（`src/core/camera.ts`）  |

世界 → 画布像素（`mat4.ortho(left, right, bottom, top, …)` 里 `bottom = centerY + viewH/2`、
`top = centerY - viewH/2`，即 y 轴翻转，所以两项都是加号）：

```
px = canvas.width  / 2 + (worldX - camera.centerX) * camera.scale
py = canvas.height / 2 + (worldY - camera.centerY) * camera.scale
```

### 2.1 实现前必须先统一的两处不一致（本仓库真实存在）

1. **`screenToWorld` 用后备尺寸归一化 CSS 偏移**（`src/core/camera.ts`）：
   `mousePxX = pxX - rect.left`（CSS 像素），随后 `ndcX = 2 * mousePxX / this.canvas.width - 1`。
   当 `rect.width !== canvas.width`（CSS 缩放过的画布）时结果会偏，而 `pickAt` 用 `rect.width` 归一化
   （正确）。测试页要专门覆盖这个场景；建议顺手修成 `rect.width/rect.height`。
2. **HiDPI 未处理**：`CanvasSurface.sync()` 把 `canvas.width = canvas.clientWidth`，
   没有乘 `devicePixelRatio`，所以高 DPI 屏上画面偏软。若将来上 DPR，`pickAt` / `screenToWorld`
   的 rect 归一化必须一起改，否则拾取会整体错位。

## 3. 实施步骤

### 步骤 1：测试页骨架（`src/drawio/test.html` + `src/drawio/test_main.ts`）

- 页面元素：`#canvas` + 控件区（`show Grid` / `show BBox` / `show Coord` 三个 checkbox，
  网格口径 `world | pixel` 的 select）+ 只读面板（当前鼠标世界坐标、画布像素、`scale`、`center`）。
- dev 下 Vite 直接能访问 `/src/drawio/test.html`；**但构建不会自动带上它**：
  `vite.config.ts` 目前没有 `build.rollupOptions.input`，要进 `dist` 得把两个页面都列进去。
  建议先只在 dev 用（`pnpm dev` 后打开 `/src/drawio/test.html`），避免动构建配置。
- 页面自己装配内核（与 demo 并列，互不依赖）：
  `createRendererContext(canvas)` → `initPipe(device, format)` → 复用图纸解析
  （`parseMxDocument` + `toPidScene`，见 `src/business/pid_schematic/drawio/`）→
  `renderDrawioFrame` 的批次组装（设备/图标/管线/位号）。
- 文件命名遵守项目约定（小写 + 下划线），跨目录引用一律 `@/...`。

### 步骤 2：Grid overlay

- 两套口径，都要支持，用来交叉验证换算：
  - **世界网格**：间距取 10 的幂次并按 `scale` 选档（保证屏幕上 ≈ 40~80px 一格）；
    细分线（1/10 间距）用更低的 alpha。
  - **屏幕像素网格**：每 50 canvas 像素一条，位置由当前 `center/scale` 反算成世界坐标。
- 画法：建 `Graphic`（细长矩形 + **显式颜色**，引擎不再给图元兜底颜色），再统一走
  `toInstances()` 装箱；线宽按屏幕像素折算成世界宽度：`worldWidth = pxWidth / camera.scale`
  （或直接用 `screenSize(px)` 让 `toInstance()` 在装箱时折算）。
- 数量控制：只生成落在 `camera.getViewportAABB()` 内的线（缩放很小时否则会爆掉实例数）。

### 步骤 3：BBox overlay

- 数据源：`Graphic.worldAABB`（`src/core/scene/graphic.ts`，已做缓存与旋转后 AABB）。
- 画法：每个 AABB 画 **4 条细长矩形图形**（同样先建 `Graphic` 再装箱）。
  :warning: 不能用 `Graphic.stroke` —— 实例契约 16×f32 已经排满（变换 8 + 图集 uv 4 + 颜色 4），
  没有边框通道（`docs/handoff.md`「下一步 1」记着这件事）。
- 数量控制：只画可见集内的图元；压测场景要加上限（例如最多 5000 个）。

### 步骤 4：层序（这里有一个 small core 改动）

`Renderer2D.render()` 当前的顺序是：**基础实例批次 → `drawOverlay`（管线/设备）→ 纹理批次**。
于是：

- Grid 放进基础批次即可（画在管线/设备之下，正是网格该有的位置）。
- BBox 要压在设备之上，就不能放基础批次；而 `extraBatches` 需要自带纹理（白纹理是 renderer 私有），
  也不方便直接用。

推荐改动（约 30 行，内核）：给 `renderComposite` 增加可选 `overlayInstances`（复用内部默认白纹理与
`writeInstance` 打包通路，排在 `drawOverlay` 之后、纹理批次之前绘制）。
这样 Grid / BBox / 未来的高亮标注都能按层序精确落位。

### 步骤 5：一键测试脚本

按项目既有分工拆成两层（`AGENTS.md`：需要真实 WebGPU 的检查放 `scripts/check_*.mjs`，按需运行、
不阻塞 `pnpm check`）：

| 层       | 文件                                                               | 进 `pnpm check`？            | 覆盖                                                                                                                                                   |
| -------- | ------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 纯数学   | `tests/pixel_coordinate.test.ts`                                   | 是（`pnpm test`）            | 世界↔像素往返、y 轴方向、CSS 缩放系数（用假 canvas 桩：`{ width, height, addEventListener(){}, getBoundingClientRect() }` 强转为 `HTMLCanvasElement`） |
| 真实 GPU | `scripts/check_pixel_coords.mjs` + `package.json` 加 `check:pixel` | 否（与 `check:device` 同档） | 用 `scripts/find_chrome.mjs` 探测浏览器 → headless Chrome（`--enable-unsafe-webgpu`）→ 打开测试页 → 在页面里跑断言矩阵，输出 JSON 并以退出码表示成败   |

真实 GPU 侧的断言矩阵：

| 场景     | 操作                            | 期望                                                  |
| -------- | ------------------------------- | ----------------------------------------------------- |
| 1× CSS   | `canvas` CSS 尺寸 = 后备尺寸    | 世界点 → 像素 → 拾取命中期望 id                       |
| 0.5× CSS | 页面把 canvas 缩到一半          | 同上（这是 `pickAt` 与 `screenToWorld` 分歧的照妖镜） |
| 2× CSS   | 放大一倍                        | 同上                                                  |
| 包围盒外 | 在图元 AABB 外 1.3 倍半宽处点击 | 不命中                                                |
| 缩放后   | `wheel` 缩放两档后重复第 1 行   | 仍一致（证明换算跟着 `scale` 走）                     |
| 开关     | 打开 Grid / BBox                | 结构断言：参与绘制的实例数增加；或抽样像素变化        |

实现提示：CDP 里用 `Runtime.evaluate` 注入一段页面内脚本（钩住 `Camera2d.prototype.getViewportAABB`
拿到相机实例、`Renderer2D.prototype.uploadProjectionMatrix` 拿到渲染器），再调用
`WebGpuPicker.pickAt(canvas, clientX, clientY, bindGroup, vertexBuffer, vertexCount, instanceCount)`。
`/private/tmp/gpuid_valve_selfpick_probe.mjs` 就是一个可直接抄的样板（阀门拾取自检）。

### 步骤 6：React 入口集成

> 画布底色由 demo 自己给：引擎不给图元兜底颜色（`fillColor = null` 就是不画），
> 而图纸里大量图元是白色/浅色填充，原来的 0.96 浅灰底几乎看不出内容。现有 demo 的做法
> （`DEMO_CLEAR_COLOR` / `DRAWIO_CLEAR_COLOR` + `renderer.setClearColor()`）可以直接照抄，
> 测试页也按同样口径设一个中性偏深的底。

`:warning:` 现在的集成方式是「改 `src/app.tsx` 里的注释」二选一，不适合长期：

- 方案 A（推荐，成本最低）：测试页保持独立 html，dev 用 URL 直达；`app.tsx` 不动。
  等控件稳定后再谈集成。
- 方案 B：`main.tsx` 读 `location.search`（如 `?page=drawio` / `?page=pixel`）决定跑哪套
  demo；两套 demo 都要支持「卸载」——现在的 `pagehide` 里只 `dispose()` 了 renderer，
  切页/热更时必须把管线、阀门、图集一并释放（`disposePipes()` / `disposeValves()`）。

## 4. 需要顺手修的引擎侧问题（建议纳入本次范围）

1. **`Camera2d` 没有登记进 `resizeTargets`**：`createRendererContext` 里只注册了
   `[renderer, picker, ...options.resizeTargets]`（`src/core/gpu/context.ts`），
   而 `CanvasSurface.sync()` 会改 `canvas.width/height`。结果：窗口 resize 之后
   `camera.canvasWidth/canvasHeight` 仍是旧值，`getViewportAABB()` 用的剔除视口是错的
   （`getCameraProjectionMatrix()` 直接用 `canvas.width`，投影本身是对的 → 表现为「画面正常但图元被提前剔除」）。
   修法：把 `camera` 加进 `resizeTargets`（`Camera2d.resize(w,h)` 已存在）。
2. **`screenToWorld` 的归一化**：见 §2.1，改用 `rect.width/height`，与 `pickAt` 对齐。
3. 测试页里点选图元需要「id → 拾取候选」的映射：`pickFirst` 已支持有序候选数组，
   图纸场景可直接用 `PidScene.getVisible(camera.getViewportAABB())` 的三个数组拼候选，
   并按 `RENDER_LAYER` 定优先级（设备 → 管线）；命中后用 `QuadTreeStore.get(id)` 反查。
   命中后要展示的「图元信息」直接读命中图元的 `data`：图纸翻译层已把 mxCell 的
   id / 文字 / 样式 / 端点挂成 `DrawioCellData`（纯属性，不参与绘制）。

## 5. 手动验收清单

- [ ] `pnpm dev` → 打开测试页：拖动（画布内按下并移动）与滚轮缩放后，坐标面板与拾取结果仍一致
- [ ] 打开 Grid：缩放网格随 `scale` 换档，屏幕网格间距恒为 50px
- [ ] 打开 BBox：包围盒与图元边缘重合；旋转过的图元是「旋转后的 AABB」（不是原始宽高）
- [ ] 窗口 resize 后：网格/包围盒/拾取仍然对齐（这一步专门验证 §4.1）
- [ ] `pnpm run check` 全绿；`pnpm run check:pixel` 在真实 GPU 上全绿
- [ ] 掉设备（`device.lost`）自动重建后，测试页的控件与钩子仍指向新上下文

## 6. 风险与坑

| 坑                      | 说明                                                                                           | 规避                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| y 轴翻转                | 正交投影把 `bottom/top` 传反了达到 y 向下；随手写 `py = (centerY - worldY) * scale` 会上下颠倒 | 统一用 §2 的公式，并写进 `tests/`                           |
| CSS 尺寸 vs 后备尺寸    | `pickAt` 用 rect 归一化、`screenToWorld` 用后备尺寸，两者不等价                                | 修 `screenToWorld`；测试页覆盖 0.5×/2×                      |
| 实例契约已满            | 没有边框通道，BBox 只能靠 4 条细矩形拼                                                         | 见步骤 3；真要边框通道得改 `InstanceTransform` + 全部打包点 |
| 层序                    | 基础批次先画、`drawOverlay` 后画、纹理批次最后                                                 | 见步骤 4 的 `overlayInstances` 方案                         |
| 网格实例爆炸            | 缩放到 `minScale = 0.05` 时刻度若按固定世界间距会生成上万条                                    | 按 `getViewportAABB()` 裁剪 + 屏幕间距换档                  |
| 生成物纪律              | 改动任何 `.wgsl`（含 `*_include/`）后必须 `pnpm shaders`，否则 `shaders:check` 会拦            | 按项目约定执行                                              |
| 检查脚本别进 check gate | 需要浏览器的检查在 CI 上会因缺 GPU/Chrome 抖动                                                 | 与 `check:device` 同档，单独 `pnpm run check:pixel`         |

## 7. 待确认（实现前回答）

1. 目标测试页在**哪个仓库/路径**？如果就是 gpuid-2d，是否确认在 `src/drawio/` 下新建？
2. plant DXZ 图纸文件放哪（建议 `public/assets/graph/plant_dxz.xml`），是否有配套的图元 id 清单
   用于断言（没有的话测试脚本按「视口内前 N 个图元」自造期望值）？
3. Grid 默认口径（世界 / 屏幕像素）与默认间距？
4. 一键脚本要跑在 CI 吗？如果要，得先确认 runner 有 Chrome + WebGPU（现在 `device` job 是单独且不阻塞的）。
