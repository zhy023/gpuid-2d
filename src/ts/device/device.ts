import shaderCode from '@/wgsl/tools/base.wgsl?raw'

async function run() {
  // 1. 获取canvas与webgpu设备
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas')
  if (!canvas) throw new Error('未找到 canvas 元素')
  if (!navigator.gpu) throw new Error('当前浏览器不支持 WebGPU')

  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('没有拿到 GPUAdapter，请检查浏览器与显卡驱动支持情况')

  const device = await adapter.requestDevice()
  const context = canvas.getContext('webgpu')
  if (!context) throw new Error('无法获取 canvas 的 webgpu 上下文')

  const format = navigator.gpu.getPreferredCanvasFormat()

  context.configure({ device, format, alphaMode: 'opaque' })

  // 2. 顶点数据：矩形，局部坐标（图元自身坐标系）
  // 两个三角形组成矩形
  const vertices = new Float32Array([
    -0.5, -0.5, 0.5, -0.5, -0.5, 0.5,

    -0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  ])
  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(vertexBuffer, 0, vertices)

  // 3. Uniform Buffer：存放变换参数 sx,sy,beta,tx,ty
  // f32 每个4字节，一共5个浮点数
  const transformData = new Float32Array([
    1.0, // sx  X缩放
    1.0, // sy  Y缩放
    0.5, // beta 弧度，0.5弧度旋转
    0.0, // tx X平移
    0.0, // ty Y平移
  ])
  const uniformBuffer = device.createBuffer({
    size: transformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(uniformBuffer, 0, transformData)

  // 4. 绑定组
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      },
    ],
  })
  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  })

  // 5. Shader（就是刚才那段WGSL，直接写这里）
  const shaderModule = device.createShaderModule({ code: shaderCode })

  // 6. 创建管线
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  })
  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vertexMain',
      buffers: [
        {
          arrayStride: 8, // vec2f 2*4字节
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: 'float32x2',
            },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fsMain',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  })

  // 7. 渲染循环
  function render() {
    if (!device || !context) return

    const commandEncoder = device.createCommandEncoder()
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    renderPass.setPipeline(pipeline)
    renderPass.setBindGroup(0, bindGroup)
    renderPass.setVertexBuffer(0, vertexBuffer)
    renderPass.draw(6) // 6个顶点，画矩形
    renderPass.end()
    device.queue.submit([commandEncoder.finish()])
    requestAnimationFrame(render)
  }

  render()
}

export default { run }
