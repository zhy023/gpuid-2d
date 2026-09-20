# 交接说明（当前进度与后续）

## 状态

- 远端 `main`：见 `git log -1`；工作区应为干净
- 质量门：`pnpm run check`（lint + 文件名 + WGSL/Tint + 用例 + format + build）、`pnpm run check:device`（真实 WebGPU 掉设备重建）
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
- 数据源解析：`drawio/mx_style.ts` + `drawio/mx_document.ts`（零运行时依赖，`DOMParser` 注入；绝对坐标按父链累加、折点在 `<Array as="points">`）

### demo

`main.ts`（装配 → 资源 → 场景 → 输入 → 帧循环 → 卸载，含掉设备自动重建）、`scene.ts`、`resources.ts`、`input.ts`、`frame.ts`

## 下一步（已确认的顺序）

1. `drawio/to_pid_scene.ts`：顶点 → 设备矩形；`edge=1` → 管线折线（端点取 source/target 中心 + 折点）；样式翻译（`strokeWidth` → 宽度档位、颜色 → 实例颜色、`shape` → 类型）；`value` → 位号文字
2. 图标：**不需要新增 API**——mxCell 里的内联 base64 直接喂 `loadTextureFromUrl()`
   （实测 `fetch(dataURL)` 与 `blob()` 均正常，唯一失败点是 Node 缺 `createImageBitmap`，页面里没这个问题）
3. `demo/scene.ts` 增加 `createDrawioScene(device)`（fetch XML → DOMParser → 翻译 → `PidScene`），`frame.ts` 出图，`main.ts` 切换场景
4. 验证：`pnpm run check` + CDP 冒烟（图元数、剔除数、拖动帧率）后提交

样例数据：`public/assets/graph/meta_demo.xml`（532 个 mxCell）

## 已知坑（避免重复踩）

- `copyExternalImageToTexture` 的目标纹理必须带 `RENDER_ATTACHMENT`，否则整张上传被拒、采样全透明
- 额外实例（文字/贴图）必须只由图集批次绘制：`setInstances` 的数量只算基础批次，否则会被白纹理批次画成实心方块
- 实例结构体 64B：变换 8 + 图集 uv 4 + 逐实例颜色 4
- wgpu-matrix 的 `mat3` 是 12 个元素（不是 9）
- `erasableSyntaxOnly`：禁止构造参数属性；嵌套函数声明拿不到外层收窄（用 `const canvasEl` 之类中转）
- `sed` 按行号删代码出过两次事故（多删 `const camera`、留下孤立 `/**`）：大段删除先读全文再 `apply_patch`
