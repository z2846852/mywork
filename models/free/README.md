# BodyTrace 免费 3D 模型候选

本目录为**已核实来源和许可证的模型资产缓存**，不是当前 App 身体页的最终渲染实现。

## 主要候选：MakeHuman / CharacterCreator（优先）

- 来源：[kblood/CharacterCreator](https://github.com/kblood/CharacterCreator)；**仅使用其 `output/` 生成资产，未复制 GPL-3.0 运行时代码**。
- 生成资产许可：CC0-1.0，详见[LICENSE-NOTES](https://github.com/kblood/CharacterCreator/blob/master/LICENSE-NOTES.md)（源代码 GPL 和生成资源 CC0 分开）。
- 人体文件 `makehuman/base_body.glb` 约 7.23 MB，包含 ~92 个形变目标；辅助文件 `base_body.joints.json` 提供关节偏移。
- `hair_short02.glb` / `hair_short04.glb` 为可替换短发；`clothing_shorts.glb`、`clothing_shoes.glb` 为相配的衣服组件。需要用相同骨架配置加载，而不是将几个 GLB 随意拼接。
- 官方项目演示：https://dionysus.dk/webxr/charactercreator/

## 对照候选：Quaternius（非最终画质）

- 来源：[programasweights/avatar](https://github.com/programasweights/avatar)，模型来自 Quaternius Universal Base Characters，CC0-1.0，原作者声明详见其仓库的 `public/assets/QUATERNIUS-LICENSE.txt`。
- `quaternius/character.glb` 为完整的约 0.74 MB 人物模型，含骨骼，但表面经过简化、材质统一；只用于 GLB 渲染器/骨骼功能测试，**不代表最终视觉效果**。

## 下载、校验、更新

[GitHub Actions - Import Free 3D Models](../../.github/workflows/import-free-3d.yml) 会按固定源代码 commit 和 Git blob SHA-1 下载，验证真实文件长度、glTF 二进制头和身体模型是否含 morph targets，之后以**独立 Git 提交**存入本目录。不会改动个人身体 JSON，不要求 fal 充值。

`models/free/catalog.json` 列出全部来源、路径及原始 blob 校验值。禁止把不明许可证的模型直接放进公共仓库。

## 仍未完成

1. Android 端装入 Three.js / GLTFLoader，并使用上述**真实 GLB** 替代旧椭球模型。
2. 测试短发、短裤与身体同骨架正确组合，没有穿模。
3. 映射按日 JSON：身高 173.5cm 与体重、肩/胸/腰/臀/臂/腿围。源 Morph Target 不一定与围度一一对应，映射是近似值。
4. 真机评估正背面、360°旋转、帧率和光照材质质量。

**文件入库 ≠ 完成上述功能；请通过 Android 真机界面确认后再验收。**
