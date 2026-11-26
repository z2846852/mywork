# 体迹 · BodyTrace / MyWork

个人使用的 Android 数据看板：**健身记录、身体趋势、饮食、睡眠录音与声音分析**。数据优先在手机本地保存，GitHub 用作按需同步和版本化备份。此 README 是跨 ChatGPT / Codex 窗口接手项目的**唯一概要入口**。

[下载最新 APK](https://github.com/z2846852/mywork/releases/latest) · [最新成功发布状态](build-status.json) · [正式构建 Actions](https://github.com/z2846852/mywork/actions/workflows/android.yml) · [夜间回归](https://github.com/z2846852/mywork/actions/workflows/nightly-tests.yml) · [代码提交记录](https://github.com/z2846852/mywork/commits/main)

> **阅读规则：** 先读此 README，再检查 `main` 的实时源码、Actions、Release；它记录当前目标和已确认的默认行为，不是未来改动的强制需求。本文避免按日期堆砌版本流水账，过去的变更在 Git 历史和 Release 中查看。代码实现、CI 成功、APK 发布、手机真机验证是四件不同的事，不能互相替代。

## 个人开发约定

| 事项 | 规则 |
| --- | --- |
| 分支 | **默认只操作 `main`**，修改后直接提交，由 Actions 出包；未经用户明确要求，不创建功能分支或 PR |
| 需求优先级 | 用户当前明确要求 > 本 README 的旧摘要 > 旧聊天/注释/历史方案。需求有歧义、技术不确定时应直接说明 |
| 工程约束 | 以能正确运行、数据安全为主，不因纯格式、缩写或原作者协作风格制造门禁；但不能跳过实际必要的编译、签名、完整性及数据兼容验证 |
| 功能删改 | 不擅自隐藏或删除“不常用”功能；用户明确决定后，优先修改实际行为与默认值，不做形式上的隐藏 |
| 数据 | **保留原始记录和历史**，编辑/删除通过明确的记录逻辑处理，不能直接清空整个日期文件或覆盖他端更改 |
| 文档 | 影响默认行为、数据协议、同步、更新、主要页面和工程工作流的修改，**同步更新此 README 的对应摘要**；不要再新增长篇“某天更新了什么”的章节 |
| 发布 | **优先读取仓库根目录 `build-status.json`** 查询最近一次已成功发布的 APK 版本、构建编号和源码提交；必要时再核对 Release/Actions。README 不写死最新版号，更不把发布成功当作真机验证通过 |

## 当前页面及功能

| 页面 | 主要用途和行为 |
| --- | --- |
| **概况** | 快捷数据、年度训练热力图、日期选择及各页面跳转；日历四宫格分别表示胸（珊瑚红）、肩（金黄）、背（蓝）、腿（紫），每格按该部位当天实际完成组数独立调整颜色深浅（1 / 2–3 / 4–5 / ≥6 组；未练灰色），不再用整日绿色总负荷背景；这不是生理负荷指标；点选日期仅在原页更新下方详情，不自动滚动或跳页；当天动作默认全部显示，不设置“展开/收起动作”开关（各动作历史组的“收起历史”独立保留） |
| **趋势** | 标题和时间范围按钮同一行；顶部紧凑显示组数、训练天数、曲线数、体重及胸肩背腿统计；综合曲线选中后会高亮且将对应的单动作图表卡片置顶，不改变统一纵轴，不强制滚动或跳页；取消选中时下方卡片恢复按最近训练日期排序；下方动作卡片和训练点可反向选中上方同动作同负重口径的曲线，卡片只移动原有 DOM 节点，不创建放大副本或重绘单动作图表；每动作可显示一条“个人阶段目标”虚线，可修改工作重量和次数、一键隐藏，设置通过 Android 原生 SharedPreferences 存在当前设备（不依赖 WebView localStorage，不上传 GitHub）；历史动作自动以自己的最佳有效记录再提高10%为阶段目标，臀推首次预置可修改的 60kg×8 次（不是成年平均），辅助器械默认隐藏；有目标的综合指数100对应目标1RM，幂次映射压低早期浮夸增长且保留中后期增益，原始记录不变；无法从不同器械/缺乏人口资料推断真实成人平均力量等级；保留历史编辑、图例和快捷跳转。**训练组数不等于肌肉增长，器械重量不可跨动作直接相加** |
| **记录** | “训练记录”标题后显示可修改的北京时间训练日期，非今天高亮，手动历史日期不被自动覆盖。肌群/动作选择、最近记录带入、滚轮输入、独立保存与批量录入、历史修改删除不变。重量标题右侧新增小「R」：按当前动作的历史最高**至少完成6次**的标称重量，连同当组实际次数回填；70×1、65×5 等不参与比较，等重时取较新的记录，点击 R 不自动保存。e1RM 双向重量/次数滑块**常显在保存按钮下方、更多设置上方**；调整理论重量或次数后会立即回填上方待保存的重量与次数（重量保留1位小数、次数取整），仍需点击保存才写入历史；校准参数默认折叠，休息计时不变 |
| **身体** | 体重及围度趋势、快捷录入、按日期查看测量、身体部位训练分布。身体示意为记录可视化，**不推断真实体型或肌肉变化** |
| **睡眠** | 整晚录音/导入、后台分析、波形与噪声阈值、AI 鼾声/梦话筛选、时间线与回放；「实时鼾声反馈」下分麦克风输入与喇叭输出两张波形卡片：录音时自动共享 PCM，未录音可单独开麦测试且不保存 M4A；提示音/震动可独立试听，反馈开关不影响已有录音；YAMNet 仅供声音分类，不是医学诊断 |
| **声音** | 音高连续轨迹、五线谱参考、IPA 教学和易混音练习；按住说话分析 PCM 音频，实验性 ZIPA 神经音素识别与英汉词典反查 |
| **饮食** | 每日饮食、热量和营养素记录及统计；数据以实际录入内容为准 |
| **日志** | 最近 Git 提交、可获取的文件 diff、Raw 想法收件箱、GitHub 连接/同步、版本历史、更新和其他设置 |

页面实际结构见 [index.html](app/src/main/assets/index.html)。底部导航按代码的「概况、趋势、记录、身体、睡眠、声音、日志」为准；饮食入口集成在页面中，并非独立底部 Tab。

### e1RM 记录页预测与测试

- e1RM 现在默认常显，位于记录页「更多设置」正上方；仅通过 e1RM 标题旁「!」展开公式校准。按当前器械重量和次数估计 e1RM；**次数滑块固定1–20次**，**重量滑块按当前e1RM与校准参数动态限制在1RM～20RM对应的标称重量**（辅助量方向反转），两者双向联动。数字框可超出滑块范围手动填写，滑块只停在边界、不反向截断手动输入。**滑块或试算数字框改变后即时回填待保存训练表单**，不自动保存、不改历史；使用初始 e1RM 作为当前滑动的固定基准，避免取整造成反复重新计算与跳动。超过 15 次仅数学外推。
- 按动作校准 Epley 次数系数 C、机器倍率 a 和零点偏移 b；辅助器械使用空载平衡刻度 N。Android 通过原生 SharedPreferences 保存，WebView DOM Storage 已禁用，不能依赖 localStorage。
- GitHub 预览测试先展开记录页的“更多设置”，再访问动作排序控件；同时验证常显 e1RM 双向反算主动回填训练草稿、不会在拖动时循环重新定基准，并验证 R 排除 5 次及以下的记录。

### 重要的实际交互

- **本地优先**：离线也能记录训练、身体和 Raw；后台同步不应改动正在填写的表单、已选动作、手动选择的历史日期或用户正在查看的滚动位置。
- **每组独立**：训练按 UUID 保存；可追加修改/删除事件来更正历史，保留原始记录及操作痕迹。辅助量 `assistance_kg` 与普通负重 `load_kg` 不混淆。
- **e1RM 记录页试算**：上方标称负重和重复次数是待保存原始记录；下面的理论重量/次数双向预测器**会立即回写待保存表单的重量与整数次数**，但不会自动保存为一组训练；基准 e1RM 由当前动作标称量和 1–15 次近力竭记录推算（16–20次仅作不可靠数学外推），公式为 `e1RM = 有效负荷 × (1 + 次数/C)`，默认 `C=30`。其他重量的重复次数按逆公式试算，超过 15 次仅数学外推，不能视为可靠实际能力。点击公式旁 `!` 可为当前动作独立设置 `C`、器械负荷倍率 `a` 和普通动作偏移 `b`；辅助引体/双杠使用 `有效负荷 = (空载平衡刻度N - 标称辅助量) × a`，可将自己实测的空载点（如 100 kg）存为 `N`。未设定时仅暂以最近有效体重作为初始假设，**不是已校准器械数据**；没有体重且未校准时不估算。校准值保存在 Android 原生 SharedPreferences 的 `bodytrace_e1rm_calibration` 命名空间中，每个动作独立、更新应用后保留，**尚未通过 GitHub 同步或跨设备备份**。已有综合趋势和专属趋势仍沿用各自原始口径，不应认为新校准自动修改了历史趋势。普通自重动作仅外加重量、未确认负重口径、0 次失败、或超过 20 次的原始记录不生成 e1RM；16–20次标记为高不确定性外推。
- **趋势与入口联动**：优先让一屏展示高信息密度看板；可点击指标/曲线直达相关录入或详情，不重复显示无用信息。
- **休息计时**：默认参考动作类型；计时超出预定休息时显示负数。用户可以手动调整、停止或重新开始。
- **双波形实时反馈**：睡眠页在「录音分析／实时鼾声反馈」间切换时不改变后台采集。输入卡显示实时 PCM 声音电平（dBFS、非标定 dB SPL）和 YAMNet 鼾声得分；若整晚录音已启动，自动显示该唯一麦克风输入。未录音时可主动「开启麦克风测试」：共用 `SleepRecorderService` 的 `AudioRecord` 但 **不创建录音会话或 M4A**；此时可直接关闭测试监听。测试监听期间如果从录音页按开始，会原地接入 AAC-LC 编码并保存 M4A，无需另开第二路麦克风。输出卡独立选择声音（4 种）、相对提示幅度、震动、触发阈值和重复间隔，自动反馈开关随时可用。人工「测试提示音」无须麦克风，使用实际生成的合成波形驱动喇叭波形动画；鼾声触发使用同一播放器。**输出波形是应用合成信号可视化，非扬声器实际声压测量**。关闭反馈不会关闭麦克风、停止录音或阻止 AI 得分显示；关闭麦克风测试不会停止正在进行的 M4A 录音。录音 PCM 经 `MediaCodec + MediaMuxer` 保存成原有 M4A 格式；原始 PCM 不进入 WebView 或上传远端，UI 仅收到短时幅度摘要。提示无整晚次数上限，默认得分阈值 0.15、连续 2 秒、最短间隔 5 秒（参数可调整）。播放音量仍受 Android 媒体音量与设备影响。首次引入这套链路，需要真机验证锁屏长时录音兼容性。
- **睡眠推算**：Android 使用情况事件只能推测不使用手机的窗口；允许短暂亮屏的容忍逻辑，仍**不能证明已经入睡**。vivo 健康私有接口只是只读兼容性实验，不假定任意机型可用。
- **声音分析**：IPA 来自声学模型的候选预测，不是“语音转文字再生成音标”；词典相似度、神经网络输出与真正发音准确率是三种不同概念，**不能混作口音评分**。

## 数据结构与同步

```text
Android 应用私有 files/bodytrace/
├── daily/YYYY-MM-DD.json    # 原始每日记录，schema_version: 2
├── raw_entries.json         # Raw 收件箱（本地原文与状态）
├── pending.json             # 待同步操作队列
├── exercise_catalog.json    # 动作目录、自定义/隐藏项
└── view_model.json          # 可重新生成的图表数据，非原始事实
```

- `daily/*.json` 内可含 `workouts`、`measurements`、`nutrition` 等条目。**以每条记录的 UUID 和实际字段为准**，不把某个演示日期当成真实用户数据。
- `JsonStore.java` 使用 `AtomicFile` 写入私有 JSON；`ViewProjector.java` 根据原始记录重建 `view_model.json`，不得反向覆盖原始 JSON。
- 连接私有 GitHub 数据仓库需要用户在手机上配置 **fine-grained PAT**；PAT 经 `SecureStore.java` 和 Android Keystore 保护，不能写入源码、README、日志或聊天。其他本地 JSON 位于 App 沙箱内，**并非端到端加密**。
- 训练、身体及 Raw 等数据先本地保存，再尝试同步；断网保留待上传项。每日 JSON 用 UUID 合并与远端 SHA 乐观并发保护，遇到冲突应重试/报告，**不可直接覆盖远端全部数据**。
- 手动解除 GitHub 授权只清除凭据，不应删除手机记录。GitHub 仓库承担备份/多端协作，不代表开启实时跨设备全自动同步。
- 私有数据仓库与公开源码仓库分离。公开源码仓库的 `data/demo/` 是演示样例，**不要在公开仓库提交实际健康、录音或训练隐私数据**。

核心代码：[JsonStore](app/src/main/java/com/z2846852/bodytrace/JsonStore.java) · [GitHubApi](app/src/main/java/com/z2846852/bodytrace/GitHubApi.java) · [ViewProjector](app/src/main/java/com/z2846852/bodytrace/ViewProjector.java) · [WorkoutEdits](app/src/main/java/com/z2846852/bodytrace/WorkoutEdits.java)。

## 架构与代码定位

**Android 原生层：** Java 17 + 少量 Kotlin；`MainActivity.java` 提供 WebView、受控 `BodyTraceNative` 桥接、权限和系统生命周期。HTML/CSS/JS 前端来自 APK 内置资源，不是远程网页。最低 Android API 26（Android 8.0），当前 `targetSdk 34`，`compileSdk 35`；以 [app/build.gradle](app/build.gradle) 为准。

| 任务 | 主要文件 |
| --- | --- |
| 全局页面、样式、导航 | [index.html](app/src/main/assets/index.html)、[features.css](app/src/main/assets/features.css)、[features.js](app/src/main/assets/features.js) |
| 训练动作、休息倒计时 | [exercise_catalog.js](app/src/main/assets/exercise_catalog.js)、[rest_timer.js](app/src/main/assets/rest_timer.js) |
| 睡眠前端与波形交互 | [sleep.js](app/src/main/assets/sleep.js)、[sleep_visualization.js](app/src/main/assets/sleep_visualization.js) |
| 睡眠录音、离线分析与实时反馈 | [SleepRecorderService](app/src/main/java/com/z2846852/bodytrace/SleepRecorderService.java)、[SnoreFeedbackController](app/src/main/java/com/z2846852/bodytrace/SnoreFeedbackController.java)、[SleepAnalysisService](app/src/main/java/com/z2846852/bodytrace/SleepAnalysisService.java)、[SleepYamnetClassifier](app/src/main/java/com/z2846852/bodytrace/SleepYamnetClassifier.java) |
| 手机行为睡眠推算 / vivo 实验 | [PhoneSleepInference](app/src/main/java/com/z2846852/bodytrace/PhoneSleepInference.java)、[VivoSleepProbe](app/src/main/java/com/z2846852/bodytrace/VivoSleepProbe.java) |
| 音高、音素、词典 | [voice_lab.js](app/src/main/assets/voice_lab.js)、[VoiceLabController](app/src/main/java/com/z2846852/bodytrace/VoiceLabController.java)、[PhonemeNeuralEngine](app/src/main/java/com/z2846852/bodytrace/PhonemeNeuralEngine.kt)、[PhoneticLexicon](app/src/main/java/com/z2846852/bodytrace/PhoneticLexicon.java) |
| APK/差分/UI 小包更新 | [ApkUpdateManager](app/src/main/java/com/z2846852/bodytrace/ApkUpdateManager.java)、[ApkDeltaPatch](app/src/main/java/com/z2846852/bodytrace/ApkDeltaPatch.java)、[UiBundleManager](app/src/main/java/com/z2846852/bodytrace/UiBundleManager.java) |
| Git 变更与版本历史 | [git_log.js](app/src/main/assets/git_log.js)、[ReleaseHistory](app/src/main/java/com/z2846852/bodytrace/ReleaseHistory.java) |

`MainActivity.java` 和 `index.html` 体量较大，修改跨页面事件时优先定位已有独立 JS/Java 类，避免把所有逻辑继续堆到入口文件。

## 更新、构建与验证

**正式发行路径：** 直接提交 `main` 中的应用、构建脚本或相关工作流文件 → [Android fast workflow](.github/workflows/android.yml) 编译固定签名 APK → 签名及 APK 资源检查 → [GitHub Release](https://github.com/z2846852/mywork/releases/latest) 发布成功 → **自动写回根目录 [`build-status.json`](build-status.json)**。

- **版本号**使用 `0.2.<GitHub Actions run number>`；发布标签为 `v0.2.<run number>`。每次**成功发布 Release 之后**，Actions 使用当前令牌将 `build-status.json` 写入 `main`，记录 `status: published`、`version`、`version_code`、`run_number`、`run_id`、`source_commit`、`published_at`、`actions_url`、`release_url`、`apk_download_url`。发布失败或编译失败**不得**写入成功状态。
- 安装包 `BodyTrace-release.apk`；支持以已安装 APK 为基准的 `.btpatch` 差分升级，也可从更新页手动导入本地 `.btpatch` 离线还原并安装（首次使用须先安装含该入口的新版 APK）；校验还原后 APK 的 SHA256、包名、版本及证书。校验不满足时改用完整包或报告错误，绝不安装未验证文件。
- 纯前端变化可使用 `BodyTrace-ui.zip` 小包；**仅当原生指纹兼容且每个文件哈希均通过**才允许覆盖 WebView 资源，否则回退 APK 内置 UI。新增 Java 桥接/原生权限/模型运行时需要完整 APK。
- ZIPA 模型权重**不内置 APK**：在声音页按需一次下载缺失资源，三种模型可单独选择/删除，下载与安装检查 SHA256。内置英文 IPA/中文释义词典在打包时生成，缺失应修复 APK，不伪造结果。
- 主要模型：ZIPA 300k 和 500k（**CC BY 4.0**），NS 700k（**CC BY-NC-SA 4.0，限非商业用途**）；相关出处见 [ZIPA](https://github.com/lingjzhu/zipa) 和 [AnySpeech](https://huggingface.co/anyspeech/models)。YAMNet 用于睡眠声学分类，不能作为医疗检测。
- [nightly-tests.yml](.github/workflows/nightly-tests.yml) 每夜运行回归，也可手动运行；声音模型发布有独立的 [voice-models.yml](.github/workflows/voice-models.yml)，不会替代正式 APK。**有失败的测试必须如实报告，不将“发布成功”称为“全部测试通过”。**
- `README.md` **仅修改文档时通常不会触发 APK 出包**，因为 `android.yml` 使用了路径过滤。这是预期行为；需要新 APK 时应有实际程序改动或用户明确手动触发工作流。

### APK 版本查询与交付核对（后续窗口必须遵循）

1. 用户要求“完成后告诉我版本号”或需要核实出包时，**先读取 `main` 的 [`build-status.json`](build-status.json)**，获取最新一次**成功发布**的具体版本号、`run_id`、`source_commit` 和带版本标签的 APK 下载地址；**不要**只根据最近一次代码提交或猜测 Actions 编号报版本。
2. 比较 `source_commit` 与本次功能提交是否有包含关系（可用 Git Compare）；**状态文件的 HEAD 提交是发布记录，不是构建 APK 的源提交**。若状态仍对应旧代码，必须说“新版本尚未证实发布”，不能把旧版号报告为本次新版。
3. 通过状态中的 `release_url` 与 `apk_download_url` 交叉核对是否存在对应 Release 和资产；需要确认正在运行/失败的构建时再查 `actions_url` 或 Actions 页面。此 JSON 仅记录**最近一次成功发布**，不能证明没有后续排队、失败或取消的运行，也不能证明真机安装成功。
4. 若状态文件缺失、暂未更新、无法读取或与 Release 不一致，改查真实 Release/Actions；仍查不到时直接说明“版本号/构建状态无法确认”，**绝不编造**。首次写入依赖此工作流成功执行；不会凭空回填过去的版本。
5. 写回仅在发行成功之后进行，采用 GitHub Contents API 的 `sha` 乐观并发重试；`build-status.json` 与 README 均不在正式 APK 的 push 构建路径过滤中，避免状态写回触发无限打包。
- 公共仓库内的固定签名材料是个人实验的**公开签名**，不能据此证明发行来源可信。Android 仍可能要求用户确认安装未知应用；不要依赖无交互静默安装。

### 更换窗口时的操作顺序

1. 读本 README，确认用户当前要求的默认行为与目标。
2. 检查 `main` 的实际源码和数据协议，**不要按旧聊天或历史版本补写不存在的功能**。
3. 只在 `main` 修改所需文件；不擅自建立 PR、功能分支或隐藏功能。
4. 根据修改类型执行相称的测试，提交后**优先读取 `build-status.json`**，检查 `source_commit` 和本次修改的对应关系，必要时核对真实 Actions / Release 结果；分别说明代码提交、构建、发布、真机测试各自状态；确认成功时给出**实际版本号**。
5. 若改变了页面默认行为、数据结构、更新机制、主要算法或工作流，同步维护本 README 的相关段落，**直接替换过期描述**。

## 重要边界与已知不确定项

- 睡眠行为推算只是手机事件推断；录音中的“鼾声候选”和模型分数并不等于医学确诊。读取 vivo 健康私有接口会受 ROM/权限影响，未经实机验证不能宣称可用。
- 音高 YIN 与 ZIPA 音素模型的声学推断均有局限；IPA 字典匹配不等于发音标准，普通话声调和完整汉字识别不应由英语词典结果推测。
- 麦克风权限仅在相关录音/声音实验场景使用；后台录音按 Android 前台服务及实际权限要求运行。录音默认留在设备本地，不默认上传 GitHub。
- 用户数据迁移、签名一致性、升级中断恢复、断网同步和实际 vivo 输入法交互需要真机验证。**当前结论始终以最新代码和真实运行证据为准**。

## 历史与来源

长期保留且优先参考的历史是 [main 提交记录](https://github.com/z2846852/mywork/commits/main) 与 [Release 历史](https://github.com/z2846852/mywork/releases)。README 不再保留按日期排列的几十个历史更新章节。需要考察特定版本为什么变化时，使用 GitHub Commit / Compare 和对应源码，避免历史叙述与当前行为互相矛盾。
