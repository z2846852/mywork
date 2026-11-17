# 体迹 · BodyTrace

Android 个人数据仪表盘：训练、身体指标，后续扩展饮食。参考了 [better](https://github.com/z2846852/better) 的原生 Java + Gradle + GitHub Actions 自动构建方式。

**[下载最新 Android APK](https://github.com/z2846852/mywork/releases/latest/download/BodyTrace-debug.apk)** · [Actions 构建](https://github.com/z2846852/mywork/actions) · [最新 Release](https://github.com/z2846852/mywork/releases/latest)

> 当前是使用临时 Debug 证书的测试版，更新安装可能需要先卸载旧版（会清空本机令牌、缓存和未上传队列）。不要将测试 APK 视为已经完成真机端到端验收。

## 双仓库数据架构

- **私有 `z2846852/-`**：真正的数据主仓库，保存完整记录、历史 TXT、清洗逻辑和模型。无论 ChatGPT 还是 App，都向 `data/daily/YYYY-MM-DD.json` **按天单文件追加**。
- **公开 `z2846852/mywork`**：Android App 源码、构建流程及 `data/demo/YYYY-MM-DD.json` 演示快照。用户已同意公开训练重量/次数、体重身高等基础数据用于演示；演示目录已排除原始备注、健康叙述和所有凭证。**演示快照不是实时同步的数据源，也不是写入目标。**
- **GitHub Actions（手动兼容刷新）**：仅在 App 选择「触发 Actions」或在 GitHub 手动执行时，按每组 UUID 去重导入 `fitness_log.txt` 并重建旧 CSV、PNG/SVG 与 Markdown 报表。新训练数据写入每日 JSON **不会自动触发这套昂贵的旧图表流程**。

```
ChatGPT GitHub Connector ───┐
                             ├──> Private data/daily/YYYY-MM-DD.json
BodyTrace App (GitHub API) ──┘                |
                                            v
                                import_daily.py (idempotent)
                                            |
                                            v
                   (仅手动触发) fitness_log.txt → CSV → charts
                                            |
                                            v
                              BodyTrace App GET daily JSON

Public mywork/data/demo/*.json: authorization-approved snapshot for demos
```

### 每日 JSON v2 示例

```json
{
  "schema_version": 2,
  "date": "2026-11-17",
  "workouts": [
    {
      "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "exercise_id": "row",
      "load_kg": 27.5,
      "reps": 8,
      "source": "chatgpt"
    },
    {
      "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "exercise_id": "assisted_pullup",
      "assistance_kg": 73,
      "reps": 4,
      "source": "bodytrace-android"
    }
  ],
  "measurements": [],
  "nutrition": []
}
```

示例 ID 不能用于实际写入；每条记录都要生成唯一 UUID。**只使用 `assistance_kg` 表示辅助量**，其他负重使用 `load_kg`。无实际测量依据的 e1RM 和机器阻力系数不得描述为实测最大力量。

### App 实现情况

- 训练贡献热力日历（按组数分色）、按日期列出所有动作及各组、按动作筛选。
- 从私有仓库 `data/daily/YYYY-MM-DD.json` 直接读取训练和身体数据，本地计算可视化；使用 Keystore 加密缓存和断网待提交队列。
- 新增训练组：GET 当天 JSON 与 SHA，追加单个 UUID 组，PUT 完整当天 JSON 和 `sha`。发生 GitHub 409/422 冲突时重新获取文件、再次合并，最多重试。
- GitHub fine-grained PAT 必须**由用户在 App 内输入**，仅授权私有 `z2846852/-` 仓库 Contents Read and write。PAT 不能写进 APK，也不会存到公开仓库。Android 本机使用 AES-GCM + Keystore 存储。
- 体重、围度等展示已有测量；饮食录入与分析尚未接入。当前饮食字段在每日 JSON 中预留为 `nutrition` 数组。
- App 直接读取 JSON 并绘图；不再等待 CSV/PNG/SVG 的生成。首页「刷新数据」直接请求 JSON，「触发 Actions」通过 `repository_dispatch` 启动私有仓库旧报表工作流；这两种操作独立。

### 首次接入与验收

1. 下载并安装测试 APK。
2. 在 GitHub 创建 fine-grained personal access token，仅选择 `z2846852/-`，授予 Contents Read/write。在 App「连接」页输入，不要发到聊天里。
3. App「概览」直接读取私有每日 JSON；应看到过去的训练日历和全部组数。
4. 在「记录」页录入**实际完成**的一组，检查私有仓库 `data/daily/当天.json` 对应的 `workouts` 数组多出一项，并且不丢失以前的组。
5. 保存成功后直接刷新每日 JSON，新组应立即显示；如需重建旧 GitHub 报表，点「触发 Actions」，并在 GitHub Actions 页面检查执行状态。
6. 检查 ChatGPT 继续读取、追加同一份每日 JSON。

**验证边界：** 代码编译、APK 签名校验和私有 GitHub Actions 导入测试已经通过；尚未使用用户的真实 Android 设备和 PAT 验证双向网络写回。旧 APK 以独立 `app_events` 文件写入，私有兼容导入器暂时保留。

## 数据发布与后续演进

`data/demo/*.json` 是用户授权用于公共演示的历史结构化快照。它不自动随私有仓库更新；本次公开不包括原始聊天文本、医疗信息、完整饮食记录或任何凭证。**公开 Git 历史不能被视为可随时完全撤回的私有存储。**

接下来可按相同 `data/daily/YYYY-MM-DD.json` 模式增加 `nutrition`（餐食、估算热量、蛋白质、份量来源）及 `measurements`（体重、腰围、胸围、体脂等）的录入和趋势分析，避免重构整体架构。

## 开发

Java 17 · Android SDK 35 · Gradle 8.9 · AGP 8.7.3。原生 Java + WebView 离线本地 UI，不在 WebView 暴露 GitHub 令牌。

源码在 `app/src/main/`，CI 在 `.github/workflows/android.yml`，APK 发布于 GitHub Releases。
