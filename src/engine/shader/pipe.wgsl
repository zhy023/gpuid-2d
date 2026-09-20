// pipe.wgsl 工艺管线渲染着色器，支持流动动画
struct Uniforms {
  viewProj: mat4x4f,
  time: f32,
};

@group(0) @binding(0) var<uniform> ubo: Uniforms;

struct VertexOutput {
  @builtin(position) pos: vec4f,
  @location(0) vUv: vec2f,
}

@vertex
fn vs_main(@location(0) pos: vec2f, @location(1) uv: vec2f) -> VertexOutput {
  var out: VertexOutput;
  out.pos = ubo.viewProj * vec4f(pos, 0.0, 1.0);
  out.vUv = uv;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  // 管线底色：工业蓝色
  const baseColor = vec4f(0.12,0.45,0.72,1.0);
  // 流动偏移，沿管线U方向流动
  let offset = ubo.time * 0.8;
  let u = fract(in.vUv.x + offset);
  // 流动条纹，间隔0.7
  let stripe = step(0.7, u);
  let flowColor = mix(baseColor, vec4f(0.35,0.70,0.95,1.0), stripe);
  return flowColor;
}
