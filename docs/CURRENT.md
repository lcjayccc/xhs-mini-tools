# 当前状态

> 只写现行事实和指针，覆盖更新。核实：2026-11-20 17:10（北京时间）。

## 工具一览

| 工具 | 代码版本 | 平台状态 | 下一步 |
|---|---|---|---|
| darkroom（暗房冲印店） | 1.3.0 候选（最新提交，未验收，未打 tag）；上一个验收版 1.2.0（tag `darkroom/v1.2.0`） | **从未上传**：`redapp list`（正式环境、来源 thirdAgent）返回 0 个小工具（2026-11-19 查询） | 界面精修收尾（T-14）：先读 `tasks/T-14-界面精修/交接.md`。之后讨论小卡材质规则（T-13），再做流体显影（T-07）；上架（T-02）排在后面 |

## darkroom

- 玩法：选照片或示例底片 → 显影（晃手机或手指划药盘）→ 定影（按住 4 秒）→ 开灯出片 → 存相册 / 发笔记 → 领取镭射小卡、收进暗房卡册、存晒卡图。冲洗的好坏决定成片效果；小卡材质现在也由冲洗结果决定（规则 `tasks/T-03-小卡/映射规则.md`，Kaisa 倾向改为随机，见 TODO T-13，暂缓）。
- 文件分工：`bridge.js` 封装容器能力（陀螺仪、震动、存储、存相册、发笔记），`film.js` 是图像处理，`app.js` 是流程和交互，`index.html` / `style.css` 是界面。
- 1.3.0 候选 = Gemini 精修版为基线 + Claude 版三项 + Claude 修的三条审查问题，详见交接文件。还有 Codex 审出的 9 条界面问题没修。
- **未实测**：创服平台模拟器（1.3.0）、切后台、真机陀螺仪和震动、存相册、发笔记、多指真机手感、Chrome 61 真机兼容。
- 已知问题：只要晃得不够，成片会出现块状色阶（P0），归 T-07 / T-12。

## 协作现状

- 分工按 `AGENTS.md`「协作流程」：Claude 总控并负责容器逻辑，Gemini 网页版（4 Neon）做前端，Codex 以 Orca worker 只读审查。理由见 `DECISIONS.md` D-01。Kaisa 2026-11-20：下一轮先不让 Gemini 做，任务回到 Claude Desktop。
- 仓库已公开在 GitHub：https://github.com/lcjayccc/xhs-mini-tools （2026-11-21 推送，提交作者邮箱用 GitHub noreply）。Kaisa 打算让 Gemini 直接从仓库读最新代码，Gemini 能否读到**未验证**。
- 本地测试工具在 `tools/`：模拟宿主测试页、不缓存的静态服务、受保护函数比对脚本，用法见交接文件「怎么验证」。
- Gemini 只能用网页版：Gemini CLI 个人账号已停服，Antigravity 账号无权限（2026-11-18）。
- redapp CLI 装在 `D:\DevTools\redapp-cli\npm-prefix`，运行前要在当前进程设置 npm prefix 和 cache，不要装回 C 盘。
