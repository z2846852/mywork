# 体迹 · BodyTrace

个人身体数据仪表盘（Android）。在公开的 `mywork` 仓库维护**应用代码与界面**；训练原始记录仍然保留在私有仓库 `z2846852/-`。

**数据保护原则：公开仓库绝不存放真实训练记录、饮食、体重、围度或 GitHub 访问令牌。**

**[直接下载最新测试 APK](https://github.com/z2846852/mywork/releases/latest/download/BodyTrace-debug.apk)** · [源码](https://github.com/z2846852/mywork) · [构建记录](https://github.com/z2846852/mywork/actions)

> 当前构建为测试 APK，使用 Actions 临时 debug 证书。更新版本可能需要卸载后重装，导致本机令牌及未上传队列被清除。后续应改为私有签名密钥存储在 Actions Secrets 以支持直接覆盖安装。

## 接入验收清单

1. 安装 APK，进入「连接」，输入只对私有仓库 `z2846852/-` 有 Contents Read and write 权限的 fine-grained PAT。
2. 「概览」读取私有 `workouts.csv`，应能看到 2026-11-17 的训练日；「身体/饮食」能读已有 `measurements.csv` 的最近指标。App 不会向公共仓库下载你的真实训练数据。
3. 「记录」新增**真实完成**的训练组，App 显示已写入私有 GitHub。
4. 打开 [私有事件目录](https://github.com/z2846852/-/tree/main/data/app_events)，确认有 `YYYY-MM-DD/<uuid>.json`。
5. 私有 [图表工作流](https://github.com/z2846852/-/actions) 成功后，检查新组是否进入 `data/fitness_log.txt` 和 `data/workouts.csv`。
6. 回到 App 点「同步」，确认新组显示在当天日历详情。

**验证状态：** Android Actions 编译、打包、签名校验已通过；私有 Actions 的事件导入器已通过隔离数据单元测试。尚未在你的 Android 真机上验证 PAT 授权与真实网络写回。

## V0.1 核心能力
- Android App 内展示 GitHub 风格的训练贡献日历；按日期查看全部训练组、按动作筛选。
- 通过用户自己创建的 fine-grained GitHub PAT 连接私有仓库；令牌由 Android Keystore 加密保存在本机，不提交到仓库、也不注入前端脚本。
- 从私有仓库 `data/workouts.csv` 和 `data/measurements.csv` 读取真实数据，提供离线加密缓存。
- 录入一组训练后写入私有仓库 `data/app_events/YYYY-MM-DD/<uuid>.json`，并由私有仓库 Actions 导入 `fitness_log.txt`、重建 CSV 和图表。
- 按日期和动作查看历史记录；饮食、围度等模块预留扩展接口。
- 使用 GitHub Actions 构建可下载的测试 APK。

## 使用方式

1. 在 GitHub 设置中创建 **Fine-grained personal access token**，Repository access 仅选择私有仓库 `z2846852/-`；授予 **Contents: Read and write**。不要授予 `mywork` 或其他仓库的写权限。
2. 在应用的「连接」页粘贴令牌并验证。令牌只存于手机受 Android Keystore 保护的应用数据区域。
3. 点击「同步」读取私有训练记录。点击日期即可查看动作和组数。
4. 在「记录」页新增一组，提交后产生独立事件文件；私有仓库的 Actions 导入 CSV，之后再同步即可显示。

## 安全边界

- 不含固定 PAT、OAuth secret 或真实个人数据；没有服务器。
- 仓库是公开的，APK 也可能被其他人下载，但没有你的令牌就无法访问私有数据。
- V0.1 使用 Android Debug 签名，仅用于个人测试；不同构建可能无法覆盖安装。**不要将测试版当作生产级安全产品。**
- 短期个人自用采用手动粘贴限定权限的 PAT；以后可升级为 GitHub App OAuth + PKCE。
- 如果发生令牌泄露，立即在 GitHub 撤销该令牌。

## 构建

参考私有 `better` 仓库的原生 Java + Gradle + GitHub Actions 构建方式。Java 17、AGP 8.7.3、Gradle 8.9、Android SDK 35。

在 [Actions](https://github.com/z2846852/mywork/actions) 的 `Build BodyTrace Android APK` 找到构建结果，在 Artifacts 中下载 APK。

## 后续模块

`workout`（训练）→ `nutrition`（饮食）→ `body`（围度/体重/体脂）→ `dashboard`（跨模块趋势）。

后续通过共享版本化 JSON schema 接入不同数据类型，避免所有业务耦合到 `fitness_log.txt`。

## 数据流

```
ChatGPT (GitHub connector) -------> Private z2846852/-
                                        ^
BodyTrace (encrypted local PAT) --------|
            | PUT data/app_events/YYYY-MM-DD/{uuid}.json
            v
Private Actions: import_app_events.py -> fitness_log.txt -> workouts.csv
            ^
            |
BodyTrace GET private CSV -> local graph / calendar

Public mywork: Android source + build + demo (NO PERSONAL DATA)
```
