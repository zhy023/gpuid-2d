export interface GenerateShadersOptions {
  /** true 时只比对生成物是否最新，不写盘（供 CI 校验） */
  check?: boolean;
}

export interface GenerateShadersResult {
  /** 入口着色器数量（`src/` 下除 `*_include/` 外所有 `.wgsl`） */
  entryCount: number;
  /** 参与展开的 wgsl 文件总数（含被 include 的片段） */
  shaderFileCount: number;
  /** 本次写盘更新的生成物绝对路径（校验模式下为空） */
  written: string[];
  /** 本次清理的孤儿生成物绝对路径（校验模式下为空） */
  removed: string[];
  /** 校验模式下的不同步文件绝对路径（写盘模式下为空） */
  stale: string[];
}

export function generateShaders(options?: GenerateShadersOptions): Promise<GenerateShadersResult>;
