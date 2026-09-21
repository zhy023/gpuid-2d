# 交接说明（当前进度与后续）

## 状态

- 远端 `main`：见 `git log -1`；工作区应为干净
- 质量门：`pnpm run check`（lint + 文件名 + 着色器模块同步 + WGSL/Tint + 用例 + format + build）、
  `pnpm run check:device`（真实 WebGPU 掉设备重建）
- CI：`.github/workflows/check.yml`（`check` job 跑完整检查，`device` job 单独跑且不阻塞；
  两个 job 都自带 Chrome 探测，见 `scripts/find_chrome.mjs`）
- 性能基线：5 万设备图元 + 800 管线，拖动渲染中位 16.7ms / p95 17.7ms；四叉树更新 0.67ms/帧

## 已建成能力

### core（业务无关）

- 装配与生命周期：`createRendererContext`、`CanvasSurface`（resize 统一处理）、`recreateRendererContext`（掉设备重建，必须重新 `requestAdapter`）、`dispose` 链路
- 渲染：`Renderer2D`（16×f32 实例 = 变换 + 图集 uv + 逐实例颜色；`renderComposite` 批次偏移内部累加；4x MSAA + alpha 混合；层契约 `RENDER_LAYER`）
- 拾取：`WebGpuPicker.pick` / `pickAt`、`createRendererPicker`、`pickFirst`
- 纹理：`loadTextureFromUrl`、`createTextureFromBitmap`、默认白纹理、采样器
- 文字：`GlyphAtlas`（按需图集、shelf 打包、局部写入、满页扩容）、`layoutText`（字素排版、颜色、底板、描边 halo）、`splitGraphemes`
- 几何与空间：`Camera2d`、`QuadTree`、`QuadTreeStore`、AABB 与折线包围盒、`composeTransform2d`
- 内置图元模板：**一个覆盖单位方形的三角形**（`triangle-list`，3 顶点，`core/geometry/geometry.ts`），
  不再用 6 顶点双三角形；方形之外的部分由 `unitSquareMask`（`core_include/vertex_math.wgsl`）
  按屏幕像素抗锯齿裁掉。渲染与拾取（含阀门拾取）走同一套掩码，命中区域与看到的一致
- 图形按「本体 → 能力」分层，`core/scene` 下按目录归类（目录名 = 内容）：
  - `scene/graphic`（图形本体，三个文件同目录）：
    - `base`（`GraphicBase`）：基础属性——id + 世界变换 + 可见/变更标记 + 世界 AABB，
      实现 `QuadTreeItem`，四叉树索引与拾取只需要它
    - `graphic`（`Graphic`）：绘制属性——外观（`fill` / `stroke` / `atlasUv` / `sizeUnit`）、形状绘制
      命令（`rect` / `square` / `circle` / `ellipse` / `triangle` / `polyline`）与唯一打包出口
      `toInstance()`。圆/椭圆与三角形把形状编码写进实例的 shape 通道，渲染与拾取着色器按包围盒
      内切圆 / 内切三角形裁剪
    - `data`（`DataGraphic`）：用户自定义数据 `data`（纯属性：内核不解释、不进实例、不改 dirty）
  - `scene/capability`（图形本体之上的两种互斥能力）：
    - `selectable`（`SelectableGraphic`）：图形能力——选中/取消选中（+ hover），选中态进实例的
      选中通道；图形没有流动状态
    - `flow`（`FlowGraphic`）：管线能力——开关 + 动画速度 + 相位里程；管线不参与选中
  - `scene/spatial`（`QuadTreeStore`）：空间索引与视口查询
    业务侧：`FlowPipe` 长在 `FlowGraphic` 上（有流动、无选中），`ValveGraphic` 长在
    `SelectableGraphic` 上（可选中，开/关是它自己的业务状态），场景里的设备同样是 `SelectableGraphic`；
    图纸翻译层（`to_pid_scene.ts`）把 mxCell 的 id/文字/样式/端点作为 `DrawioCellData` 挂在图元上
- 绘制入口唯一：`Graphic#toInstance()`（批量 `toInstances()`）负责把图形装箱成实例——颜色只取
  `fillColor`（null = 不画）、uv 取 `atlasUvRect`、尺寸按 `sizeUnit`（世界单位 / 屏幕像素）折算
  相机缩放。demo 与业务只负责建图形，不再手搓实例数组
- 内核不认业务图元类型：`QuadItem` 里没有 `type`，只有变换 + 选中态 + 形状编码；
  是矩形/管线/阀门由业务类自己表达（实例打包处用 `instanceof ValveGraphic` 分流）

### business/pid_schematic

- 管线：分段实例化（拐点补方块、流动相位连续）、像素宽度档位 2–10、逐实例 `strokeColor`、
  `flowSpeed` 三态（`>0` 流动 / `<0` 静止虚线 / `=0` 实心）
- 阀门（`ValveGraphic`，图形基类的业务实现）：开关两态贴图精灵；拾取直接用内核拾取着色器
  与内核图元模板，业务只提供自己的 bindGroup（不再有独立拾取着色器）
