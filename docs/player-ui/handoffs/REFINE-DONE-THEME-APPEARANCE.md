# 主题注入按「Hana 当前主题」而非「系统深浅」——两个 bug 同一根因

> 起因：Windows 用户反馈两个现象同时出现 —— ① 深色卡面上左上/右上 14px 圆角处露出近白补丁；
> ② 强调色不是 Hana 当前主题（midnight）的藕荷粉，而是暖纸主题的远山蓝。
> 定位报告给到「初始主题注入按系统深浅选色」的根因；本仓核对源码后确认成立并修复。

## 一句话

初始注入原来把宿主给的两套调色板分别塞进 `@media (prefers-color-scheme: light/dark)`，
**等于用操作系统的深浅决定 App 用哪套色，而不是用 Hana 当前主题**。
宿主早在 iframe URL 里给了权威答案 `hana-theme-appearance`，App 从头到尾没读过它。

## 根因链（源码逐条核对）

```
系统浅色 + Hana=midnight
   └─ App 注入 warm-paper（老实现命中 prefers-color-scheme: light）
        ├─ --accent = #537D96                       → bug ②（颜色不跟随）
        └─ --bg-card = #FCFAF5（近白）
             └─ --hk-surface: var(--bg-card, …)          ui/style.css:46
                  └─ .frame { background: var(--hk-surface) }   ui/style.css:239
                       └─ .player { border-radius: 14px 14px 0 0 }
                            └─ 只有上两角让 .frame 露出来 → 深色卡面两块近白补丁 → bug ①
```

角上就该露卡面色（`.frame` 用 `--hk-surface` 而不是页面色 `--hk-bg`）——**设计是对的**，
错的是喂进去的调色板。所以修注入，两个 bug 一起消失。

## 宿主侧已核实

desktop renderer 里唯一的构参函数（卡片与独立窗共用，`PlanModeButton-*.js`）：

```js
function hc(e,t,n,i){
  e.searchParams.set("hana-theme", i);
  e.searchParams.set("hana-css", In(t,n,i));            // 当前主题
  const r = ei(i);                                       // 当前主题的 appearance（查表）
  if (!r) return;                                        // ← 真·auto（查不到）直接 return
  const o = r==="light" ? i : en("auto",false).concrete; // warm-paper
  const s = r==="dark"  ? i : en("auto",true).concrete;  // midnight
  e.searchParams.set("hana-theme-appearance", r);        // ← 权威：'light' | 'dark'
  e.searchParams.set("hana-palette-light-theme", o);
  e.searchParams.set("hana-palette-light-css", In(t,n,o));
  e.searchParams.set("hana-palette-dark-theme", s);
  e.searchParams.set("hana-palette-dark-css", In(t,n,s));
}
```

- `ei` = 主题表查 `appearance`（`sF`：`rr[theme]?.appearance ?? null`）。
- 主题表里 `midnight.appearance = "dark"`、`warm-paper.appearance = "light"`、
  `auto` 是个只有 id/i18nName 的伪主题 → **查不到 → return**。
- 所以「真·auto」时宿主**根本不发 palette 那对参数**，给的是 `theme.css?theme=auto`；
  服务端 `basename().replace(/[^a-zA-Z0-9_-]/g,"")` 取文件，取不到回 `/* theme not found */`。
- 服务端把 `hana-theme / hana-css / hana-theme-appearance / hana-palette-*` 列进
  「不转发给 App 后端」白名单 —— 正式契约参数。

## 改动（4 处）

| 文件 | 改动 |
|---|---|
| `ui/app.js` 顶部 | 新增 `HOST_APPEARANCE`：读 `hana-theme-appearance` 落到 `<html data-appearance>`（尽早，主题样式表回来前也能读到） |
| `ui/app.js` `injectHostTheme()` | 初始分支改成**无条件注入 `hana-css`**（= 当前主题，不包 media）。palette 对只作老宿主兜底，且按 `hana-theme-appearance` 选，仍不看系统深浅 |
| `ui/app.js` `themePolarity()` | 优先读 `data-appearance` → 主题字面量 → 按实际底色 `--hk-surface` 亮度算 → 最后才退系统深浅。新增 `syncAppearance()`，挂进 `applyTone()` |
| `ui/style.css` | 新增 `:root[data-appearance="dark/light"]` 覆盖 `--hk-on-accent`（压在强调色上的字），press 过 `@media (prefers-color-scheme: dark)` 里的同族写法 |

