# 暗房冲印店 · 界面优化（交给前端 AI）

> 状态：2026-11-22 按方案 A 和文中「Claude 建议」交给 Gemini 实现，Claude 已落盘并提交（`c9215d2`），Kaisa 2026-11-23 看过说「可以先这样」。下面是当时的说明原文；发给 Gemini 时附的「线框文字版」也收在这里。

## 你是谁、做什么

你是这个项目的前端实现者，负责 HTML / CSS 和界面交互 JS。
产品是小红书 App 里的离线 H5 小工具「暗房冲印店」，手机竖屏。流程：选一张照片 → 在红灯下晃手机或用手指划药盘显影 → 按住 4 秒定影 → 开灯出片 → 存相册 / 发笔记 → 拆一张镭射小卡，收进暗房卡册。
文件：index.html（结构）、style.css（样式）、app.js（流程和交互）、bridge.js（容器能力封装，不改）、film.js（图像处理，不改）。工程师会附上前三个文件的最新版本，以附件为准。
附件里还有黑白低保真线框图。线框只表达结构和信息层级；配色、质感沿用现有的暗房风格，不要做成黑白。

## 这一轮要解决的问题

用户反馈两点：
1. 出片页底部「暗房卡册 · 3/6 · 再冲一张」像一行页脚，看不出能点，两个入口长得一样，找不到「再冲一张」。
2. 文案像说明书：说得多、有重复、靠文字教人操作。要少说废话；能用组件状态和交互表达的就不写字；留下的字只给极简指令或情绪。

设计原则：借鉴 Apple / Linear 的理念（内容优先、克制、一致、动效有目的），保留暗房身份，不要改成它们的样子。

## 线框文字版（每屏自上而下）

- 首屏：右上容器胶囊 | 品牌行 DARKROOM LAB · 35MM | 标题「暗房冲印店」| 一行副标题 | 药盘里的示例底片（占主要高度）| 主按钮「选一张照片」（相机图标）| 次按钮「试试示例底片」| 状态行平时不占内容，只在读图中或失败时出现
- 显影（画的是刚好时）：步骤条 01 显影 / 02 定影 / 03 开灯 + 右上胶囊 | 药盘（相纸；静止时中间出现手势引导；刚好时药盘边缘透暖光）| 读数条：左边红点 + 计时，右边「药水流动」进度条 | 一行短提示 | 「捞出来」按钮（刚好时实心并轻呼吸）
- 定影（画的是按住中）：步骤条（02 高亮）| 药盘 | 说明行默认不显示 | 长按按钮，按钮本身从左往右填充进度，文字居中 | 松手但没做完时，按钮下方才出现警示行和次按钮「就这样开灯」| 完成后，长按按钮原位变成「开灯」
- 出片（方案 A）：左上「卡册 3/6」胶囊（四宫格图标），右上容器胶囊 | 相纸（居中，视觉中心，可点）| 一行小字回执 | 一排两个按钮：存到相册（主）、发一篇笔记（次）| 「拆一张暗房小卡」深色按钮 | 「再冲一张」描边胶囊，单独一行居中 | 状态行
- 全屏预览（新）：背景压暗 | 左上 44px 关闭按钮 | 相纸放大居中 | 底部很淡的「轻点退出」
- 小卡：顶栏「返回相纸」「卡册 2/6」| 卡片 | 材质说明 +「新收入卡册」| 一行提示 | 「存这张小卡」
- 卡册：不变

## 逐屏改动

### 1 首屏
- 副标题改成一行：「红灯下，亲手洗出你的胶片」（index.html 的 .intro-sub）。
- 次按钮文字改「试试示例底片」（#use-sample）。
- 删掉常驻状态行「红灯亮了，开灯前看不清颜色。」（initIntro 里设这句的地方改为空）。#intro-status 只在读图中、读图失败时出现。

### 2 显影
- 步骤条、药盘、计时、药水流动条的结构不变；静止 1.8 秒出现的手势引导保留。
- 只留一行短提示（Claude 建议：第一次用的人需要知道能晃手机，快过显时也需要唯一的预警）。删掉 tick() 里「影子出来了，继续晃」「画面差不多成形了，你觉得呢？」两句，保留「再不捞，就只剩轮廓了」。开局那句由工程师改（见文案表）。
- 新增「刚好」手感信号：显影进入刚好区间（state.dev 在 0.9 到 1.12 之间）时，计时旁的红点闪烁变慢，药盘边缘透出一点暖光；离开区间就恢复。不显示秒数，不出字。
- 「捞出来」的文字始终不变，不要改成「显影中…」：早捞是合法玩法，欠显会出珠光卡。成形前描边、成形后变实心的切换已经有了（tick() 里 pullBtn / pullCls 那几行，不能动）。你只加一件事：刚好区间内按钮轻微呼吸（只动 transform / opacity，周期约 1.6 秒）。
- 以上动效在 prefers-reduced-motion 下全部关掉。

