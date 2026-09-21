// core/shader/core_include/instance_transform.wgsl
// Core 内核：实例变换存储结构，业务无关
// 存储图元的空间变换与通用选中标记，所有实例化渲染共用
// 注意：本文件只放「结构体」，绑定声明放在 primitive_uniforms.wgsl，
// 这样特性着色器（如管线带动画时间的 UBO）能复用结构体、自定义绑定。
struct InstanceTransform {
    scaleX: f32,
    scaleY: f32,
    rotateRad: f32,
    worldPositionX: f32,
    worldPositionY: f32,
    isSelected: f32, // 0.0 = false，1.0 = true
    shape: f32, // 形状：0 = 方框（矩形/正方形），1 = 圆/椭圆（按包围盒内切）
    pad1: f32,
    // 图集 uv 矩形 (u0, v0, u1, v1)：单纹理/白纹理时填 (0,0,1,1)
    // vec4f 需要 16 字节对齐，放在 32 字节偏移处正好
    atlasUvRect: vec4f,
    // 逐实例颜色：(r,g,b,a)；a > 0.5 才算指定了颜色，否则该实例不绘制、也不参与拾取
    color: vec4f,
};