### 为什么 `themePolarity` 的修法按「实际底色」而不是只读 URL

`data-appearance` 直接取 URL 值最简单，但**运行时换主题后它是陈旧值** ——
SDK 推的 `THEME_CHANGED` 载荷里只有 `theme` / `cssUrl`，没有 `appearance`。
所以落地时按实际生效的底色算：宿主注入的主题样式表会定义 `--bg`（App 自己只消费、不定义），
「`--bg` 有值」即主题已生效 → 读 `--hk-bg` 判亮度。读不到才退 URL 给的 `HOST_APPEARANCE`。
自动跟上换主题，不需要等 SDK 补字段。

### 连带修的一个同族问题（报告 §8 之外）

`--hk-on-accent`（播放键字形、选中态 tab、主按钮文字等的颜色）原来也只在
`@media (prefers-color-scheme: dark)` 里切成深字。同一触发条件下，浅色主题的强调色（远山蓝）
会被配上近白字、深色主题的强调色（藕荷粉）也可能错配 —— 对比度掉到约 2.2。
现在由 `data-appearance` 说了算。

## 验收

`node tools/verify-ui.mjs`：

- **新增/改判** 三条主题断言：
  - `theme-real-host-shape-uses-current-theme`：真实宿主形状（同时给 `hana-css` + palette 对 + appearance），
    系统浅色 + 主题深色 → 必须用当前主题那套（body `#3B4A54` / accent `#C99AAF`）+ `--hk-on-accent` 深字
    + `data-appearance="dark"`。**这条旧实现必挂**（旧实现会挑 palette-light 那套）。
  - `theme-palette-follows-appearance-not-macos`：只给 palette 对时，系统浅色/深色切换**结果不变**，
    都取 appearance=dark 那套。
  - `theme-palette-light-despite-macos-dark`：系统深色 + appearance=light → 取浅色那套 + 近白 on-accent。
  - 原 `theme-palette-follows-macos` 删除（它固守的就是错误行为）。
- 夹具 `theme.css` 分支 `/dark/` → `/dark|midnight/`（顺手让 `midnight*` 走深色那套）。
- 布局 12/12、窄卡 4/4、`runtimeErrors: []` 未受影响。

## 未做 / 待办

- **Creator 模板可能同病**：本 App 的初始注入注释原写「按 Creator 模板的方式」。
  已查 `~/.hanako/skills/hana-app-creator/`，技能文档第 279-285 行只说
  `hana.theme` 可能暴露 `appearance` + `palettes.light/dark`，「consume these URLs as issued」，
  **没有给 prefer-color-scheme 的具体写法**（本仓那套是历史自造）。所以暂时不判定模板有病，
  但任何按「palette 对 + `@media prefers-color-scheme`」写的 App 都有同一颗雷 —— 值得留意。
- **真机复核**（用户侧）：
  1. 系统浅色 + Hana midnight → 新开卡片**不要重设主题** → 青夜色 + 上两角无近白补丁。
  2. 系统深色 + Hana warm-paper → 暖纸色 + 角上补丁为 `#FCFAF5`。
  3. Hana 里切主题 → 立即跟随（这条本来就通，别改坏）。
  4. 独立窗 ↔ 嵌入卡来回切 → 颜色与圆角一致。

## 相关

- 知识库：`20-资料/Hana App 卡片UI-主题变量与存储接线.md`「初始注入绝不能用系统深浅挑主题」一节
- 同一 App 的呈现层：`REFINE-DONE-AMBIENT.md`（封面环境色 / 顶部圆角 / `.frame` 露卡面色）
