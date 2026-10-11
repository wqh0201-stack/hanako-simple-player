# ETE 沉浸播放页与歌词阅读轴 · 实施交接

> 2026-10-11 · 从 `hana-simple` / `be18200` 开工，版本保持 **1.0.0**。
> 构建 **1003131649**。源码与自动化验收已完成。**未部署、未 reload、未 push**。

## 实际改动

- `manifest.json`：`cardForm: "edge-to-edge"`、`titleMode: "hide"`、`minAppVersion: "0.1017.0"`，移除旧 `titlebar`。注册名称、version、权限、整个 network 配置（含 `*.mountaintoys.cn`）保持原样。
- `ui/index.html` / `ui/standalone.html`：环境色、晖开封面、封面本体与歌词薄纱放入一张贯通的 `#playerBackdrop`；既有 id 保留。孪生仍只差 `body data-shell`。
- `ui/app.js`：封面按完整播放器高度计算；宽窗阅读轴使用原有比例曲线，移除 `coverW * 0.72` 推右规则；窄卡固定为窗口宽的 38%。竖图的羽化终点收在图片内部。
- `ui/style.css`：主题底色 82% + 20px 模糊的玻璃背景只画在控制条伪元素。控制层固定在 z35，整体高于队列 z30、搜索 z22；匹配弹窗/首次提示仍高于它。音量浮层保留原 DOM 与交互，通过真实命中测试。
- 显隐只改变工具层 opacity / visibility / inert，不改底栏占位高度、背景尺寸和歌词矩形。隐藏后不绘制玻璃，也不拦截点击或键盘焦点；恢复约 100ms，淡出 200ms，reduced-motion 无过渡。
- 搜索退场完整结束后才恢复玻璃，并同步 `data-search`；退场过程中再次打开可打断旧回调。ETE 搜索页与矮卡队列顶部留 40px，避开宿主悬浮操作；宽窗队列保留已有 56px 顶部留距。
- `tools/play.js` 已核对，浓缩聊天卡 `details.card` 保持原声明。`?view=compact` 不启用完整播放器的玻璃/自动隐藏，也不强改其承载形态。
- 原始讨论简报完整归档为 `IMMERSIVE-ETE-BRIEF.md`；其旧基线记录不是本次实际开工基线。

## 显隐行为

鼠标留在窗口内，即使静止也一直显示。可确认离开整个 iframe 视口时开始 **3000ms**，到点再检查播放/搜索/操作状态；进入、点击、键盘输入和窗口重新获得焦点立即唤回。

暂停/停止、无封面、搜索打开/退场、队列展开、菜单、歌词匹配/对齐、音量浮层、指针按住拖动、键盘焦点都守住控制条。保护结束且鼠标仍在外面时重新计满三秒。观察器只订阅相关容器状态，不观察逐字歌词的每帧 class 更新。

用户反馈普通出窗不隐藏后，收窄了过宽的坐标过滤，并在鼠标回到内容区时结束旧键盘保护。延时按用户后续确认改为 3 秒；细节与本次部署提示见 [出窗计时修正](IMMERSIVE-ETE-AUTOHIDE-FIX.md)。

## 自动化与截图

- UI：**212/212**，保留开工时 **171** 条，新增 **41** 条；12/12 布局自检、4/4 窄卡自检、0 运行时错误。
- 后端：**22/22**。
- 额外复核：reduced-motion、常驻队列菜单、搜索页安全区、矮卡返回键安全区与点击命中均通过。
- 方/横/竖图在相同窗口下得到一致的阅读列几何：

| 窗口 | 阅读列起点 | 阅读列宽度 |
| --- | ---: | ---: |
| 1040×780 | 538px | 482px |
| 910×600 | 466px | 424px |
| 465×930 | 177px | 268px |
| 312×494 | 119px | 173px |

测试包含真实窗内静止与真实 3 秒出窗计时；其他保护/竞态用可控的 3000ms 队列推进，音频、动画与布局仍走浏览器实际行为。音量在队列/搜索上的 `elementFromPoint` 命中测试全部保留。

官方校验：显式设置 `HANA_APP_TOOLS_ROOT` 指向当前 server artifact 后调用官方 `validate_app.mjs`。仓库路径仅出现已知目录名不匹配 `INVALID_MANIFEST`；将同一份源码复制到临时 `hanako-simple-player` 目录后，官方结果 **ok:true，0 errors**，仅一条通用 `DYNAMIC_DEPENDENCIES_NOT_PROVEN` warning。

