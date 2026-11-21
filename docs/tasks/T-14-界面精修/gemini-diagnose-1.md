这次请你给「暗房冲印店」做一次全面的界面和体验精修。**这一条只做调研和诊断，不写代码**；方案确认后，下一条再实现。

## 背景

- 产品：小红书 App 里的离线 H5 小工具，手机竖屏。主力屏幕 390×844，也要顾及 360×640。用户主要是喜欢「出片」的年轻女性。
- 玩法：选照片或用示例底片 → 在红色安全灯下显影（晃手机或手指划药盘）→ 按住 4 秒定影 → 开灯出片 → 存相册 / 发笔记；出片后可以领一张「暗房镭射小卡」（六种材质，翻开揭晓，倾斜看镭射光），收进「暗房卡册」，还能存一张晒卡图。
- 产品负责人的要求：**降低 AI 味，提升质感、视觉感受和使用体验。借鉴 Apple 和 Linear 的设计理念，但不是把界面改成它们的样子。** 暗房的身份要保留：红色安全灯、显影 → 定影 → 开灯的仪式感、开灯时整页从暗红变成相纸色。在这个身份里做减法和精修。

## 附件

- 4 张截图拼图，每格左上角有编号和页面名：
  - `S1-intro-to-fix`（首屏到定影）：01–06
  - `S2-result-export`（出片页和导出图）：07–10
  - `S3-card-binder`（小卡和卡册）：11–19
  - `S4-small-360x640`（小屏）：20–26
- 现在的 `index.html`、`style.css`、`app.js`。
- 截图里照片上的块状色块是出片算法的问题，工程师会另外修，**你不用管**。

## 第一步：联网调研参照（每条附来源链接）

找 6–10 个和这个题材相关、公认做得好的作品，说清楚每个**具体哪一点值得借鉴、用在我们哪个页面**。下面是起点，请核实后取舍，再补充你找到的：

- **「冲洗要等」的胶片相机 App**：Gudak（拍完要等三天才能看到照片）、Dispo、Huji Cam、NOMO CAM、Dazz Cam。看它们怎么做等待、揭晓和成片展示。
- **克制的专业相机界面**：Halide、Apple 相机、Apple 照片。看「照片就是界面」，控件怎么退后。
- **Linear**：看它的设计理念和界面，比如极少的颜色、精确的字阶和间距、1px 半透明描边、细腻的层级和动效。
- **拆卡包和揭晓**：比如 Pokémon TCG Pocket，看揭晓前的蓄力和稀有卡的演出。
- **小红书上受欢迎的胶片、拍立得、小卡类内容**：看用户真正喜欢晒什么样的画面。
- **设计原则的出处**：Apple 人机界面指南（Human Interface Guidelines）里关于清晰、让位于内容、层次的原则；Linear 官方讲自己设计方法的文章。

## 第二步：逐页诊断

页面包括：首屏、显影中、定影（待按 / 按住 / 完成）、出片页（正常 / 欠显）、导出成片、小卡（揭晓前卡背 / 揭晓中 / 正面 / 背面）、卡册（空 / 有收集）、晒卡图、360×640 小屏。

每页按下面这些维度逐项看，**每条问题都要说明属于哪个维度**：
- 视觉层级（visual hierarchy）：一眼先看到什么，是不是该先看到的东西
- 字阶（type scale）：字号、字重、行高、字距是否成体系
- 间距系统（spacing system）：是否落在统一的间距刻度上，比如 4 / 8 的倍数
- 颜色与对比度（color & contrast）：强调色用在哪，文字对比度是否达到 WCAG AA（正文 4.5:1）
- 层级与材质（elevation & material）：阴影、描边、渐变、纹理，是否每一层都有理由
- 可供性（affordance）：能点的东西看起来能不能点，主次按钮是否一眼分明
- 拇指热区与触控尺寸（thumb zone & touch target）：常用操作是否在屏幕下半部分，点击区域是否至少 44px
- 动效（motion）：时长、缓动曲线、先后编排，是否只用来表达状态变化
- 状态（states）：空、加载、禁用、成功、失败
- 文案（microcopy）：是否说人话，术语用户能否看懂
- 一致性（consistency）：同类元素的长相和说法是否统一
- 去装饰（decoration audit）：每个元素都要说得出它为用户做了什么，说不出就删

