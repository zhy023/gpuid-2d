/**
 * 核心侧纹理能力：纹理、采样器，以及保证 bindGroup 永远有可采样纹理的默认白纹理。
 * 后续的符号图集、文字图集都建立在这一层之上。
 */

export interface Texture2d {
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
}

/** 把 ImageBitmap / canvas 上传成可采样纹理 */
export function createTextureFromBitmap(
  device: GPUDevice,
  bitmap: ImageBitmap | HTMLCanvasElement | OffscreenCanvas,
  label = 'texture',
): Texture2d {
  const texture = device.createTexture({
    size: [bitmap.width, bitmap.height],
    format: 'rgba8unorm',
    /* copyExternalImageToTexture 要求目标纹理同时具备 COPY_DST 与 RENDER_ATTACHMENT */
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
    label,
  });

  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [
    bitmap.width,
    bitmap.height,
  ]);

  return { texture, view: texture.createView(), width: bitmap.width, height: bitmap.height };
}

/**
 * 1×1 白色纹理：作为默认绑定。
 * 着色器里做 `color * texel` 时白色不改变颜色，因此未贴图的图元外观保持不变。
 */
export function createDefaultWhiteTexture(device: GPUDevice): Texture2d {
  const texture = device.createTexture({
    size: [1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    label: 'default-white-texture',
  });

  device.queue.writeTexture(
    { texture },
    new Uint8Array([255, 255, 255, 255]),
    { bytesPerRow: 4 },
    [1, 1],
  );

  return { texture, view: texture.createView(), width: 1, height: 1 };
}

/**
 * 从 URL 加载纹理：fetch → createImageBitmap → 上传为可采样纹理。
 * 任何使用方都要写这一串，所以收进内核；失败时抛错，由调用方决定是否降级。
 */
export async function loadTextureFromUrl(
  device: GPUDevice,
  url: string,
  label = 'texture',
): Promise<Texture2d> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`加载纹理失败：${url}（HTTP ${response.status}）`);

  const bitmap = await createImageBitmap(await response.blob());
  const result = createTextureFromBitmap(device, bitmap, label);
  bitmap.close();
  return result;
}

/** 线性采样、边缘夹取：2D 图元与文字最常用的组合 */
export function createTextureSampler(device: GPUDevice, label = 'texture-sampler'): GPUSampler {
  return device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    label,
  });
}
