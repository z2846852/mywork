# 体迹 · BodyTrace

Android 个人健康与训练记录实验应用：**本地优先，GitHub 按需同步**。未来逐步扩展饮食、体重、围度和力量趋势。参考 [better](https://github.com/z2846852/better) 的 Java + Gradle + GitHub Actions 自动构建方式。

**[下载最新 Android 测试 APK](https://github.com/z2846852/mywork/releases/latest/download/BodyTrace-debug.apk)** · [Actions 构建状态](https://github.com/z2846852/mywork/actions) · [全部版本](https://github.com/z2846852/mywork/releases)

> **注意：测试版每次使用临时 Debug 证书。** 更新 APK 可能需要先卸载旧版，导致本地 JSON、PAT 和未同步训练全部丢失。升级前务必先手动同步到 GitHub。后续应配置固定签名来支持覆盖安装。

## 本地优先架构

- **Android App** 是随时可用的录入、清洗和可视化入口：不联网即可保存新训练组。手机用 Android Keystore AES-GCM 加密保存每日 JSON 数据的本地快照，以及未同步的事件队列。
- **私有 [z2846852/-](https://github.com/z2846852/-)** 保存每天一个 JSON 文件：`data/daily/YYYY-MM-DD.json`。ChatGPT 继续直接写这里。App 只有用户主动点击「同步 GitHub」时才访问它：先上传未同步事件，再下载每日文件并按 UUID 合并。
- **公共 [mywork](https://github.com/z2846852/mywork)** 保存 APK 源码、构建和经用户允许的历史演示快照 `data/demo/*.json`。演示快照不自动同步真实私有仓库，不包含个人备注或 PAT。
- **GitHub Actions：仍负责构建/发布 APK。** 旧 TXT/CSV/SVG 兼容图表流程不是日常录入依赖，也不由 App 自动触发；如需重建旧报表，可在私有仓库 Actions 手动执行。

```text
  [手机 BodyTrace]         [ChatGPT]
        |                     |
        | 本机加密每日 JSON    | 直接提交 JSON
        |                     v
        |  <== 手动同步 ==> 私有 GitHub data/daily/*.json
        |      先推后拉
        v
  Android 本地解析/计算/画图
  （不需要等待旧图表 Actions）

  ChatGPT 改 mywork 源码 → GitHub Actions 构建 APK
```

## 当前已实现

- 无需 PAT、无需联网即可录入训练组；本机记录后立即在训练贡献日历显示。
- 训练日历按照每日组数显示深浅，支持按日期查看所有组、按动作过滤。
- 身体指标及体重、腰围、胸围、体脂的简易趋势图均由 App 从 JSON 本机计算。
- GitHub fine-grained PAT 仅在手机本地 Keystore 加密存储，不随 APK 或公开源码分发。
- 「同步 GitHub」：推送本地待上传组，再读取 ChatGPT 写入的每日 JSON，用每组 UUID 合并，远端同 ID 项优先，本地未上传项保留；写入有 SHA 冲突重试。
- 「解除授权」只清除 PAT，**不删除本地数据和待同步队列**。
- 饮食数据字段 `nutrition` 已预留；饮食录入、营养清洗规则和可视化尚未实现。

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
3. 点击「同步 GitHub」。App 先上传待同步组，再拉取 ChatGPT 录入的每日 JSON，与本地按 ID 合并。检查私有仓库当天文件新增项目。
4. 请 ChatGPT 写入另一组，然后回 App 点击「同步 GitHub」，确认两端都能看到完整记录。
5. 「解除授权」后验证本机数据仍存在、仍可离线录入。
6. 升级测试版 APK 前先同步。**临时 Debug 签名可能导致必须卸载旧版，本机未同步数据将丢失。**

## 范围与验证限制

Android Actions 已用于编译与签名检查；但是 **真机上的 PAT 授权、离线录入持久化、同步及断线恢复仍需实际设备验收**。

V0.1 暂不支持编辑、删除已存在的某一组，也没有跨设备自动同步和后台自动计划任务。当前本地是加密的每日 JSON **集合快照**，不是每一天一个单独的磁盘文件；远端 GitHub 是严格「每天一个 JSON」。大量历史文件时可以再按年份分目录并做增量同步。

## 开发与更新

Java 17、Android SDK 35、Gradle 8.9、AGP 8.7.3。原生 Java + 只加载内置 HTML 的 WebView，本地界面不访问外站，所有 GitHub 网络操作通过原生 Java HTTPS 完成。

源码在 `app/src/main/`，自动构建位于 `.github/workflows/android.yml`。ChatGPT 后续修改界面/新增字段时提交源码，Actions 自动发布新 APK，无需在手机里手动运行图表生成器。
