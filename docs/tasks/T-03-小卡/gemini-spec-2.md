方案确认，请按你的改版方案实现。基于你上一轮输出的 index.html、style.css、app.js（项目里现在就是这三份，没有改过）。

要求和上一轮一样，再强调几条：
- `pickMaterial`、`collectMaterial`、`lightsOn` 里给 `state.material` / `state.photo` / 收集赋值的代码，以及 `bindTrayRub`、`bindFix` 的指针逻辑，都不要动。
- 保留所有现有 id，保留 `setCardTilt(nx, ny)` 的函数名和参数含义；`save-card` 按钮仍然只放好、不写点击逻辑。
- 运行时生成的纹理（如棱镜的碎冰纹理）只生成一次并缓存；关掉小卡、再冲一张、页面隐藏时停掉动画循环。
- 帧率降级（`.is-low-perf`）要能回退：降级后不要再自动升回去，避免来回抖动。
- 不新增图片文件，不联网，ES2017，Chrome 61 回退写法照你方案里写的做。

只输出有改动的文件，每个给完整文件，代码块前一行写文件名。最后列出：相对上一轮改了哪些 id 和函数、每种材质最终的图层组成。
