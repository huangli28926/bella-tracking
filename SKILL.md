---
name: bella-tracking-github
description: >-
  EN: Turns a Beike tracking-requirements Excel into landing HTML with SDK/project
  wrapper snippets and parameter provenance, then runs Playwright critical-path
  acceptance. Use when the user provides a tracking xlsx, or mentions tracking
  landing docs, tracking code, parameter sources, critical-path acceptance,
  auto acceptance, final tracking report, landing correction, hint images,
  empty-value self-repair, historical tracking, missing-event list, or
  backfilling missing tracking.
  ZH: 将贝壳埋点需求 Excel 转为带 SDK/项目封装写法与参数来源的可视化落库 HTML，并生成 Playwright
  关键路径验收。在用户提供埋点需求文档 xlsx，或提到埋点落库文档、埋点写法、参数来源、关键路径验收、
  自动验收、埋点终稿、矫正落库、上传提示图、空值自修复、修空值、梳理历史埋点、历史埋点关系、缺失埋点列表、补全历史埋点、补缺失埋点时使用。
---

# 埋点落库 + 关键验收

稳定性：**磁盘事实 > 脚本 JSON > Schema > 当前模型判断 > 对话文本**。禁止用聊天历史猜阶段。

只依赖读文件 / 搜文本 / 跑命令 / 改文件。打开浏览器只通过 `confirm-event.js` / `serve-impl.js`。禁止平台工具名、占位符 `<skillDir>` 写入事实文件（`impl.json` / `events.json` 等）。脚本只在本 skill 目录；当前打开的业务仓不必有 `scripts/`。xlsx 必须在**项目根** `docs/`（`ensureExcelInDocs`）。命令的 cwd = 用户当前项目根。

## 主循环

初始化：只从用户消息抄 `--excel=` / `--entry=` / `--run=`，没有就不要编造。

**本轮第一条且唯一允许的命令**（skill 根 = 本 SKILL.md 所在目录，不是业务仓根；有用户给出的路径/入口才追加对应参数）：

`node {skillRoot}/scripts/workflow/tracking-workflow.js --status --json`

不要因为当前仓缺少 `scripts/workflow/tracking-workflow.js` 就停。发出 `prompt` 之前禁止：列出 `docs/`、猜测 xlsx、读 `scripts/` 或 `reference/`、自己生成选项、执行任何阶段。

仅当 `nextTask.command` 为空时，才把 `prompt` **原样**发给用户后**本轮结束**（例如 `choose_*` / `ask_excel`，或确实需要用户先做选择的动作）。如果 `nextTask.command` 非空，必须先执行该命令，不能因为 `prompt` 非空而提前结束；其中 `confirm-event --wait` / `serve-impl` 负责实际打开浏览器并等待用户操作，命令完成后再重新 `--status --json`。禁止从记忆或本文件补菜单，禁止再加解释或「先看脚本」。exit 10 = 未选入口。用户下一条消息再带路径或入口，重新 `--status`。

其后：`executor=script` 只跑返回的 `nextTask.command`（已指向 skill 内脚本绝对路径，cwd 仍是项目根）。`executor=agent` 只读 `nextTask.inputs` + 下表对应 reference，写 `outputs`。写入 `impl.json` 后立刻跑 status 给出的 `normalize-impl` + `validate-impl`。error / `status=blocked` 则停。成功后再 `--status --json`。聊天解释不是下一跳输入。`confirm-event --wait` 会阻塞，超时 exit 2。

`--run=A` 只 dump+render，不等于路径 A 完成。公司 SDK 是 `$ULOG.send`；项目封装进仓后探测，不写进本文件。

## 何时读哪篇

| nextTask | 读 |
|---|---|
| 循环 / `command` | `reference/workflow-next-task.md` |
| A | `reference/path-a.md` + `call-adaptor.md` + `sdk-profiles.md` |
| B | `reference/path-b.md` + `confirm-flow.md` |
| C | `reference/path-c.md` + `accept-chain-rules.md` |
| D | `reference/path-d.md` + `accept-assert.md` + `accept-fail-explain.md` |
| E | `reference/path-e.md` + `accept-assert.md` |
| F / 7 / H | `reference/path-history.md` + `history-tracking.md` |
| 禁令 / `.env` / 定位优先级 | `reference/skill-hard-stops.md` |

字段闭集见 `schemas/impl.schema.json`。产物目录与命令见 `USER-GUIDE.md`、`tracking-workflow.js --help`。

## 确定性生成

- 枚举只写 Schema 允许值（大小写一致）。`lifecycle`：`onClick` / `useEffect` / `IntersectionObserver` / `pageLoad` / 空串。
- `unresolved[]` 只允许：`请确认埋点位置`、`请确认参数 {key} 的取值`。
- 无真实证据链时字段留空并进 `unresolved`。有证据的最佳候选必须写入 `targetFile` / `functionName` / `lifecycle` / `expression` / `sourcePath`，并保留 `candidates[]`。禁止因 `medium` / `low` 清空已有候选。禁止无证据猜测。
- 数组按 `docIndex`；同一 `evtId` 一条。路径用仓库相对 POSIX。JSON 文件必须是纯 JSON。
- 不得只因历史上 `confirmed` 就复用参数事实。先重建当前 `expression` / `sourcePath` / `evidence` / `scopeReachable`，再对上一份同 `evtId`+`key` 的 confirmation 跑 `validate-confirmation-reuse.js`。只有程序判定 `reused` 才可写 `confirmation.status=reused`。

## 硬禁止（展开见 skill-hard-stops.md）

1. 不用文档「页面名称」当落点。
2. 不编造 `props.xxx` / `window.xxx`（`window.__user` 除外）。
3. 不改写文档 `uicode`；不一致只填 `uicodeConflict`。
4. 未确认不删旧埋点。
5. 确认时禁止整轮 `--no-open`，须走 `confirm-event` / `serve-impl`。
6. 真实验收未选设备不跑 Playwright。
7. 未选入口不跑任何阶段。
8. dump 失败（缺示意图）不分析、不写码。
9. 未给路径时不扫描 `docs/` 代选 xlsx。