### 3 定影
- 按钮上方的说明行默认隐藏（#fix-hint 初始为空，在 pullOut 里设置）。
- 按钮初始文字「按住定影 4 秒」（pullOut 里的 #fix-text）。按住中的倒数、松手、完成这三种文字在 bindFix 里，由工程师改。
- 定影完成后，不要再出现「✓ 定影已完成」和「开灯」两排，改成同一个位置上的一个「开灯」主按钮（暖白）。结构和样式你来做，bindFix 里的切换由工程师按你的结构接上。
- 松手但没做完时，才出现警示行「定影没做完，现在开灯可能留下斑」和次按钮「就这样开灯」（Claude 建议保留这句警示）。

### 4 出片（方案 A）
1. 卡册入口挪到左上角，做成和小卡页「卡册」一样的胶囊按钮：四宫格图标 +「卡册 3/6」，高 44px。沿用 id open-binder-result 和 binder-count-result。
2. 相纸是视觉中心；轻点相纸进入全屏预览（见 5）。
3. 去掉「冲印回执」标题，回执标签压成一行小字，例：「38s · 略过 · 药水流动 4%」（#result-report 的样式）。不新增情绪大标题，相纸上已经印了标题（Claude 建议）。
4. 「存到相册」「发一篇笔记」不变。
5. 小卡入口文字改「拆一张暗房小卡」（每轮在 lightsOn 里重写，工程师改；index.html 里的初始值你改）。本轮还没拆时，按钮上扫过一次流光，只扫一次。
6. 「再冲一张」单独一行居中：带重拍图标的描边胶囊按钮，高 44px。注意 bindAgainConfirm 会改这个按钮的文字，所以按钮里用一个 span.again-text 装文字，图标放在这个 span 外面；工程师会把 bindAgainConfirm 改成只改这个 span。
7. 删掉原来的 .result-sub-row 和中间的圆点分隔。

### 5 全屏预览（新增）
- 出片页轻点相纸进入：其他内容淡出，相纸放大居中，背景压暗；左上角一个 44px 的关闭按钮（aria-label「退出全屏预览」）；底部一行很淡的「轻点退出」，2 秒后淡出。
- 再点一次或点关闭按钮退出，焦点回到相纸。相纸要能用键盘打开（用原生 button 包住，或在相纸上叠一个透明的原生 button）。
- 这是页面内的放大层，不能用 requestFullscreen（平台禁用）。
- 不改成片图片本身，不新增 canvas 绘制。减少动态效果时不做淡入淡出。

### 6 小卡
- 揭晓前的提示改「点击翻开」（openCard 里的 #card-tip，index.html 初始值同步改）。卡背轻轻上下浮动（2 到 3px，周期约 3 秒），翻开瞬间自动扫光一次。
- 揭晓后的提示改「倾斜看光 · 轻点翻面」（finishReveal、openCard 里的 #card-tip；toggleCardFlip 里翻回正面时那句同步改）。
- 其余不变。

### 7 卡册
- 这一轮不改。卡册空槽改成盲盒稀有度预告，依赖「材质随机」，那件事还没定，不做。

## 文案表

