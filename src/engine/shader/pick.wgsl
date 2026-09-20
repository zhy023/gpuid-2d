struct InstanceItem {
  sx: f32,
  sy: f32,
  beta: f32,
  tx: f32,
  ty: f32,
  selected: f32,
  pad1: f32,
  pad2: f32,
};

struct Uniforms {
  viewProj: mat4x4f,
};

@group(0) @binding(0) var<uniform> ubo: Uniforms;
@group(0) @binding(1) var<storage, read> instances: array<InstanceItem>;

struct VertexOutput {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) instanceId: u32,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIdx: u32, @builtin(instance_index) instanceId: u32) -> VertexOutput {
  var out: VertexOutput;
  let inst = instances[instanceId];
  let cosBeta = cos(inst.beta);
  let sinBeta = sin(inst.beta);
  let local = vertexLoadPos(vertexIdx);
  let world = vec2f(
    (local.x * cosBeta - local.y * sinBeta) * inst.sx + inst.tx,
    (local.x * sinBeta + local.y * cosBeta) * inst.sy + inst.ty,
  );
  out.pos = ubo.viewProj * vec4f(world, 0.0, 1.0);
  out.instanceId = instanceId;
  return out;
}

fn vertexLoadPos(idx: u32) -> vec2f {
  const arr = array<vec2f,6>(
    vec2f(-0.5, -0.5),
    vec2f( 0.5, -0.5),
    vec2f( 0.5,  0.5),
    vec2f(-0.5, -0.5),
    vec2f( 0.5,  0.5),
    vec2f(-0.5,  0.5),
  );
  return arr[idx];
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4u {
  let id = in.instanceId + 1u;
  return vec4u(id, 0u, 0u, 0u);
}
