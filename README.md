# 体迹 · BodyTrace

Android 个人健康与训练记录实验应用：**本地优先，GitHub 按需同步**。未来逐步扩展饮食、体重、围度和力量趋势。参考 [better](https://github.com/z2846852/better) 的 Java + Gradle + GitHub Actions 自动构建方式。

**[下载最新固定签名 Release APK](https://github.com/z2846852/mywork/releases/latest/download/BodyTrace-release.apk)** · [Actions 构建状态](https://github.com/z2846852/mywork/actions) · [全部版本](https://github.com/z2846852/mywork/releases)

> **Android 签名已改为固定公开密钥。** 从首次 Release 安装起，后续同包名、同签名且 versionCode 递增的 APK 可直接覆盖升级。**旧 Debug 签名与新 Release 不兼容，第一次可能要卸载旧版**：卸载前先将本机未同步数据推送到 GitHub。

## 固定公开签名（个人实验用途）

仓库内 `signing/bodytrace-release.p12.b64` 是完整签名密钥库的 Base64 文本（**包含私钥**），不是公开证书；密码为 `bodytrace-public-signing-v1`，别名 `bodytrace`。这套签名专供 BodyTrace 使用，**不要**用于其他应用，也不要重新生成：更换签名会导致老版本无法覆盖升级。

选择公开密钥是为减少个人实验项目的配置步骤，意味着任何拿到密钥的人都能签名一个 Android 视为同一开发者的 APK。不要安装非自己仓库发布的不可信安装包；APK 签名不等于 GitHub PAT，但安装恶意升级包仍可能威胁已存储 PAT。

`mywork` 的 Actions 不需要任何额外 Secrets，使用这个静态密钥签名 Release。GitHub PAT 依然只能在手机里保存，不能上传到仓库。

## 本地优先架构

- **Android App** 是随时可用的录入、清洗和可视化入口：不联网即可保存新训练组。手机在应用私有目录保存**明文 UTF-8 JSON**，包括每天的原始数据、Raw 收件箱和待上传队列；仅 GitHub PAT 使用 Android Keystore 加密。
- **私有 [z2846852/-](https://github.com/z2846852/-)** 保存每天一个 JSON 文件：`data/daily/YYYY-MM-DD.json`。ChatGPT 继续直接写这里。App 在保存训练组/Raw 后，只要已配置 PAT 就立即尝试上传；断网失败进入待上传队列。用户点击「同步 GitHub」时会重试上传并拉取 ChatGPT 新增的所有每日 JSON，按 UUID 合并。
- **公共 [mywork](https://github.com/z2846852/mywork)** 保存 APK 源码、构建和经用户允许的历史演示快照 `data/demo/*.json`。演示快照不自动同步真实私有仓库，不包含个人备注或 PAT。
- **GitHub Actions：使用仓库内固定的公开签名证书，自动编译并发布可持续覆盖升级的 Release APK。** 旧 TXT/CSV/SVG 兼容图表流程不是日常录入依赖，也不由 App 自动触发；如需重建旧报表，可在私有仓库 Actions 手动执行。

```text
  [手机 BodyTrace]         [ChatGPT]
        |                     |
        | 本机明文每日 JSON    | 直接提交 JSON
        |                     v
        |  <== 手动同步 ==> 私有 GitHub data/daily/*.json
        |      先推后拉
        v
  Android 本地解析/计算/画图
  （不需要等待旧图表 Actions）

  ChatGPT 改 mywork 源码 → GitHub Actions 构建 APK
```

## 数值滚轮与身体测量录入（2026-11-17）

- 训练记录的重量/辅助量、每组次数、组数均可点击数字打开横向刻度滚轮；重量刻度 0.5kg、次数/组数刻度 1，滚轮大数字允许直接键盘输入至 0.1kg。组数 1–10 会生成互不相同 UUID 的独立训练 JSON，而不是伪造一条合并记录。
- 身体页有「记录身体围度」表单，支持体重、肩、胸、腰、上臂、臀、大腿、小腿围。围度滚轮每格 0.1cm；体重可显示 kg 或斤，统一写入 weight_kg（斤按 1斤 = 0.5kg 换算）。每项首次显示历史值作为参考，但**只有用户点击滚轮确认的字段才会作为本次测量存档**，避免把旧数字误写为新测量。
- App 本机优先保存，连上 GitHub 后通过原来的 SHA 乐观并发控制自动追加到 `data/daily/YYYY-MM-DD.json` 的 workouts / measurements 数组。记录具有 UUID，网络失败后队列重试幂等；ChatGPT 同步不受影响。
- 同日存在多次测量时，图表选取同一日期最近一次的对应指标；历史记录完整保留，没有覆盖和删除。
- 身体展示已回退为轻量的正面／背面训练部位示意图。围度数值、日期比较、体重趋势仍按 JSON 直接显示；旧二维人物图片与形变实验代码保留在仓库作历史参考，但 APK 不再载入。
- Chromium 验收脚本检查 27.5kg ×3 组的批量 JSON、仅修改体重的测量 JSON、部位示意图、所有动作的趋势、最近训练排序以及滚轮交互。

## 身体展示：基础部位示意图（当前默认）

- 正面与背面两幅简洁的身体轮廓，按照最近28天记录组数突出胸、肩、背、腿、手臂和核心；点选可查看相关动作。此图不使用真实人体照片、卡通人物或者虚假的身体围度形变。
- 身高默认 173.5cm；身体日期、体重、胸腰臀等围度全部来自本机缓存的 GitHub 每日 JSON。支持 2026-04-15 等历史数据。
- 「记录身体围度」滚轮、按日 JSON 上传、训练/饮食/Raw 同步都保持原功能，不删除旧数据。
- 旧 2D/3D 资源仍留在仓库作为参考；当前 APK 不加载人物素材。此前导入到手机的图片不主动删除，但身体主页不会再展示。

## 训练趋势与动作排序

- 趋势页不再有动作下拉菜单：所有存在训练记录的动作都以独立卡片连续展示；无有效重量时保留卡片并显示缺失提示。每张卡片仍保留历史训练趋势、标称重量/辅助量与估算参考说明。
- 顺序按该动作**最近一次训练日期**由新到旧，同日以创建时间、记录顺序为后备排序规则。新近练习的动作始终在前，久未更新的动作在后。
- 记录页与日历动作下拉选项增加 `【胸】`、`【肩】`、`【背】`、`【腿】` 等部位前缀，展示字号略小；已练动作按最近训练日期排列，从未练过的动作排到后面。
- 动作的内部 `exercise_id` 不变，旧版 `schema_version:2` 每日 JSON 与现有同步规则完全兼容。
## 当前已实现

- 无需 PAT、无需联网即可录入训练组与 Raw；本机 JSON 原样保存、立即更新视图。连接 GitHub 后保存即尝试上传，失败不丢本地记录。
- 训练日历按照每日组数显示深浅，支持按日期查看所有组、按动作过滤。
- 身体指标、体重、腰围、胸围和体脂趋势均由 App 从 JSON 本机计算；身体页显示基础部位示意及按日期更新的真实围度数值。
- **GitHub fine-grained PAT 是唯一需要 Keystore 加密的应用字段**；普通训练、身体指标和 Raw JSON 在 App 私有目录明文存储，无需第三方存储权限。
- 「同步 GitHub」：重试上传待提交的训练及 Raw，再读取 ChatGPT 写入的每日 JSON，按 UUID 合并，远端同 ID 项优先；GitHub 文件写入携带 SHA 并在冲突时重试。
- 「解除授权」只清除 PAT，**不删除本地数据和待同步队列**。
- Raw 模式把原话记录为 JSON，上传到私有仓库 `data/raw_inbox/YYYY-MM-DD/UUID.json`，默认 `unprocessed`；未来由 ChatGPT 读取并判断是否新增功能或转化成结构化数据，不会自动执行原文。饮食模块已支持录入份量、热量/100g和可选营养素，并按已录入数据计算摄入热量。

## 已处理的 Raw UI 反馈（2026-11-17）

- **日历最新日期定位**：首次进入、读取本地历史或 GitHub 同步数据后，热力图横向滚动到最右侧（近52周的最新一周）；点击日期主动浏览过去的记录时不强制回弹。「最近一次」按钮会重新定位到最右侧。
- **训练默认值**：次数输入框真实默认值为 **10次**（不是只有 placeholder）；动作切换时自动恢复10次。重量按**同一动作最近最多10组**可用的标称重量取**较低中位档**，直接填入输入框，可自行修改。辅助引体使用标称辅助量而不是负重，与普通动作分开。无对应历史组时重量不自动猜测，必须手动输入。该重量推荐只是历史档位，不宣称是真实10RM或安全的个人训练处方。
- **回归检查**：`scripts/test_ui.js` 验证真实示例数据上的最近组推荐、默认次数和热力图右端定位；Android Actions 构建前自动执行。

## App 内置 JSON 转换（替代数据可视化 Actions）

本机分层保存，无需把图表计算写入 GitHub 工作流：

```text
/files/bodytrace/
├── daily/
│   ├── 2026-11-16.json    # 原始 JSON（明文）
│   └── 2026-11-17.json
├── raw_entries.json       # Raw 原文和上传状态（明文）
├── pending.json           # 待同步事件（明文）
└── view_model.json        # App 重新生成的可视化 JSON（明文）
```

`ViewProjector.java` 读取全部每日原始 JSON，生成版本化 `view_model.json`：包含 `view_schema_version:1`、平铺训练组 `workouts`、身体测量 `measurements`、`heatmap` 日期计数和 `metric_series` 变化序列。WebView 使用这个中间 JSON 渲染界面，原始 JSON 始终保留，不被派生算法覆盖。可以在 App 的「连接」页面点击「查看生成的 view_model.json」检查实际内容。

**协议扩展：** 原始 JSON 保持 `schema_version:2`，新增非破坏性字段可直接添加；旧 App 忽略不认识的可选字段，拉取与合并时保存原样。若未来发生不兼容结构变化，再引入明确的 schema 迁移，不要暗自覆盖旧文件。派生 JSON 单独版本管理，随 App 升级重建。

**计算边界：** 已实现训练组清洗、热力图、饮食营养素/热量录入计算、简化e1RM参考、身体围度趋势以及训练部位示意。e1RM不是实测最大力量；部位高亮仅代表训练记录数量，不是解剖学或体型推测。

## 每天一个 JSON · schema v2

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
    }
  ],
  "measurements": [],
  "nutrition": []
}
```

例子中的 UUID 是示意。每组必须有独立 UUID，辅助引体用 `assistance_kg`，其他动作用 `load_kg`；均为器械标称值而非标定后的实际作用力。次数低于15而未明确 RIR 时，界面按用户个人规则显示「RIR0（规则）」，并非实际测试力竭。

## 首次测试步骤

1. 安装 APK。**不需要登录**，进入「记录」完成一组真实训练；返回「概览」，应立即看见本地日期和组数。
2. 在 GitHub 创建 fine-grained PAT，仅授权私有 `z2846852/-`，权限为 Contents Read/write。到 App「连接」粘贴，不要发到聊天里。
3. 已配置 PAT 时，新增训练组或 Raw 会**先本地保存、再即时上传**；断网时保留队列。点击「同步 GitHub」拉取 ChatGPT 的新 JSON 并更新本机可视化。
4. 请 ChatGPT 写入另一组，然后回 App 点击「同步 GitHub」，确认两端都能看到完整记录。
5. 「解除授权」后验证本机数据仍存在、仍可离线录入。
6. 固定签名 Release APK 支持后续覆盖安装升级（签名与包名一致、versionCode递增）；升级前仍建议先同步未上传记录。

## 范围与验证限制

Android Actions 已用于编译与签名检查；但是 **真机上的 PAT 授权、离线录入持久化、同步及断线恢复仍需实际设备验收**。

当前版本暂不支持编辑、删除已存在的某一组，也没有跨设备自动同步和后台自动计划任务。当前本地是**按天独立的明文 JSON 文件**（App 沙箱目录），远端 GitHub 同样按天一个 JSON。旧版加密缓存首次启动时尝试迁移，PAT 继续单独加密。大量历史文件时可以再按年份分目录并做增量同步。

## 开发与更新

Java 17、Android SDK 35、Gradle 8.9、AGP 8.7.3。原生 Java + 只加载内置 HTML 的 WebView，本地界面不访问外站，所有 GitHub 网络操作通过原生 Java HTTPS 完成。

源码在 `app/src/main/`，自动构建位于 `.github/workflows/android.yml`。ChatGPT 后续修改界面/新增字段时提交源码，Actions 自动发布新 APK，无需在手机里手动运行图表生成器。