截图与验收记录已归档到 `assets/ete/`。这些是浏览器夹具，未包含 Hana 原生浮动标题栏。

- [方图 · 浅主题玻璃](/Volumes/SSD/hanadesk/hanako-audio-player-simple/docs/player-ui/assets/ete/ete-square-glass-1040x780-light.png)

- [底栏隐藏 · 全高背景](/Volumes/SSD/hanadesk/hanako-audio-player-simple/docs/player-ui/assets/ete/ete-hidden-1040x780-light.png)

- [横图 · 深主题玻璃](/Volumes/SSD/hanadesk/hanako-audio-player-simple/docs/player-ui/assets/ete/ete-landscape-glass-1040x780-dark.png)

- [竖图 · 稳定阅读列](/Volumes/SSD/hanadesk/hanako-audio-player-simple/docs/player-ui/assets/ete/ete-portrait-glass-1040x780-dark.png)

- [搜索 · 主题色与顶部安全区](/Volumes/SSD/hanadesk/hanako-audio-player-simple/docs/player-ui/assets/ete/ete-search-solid-1040x780-light.png)

- [窄卡 · 播放](/Volumes/SSD/hanadesk/hanako-audio-player-simple/docs/player-ui/assets/ete/refine-312x494-light-lyrics-on.png)

- [窄卡 · 搜索](/Volumes/SSD/hanadesk/hanako-audio-player-simple/docs/player-ui/assets/ete/search-header-narrow-312x494-light.png)

- [验收记录](/Volumes/SSD/hanadesk/hanako-audio-player-simple/docs/player-ui/assets/ete/verification.json)

## 尚需 Hana 真机验收的边界

**鼠标经过宿主浮动按钮后直接出窗，以及从按钮区域入窗/点击**仍需验证。App 位于 iframe，顶部 40px 带有效位置的 `pointerleave` 被当作覆盖层交接而忽略，防止“停在宿主按钮上三秒就隐藏”。但是宿主按钮接管指针后，iframe 可能收不到下一次真正出窗通知。公开 SDK/契约未找到原生窗口指针进出信号；没有读取私有宿主 DOM、也没有自造桥。若宿主不发对应通知，从按钮区域出窗可能保持显示，隐藏后只进入按钮区域也可能尚未唤醒；因此完整原生窗口边界仍未验收。

从内容区直接出窗、重新进入、点击、焦点恢复的浏览器行为已经验证。不会改成“离开底栏计时”，也不会把宿主按钮误判为窗外。宿主窗口控件本身不参与本轮自动隐藏。

还需真机核对：新建/已有卡片、已有/新建拆窗、钉回；应用名隐藏与 ETE 采纳；亮暗封面的宿主按钮可读性；真实滚动/拖动；续播与 offset；涟漪和模糊共同运行的流畅度。旧 binding 若保留历史形态，要区分新卡声明与旧绑定，不由 App 擅改宿主数据。

## 给统筹线 / Hana 的执行提示词

请在取得共享工作树的独占部署时段后，基于本线最终提交进行部署与真机验收。先阅读本交接和原简报，确认 HEAD/build；版本保持 1.0.0，不覆盖新网络白名单。整包同步 UI，并同步本轮 manifest；按项目正式流程 reload `app:hanako-simple-player`，处理宿主要求的清单审批。仅同步 UI 无法应用 ETE 声明。

请检查完整卡片、新旧拆窗与钉回：背景顶到上下沿，应用名消失，宿主操作可用。重点实测“内容区出窗 → 三秒隐藏”“进入/点击/切回唤醒”“鼠标移到宿主顶部按钮并停留 → 不隐藏”“从宿主按钮区域直接出窗 → 三秒隐藏”“隐藏后从顶部按钮区域入窗/点击 → 立即唤醒”。记录这些顶部区域的进出与点击是否能被 iframe 感知；若不能，请查找官方支持的原生窗口进出事件并给出明确契约，不能使用私有 DOM、非公开桥或改成离开底栏计时。

再验暂停、搜索完整退场、进度拖到窗外、音量拖动、菜单、歌词长按对齐、键盘焦点均不被隐藏；搜索按钮不碰顶部宿主安全区；显隐不改变封面/歌词几何；同窗大小方/横/竖图阅读轴一致。真机截图和实际构建号交回统筹线，Release/市场登记由统筹线统一处理。