## 客观检测数据（工具测出来的，供你核对；要不要改、怎么改由你判断）

- **对比度不足**：
  - `.result-kicker` 2.9:1（#9a8378 在 #eee8de 上）
  - `.pocket-empty-no` 2.96:1，`.pocket-empty-hint` 3.3:1
  - 步骤条未激活 3.27:1、已完成 2.59:1
  - `--lit-dim` 4.42:1
  - 主按钮渐变顶部的颜色上 4.2:1
- **小于 11px 的功能文字**：
  - 卡面：`.holo-front-lab` 7px，`#card-front-no` 10px，稀有度字母 9px
  - 卡背：`.holo-back-top` 7.5px，`#card-back-date`、`#card-back-no` 8px
  - 小卡说明：`#card-caption-new` 10px
  - 卡册：`.pocket-empty-no` 10px，`.pocket-empty-hint` 10.5px，「本次」9px，「特别款」10px
  - 步骤条：`.step-num` 10px
- **触控区域小于 44px**：`.btn-text` 34–36px 高，`.card-bar-btn` 34px。
- **样式数量**（统计自 style.css）：18 种字号，15 种圆角，18 种字距，57 处渐变，37 处阴影，约 280 个不同的颜色写法，16 处等宽字体。
- **规则检测命中**：
  - 发光效果：`.lamp-dot`、`#pick-label`、`.clock-dot`、`#dev-time`、`#pull-out`、`#open-card-dot`、`#save-card`、`#fix-hold`
  - 径向光斑：`.tray-liquid`、`#holo-back-shine`
  - 卡片套卡片：`.tray-static > .tray-paper`、`.binder-slot > .binder-pocket`
  - 用 `width` 做过渡动画：`.meter-fill`
- **兼容性**：Chrome 61 不支持 `:focus-visible`，也不支持 flex 的 `gap`。

## 交付（中文，这一条不写代码）

1. **参照表**：作品 / 值得借鉴的那一点 / 用在我们哪一页 / 来源链接。
2. **逐页诊断表**：编号 / 页面 / 问题 / 维度 / 证据（截图编号或选择器）/ 参照了谁 / 打算怎么改 / 优先级（P0 用不了、P1 明显影响体验、P2 小问题、P3 打磨）。
3. **统一的设计规范草案**：颜色（每个颜色叫什么、用在哪）、字阶（几级、各用在哪）、间距刻度、圆角、描边、阴影、动效（几档时长、哪条缓动曲线）。全部要在 Chrome 61、只用系统字体（iOS 苹方 / SF，Android 系统黑体）、离线的前提下能实现。
4. **删除 / 保留 / 重做清单**，具体到元素和选择器。保留的部分写清楚为什么它是产品的灵魂。
5. **会动到玩法或逻辑的想法单独列一节**，只写想法和理由，不放进实现计划。比如改变出片页的操作顺序、改变卡册收集什么、增删功能。

## 不能动的东西（下一条实现时同样适用）

- 以下函数由工程师维护，一行都不要改：
  - `pickMaterial`、`collectMaterial`、`persist`、`saveCount`、`saveCards`、`refreshCollectionViews`、`loadSaved`
  - `lightsOn`、`bindTrayRub`、`bindFix`、`startDevelop`、`stopDevelopLoop`、`stopAllGyro`
  - `startCardGyro`、`stopCardGyro`、`ensureCardShot`、`saveCard`、`releaseBusy`、`again`、`savePhoto`、`postNote`
- 还有这几处：`openCard` 里的 `cardState.openSeq` 自增，`finishReveal` 里的 `saveBtn.disabled = state.busy`，`renderCardContent` 里的 `state.shotNo || state.count`，`openBinder` / `closeBinder` 里调用 `stopCardGyro()` / `startCardGyro()` 的两行。
- 保留所有现有 id 和 `setCardTilt(nx, ny)`。
- 平台硬约束：
  - 不联网：不能用外部字体、图片、脚本，也不能用 CSS `url()` 引用外部资源。
  - JS 最高 ES2017，不用 `?.`、`??`、对象展开。
  - 不用 `conic-gradient`；`mask` 要带 `-webkit-` 前缀。
  - 不新增图片文件，纹理用内联 SVG、CSS 或 canvas 生成。
  - 不用 `localStorage`。
