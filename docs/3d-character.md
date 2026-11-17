# BodyTrace 三维身体页（MakeHuman Studio）

## 实现状态

- 真正的 GLB 人体、53 骨骼和 92 个可混合 Morph Target。资源来自 `models/free/makehuman/`，许可 CC0；Three.js 0.170.0 引擎许可 MIT。没有复制 CharacterCreator 的 GPL 源代码。
- Android Actions 在构建时以 esbuild 生成单文件、离线可用的 Three.js 运行时，将 `base_body.glb`、`hair_short04.glb`（短寸）、`clothing_shorts.glb` 与 `clothing_shoes.glb` 一起打包进 APK，不需要手机联网或 fal 账户。
- 手机 WebView 从内置可信资源加载，不向远程平台上传人体指标；JSON 同步仍由既有原生 GitHub HTTPS 代码执行。
- 自由拖动 360° 旋转、触控缩放、正背视角、按日期选围度；场景具 PBR 材质、柔和摄影棚灯光、地面接触阴影。
- 体重采用原模型的 `weight_min/weight_max` Morph；肩胸腰臀上臂大小腿围通过保留拓扑的局部相对尺度近似调整。固定身高 173.5 cm。

## 已查明并修复的关键形变错误

上游 GLB 的 `mesh.weights` 将全部 92 个 Morph 的默认权重设成 **1**。初始版本只覆写了一部分权重，导致所有性别/胸部/面部变形同时叠加，出现严重畸形。

**每次应用体型参数时必须先执行 `morphTargetInfluences.fill(0)`，再设置男性及有效的全身 Morph。** `scripts/test_makehuman_assets.js` 已加入回归检查。任何重写形变算法的修改都应保留这一约束。

## 精度和视觉边界

- 用户记录的是量尺围度，并非扫描得到的 3D 几何。胸围相同也可能有完全不同的胸深、胸廓和肌肉外形，因此本人物只能是**趋势示意**。
- 源 Morph 只有体重、肌肉、身高等整体参数，局部围度使用独立网格形变近似匹配，并未建立具有临床精度的肌肉/体脂模型。
- 短发及短裤使用相同骨骼重绑定。极端体重和局部围度可能出现穿模，需要继续优化关节和衣物遮挡。
- 二维原画仍可作为备用模式；它不能三维旋转或随围度变化。
- 画质与用户最初选择的原创卡通角色存在风格差异；目前是免费可控的真人风格人物，而不是对原始二维图进行完美三维重建。

## 验收和诊断

- `scripts/test_makehuman_assets.js` 验证下载哈希、GLB 结构、皮肤骨骼、Morph 名称、Android 打包接入。
- `scripts/preview_makehuman.cjs` 使用 Headless Chromium + 软件 WebGL 实际渲染源模型，生成前/侧面截图，预览在 `.github/workflows/preview-makehuman.yml` 的 Artifacts 下载。
- 安卓 `.github/workflows/android.yml` 需要成功完成 Morph 测试、JS Bundle 以及 Release APK 签名检查。
- 自动渲染测试不能替代 Android 手机上的 GPU、屏幕与触摸体验验收。

上游源码许可证与模型资料请参见 [免费模型说明](../models/free/README.md)。
