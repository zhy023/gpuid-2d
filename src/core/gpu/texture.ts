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

/** 把 ImageBitmap（或 canvas）上传成可采样纹理 */
export function createTextureFromBitmap(
  device: GPUDevice,
  bitmap: ImageBitmap,
  label = 'texture',
): Texture2d {
  const texture = device.createTexture({
    size: [bitmap.width, bitmap.height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
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