- 流动管线（`FlowPipe`，图形基类的业务实现）：静止虚线 + 流速三态；设备矩形直接用内核的 `Graphic`
- 拓扑：`applyValveFlowState` 下游广播
- 场景：`PidScene` 统一增删改与可见集
- 数据源解析：`drawio/mx_style.ts` + `drawio/mx_document.ts`（零运行时依赖，`DOMParser` 注入；
  绝对坐标按父链累加、折点在 `<Array as="points">`）→ `to_pid_scene.ts` 翻译成 `PidScene`
  （设备矩形 / 管线折线 / 位号 / 内联图标，并返回图纸 `bounds` 供相机取景）

### demo

`main.ts`（阀门示例 + 压测：装配 → 资源 → 场景 → 输入 → 帧循环 → 卸载，含掉设备自动重建）、
`drawio_main.ts`（图纸模式入口，按 `bounds` 取景；阀门节点按开/关贴图绘制，阀门与管线默认关闭）、
`drawio_frame.ts`（设备批次 + 图标批次 + 阀门精灵批次 + 管线层 + 位号批次）、
`scene.ts`（图纸 → PidScene，并把阀门图标表交给翻译层；阀门/管线保持默认关闭，静止初始态）、
`resources.ts`、`input.ts`、`frame.ts`、
`label_atlases.ts`（按字号缓存位号图集）

图纸交互：单击阀门 = 选中 / 取消选中（一次只选中一个，日志打印图元 id 与 drawio cellId）；
双击阀门 = 开 / 关，并按拓扑把下游管线切到流动 / 默认样式。

图纸绘制口径：**图纸是唯一事实来源**，渲染端不自作主张——

- 颜色：`fillColor` 有值才画，`fill=none` / 没写填充的单元保持透明（与 draw.io 导出的 SVG 一致）；
  `group` 单元（阀门 + 位号那一组）自己也没有填充，所以不会变成白底。代价是「只有描边」的单元
  目前完全看不见（引擎还没有边框通道，见「下一步 1」）
- 图标：图片单元一律用图纸自己的内联图，按 `aspect=fixed` 等比缩放居中，不拉伸、不换贴图；
  阀门节点在模型上是 `ValveGraphic`（selectable 能力、自带开/关状态），但画什么、多大仍然看图纸
- 尺寸/位置/文字：都用单元自身的几何与 `fontColor` / `fontSize`
- 拓扑：边的 `source` / `target` 指向节点组里的**关节单元**（图纸里阀门 = 关节 + 位号 + 阀门图标一组），
  `to_pid_scene` 按「单元 → 所属组 → 组里的阀门」解析回阀门并建出 `Topology`，
  **方向就是 source → target**；`applyValveFlowState` 据此把阀门开关广播到下游管线
- 管线横平竖直：绘图员画的线不是 100% 正交（实测 154 段里 145 段偏差 <5°，中位数 0.5°、p90 3.2°），
  翻译时按 `orthogonalizePolyline()` 纠正——偏差 ≤5° 直接拉正，更大的插入一个肘点改成
  「先水平后垂直 / 先垂直后水平」（对应 drawio 的 `orthogonalEdgeStyle`）；纠正后样例图纸
  163 段全部为 0° 偏差
- 图元位置可按管线微调：端口差得不多（≤12 世界单位）时优先把**相连图元整体挪一点**去对齐正交轴，
  而不是在端口处留拐角；一个单元连多条边时取平均诉求并迭代几轮。实测样例图纸「有意义的端点拐角」
  从 79 条降到 67 条、真实管线段数 234 → 222
- 管线粗细完全按图纸：XML 的 `strokeWidth` 是多少就画多少（没写按 drawio 默认 1px），
  不再吸附到示例用的 2–10px 档位（档位只用于压测数据生成）
- 接头不断开：正交化**只动中间点**，首末点（吸附在设备 / 连接点上的端口）原样保留；
  drawio 的 `perimeter=centerPerimeter` 也照做——连接点（`shape=waypoint`）的端口就是它的中心，
  多条管线在同一点接上，不会有缝
- 纯连接点不算图元：`shape=waypoint`（样例里 64 个）只是接边用的节点，不建可绘制图元，
  只保留 id 让管线拓扑能串过去；跟它相连的管线照常绘制

### 着色器工程

- 手写源：`src/core/shader/`、`src/business/pid_schematic/shader/` 下的 `.wgsl`，支持 `#include "..."` 与 `@/` 别名
- 生成物：`pnpm shaders`（`scripts/build_shaders.mjs`）把每个入口展开成 `<shader>/generated/**/*.ts`
  的 `export default '…'` 字符串模块，与 `.wgsl` 分开存放、随源码提交
- TS 侧只 import 生成物（`@/core/shader/generated/core_render/primitive_render`），**不要再用 `?raw`**
- `pnpm shaders:check` 已接进 `pnpm check`；dev 下改 `.wgsl`（含被 include 的片段）自动重新生成并整页刷新
- `pnpm lint:wgsl` 用真实 Tint 校验 `src` 下全部 7 个着色器（展开后的代码）

