代码审查发现了几个问题，请修复。**附件是项目里现在的 index.html、style.css、app.js，请以附件为准**：工程师在你上一版的基础上加了三项（「捞出来」成形后才升为主按钮、「再冲一张」先确认、揭晓蓄力），还改了存相册的成功记录。

## 要修的问题（行号对应附件 app.js / style.css / index.html）

**重要**
1. **卡册缩略图会显示错卡**（app.js 约 1235、1353 行）：连续揭晓两种材质后，两个格子都显示照片但只有本轮能点；同一种材质冲了两轮、第二轮缩略图没生成出来时，带「本次」的格子显示的是上一轮的照片。请把缓存绑定到「轮次 + 材质」，**只有本轮揭晓的那张显示缩略图并且能点**，其他格子一律显示材质底图；本轮没生成成功就回退到材质底图。
2. **缩略图用键盘打不开**（约 1243 行）：Tab 能聚焦，但 Enter 和空格没反应。请用原生 `<button>`，并保留可见的焦点样式。
3. **从卡册回看本轮小卡会回到卡背**（约 1250、1454 行）：从出片页进卡册、点本轮缩略图，又要重新揭晓一次，存卡也要再揭晓；关闭后焦点还给了已经隐藏的缩略图。请回看时直接显示已揭晓的正面，存卡按钮可用；关闭后把焦点还给出片页的「暗房卡册」按钮。打开小卡时仍要走 `openCard` 里 `cardState.openSeq` 自增和陀螺仪启动这两处，不能绕开。
4. **减少动态效果时药液还在动**（约 654 行）：系统开了「减少动态效果」后，不晃手机时药液的 transform 仍然每帧变化。请在 `prefers-reduced-motion` 下保持静态液面，药水流动读数照常更新。

**次要**
5. **深色「领取暗房小卡」的键盘焦点看不见**（style.css 约 499 行）：焦点内圈和底色对比只有 1.06:1，请换成能和底色区分的焦点环。
6. **首页第一次按 Tab 落在透明的文件输入框上**（index.html 约 59 行，style.css 约 44 行）：可见的「选一张照片」没有焦点提示。请让输入框聚焦时，标签显示焦点样式（比如把 input 放到 label 前面，再用相邻选择器）。
7. **矮屏点击区不足**（style.css 约 1282、1286 行）：视口高度 ≤440px 时，「返回」「卡册」「关闭」只有 36px，「存这张小卡」40px。请保持 44px 点击区，靠缩小周围留白来省空间。
8. **卡册「本次」徽标对比度不够**（style.css 约 1205、1209 行）：白字红底跟着父层 0.85 的透明度一起变淡，浅色卡面上约 4.1:1。请只降低编号文字的透明度，徽标保持不透明。
9. **显影循环里每帧重复写同一个 class**（app.js 约 669、681、692 行）：手势提示和读数容器静置时每帧都写一次相同的 className；自动水波纹每次读两次 `getBoundingClientRect`。请只在状态跨过阈值时写 class；自动水波纹直接用波纹层内的百分比坐标，不要读布局。

## 不能动的代码

- 原来那 21 个函数照旧一行不改：`pickMaterial`、`collectMaterial`、`persist`、`saveCount`、`saveCards`、`refreshCollectionViews`、`loadSaved`、`lightsOn`、`bindTrayRub`、`bindFix`、`startDevelop`、`stopDevelopLoop`、`stopAllGyro`、`startCardGyro`、`stopCardGyro`、`ensureCardShot`、`saveCard`、`releaseBusy`、`again`、`savePhoto`、`postNote`。
- 新增的也不要改：`bindAgainConfirm`、`triggerReveal` 里的蓄力时长和光晕时机、`tick()` 里 `pullBtn` / `pullCls` 那几行、`boot()` 里 `visibilitychange` 处理中的 `stopCardGyro()` / `startCardGyro()`。
- 那几处单行照旧保留：`openCard` 里的 `cardState.openSeq` 自增，`finishReveal` 里的 `saveBtn.disabled = state.busy`，`renderCardContent` 里的 `state.shotNo || state.count`，`openBinder` / `closeBinder` 里调用 `stopCardGyro()` / `startCardGyro()` 的两行。
- 保留所有现有 id 和 `setCardTilt(nx, ny)`。约束照旧：离线、ES2017、Chrome 61 回退写法、不新增图片文件、只用系统字体。

只输出有改动的文件，每个给完整文件，代码块前一行写文件名。最后简短说明每个问题怎么修的。
