审查任务：darkroom 1.3.0 候选的第二轮修复，只读审查，不改任何文件，不提交。

## 背景

- 仓库 `F:\AI创作\小红书工具`，先读根目录 `AGENTS.md`（平台硬约束和协作流程）。
- 基线是提交 `538527c`（1.3.0 候选）。本次是工作区里未提交的 diff：`git diff 538527c -- darkroom/`，只涉及 `index.html`、`style.css`、`app.js`。
- 内容：上一轮 Codex 审出的 9 条界面问题，规格见 `docs/tasks/T-14-界面精修/gemini-fix-1.md`（行号对应 538527c）。代码由 Gemini 网页版写，Claude 原样落盘。
- 修法摘要：
  1. 卡册缩略图：`cardState.thumbs`（按材质）改为 `cardState.thumb = { round, material, url }`，`finishReveal` 先清空再生成；`renderBinderGrid` 只给「本轮已揭晓且轮次、材质都匹配」的格子贴缩略图。
  2. 本轮格子改原生 `<button type="button">`，CSS 重置按钮样式并加 `:focus` 焦点环。
  3. `openCard(e, opts)`：卡册点本轮格子时传 `{ alreadyRevealed: true, returnFocus }`，直接显示正面、启用存卡，关闭后焦点回出片页「暗房卡册」按钮；`openSeq` 自增和 `startCardGyro()` 照旧走。
  4. `tick()`：`prefers-reduced-motion` 下清掉液面 transform、透明度固定 0.42。
  5. 深色「领取暗房小卡」加亮色内圈焦点环。
  6. 首页 `#pick-input` 挪到 `#pick-label` 前，`#pick-input:focus + #pick-label` 显示焦点环。
  7. `max-height: 440px` 下顶栏按钮和存卡按钮保持 44px，收紧周围内边距。
  8. 「本次」徽标不再随父层 0.85 透明度变淡，只降编号文字透明度。
  9. 手势提示和读数容器只在 class 变化时写；自动水波纹用新函数 `spawnRipplePct` 按百分比定位，不读布局。
- Claude 已做的验证（模拟宿主、桌面浏览器 390×844 / 390×430）：`node tools/check-protected.mjs` 22 个受保护函数和 5 处单行一致；`node --check` 通过；9 条逐条复现修复后的行为（含真实 Tab 和回车键）。

## 审查重点（按优先级）

1. **9 条是否真的修好**，有没有只修了表面。尤其第 1、3 条：再冲一张后进卡册、同材质连冲两轮、缩略图生成失败、揭晓中途打开卡册、从小卡页内打开卡册再点本轮格子、`state.busy` 为真时回看。
2. **有没有引入新问题**：`openCard` 新参数对原有调用（出片页「领取暗房小卡」按钮的 click 事件）是否无副作用；回看正面时光晕、扫光、`cardState.revealedRound` 等状态是否一致；`<button>` 包住 div / p 的卡面在样式和点击区上是否走样。
3. **受保护代码**：抽查 22 个函数和交接文件「受保护的代码」一节列的片段（`docs/tasks/T-14-界面精修/交接.md`）。
4. **平台红线**：外部资源、禁用 API、ES2017 以上语法、Chrome 61 不支持却没回退的 CSS。

本地测试页的用法见 `交接.md`「怎么验证」；`http://127.0.0.1:8732/.review/harness/index.html` 可能已经在跑。

## 交付格式

- 按严重度分组：阻断 / 重要 / 次要。每条写 `文件:行号`、问题、触发场景（具体操作 → 错误结果）、修复建议，并标注「基线已有」或「本次引入」、「已核实」或「推论」。
- 9 条逐条给结论：已修好 / 部分修好 / 没修好。
- 没有问题的类别写「未发现」，不凑数。不改任何文件，不提交。
