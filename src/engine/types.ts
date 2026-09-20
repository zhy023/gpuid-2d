export interface RectInstance {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  beta: number;
  selected: number; // 0未选中，1选中
}

// P&ID 基础类型定义
export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// 四叉树存储最小单元，只要id+包围盒
export interface QuadItem {
  id: number;
  worldAABB: AABB;
}

export interface ExpandResult {
  vertexData: Float32Array;
  totalLength: number;
}

// 追加：管线图元
export interface PipePolylineItem extends QuadItem {
  id: number;
  dirty: boolean;
  points: Array<{ x: number; y: number }>;
  lineWidth: number;
  // 原来：cachedVertices: Float32Array | null;
  geoCache: ExpandResult | null; // 存完整膨胀结果，包含顶点+总长
  flowSpeed: number;
}

export interface PipeRenderResources {
  pipeline: GPURenderPipeline;
  uniformBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
}
