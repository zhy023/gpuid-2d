export interface WgslIncludeOptions {
  /** 自定义读取实现，默认读本地磁盘；测试或内存文件系统可覆盖 */
  readSource?: (filePath: string) => Promise<string>;
}

export interface WgslIncludeResult {
  /** 展开 `#include` 之后、可直接交给 createShaderModule 的 WGSL 代码 */
  code: string;
  /** 参与本次展开的全部文件绝对路径（含入口文件，按展开顺序） */
  dependencies: string[];
}

export function resolveWgslIncludes(
  entryFilePath: string,
  options?: WgslIncludeOptions,
): Promise<WgslIncludeResult>;