| 位置 | 现在 | 改成 | 谁改 |
|---|---|---|---|
| 首屏副标题 | 选一张照片，在红灯下亲手冲洗出来。晃得好不好，决定它最后长什么样。 | 红灯下，亲手洗出你的胶片 | 你（index.html） |
| 首屏次按钮 | 先用示例底片试试 | 试试示例底片 | 你（index.html） |
| 首屏状态行 | 红灯亮了，开灯前看不清颜色。 | 不显示 | 你（initIntro） |
| 显影开局提示 | 晃一晃手机，让药水流过相纸 | 晃手机，或用手指划药盘 | 工程师（startDevelop） |
| 显影中途提示 | 影子出来了，继续晃 / 画面差不多成形了，你觉得呢？ | 删掉 | 你（tick） |
| 显影快过显 | 再不捞，就只剩轮廓了 | 不变 | 不改 |
| 定影按钮初始 | 按住定影（4 秒） | 按住定影 4 秒 | 你（pullOut、index.html） |
| 定影说明行 | 按住不放，让定影液把画面固定下来 | 默认不显示 | 你（pullOut） |
| 定影按住中 | 定影中… 还剩 N 秒 | 定影中 N… | 工程师（bindFix） |
| 定影松手 | 继续按住定影 | 继续按住 | 工程师（bindFix） |
| 定影完成 | ✓ 定影已完成 + 开灯（两排） | 开灯（一个按钮） | 结构你做，切换工程师接（bindFix） |
| 松手警示 | 定影还没做完，现在开灯可能会留下斑 | 定影没做完，现在开灯可能留下斑 | 工程师（bindFix） |
| 出片小卡入口 | 领取暗房小卡 | 拆一张暗房小卡 | 工程师（lightsOn）；index.html 初始值你改 |
| 再冲一张提醒 | 这张还没存，再点一次放弃 | 没拆小卡时：还有一张小卡没拆，再点一次放弃；没存照片时不变 | 工程师（bindAgainConfirm） |
| 小卡揭晓前 | 轻点翻开，看看冲出了什么材质 | 点击翻开 | 你（openCard、index.html） |
| 小卡揭晓后 | 手指划动倾斜赏光 · 轻点翻看卡背 | 倾斜看光 · 轻点翻面 | 你（finishReveal、openCard、toggleCardFlip） |

## 不要做

- 小卡材质改随机、卡册空槽改稀有度预告：没定，不做。
- 出片页加情绪大标题。
- 改成片的图像处理、相纸合成、镭射效果。
- 新增图片文件、外部字体。

## 平台硬约束（违反任何一条都要重做）

- 不联网：禁止 fetch、XMLHttpRequest、WebSocket、EventSource；禁止任何 https:// 外部脚本、样式、字体、图片和 CSS url()。资源全部打包在内，用相对路径。
- 兼容 Chrome / WebView 61：JS 不超过 ES2017，不用 ?.、??、对象展开 {...obj}。CSS 不依赖 flex 的 gap、inset、:focus-visible、aspect-ratio、clamp()、conic-gradient、backdrop-filter；mask 要带 -webkit- 前缀；焦点样式用 :focus。
- 禁用：eval、new Function、WebAssembly、Worker、window.open、window.prompt、navigator.clipboard、geolocation、DeviceMotionEvent / DeviceOrientationEvent、requestFullscreen、iframe、a[download]、target="_blank"、表单跳转提交。
- 持久化不用 localStorage、IndexedDB、Cookie；容器能力只走 bridge.js。
- 系统长按菜单被禁用，交互用 touch / pointer 事件。
- 点击区不小于 44px，正文对比度不低于 4.5:1，所有动效在 prefers-reduced-motion 下关掉。

## 不能动的代码（工程师维护）

- 这些函数一行不改：pickMaterial、collectMaterial、persist、saveCount、saveCards、refreshCollectionViews、loadSaved、lightsOn、bindTrayRub、bindFix、startDevelop、stopDevelopLoop、stopAllGyro、startCardGyro、stopCardGyro、ensureCardShot、saveCard、releaseBusy、again、savePhoto、postNote、bindAgainConfirm、lightRevealAura。
- 这些片段不改：triggerReveal 里的蓄力时长和光晕时机；tick() 里 pullBtn / pullCls 那几行；startCardLoop 里「蓄力被打断时直接揭晓」那一行；boot() 里 visibilitychange 处理中的 stopCardGyro() / startCardGyro()；openCard 里的 cardState.openSeq 自增和 startCardGyro()；finishReveal 里的 saveBtn.disabled = state.busy；renderCardContent 里的 state.shotNo || state.count；openBinder / closeBinder 里调用 stopCardGyro() / startCardGyro() 的两行。
- 保留所有现有 id 和 setCardTilt(nx, ny)；新元素可以加新 id。
- 文案表里「谁改」写工程师的，你不要改，只要保证你的结构能让工程师接上（比如再冲一张按钮里的 span.again-text）。

## 交付

- 只给改动片段：每段写清楚替换哪个函数、哪几行，或插在哪里，给完整代码块；不要整文件。
- 最后列三样：① 每处改动对应上面哪一条；② 需要工程师接的地方（函数名 + 你期望的行为）；③ 确认没碰「不能动的代码」，没违反平台硬约束。

## 附：方案 B（只在选 B 时，替换「4 出片」的第 1、6、7 条）

- 卡册不挪到顶部。底部把「卡册」和「再冲一张」做成并排的两个 44px 胶囊，去掉中间的圆点。
- 左：四宫格图标 +「卡册」+ 浅底数字徽标 3/6；右：重拍图标 +「再冲一张」，字色略深、字重略高。
- 「再冲一张」同样用 span.again-text 装文字。
