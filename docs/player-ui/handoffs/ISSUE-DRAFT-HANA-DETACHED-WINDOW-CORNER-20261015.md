[Bug] Windows 独立窗（detached）四角露出主题卡面色，App 侧已不画圆角仍复现

<!-- 按 .github/ISSUE_TEMPLATE/bug_report.md 整理。本仓库只接受 Agent 排查报告，且不含修复建议。 -->

**环境信息**
- OS: Windows 10 (10.0.19045)
- HanaAgent 版本: 1.1.0-beta win32-x64（复现时 1.0.4-beta，两版 app-window 创建代码一致）
- 使用的 Agent 及模型: HanaAgent 内置 DeepMind（统筹）/ 码农（执行）

**问题清单**

1. Windows 上，v2 App 的独立窗（manifest `contributes.cards[].detached`）在「浅色主题 + 深色内容」时，窗口四角出现一小块浅色（`#FCFAF5`）。该颜色等于当前主题的卡面色 `--bg-card`，不是纯白。

2. 同一 App 在 macOS 同场景下四角干净，仅 Windows 出现。

3. 对照组：App 完全不再自画圆角后，同一 App 的**聊天卡片**形态白角消失，**独立窗**形态白角依旧。

4. 关掉独立窗后重新弹出，问题依旧。

**复现步骤**

1. 主题切到浅色（warm-paper）。
2. 打开小花音乐播放器（`hanako-simple-player`）的独立窗（`contributes.cards[].detached`，`detachedDefaultSize` 1040×780）。
3. 播放一首深色封面的曲目。
4. 观察窗口四角。

**期望行为 vs 实际行为**
- 期望：独立窗四角不出现与内容无关的浅色块。
- 实际：四角出现一小块 `#FCFAF5`（主题卡面色），压在深色内容上一眼可见。深色主题下不可见。

**证据**

两组关键对照：

- 对照一（承载形态）：App 侧已完全不画圆角（原 `ui/style.css` 的 `.player { border-radius: 14px 14px 0 0 }` 及其 `--hk-surface` 垫层依赖已移除，圆角全部交给宿主）后 —— 聊天卡片白角**消失**，独立窗白角**依旧**。
- 对照二（独立窗 session）：关掉独立窗重新弹出，问题**依旧**。独立窗跑在 `partition: app-window:<windowId>`，新窗口即新 session，排除旧样式缓存。

像素采样：

整窗截图 1042×781（等于 `detachedDefaultSize` 1040×780），沿各角对角线采样（JPEG，有压缩噪声，看趋势）：

| 位置 | 左上 | 右上 |
| --- | --- | --- |
| 第 0 像素 | `#FCF6F6` | `#FFFEFF` |
| 第 1 像素 | `#EBE5E5` | `#464145` |
| 第 2 像素 | `#A8A4A3` | `#161115` |
| 第 3 像素 | `#A2A19F` | 深色 |
| 第 4 像素 | `#A0A0A0` | 深色 |
| 第 5 像素 | `#0A0A0A`（深色） | 深色 |

左下 / 右下被 App 自己的控制条覆盖，无深色对比。

左上角放大图（PNG，无压缩噪声）：最亮像素为 **`#FCFAF5`**，即主题卡面色 `--bg-card`（`--bg` 为 `#F8F4ED`），**不是纯白 `#FFFFFF`** —— 露出的那层是主题色的面，不是窗口默认白底。

平台差异（读自 `desktop/main.bundle.cjs`，`1.0.4-beta` 与 `1.1.0-beta` 该段代码一致）：

- darwin：`titleBarStyle: "hiddenInset"` + `trafficLightPosition` → 系统原生圆角窗；
- win32：`frame: false` → 无边框方角窗，且未设 `transparent` / `backgroundColor` / `roundedCorners`。
- （另有 `chrome === "custom"` 分支：`frame: false`，darwin 下 `titleBarStyle: "hidden"`。）

App 页面由 `app-window.open` 的 `entryUrl`（`${serviceBase}${entryPath}`，走 `_surface` 会话）加载。

未确认项：圆角外那一笔具体落在哪一层（承载层裁切 / 窗口 chrome 背景 / 窗口底色），未能直接读到；只能确认不在 App 页面内。

**验收方式**

1. 在 Windows 10（10.0.19045）上，主题设为浅色（warm-paper），打开该 App 独立窗并播放深色封面曲目，窗口四角不再出现 `#FCFAF5`（或任何与主题卡面色相同的色块）。
2. 同一 App 的聊天卡片形态维持现状（四角干净），不受影响。
3. 同一台机器切到深色主题时，四角无异常。

**提交前确认**
- [x] 报告由 Agent 实际复现、排查后整理，不是猜测
- [x] 每个问题都可以按上面的步骤复现和验收
- [x] 报告中没有修复建议、补丁、diff、代码实现或实现示例

---

<!-- 以下为本地留档，提交时不带上 -->
<!--
提交时删除本段。删除理由：仓库 CONTRIBUTING.md 明确「所有 Issue 都只描述问题或需求，
不接受代码实现。包括修复建议、补丁、diff、替换代码、实现方案和实现示例。
不符合规则的 Issue 会被直接关闭。」

被移除的「可能的方向」四条（全部是修法，不能进 Issue）：
1. win32 下不对 App 面做圆角裁切（方角窗配方角内容）
2. 或给独立窗设 backgroundColor / 透明
3. Win11 可用 roundedCorners（注意：Electron 文档说明该选项在 Windows 11 Build 22000 之前无效，
   对本环境 Win10 19045 无意义；且 Electron #51278 的修复 PR #51287 只进了 43.0.0，
   本机 macOS HanaAgent 的 Electron 为 42.3.0）
4. 若判定为设计取舍，在文档说明

排重记录：在 liliMozi/openhanako 按「独立窗 / 圆角 / 四角 / detached / 承载层 / corner / frameless / 白边」
检索，state=all，无重复 issue。相关但不重复：#498（任务栏图标方形，已关闭）、#2717（docked 默认宽度，OPEN）。
-->
