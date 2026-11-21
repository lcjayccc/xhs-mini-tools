审查任务：darkroom 界面精修（版本 1.3.0 候选），只读审查，不改任何文件，不提交。

## 背景

- 仓库 `F:\AI创作\小红书工具`，先读根目录 `AGENTS.md`（平台硬约束和协作流程）和 `docs/CURRENT.md`。
- 基线是 tag `darkroom/v1.2.0`（提交 `92d29e0`）。本次是工作区里未提交的 diff：`git diff darkroom/v1.2.0 -- darkroom/`，只涉及 `index.html`、`style.css`、`app.js`；`bridge.js`、`film.js` 没动。
- 来历：Claude 和 Gemini 比稿，Kaisa 选 Gemini 版为基线，再移植 Claude 版的三项：
  - 「捞出来」画面成形前是描边按钮，`state.dev > 0.8` 才升为主按钮（`tick()` 里切 class）；
  - 成片没存也没发时，「再冲一张」第一下只提醒，3 秒内再点才调 `again()`（`bindAgainConfirm()`）；
  - 揭晓蓄力：每张卡先 `is-charging` 再翻开，普通 420ms / 特别款 640ms / 棱镜 900ms（`triggerReveal()`）。
- Gemini 版的主要改动：去外发光、统一设计变量和字阶、触控区 44px、对比度修复；出片页按钮重排；药水层挪到红光层之上、晃动时液面起伏和自动水波纹（`tick()`）；显影开始 1.8 秒内没晃动时出现手势提示（`#tray-guide`）；镭射层改 screen 混合、棱镜纹理中央减弱（`getPrismTexture()`）；用 Canvas 画的人像示例底片（`makePortraitSample()`）；卡册显示本轮小卡的缩略图（内存缓存 `cardState.thumbs`），点它回到小卡页。
- 受保护的函数（Claude 维护，要求一行不改）：`pickMaterial`、`collectMaterial`、`persist`、`saveCount`、`saveCards`、`refreshCollectionViews`、`loadSaved`、`lightsOn`、`bindTrayRub`、`bindFix`、`startDevelop`、`stopDevelopLoop`、`stopAllGyro`、`startCardGyro`、`stopCardGyro`、`ensureCardShot`、`saveCard`、`releaseBusy`、`again`、`savePhoto`、`postNote`。Claude 已用脚本逐字比对过这些函数体，一致；请抽查，并重点看这些函数之外、新加或改动的代码有没有绕过它们的约定。

## 审查重点（按优先级）

1. **状态和生命周期**：手势提示、卡册缩略图、揭晓蓄力在「揭晓中途关闭小卡 / 打开卡册 / 切后台 / 再冲一张」时是否正确复位；`cardState.thumbs` 跨轮次会不会显示错卡、点击缩略图回到小卡页时 `openSeq`、陀螺仪订阅、`state.busy` 是否一致；「再冲一张」确认态在离开出片页后是否残留。
2. **显影循环**：`tick()` 里新增的液面动画、自动水波纹、按钮 class 切换的性能（每帧 DOM 写入、`getBoundingClientRect`）和正确性；手势提示的出现和消失条件。
3. **平台红线**：外部资源、禁用 API、ES2017 以上语法、Chrome 61 不支持却没回退的 CSS（flex `gap`、`inset`、`:focus-visible`、`aspect-ratio`、`clamp()`、`-webkit-mask` 前缀、3D 前缀）。
4. **可访问性**：对比度（新设计变量下的正文和小字）、触控尺寸、键盘能否完成全流程、焦点样式、`prefers-reduced-motion` 下蓄力和液面动画是否跳过。
5. **性能**：`makePortraitSample()` 和新棱镜纹理的绘制耗时、是否只生成一次；低端机降级（`.is-low-perf`）在新混合模式下是否还生效。

## 交付格式

- 按严重度分组：阻断 / 重要 / 次要。每条写 `文件:行号`、问题、触发场景（具体操作 → 错误结果）、修复建议，并标注「基线已有」或「本次引入」、「已核实」或「推论」。
- 没有问题的类别写「未发现」，不凑数。
- 审查完成即算成功（outcome succeeded），问题多少不影响 outcome。
