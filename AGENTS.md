# 小红书小工具

本仓库放小红书小工具：离线 H5 页面，打包成 zip 由小红书容器加载。每个工具一个子目录，入口 `index.html` 在该目录根，例如 `darkroom/`。

开工前读 `docs/CURRENT.md`；待办、决定、版本和目录约定的入口是 `docs/README.md`。

## 平台硬约束

所有 Agent 都必须遵守。完整规范在 `C:\Users\25242\.claude\skills\minitool-zip-builder\`（`SKILL.md` 和 `references/`），下面只列最常踩的红线；有冲突时以完整规范和小工具在线文档 <https://miniapp-sandbox.xiaohongshu.com/minitool/doc> 为准。

- **不联网**：禁止 `fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`；禁止任何 `https://` 外部脚本、样式、字体、图片和 CSS `url()`。资源全部打包在内，用相对路径引用。
- **兼容基线 Chrome / WebView 61**：JS 不超过 ES2017，不用可选链 `?.`、空值合并 `??`、对象展开 `{...obj}`；新 CSS 特性要有基础层回退；新 Web API 先做能力检测，不按 UA 判断。
- **禁用 API**：`eval`、`new Function`、`WebAssembly`、Worker、`window.open`、`window.prompt`、`navigator.clipboard`、`geolocation`、`DeviceMotionEvent` / `DeviceOrientationEvent` 等 Web 传感器、`requestFullscreen`、`iframe`、`a[download]`、`target="_blank"`、表单跳转提交。
- **容器能力只走 `bridge.js`**：陀螺仪、震动、存储、存相册、发笔记都通过 `window.xhs.miniTool` 的封装调用，缺失时降级；持久化不得用 `localStorage`、`IndexedDB`、Cookie。
- **系统长按菜单已禁用**：交互用 touch / pointer 事件实现。
- **zip 内容**：只放 html / css / js / 图片 / woff / json；`index.html` 必须在 zip 根；不放 `.git`、`node_modules`、`*.map`。
- **验收边界**：普通浏览器里跑通不算验收。功能以创服平台模拟器和 Android / iOS 真机为准，没实测就写明「未实测」。

## 协作流程

试行中。首个任务（darkroom 整体 UI 升级）已按此流程跑通，下面已吸收它的教训。

1. **Claude（总控）拆任务**：把需求写成给 Gemini 的规格，附「平台硬约束」一节、要改的文件全文和当前截图。`bridge.js`、`film.js` 的图像算法和容器调用由 Claude 自己改，不交出去。
2. **Gemini（网页版，经 Orca 内置浏览器）实现前端**：负责 HTML / CSS 和界面交互的 JS。Gemini 读不到本地文件，输出整文件或明确的替换片段。
3. **Claude 落盘自查**：把 Gemini 的输出写回文件，逐条自查红线，截图对比；不合格的打回 Gemini 重做，不自己悄悄改。截图前先确认页面加载的是新代码：`python -m http.server` 的 JS / CSS 会被浏览器缓存，要用发 `Cache-Control: no-store` 的本地服务，并检查资源的 `transferSize` 不为 0。
4. **Codex（Orca worker，只读）审查**：审本次 diff，重点看红线、业务逻辑有没有被误改、兼容性；按严重度列问题，每条标注「基线已有」或「本次引入」，不改文件。
5. **Claude 收尾**：同意的意见交回对应作者修，有分歧的交 Kaisa 定；Kaisa 验收后再授权提交。浏览器测不到的项（切后台、陀螺仪、存相册、发笔记、多指真机手感）标为「未实测」，留给创服平台模拟器和真机。
