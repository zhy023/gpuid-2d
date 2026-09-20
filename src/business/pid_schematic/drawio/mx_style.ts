/**
 * draw.io 的 style 字符串解析：`a=1;b=2;ellipse;text` → 对象。
 * 没有 `=` 的裸标记记为 `'1'`（如 ellipse / text / group）。
 */
export type MxStyle = Record<string, string>;

export function parseMxStyle(style: string | null | undefined): MxStyle {
  const out: MxStyle = {};
  for (const part of String(style ?? '').split(';')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) out[part] = '1';
    else out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

/** 取数值样式；缺省或非法时返回 fallback */
export function mxNumber(style: MxStyle, key: string, fallback: number): number {
  const value = Number(style[key]);
  return Number.isFinite(value) ? value : fallback;
}

/** 取布尔/裸标记样式 */
export function mxFlag(style: MxStyle, key: string): boolean {
  const value = style[key];
  return value === '1' || value === 'true';
}