## 下一步

1. ~~边框渲染~~（已做：实例第 8 个 float（原 pad1）放「描边宽度（屏幕像素）」，形状码 3/4/5 = 方框/圆/三角的描边环，`Graphic#toBorderInstance()` 出环、`toInstances()` 自动补一个环实例；渲染与拾取共用 `unitInstanceMask`）。旧描述：图形模型已经有 `strokeColor` / `strokeWidth`，但实例结构体 16×f32 已占满
   （变换 8 + 图集 uv 4 + 颜色 4），要真画边框得给 `InstanceTransform` 加一条边框通道并改着色器
2. hover 交互：`Graphic` 已有 `hovered` 状态，还差在 demo 里把 pointermove 接到拾取
3. 图纸交互：拾取（`PidScene` 的图元 id 已可直接喂 `pickFirst`）、框选、悬浮预览
4. 图集淘汰与显存上限：位号图集与图标纹理目前只增不减，长跑要加 LRU 或页数上限
5. 文字 LOD：大图缩小时隐藏位号或切换字号
6. 数据接入：DXF / 后端图纸 JSON（`PidScene` 已就绪，只差解析器）
7. 性能面板：draw call / 实例数 / 剔除数 / 帧时间

样例数据：`public/assets/graph/meta_demo.xml`（532 个 mxCell，图纸范围 1238×984）

## 已知坑（避免重复踩）

- `copyExternalImageToTexture` 的目标纹理必须带 `RENDER_ATTACHMENT`，否则整张上传被拒、采样全透明
- 额外实例（文字/贴图）必须只由图集批次绘制：`renderComposite` 的绘制数量只算基础批次，
  否则会被白纹理批次画成实心方块
- 实例结构体 64B：变换 8 + 图集 uv 4 + 逐实例颜色 4（颜色在 `offset 12–15`）；
  变换里的第 8 个 float（原 pad1）现在是**描边宽度（屏幕像素）**，只有描边环实例用得到
- 逐实例颜色的 alpha 是「画不画」的开关：`a <= 0.5` = 没指定颜色 → 渲染不画、拾取也不命中
  （内核不兜底灰色，`Graphic.fillColor = null` 就是「不绘制」）。demo/业务想让图元可见，
  必须在数据里显式 `fill(...)`；`device_stress_test` 就是显式给了一个中性灰
- 实例缓冲容量 10 万（基础批次 + 覆盖批次共用一条）：实例打包与上传只有
  `renderComposite` 一条通路（`packInstances` 供用例断言），超容量直接抛错
- 模型层与实例契约的分工：实例契约叫 `PrimitiveInstance`（16×f32，不带形状语义，方框/圆/三角形
  都靠 shape 通道裁）；模型层的 `selected` 是布尔，打包成实例时才用 `selectedFlag`（0/1）映射；
  「背景」对应逐实例颜色通道，新增渲染通道要改 `InstanceTransform` 与全部打包点
- `GPUQueue.writeBuffer` 的 `dataOffset` / `size` 对 TypedArray 是**元素数**（不是字节数），
  但 `bufferOffset` 是字节；两者混用会写错区间
- wgpu-matrix 的 `mat3` 是 12 个元素（不是 9）
- `erasableSyntaxOnly`：禁止构造参数属性；嵌套函数声明拿不到外层收窄（用 `const canvasEl` 之类中转）
- `sed` 按行号删代码出过两次事故（多删 `const camera`、留下孤立 `/**`）：大段删除先读全文再 `apply_patch`
- drawio 的坑：
  - 内联图片写成 `data:image/png,<base64>`（**没有 `;base64`**），浏览器会当百分号编码的文本来解，
    必须补 `;base64` 才能解码（见 `normalizeIconUrl`）
  - 图纸坐标原点不一定在左上角（样例图纸 y 全为负），取景要用 `toPidScene` 返回的 `bounds`，
    写死页宽高会让所有图元被剔除、只剩位号
- 改任何 `.wgsl`（**包括 `*_include/` 里的公共片段**）后生成物都要重展开：跑 `pnpm shaders`，
  或交给 dev（自动重新生成 + 整页刷新）；`pnpm shaders:check` 会拦住忘记重新生成的情况
- `shader/generated/` 下的文件是生成物：勿手改，改源 `.wgsl`；生成器按首行标记识别，并会清理没有
  对应 `.wgsl` 的孤儿文件
- include 关系只存在于字符串层面，打包器看不见着色器之间的依赖，所以 dev 只能整页刷新，
  不要指望细粒度 HMR
- 需要浏览器的检查（`lint:wgsl`、`check:device`）统一走 `scripts/find_chrome.mjs` 探测，
  **别在脚本里写死 Chrome 路径**（CI 是 ubuntu，浏览器在 `/usr/bin/google-chrome`）；
  可用 `CHROME_PATH` 覆盖，`WGSL_CHECK_SKIP=1` / `DEVICE_CHECK_SKIP=1` 临时跳过
