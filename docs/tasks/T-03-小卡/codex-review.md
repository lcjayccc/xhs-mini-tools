审查任务：darkroom 小卡功能（版本 1.2.0 候选），只读审查，不改任何文件，不提交。

## 背景

- 仓库 `F:\AI创作\小红书工具`，先读根目录 `AGENTS.md`（平台硬约束和协作流程）和 `docs/CURRENT.md`。
- 基线是 tag `darkroom/v1.1.0`（提交 `605bc29`）。本次是工作区里未提交的 diff：`git diff darkroom/v1.1.0 -- darkroom/`，涉及 `index.html`、`style.css`、`app.js`、`bridge.js`、`film.js`。
- 功能说明：出片后可「领取暗房小卡」。材质由冲洗结果决定（规则见 `docs/tasks/T-03-小卡/映射规则.md`）；先展示统一卡背，点一下按稀有度分级揭晓；正面可拖动倾斜、可翻面；有 2×3 的「暗房卡册」收集图鉴；「存这张小卡」把卡合成为一张 1080×1440 的晒卡图存进相册；手机转动通过容器陀螺仪带动小卡倾斜。
- 作者分工：界面（HTML / CSS / 小卡交互 JS）是 Gemini 写的；Claude 写了 `pickMaterial`、`collectMaterial`、`bridge.js` 的 `getList` / `setList`、`film.js` 的 `drawCover` 和 `composePhotocard`、`app.js` 的 `startCardGyro` / `stopCardGyro` / `ensureCardShot` / `saveCard`。
- 容器事实（小工具在线文档，已核实）：没有加速度计；陀螺仪回调是角速度（rad/s），`offGyroscopeChange(cb)` 按函数引用注销，`stopGyroscope` 停的是全局采集；页面进后台时采集自动暂停。

## 审查重点（按优先级）

1. **状态和生命周期**：小卡和卡册的打开、关闭、揭晓中途关闭、再冲一张、页面隐藏时，动画循环、揭晓定时器、陀螺仪订阅、`state.busy` 是否都正确复位；显影用的陀螺仪和小卡用的陀螺仪会不会互相注销或互相停掉采集。
2. **收集数据**：`state.collected` 的读写、`isNewMaterial` 的判断、存储读取晚于首次收集时的合并。
3. **存图**：`ensureCardShot` 的缓存在换了一轮之后是否失效（`again()` 里清了 `cardShotPath`，但别的入口呢）；合成失败或容器拒绝时按钮和提示是否恢复；`composePhotocard` 在横图、竖图、极小图上的表现。
4. **平台红线**：外部资源、禁用 API、ES2017 以上语法、Chrome 61 不支持却没回退的 CSS（重点看 `-webkit-mask`、3D 相关前缀、`flex-wrap` 卡册网格）、Canvas 2D 的 `globalCompositeOperation` 混合模式在 Chrome 61 上是否可用。
5. **性能**：小卡动画在低端安卓 WebView 上的风险、`.is-low-perf` 降级是否真的生效；`composePhotocard` 的耗时。
6. **可访问性和减弱动态效果**：键盘能否完成领卡、揭晓、翻面、打开卡册、存卡；`prefers-reduced-motion` 下是否跳过动画。

## 交付格式

- 按严重度分组：阻断 / 重要 / 次要。每条写 `文件:行号`、问题、触发场景（具体操作 → 错误结果）、修复建议，并标注「基线已有」或「本次引入」、「已核实」或「推论」。
- 没有问题的类别写「未发现」，不凑数。
- 审查完成即算成功（outcome succeeded），问题多少不影响 outcome。
