新任务：给「暗房冲印店」加一张**镭射小卡**。附件是当前的 index.html、style.css、app.js（已含你上两轮的改动，以及工程师新加的小卡数据逻辑），和当前出片页截图 6-result.png。

## 玩法

出片后，除了现在的白边相纸，用户还能**领取一张镭射小卡**（K-pop 小卡那种：约 55×85 比例、圆角、可收藏的照片卡）。小卡的**材质由冲洗好坏决定**，一共 6 种，工程师已经在 app.js 里算好了，你只负责把它做出来、做好看：

| 材质 key | 中文名 | 稀有度 | 来历（可写在卡背） | 质感方向 |
|---|---|---|---|---|
| `prism` | 棱镜 | 最稀有（约 1/10） | 一点瑕疵都没有的那一张 | 深蓝玻璃上的棱镜色散，最华丽 |
| `rainbow` | 彩虹 | 普通 | 冲得还行的日常卡 | 光栅彩虹条纹 |
| `sparkle` | 闪粉 | 特别款 | 漏进来的光变成了闪粉 | 细碎闪粉随光闪烁 |
| `pearl` | 珠光 | 特别款 | 欠显，淡得像一段回忆 | 低调的白色珠光 |
| `etched` | 蚀刻 | 特别款 | 过显，黑得只剩轮廓 | 平时几乎看不见的蚀刻纹，只在光扫过时显现 |
| `chrome` | 银镜 | 特别款 | 没定影完，相纸上还残留着银 | 银色镜面 |

## 效果参考

参考 <https://vibedesign.tips/zh/018-holo-card/> 的「会倾斜和翻转的镭射卡片」：
- 卡片朝手指方向倾斜（最大约 12°），镭射、高光和亮边跟着一个光点移动；松手后弹簧回弹；没人操作时轻微晃动。
- 点一下（或聚焦后按回车 / 空格）翻到背面。
- 用 `rotateX/rotateY` + 父元素 `perspective`、`backface-visibility: hidden`、`mix-blend-mode`（color-dodge / overlay / soft-light / screen）、渐变和 `filter` 实现。
- **光点位置的 CSS 变量只设在卡面上，不要设在父元素上**（改变量会让下面所有元素重算样式，低端安卓上开销很大）。
- 用户开启「减弱动态效果」时：不倾斜、不晃动，翻转改为淡入淡出。

## 要你做的

1. **出片页**：在现有内容里加一个「领取小卡」的入口。点了之后展示小卡（可以是覆盖层，也可以是页面内的一块，你来设计），能倾斜、能翻转，能关掉回到出片页。
2. **小卡正面**：照片 + 当前材质的镭射效果，角落标出材质名。照片用 `state.photo`（一个 canvas，不带白边），用 `Film.drawFit(state.photo, 你的canvas)` 画进你自己的 canvas。
3. **小卡背面**：材质名和稀有度、来历文案、这次的冲洗报告（复用现有的报告标签数据）、编号（`'No.' + pad(state.count, 4)`）、**收集进度**：6 个格子按 `MATERIALS` 的顺序排，`state.collected` 里有的显示材质名，没有的显示问号，并写「已收集 N/6」。
4. **六种材质的 CSS**，每种要一眼能区分。
5. **倾斜要写成一个函数** `setCardTilt(nx, ny)`（nx、ny 取 −1 到 1，表示目标倾斜方向），指针拖动调用它。工程师之后会把手机陀螺仪也接到这个函数上，你不用管陀螺仪。
6. **只放按钮、不写处理**：小卡上放一个「存这张小卡」按钮，id 为 `save-card`，不要给它写点击逻辑，工程师会接上把卡定格成图片的保存功能。
7. 动画循环只在小卡显示时运行，关掉小卡、再冲一张、页面隐藏时都要停掉（`cancelAnimationFrame`）。

## app.js 里已有的接口（不要改动它们的逻辑）

- `state.material`：这次的材质 key；`state.collected`：已收集的材质 key 数组；`MATERIALS`：6 种材质按稀有度排好的数组；`state.photo`：成片 canvas。
- `pickMaterial`、`collectMaterial`、`lightsOn` 里给这几个值赋值的代码，以及 `bindTrayRub`、`bindFix` 的指针逻辑，**都不要动**。
- 「再冲一张」（`again()`）里要把小卡关掉、动画停掉。

## 平台硬约束（和前两轮一样，再强调新增的几条）

- 不联网：没有任何 `https://` 资源，字体只用系统字体栈，闪粉、光栅等纹理用 CSS 渐变、内联 SVG 或 canvas 画。
- 兼容 Chrome 61：JS 只用 ES2017；**`conic-gradient` 不支持**（要么不用，要么先写一个基础渐变做回退）；**`mask` 用 `-webkit-mask` 系列**，`mask-composite` 用 `-webkit-mask-composite`；3D 相关属性同时写 `-webkit-` 前缀（`-webkit-backface-visibility`、`-webkit-transform-style`）；flex `gap`、`aspect-ratio`、`inset`、`clamp()` 不能作为唯一实现。
- **不能用 `deviceorientation` / `devicemotion`**，陀螺仪由工程师接。
- 保留所有现有 id，不改 `Bridge.*`、`Film.*` 的调用（新增 `Film.drawFit` 画小卡可以）。
- 不加 WebGL 背景。

## 输出

只输出有改动的文件，每个给**完整文件**，代码块前一行写文件名。最后列出：新增的 id 和函数、六种材质各自用了什么手法、你担心在低端手机上可能卡的地方。
