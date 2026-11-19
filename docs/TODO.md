# 待办

状态词和收口规则见 `README.md`「任务管理」。

| 编号 | 事项 | 状态 | 负责 | 下一步 |
|---|---|---|---|---|
| T-01 | darkroom 1.1.0：整体 UI 升级（Gemini 两轮）+ 修复 Codex 审出的触控、键盘、陀螺仪边界问题（Claude） | 验证中 | Claude | Kaisa 2026-11-19 在本地模拟器验收通过。待 Kaisa 授权提交并打 tag `darkroom/v1.1.0`；真机项随 T-02 的扫码预览一起验 |
| T-02 | darkroom 首次上架 | 待处理 | Claude 执行，Kaisa 授权 | 依赖 T-01。打包 `releases/darkroom-1.1.0.zip` 并审计 → 上传代码包、图标、封面（要 Kaisa 授权，名称和简介各不超过 14 字）→ 生成预览二维码 → Kaisa 真机扫码，重点验 `CURRENT.md` 列出的未实测项 → Kaisa 确认「预览通过」后再送审 |
| T-03 | darkroom 小卡：冲洗好坏决定小卡稀有度（方向 B，见 D-02） | 待处理 | Claude、Gemini | 建议排在 T-02 之后。① Claude 定冲洗参数到六种材质（Prism / Rainbow / Pearl / Sparkle / Chrome / Etched）的映射和稀有度，Kaisa 拍板手感；② Gemini 按参考 <https://vibedesign.tips/zh/018-holo-card/> 做卡面、倾斜、翻转和背面冲洗报告，规格里写明 `conic-gradient` 要回退、不能用 `deviceorientation`、`mask` 改用 `-webkit-mask`；③ Claude 用 Canvas 把某个角度的反光定格成静态卡图，接存相册和发笔记；④ Codex 审查。新版本号 1.2.0 |
