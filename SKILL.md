---
name: bella-tracking
description: >-
  ZH: 将贝壳埋点需求 Excel 转为带 SDK/项目封装写法与参数来源的可视化落库 HTML，并生成 Playwright
  关键路径验收。在用户提供埋点需求文档 xlsx，或提到埋点落库文档、埋点写法、参数来源、关键路径验收、
  自动验收、埋点终稿、矫正落库、上传提示图、空值自修复、修空值、梳理历史埋点、历史埋点关系、缺失埋点列表、补全历史埋点、补缺失埋点时使用。
---

# 埋点落库 + 关键验收

## 跨 Agent 执行契约（Claude Code / Codex / Cursor）

本 Skill 只依赖“读文件 / 搜索文本 / 执行 shell / 修改文件 / 打开浏览器”这些通用能力，**不得依赖某个平台专属工具名、隐藏状态或对话记忆**。平台能力不同只影响操作方式，不改变产物和阶段语义。

稳定性优先级固定为：**磁盘事实 > 脚本 JSON > Schema > 当前模型判断 > 对话文本**。发生冲突时按此顺序覆盖，禁止根据聊天历史猜测阶段状态。

每次先跑 `tracking-workflow.js --excel=docs/{文档名}.xlsx --status --json`，只执行返回的 `nextTask.command`；`prompt` 非空则原样发给用户。不要用对话记忆猜阶段。

每次模型写入 `impl.json` 后，固定执行：

```bash
node <skillDir>/scripts/accept/normalize-impl.js --excel=docs/{文档名}.xlsx
node <skillDir>/scripts/accept/validate-impl.js --excel=docs/{文档名}.xlsx --json
```

`normalize-impl` 只做格式归一，不替模型补业务事实；`validate-impl` 有 error 时必须停止后续阶段。模型不得用自然语言解释来绕过校验。

对机器可消费结果，优先使用脚本 `--json` 输出；需要向外层 Agent 传递阶段结果时，遵循 `schemas/task-result.schema.json`。聊天回复只负责给用户解释，不作为下一阶段输入。

**确定性生成规则：**
- 枚举字段只写 Schema 中允许值；大小写也必须一致。
- `lifecycle` 仅允许 `onClick / useEffect / IntersectionObserver / pageLoad / 空串`。
- `unresolved[]` 仅允许 `请确认埋点位置`、`请确认参数 {key} 的取值`。
- 未确认事实必须留空或进入 `unresolved`，禁止写“可能 / 大概 / 建议 / 推测”等散文。
- 数组保持文档 `docIndex` 顺序；同一 `evtId` 只保留一条。
- 路径统一使用仓库相对 POSIX 路径；禁止写 Agent 本机绝对路径到事实文件。
- 模型输出不得夹带 Markdown fence 后再交给脚本解析；JSON 文件必须是纯 JSON。


判断由**当前对话模型**完成（看示意图、搜代码、追参数）。脚本只做 dump / 渲染 / 建链 / 跑验收。真相源是 `impl.json`，不要只改 HTML。关键入口会跑 `validate-impl.js` 前置校验，先修 error 再继续。

公司统一的是 dig-log SDK（`$ULOG.send`）。项目二次封装（如某仓的 `sendLog`）**不写进 Skill**，进仓后探测，跟随落点文件。

详细规则按需读：
- `reference/sdk-profiles.md` — 公司 SDK 1.3.0 / v3
- `reference/call-adaptor.md` — 二次封装探测与写码规则
- `reference/accept-chain-rules.md` — 关键路径字段
- `reference/accept-assert.md` — 断言与空值自修复分类
- `reference/accept-fail-explain.md` — 失败中文码 + 模型归因格式
- `reference/history-tracking.md` — 历史埋点静态扫描
- `reference/confirm-flow.md` — 矫正向导、confirm-sweep、确认/跳过
- `reference/workflow-next-task.md` — 按 status JSON 的 nextTask 执行

## 何时启用

从用户消息取 `--excel=` 路径。仓库根执行脚本。脚本始终用**本 Skill 目录**（当前加载的 `SKILL.md` 所在目录）下的 `scripts/`，不要假设仓库里有 `.cursor/skills/bella-tracking`。

xlsx 必须在仓库根 `docs/` 下：没有该目录则先创建；文件不在 `docs/`（含子目录）内则**移动**到 `docs/{原文件名}`，后续一律 `--excel=docs/{原文件名}`。由 `scripts/lib/lib.js` 的 `ensureExcelInDocs` 完成（dump / workflow / `report.defaultPaths` 都会走）。目标已有同名不同文件则报错，禁止覆盖。Agent 不要只改参数路径却不搬文件。

### 阶段选择（先问再跑，硬规则）

A → B → C **对外是一条执行流**（B 依赖 A，C 依赖 AB），对内仍分阶段以便中断恢复。禁止无落库产物时单独写 C。

| 用户说法 | 行为 |
|---|---|
| 明确「只跑 A / 阶段 A」 | **只跑路径 A**（dump + 逐条分析 + validate；needsConfirm 当场打断属 user task），跑完停，不自动进 B/C，不要再列菜单。`--run=A` **只** dump+render，不等于路径 A 完成 |
| 明确「落库到写码 / A→B→C」 | 按路径 A → B → C 一条链跑（阶段内可停） |
| 明确「验收全流程」 | A → B → C → D（E 不自动进） |
| 明确「只跑 B」 | **恢复**：先 `tracking-workflow --run=B`；`needA`（exit 3）则先完整路径 A 再 B，禁止无产物开矫正 |
| 明确「只跑 C」 | **恢复**：先 `--run=C`；`needA`（exit 3）则完整 A→B 再 C；`needB`（exit 4）则先 B 再 C。禁止无 impl 写业务源码 |
| 明确「只跑 D / E / F / 7」 | 只跑该入口（D 仍依赖已写码的 impl.accept；7 为文档 vs 代码缺失列表，只读） |
| 明确「补全历史埋点 / 补缺失埋点 / 入口 8 / `--run=H`」 | 走**路径 H**：依赖入口 7 缺失表；假缺失分流后对 `missing[]` 走 A→B→C；**不自动进 D** |
| **未明确调用方式**（只给 xlsx、说落库/埋点、继续、下一步、没说阶段） | **停下来列出全部选项**，等用户回复后再跑；禁止自行开始任何阶段（含 A） |

未得到选择前，禁止执行任何入口。

**未明确时必须原样列出（不要增删、不要替用户选）：**

```
请选择本次入口（回复字母或序号）：
1. 验收全流程 A→B→C→D【强烈推荐】（E 仅在 D 失败且你同意后才跑）
2. 落库到写码 A→B→C
3. A 落库（只分析，不写业务源码）
4. D 关键验收
5. E 空值自修复（仅 D 失败后，或你点名 E）
6. F 历史埋点关系
7. 文档 vs 代码：缺失埋点列表
8. 补全历史缺失埋点（依赖入口 7 的缺失表；只写 missing，不改 found）
```

验收全流程 = A → B → C → D；入口 2 = A → B → C 停在写码完成。E 不自动进全流程；F / 7 / 8 不在全流程里。B / C 不再作为从零开始的菜单项；用户口头「只跑 B/C」按上表做依赖恢复。入口 8 写码完成后默认停，不自动进 D。

用户回复 **7** / 「缺失埋点列表」/ 「文档 vs 代码」：走入口 7。本轮没有可用埋点 Excel（未给路径、不是 xlsx、文件不存在）时，**立刻停下来原样询问**，不 dump、不扫描、不对账：

```
需要梳理哪个历史埋点文档的数据，请给出该历史埋点 excel
```

拿到有效路径后再 `ensureExcelInDocs`，跑 `diff-doc-vs-history.js --excel=docs/{文件名}.xlsx`。

历史埋点 / 扫描已有埋点 / 关系图：视为明确选 F 时，仍先把下面命令发给用户，确认后再跑。

```bash
node <skillDir>/scripts/history/scan-history-tracking.js
```

## Workflow 模式（推荐）

A 落库 → B 矫正 → C 写码 → D 验收（→ 失败且用户选自修复才 E；E 失败或用户选直接矫正则打开 B）是一个状态机，不是一次性盲跑。每步都有产物门禁，允许中断、恢复、重跑。

| 阶段 | 执行者 | 自动化 | 完成门禁 |
|---|---|---|---|
| A 落库 | 脚本 + 模型 | 半自动 | dump 示意图全部成功；`events.json` / `adaptor.json` / `impl.json` / 落库 HTML 存在；每条事件有非空 `_raw/images/{evtId}.png`；`validate-impl` 无 error。needsConfirm 不阻止 A.done，进入 B 队列 |
| B 矫正 | 用户 | 人工 | 待确认队列已处理；进 C 前必须已打开**整份**落库页并得到用户「进入 C」确认 |
| C 写码 | 模型 | 半自动 | 用户明确同意改业务源码；代码已写；`impl.accept` 已补全；`build-accept-chain` 无 pending 关键项 |
| D 验收 | 脚本 | 自动 | 真实 `run-accept` 非 plan-only 即生成终稿；终稿含通过 / 失败 / 路径跳过 / 未落地 / 验不了，不要求全绿 |
| E 自修复 | 模型 | 半自动 | 仅 D 失败后用户选「自修复」，或用户点名 E；最多 1 轮；仍失败则自动打开人工矫正页 |

优先入口（先 `--status --json`，再按 `nextTask` 执行）：

```bash
node <skillDir>/scripts/workflow/tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --status --json
node <skillDir>/scripts/workflow/tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=A
node <skillDir>/scripts/workflow/tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=B --json
node <skillDir>/scripts/workflow/tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=C --json
node <skillDir>/scripts/workflow/tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --mark=B
node <skillDir>/scripts/workflow/tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --mark=C
node <skillDir>/scripts/workflow/tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=D --plan-only
node <skillDir>/scripts/workflow/tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=D --device=mobile
node <skillDir>/scripts/workflow/tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=D
node <skillDir>/scripts/workflow/tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=H --json
```

执行策略：
1. **只跑路径 A**（用户已明确）时按 `nextTask` 做到 A.done，结束后汇报，不要再列菜单。未明确调用方式时**先列出全部 8 项入口**（全流程为第 1 项并带「强烈推荐」），等回复后再跑；禁止默认开 A 或全流程。跳转以引擎 JSON 为准，不要按对话 if 猜阶段。
2. `--run=A` 只做 dump+render，**不**等于路径 A 完成，不标记 A 完成。dump 示意图失败（含缺 URL）则 dump 非 0 退出，禁止 render / 分析 / 写码。A.done = 产物齐 + 已分析 + `validate-impl` 无 error（与 confirm 队列拆开）。`--run=B|C` 只做依赖门禁，不写业务源码。`--run=H` 只做缺失表门禁，不写业务源码。`--run=D` 跑验收；真实验收须先有 `--device=mobile|pc`（或 `.env` `acceptDevice`），未指定则停下来问用户，禁止默认 iPhone。B/C 写码/确认不可脚本越过。
3. 用户选「落库到写码」或「只跑 C」且 `needA`：按路径 A 全文执行（不是只 dump），再路径 B，用户「进入 C」后再写码。`needB`：不重跑 A，走路径 B。
4. A 逐条分析时，若 `needsConfirm`，立刻跑 `confirm-event.js --evt=... --wait`。**本轮第一次打断必须打开浏览器**；同 slug 的 `serve-impl` 已在跑时脚本不再新开 tab（向导会在当前页切到下一条）。禁止整轮 `--no-open`、禁止只发 URL 或只开本地 HTML；不要等全部事件写完再开矫正页。`--wait` 超时须 `--force-open` 再开该条向导。
5. 待确认队列清空后，进 C 前仍须 `serve-impl` 打开整份 `{文档名}-落库.html`，等用户确认「进入 C」。C 完成必须来自用户明确同意修改业务源码后的代码落地。
6. D `fail>0` 时按 `reference/accept-fail-explain.md` 的**规范化总览**输出（失败 / 通过 / 报告 / C 落点），再给**两个选择**；未回复不改代码、不进 E、不进 B。选「自修复」后 E 只 1 轮；E 仍失败则自动打开人工矫正页。选「直接重新进入人工矫正页面」则跳过 E，立刻打开矫正页。
7. 每次恢复都读 `--status --json` + 磁盘产物，不靠对话记忆。
8. 任何阶段失败先看 `doctor.js` 和 `validate-impl.js`；D 失败再看验收 JSON 的 `failFactsZh` 与 `accept/_diagnostics/`。
9. 入口 8：`--run=H` `needMissingList`（exit 5）则先入口 7；缺失为 0 则停；有 missing 再假缺失分流后走 A→B→C（只写 literal_missing）。

## 硬性禁止

- 用文档「页面名称」过滤事件或当落点页面
- **本期新埋点**（未开 `trackingMode=backfill`）：多入口时忽略 `.env` `trackingBaseline`（缺省 `master`），把历史进入方式写成主落点 / 主 `accept`
- 编造 `props.xxx` / `window.xxx`（`window.__user` 除外）
- 验收整页乱点 / BFS；只走 `accept-chain.json` 的 sharedSteps + trigger
- 把某个项目的封装名（如 `sendLog`）写进 Skill 或当成全公司标准
- 在没有该封装的仓里发明封装；为了统一把旧页 SDK 直调改成封装
- 改写文档 `uicode`：只从 Excel → `events.json` 读取；禁止写入 `impl.json`、禁止落库页编辑、禁止用现网旧值覆盖。不一致只填 `uicodeConflict`
- 不确定时编造 `code` / `insertHint` / `evidence` / 参数表达式，或把分析散文写入 `unresolved[]`
- 打断确认时向用户输出与「埋点位置 / 参数取值 / uicode」无关的说明
- 未明确入口时不列完整选项（8 项：全流程 / A→B→C / 只 A / D / E / F / 缺失列表 / 补全历史缺失）就自行开跑，或替用户选择默认跑 A
- 选 7 或 8 且无可用埋点 Excel、也无 `{文档名}-缺失埋点.json` 时不询问「需要梳理哪个历史埋点文档的数据，请给出该历史埋点 excel」就开跑 dump/扫描/对账/写码
- 未走入口 8 / 路径 H、未确认「进入 C」，仅凭缺失 HTML/JSON 改业务源码
- 路径 H 把 `found[]` 的调用删掉重写，或把动态拼接的 evtId 改成字面量「为了让入口 7 变绿」
- `trackingMode=backfill` 时把历史缺失 evtId 的主落点锁到本期新文件（除非 Grep 证明只有新文件才有该 UI）
- 入口 8 / 路径 H 自动进入 D/E
- dump 示意图失败、缺 URL、或下载文件为空后，继续 render / 逐条分析 / 写码 / 验收
- 无落库产物（`inspectLanding.needA`，含缺示意图 png）时直接写业务源码，或「只跑 C」时只 dump 不分析就改 `adaptor.sourceRoots`
- 矫正 / 确认参数时整轮 `--no-open`，或不调浏览器只贴 URL / 本地 HTML。同 slug 服务已在跑时，后续 `confirm-event` 不再新开 tab 是允许的；`--wait` 超时须 `--force-open`
- D 验收失败后未经用户选择进入 E，或 E 超过 1 轮自修复
- D 验收失败后不问二选一（自修复 / 直接人工矫正），或把选项写成单一是否自动修复
- 真实验收（非 plan-only）未得到用户设备选择就启动 Playwright，或自行默认 iPhone 13
- 因 fail / skip 就不生成终稿（终稿是结果快照，不是全绿奖状）
- 路径 C / 改业务源码时删除旧埋点（已有 `$ULOG.send` / 封装调用 / DOM 埋点，含本期文档未列出的 evtId）。只允许新增本期调用，或在同一 evtId 原处改参。若 diff 出现净删除：必须停下来列出 evtId/文件并让用户确认；未回复不得继续写码、不进 D。用户选保留则撤回删除。

### 源码根（`.env` `sourceRoot`）

历史扫描与落库/写码 Grep **同一套根**（`scripts/lib/source-roots.js`）。

1. 读仓库根 `.env` 的 `sourceRoot`（也认 `SOURCE_ROOT` / `TRACKING_SOURCE_ROOTS`），逗号分隔。
2. **已配置** → 只扫这些相对仓库根的目录；路径不存在则停，不回退探索。
3. **未写或为空** → 自动探索（`src` / `app` / `pages` / `views` 等含源码目录）。
4. **禁止扫描**仓库根 `docs/`（env 指向 docs 报错；walk 跳过该目录）。

### 本期入口基线（`.env` `trackingBaseline`）

同一 evtId / 同一文案可能有多种进入方式。路径 A 定位与路径 C 的 `pageKey` / `accept.preconditions`，在**未**设置 `trackingMode=backfill` 时，**必须先锁到本期新增代码**，不要把历史入口当成主落点。

1. 读仓库根 `.env` 的 `trackingBaseline`（也认 `TRACKING_BASELINE`）。
2. **未写或为空 → `master`**。已写则用该值（本地分支名或 `origin/xxx`）。
3. 执行 `git diff {trackingBaseline}...HEAD --name-only`，得到本期文件集合。
4. 查找范围始终是全部 `adaptor.sourceRoots`（全局 Grep），不是只扫本期 diff。
5. 多处命中时：`targetFile` **优先**取 diff 内文件；`pageKey` / 前置步骤 / 种子入口只描述从本期代码能走到该控件的路径。旧页同 evtId 只作对照，不写入主 `accept`。允许落在 diff 外文件（全局查找结果仍有效）。
6. 基线 ref 不存在时停下来问用户，禁止默默改用别的分支。
7. **旧页新埋点锁验收路径**：路径 C 写 `accept.preconditions` 前跑 `resolve-entry-path.js`（倒推仓内 `history.push` / `Link` 入边，再和基线 diff 比跳转行是否本期新增）。
   - 有本期新增跳转 → 主 `accept` 只走这条新边（`lockMode=new_jump`）。
   - 入边都是历史跳转 → 从 `seedUrl` 走已有最短路径进旧页再触发本期控件（`existing_shortest`），**禁止编新入口、禁止把全部历史入边都跑一遍**。
   - seed 已在落点页 → `preconditions: []`（`seed_is_page`）。
   - 仓内无入边 → 以 seed 直达为准（外链/原生扫不到，`no_inbound`）。
   脚本只输出入边与 `lockMode`，**不写 locator**；具体 click 文案 / testid 仍由模型按代码填写。

Playwright / `run-accept` 不读 `trackingBaseline`；D 仍只跑 `impl.accept` 已锁定的那条链。

### `.env` `trackingMode`（无默认值）

读仓库根 `.env` 的 `trackingMode`（也认 `TRACKING_MODE`）。**未写、为空、或不是 `backfill` → 视为未配置**，禁止猜成 `backfill` 或 `period`。

| 值 | 定位 / 验收入口 |
|---|---|
| **不写 / 空 / 其它** | 与上节一致：全局搜 `sourceRoots`；多入口优先本期 `trackingBaseline` diff |
| **`backfill`** | 仅用户明确要补历史缺失（入口 8 / 路径 H 建议写上）：多入口优先示意图文案与同模块已落地 evtId 所在文件；**不要求** `targetFile` 在本期 diff 内；禁止为了走新入口把历史 evtId 写到新页。`resolve-entry-path` 即使扫到 `new_jump` 也不把它当主验收，改用 `existing_shortest` / `seed_is_page` / `no_inbound` |

入口 8 开跑前：若要用旧页优先规则，提示用户加上 `trackingMode=backfill`；不加则仍全局查找 + 现有优先级，但写码范围仍只限 `missing[]`。

### 定位证据优先级

给埋点找「落在哪段代码」时，按下列顺序取证（先硬后软）。页面名称不可靠，禁止当依据。未配置 `trackingMode=backfill` 时，多入口用上一节的本期文件集合**优先**收窄，查找仍覆盖全部 `sourceRoots`。`backfill` 时多入口优先示意图与同模块已落地文件，不要求在本期 diff 内。

1. **代码里已有这个 evtId** — 最硬，直接对账
2. **hint.api** — 人工标过接口字段
3. **提示图 / hint.note** — 人工矫正线索
4. **示意图上的可见文案** — 和 JSX 文案对上
5. **事件名称** — 文档里的名字，辅助搜
6. **uicode** — 只当 SDK payload.uicode（值必须抄 `events.json`），不当「找文件」依据
7. **页面名称** — 禁止当依据（Excel 页面名常和真实路由对不上）

---

## 路径 A：落库文档

**先做**
1. `dump-excel.js --excel=...`（需网络下示意图；同时写出 `_raw/adaptor.json`；示意图默认并发下载并复用本地缓存）。**每条必须有示意图 URL 且下载成功（或非空缓存）**；失败则脚本非 0 退出，**立刻停**，不 render、不分析、不写码。不要把此时空 HTML 交给用户。路径 A **禁止** `--skip-images`（该开关仅入口 7；且 `inspectLanding` 仍要求 png，skip dump 不能当 A 完成）。
2. 读 `_raw/{文档名}.events.json`。click / view **一起**按 `docIndex` 分析，不分两批。
3. 读 `_raw/adaptor.json` 与 `reference/call-adaptor.md`。`code` 按 adaptor 的 `styleId` 渲染，不要默认 `sendLog`。

**逐条事件**
0. 分析前读 `.env` `trackingBaseline`（缺省 `master`）与 `trackingMode`（**无默认**）。Grep 全部 `adaptor.sourceRoots`。未配置 `backfill` 时：用 `git diff {trackingBaseline}...HEAD` 作多入口优先级；`targetFile` 优先本期文件，不禁止 diff 外命中。`trackingMode=backfill` 时：不要求本期文件，优先示意图 / 同模块已落地调用。
1. `Read` `_raw/images/{evtId}.png`。无图说明 dump 未成功，**停下来报错**，不要改打开 `diagramUrl` 继续分析。
2. 有 `hint.images` 再 `Read` 提示图；`hint.note` / `hint.api` 作线索。
3. `Grep` `adaptor.sourceRoots` 的 `evtId`。已有调用 → `status: existing`，对账参数，`styleId` 跟该文件。多文件命中时：未配置 `backfill` 则 `targetFile` 优先本期 diff；`backfill` 则优先同模块已落地文件 / 示意图对应旧页。
4. 未命中：用示意图可见文案 + 事件名称搜源码（全局 `sourceRoots`）。未配置 `backfill` 时优先搜本期文件。页面名称只当原文备注。
5. `uicode` **原样抄** `_raw/{文档名}.events.json` 同 evtId 的值写入 SDK payload / snippet。禁止改写、禁止按路由猜。落点路由与文档 uicode 不一致 → 只填 `uicodeConflict`。
6. 定 `targetFile` / `functionName` / `lifecycle`（click→onClick；view→useEffect 或 IntersectionObserver）。
7. `styleId`：`fileStyle[targetFile]` > 同目录最常见 > `defaultStyleId` > `sdk-send`。用对应 snippet 填 `code`。
8. 参数解析顺序：已有 `expression`（及 `valueKind`）→ `_raw/field-memory.json`（或同文档已确认事件）同 key 上次确认值 → `hint.api` → hint 图/note + 示意图 → 仓级惯例 → 同文件已有埋点 → 按「用途说明」追变量。抄不到：`expression` 留空，`confidence: low`，`unresolved` 只写 `请确认参数 {key} 的取值`。记忆回填后 `confidence` 为 `medium`，**仍须人工确认**；禁止用记忆覆盖 `high` 且非空的表达式；代码里已有调用优先于记忆。不回填 `targetFile` / `uicode`。用户在落库页可填 **JS 表达式** 或 **备注**（`valueKind: prompt`，自然语言说明取值，给路径 C 当提示词）；备注非空也算已给出取值，不要因为不像 JS 再列入 unresolved。
9. 按 evtId 合并写回 `_raw/{文档名}.impl.json`。**不要覆盖 hint / confirmed。**
10. 写回后立刻重渲 HTML（`render-html` / `lockImplFile` 会把记忆回填进未确认条）。若该条 `needsConfirm` 且尚未 `confirmed`：跑 `confirm-event.js --excel=... --evt={evtId} --if-needed --wait`。**本轮第一次**必须打开浏览器；服务已在跑则不再新开 tab。禁止整轮 `--no-open`。用户在页面改完、勾选「已确认」并保存后脚本退出 0，再分析下一条。全部参数 `high` 且落点明确的条不打断（`medium` / `low` 须人工确认）。

`needsConfirm`（任一命中即打断）：
- `status` 为 `unresolved` / `pending`
- `unresolved[]` 非空
- 缺 `targetFile`
- 任一参数 `expression` 为空，或 `confidence` 为 `low` / `medium`
- 有 `uicodeConflict`

**不确定时禁止自由发挥（硬规则）**
- 缺位置：`status: unresolved`，`targetFile` / `functionName` / `lifecycle` 留空。不要猜文件、不要写 `code` / `insertHint` / `evidence`。
- 缺参数取值：该参数 `expression` 留空，`confidence: low`。不要编表达式、不要把分析过程写进字段。用户可在向导里改填备注（`valueKind: prompt`）。
- `unresolved[]` **只允许**短句闭集，禁止散文：`请确认埋点位置`、`请确认参数 {key} 的取值`。uicode 不一致只填 `uicodeConflict`，不要另写说明。
- 对用户（聊天 / 超时提醒）**只列**：`evtId`、事件名、闭集待确认项、向导 URL。禁止附业务流程、禁止附猜测 snippet、禁止附未要求的参数说明。

`confirm-event.js`：复用已在跑的 `serve-impl`（同 slug），否则后台拉起。**仅在新拉起服务（或 `--force-open` / `--wait` 超时）时**打开系统浏览器；已复用服务则只 `--wait`，不新开 tab（向导确认后会同页切到 `nextEvtId`）。`--wait` 默认 600s，轮询该条 `confirmed === true` 或 `deferred === true`。Agent 调脚本时 `block_until_ms` 须大于超时（建议 620000）。超时 exit 2：脚本会再 `open` 一次；聊天只把 URL + 闭集待确认项发给用户。禁止只贴链接、禁止整轮 `--no-open`。

**再做**
- 不要等全部事件写完才开服务。第一次打断由 `confirm-event` 拉起 `serve-impl` 并打开浏览器；后续条只 `--wait`，由向导同页切换，禁止再 `open` 新 tab。
- 全部分析完后再跑一次 `render-html.js` 收尾。
- 若仍有未 `confirmed`，进入路径 B 扫尾。若全程无待确认项，B 仍须开整页确认后才能进 C（见路径 B）。

**交付**
- `{文档名}-落库.html` + 已填落点/参数的 `impl.json`。
- 打断时把当前 evt 的服务 URL 发给用户（浏览器必须已打开）。不要只开本地 HTML（静态只读，无法保存）。

**停**
- 每条 `needsConfirm` 在 `confirm-event --wait` 上停，不要攒到最后再出交互界面。
- 全部分析完后若还有未 `confirmed`，停在 B 扫尾。
- 即使用户选了全流程，未在整份落库页确认「进入 C」前不进入路径 C。

---

## 路径 B：人工矫正（扫尾）

只处理 A 未打断、或打断后仍未处理的条。**禁止整轮 `--no-open`。** 同 slug 服务已在跑时 `confirm-sweep` / `confirm-event` 不新开 tab。B 依赖 A：`needA` 时先走路径 A，不要对空 HTML 开向导。

1. 仍有待确认：`confirm-sweep.js --excel=... --wait`，按 `docIndex` 逐条 `--wait`（默认 http://127.0.0.1:3920）。仅队列第一条在无服务时打开浏览器；后续条复用当前向导页。用户在服务里矫正，不要只开本地文件。勾选「已确认落库内容」后点「确认并继续」；也可「跳过稍后处理」。
2. 队列清空后生成 `{文档名}-矫正.html`。保存后以磁盘 `impl.json` 为准。
3. **进 C 前的整页确认（必做）**：无论过程中是否出现过 `needsConfirm`，启动 C 之前必须跑 `serve-impl.js --excel=...`（不要 `--evt`、不要 `--no-open`），打开整份 `{文档名}-落库.html`，把 URL 发给用户，等用户回复「进入 C」后再进入路径 C。队列已空也不能跳过这一步。

详见 `reference/confirm-flow.md`。

---

## 路径 C：写业务埋点

C 依赖 A+B。禁止在 `events.json` / `impl.json` / 落库 HTML 缺失、impl 全 `pending`、或待确认队列未清时改业务源码。

**前置**：
1. 跑 `tracking-workflow.js --excel=... --run=C --json`（或 `--status`）读 `landing`：
   - `needA`（exit 3）：按路径 A 全文 → 路径 B → 整页确认，禁止只 dump。
   - `needB`（exit 4）：不重跑 A，走路径 B，再整页确认。
   - 队列已清：仍须整页确认。
2. 已打开整份落库页，用户回复「进入 C」（或同等确认）。
3. 用户明确确认改业务源码（`adaptor.sourceRoots`）。「落库到写码 / 全流程」里「进入 C」即视为同意写码。

1. 按矫正后的 `impl.json` 写调用：用该事件的 `styleId` / 落点文件已有写法。DOM 声明式须再确认。`uicode` 必须抄 `events.json`，禁止沿用现网旧值。未配置 `backfill` 时：调用写在已定的 `targetFile`（优先本期），不要为了「多种进入方式」去改无关旧页。`backfill` 时：写在历史 UI 所在 `targetFile`，不要为了本期入口改到新页。参数 `valueKind === 'expression'`（或缺省且像 JS）时，把 `expression` 写入 payload；`valueKind === 'prompt'` 时把 `expression` 当**写码提示词**，禁止当 JS 粘贴，须在该 `targetFile` 追到真实变量后再写入调用，并回写真正的 JS 到 `impl.expression`、`valueKind: expression`。**不要删除旧埋点**（含同文件其它 evtId、本期文档没有的调用）；`status: existing` 只对账/补参，禁止整段删掉再重写到别处（除非用户确认删除）。
2. 写完后先跑 `check-old-tracking.js --json`（默认相对 `HEAD` 的未提交 diff）。`removedCount > 0`（脚本 exit 2）则**立刻停下**，列出 `evtId`、文件、片段，原样问用户（可替换花括号，不得改选项含义）：

```
检测到旧埋点将被删除，请确认是否继续：
1. 保留旧埋点（撤回删除，只写本期新增/原地改参）
2. 确认删除以下旧埋点：{evtId 列表}
未回复前不继续写码、不进 D。
```

未回复则撤回或暂不提交删除。用户选 1 → 恢复被删调用后再继续。用户选 2 → 才允许保留删除并继续补 `accept`。
3. 写完后由模型根据代码补全 `pageKey` + `accept`（`trigger` / `preconditions`≈sharedSteps / `navigatesAway` / `dataDeps`）。先跑 `resolve-entry-path.js --excel=... --json`（可 `--evt=`），按 `lockMode` 写前置；再读 `reference/accept-chain-rules.md`。未配置 `backfill` 时：前置步骤覆盖 `.env` `trackingBaseline`（缺省 `master`）diff 能走到的本期入口（含本期新增跳转边；无新边则 seed→旧页最短路径）。`trackingMode=backfill` 时：即使用户分支上有新跳转，主 `accept` 也不走 `new_jump`，用 `existing_shortest` / `seed_is_page` / `no_inbound`。
4. 不要让用户填配置文件；不要在 skill 脚本写死业务 locator。
5. 跑 `build-accept-chain.js`（可选 `--write-impl` 仅规范化已有 accept）。检查同页聚类、`navigatesAway` 拆 path、pending 缺 pageKey/trigger → 模型补 `impl.json` 后再建链。

**交付**：代码 diff + 更新后的 `impl.json.accept`。若曾检出旧埋点删除，交付里写明用户已确认删除的 evtId。

---

## 路径 D：关键验收

**先做**
1. 确认 `impl.json` 已有 `pageKey` + `accept.trigger`；缺则先补再 `build-accept-chain.js`。
2. `validate-impl.js --excel=...` 无 error 后再继续；`--plan-only` 把路径给用户看。

**确认后跑**
0. **设备选择（硬规则）**：非 `--plan-only` 启动 Playwright 前，若命令与 `.env` 都没有 `device` / `acceptDevice`，必须停下并原样列出（不要替用户选）：

```
请选择 Playwright 打开方式（回复 1 或 2）：
1. 移动端（iPhone 13）
2. PC 端（桌面视口）
未选择前不启动浏览器、不跑验收。
```

用户回复后带 `--device=mobile` 或 `--device=pc` 再跑。也可写仓库根 `.env` 的 `acceptDevice=mobile|pc`。`--plan-only` 可不选设备。
1. `run-accept.js`（可 `--evt=` 精点）。按 adaptor.sdkId 注入 SDK hook（默认拦 `$ULOG.send`），发出时抄到 sessionStorage 与 Playwright binding（点击后跳走仍能对账）。上报 GIF 挂在 BrowserContext 的 request/response，并拦 Image.src / sendBeacon 做 persist：跳页打断响应仍算已捕获请求。同 path 内若某条 click 阻断后续，脚本自动 skip 该条并恢复种子入口继续；漏判时对话模型可 `--skip-evt=` 再跑 1 轮。
2. 根目录 `.env`：`baseUrl`=origin，`seedUrl`=完整 path+query（禁止删减）。`trackingBaseline` 仅用于 A/C 锁定本期入口（缺省 `master`），`run-accept` 不读。每条 path 都 `goto(seed)` 再点到子页。
3. Playwright 视口由 `--device` 决定：`mobile` = iPhone 13（390×844，touch + iPhone UA）；`pc` = 1440×900 桌面 UA。遇登录页先登录，态写入 `docs/tracking/.auth/storage.json` 复用。click / sharedSteps 先等 DOM `attached`，不在可视区则 `scrollIntoView`（含内部滚动容器兜底）后再点；禁止因「未进视口」当成找不到节点。
4. 报告每条三图：`accept/shots/{evtId}.png`（滚入视口后、click 前截按钮；view 在 trigger 后截视口）+ `accept/shots/{evtId}-page.png`（按钮所在完整页面，含内部滚动容器兜底）+ `_raw/images/{evtId}.png`。验收 JSON / HTML 写入当时完整 `pageUrl`（可复制）。
5. 失败会额外写 `accept/_diagnostics/{evtId}-*.json/png`，含当前 URL、标题、可见候选元素、已采集日志和失败截图，用于快速修 trigger / sharedSteps。

**断言要点**（详 `reference/accept-assert.md`）
- 必须发出：evtId + eventType；`uicode` 以文档为准，有 expect 则必须一致（空上报也 fail）。
- 必须捕获上报 GIF（测试 `check.gif` / 线上 `alliance.gif`）。请求已发出即算捕获（含跳页导致无响应）。完全未捕获 → `fail`。HTTP 非 2xx 只展示、不改 pass/fail。
- `'-'` / 空 / 缺失 → 不判 fail，写入 `emptyParams`，`summary.needConfirm` 提醒人工确认。
- plan-only 的 skip 不算失败。
- 同 path 上某条 click 离开页面或点完后下一条找不到目标：脚本自行把本条标为 **路径跳过**（`reason=path_blocker` + `skipReason`），恢复种子入口后继续后续埋点。用户无需事先勾选。对话模型若发现连锁失败漏判，可对挡路 evtId **最多再跑 1 轮** `--skip-evt=`（仍算 D，不算 E）。
- 找不到点击目标（未点下去）仍记 **fail**，不因「怕挡住后面」改成 skip。

**交付**
- `accept/{文档名}-验收.html`（含 `fired.action` 与 `http` 状态，如 `200 OK`）。
- 真实验收（非 plan-only）**无论 fail/skip 多少** 都生成 `{文档名}-终稿.html` 并打开；终稿是结果快照。plan-only 不生成终稿。`--no-open` 可关掉自动打开。

**验收失败（硬规则）**
1. 按 `reference/accept-fail-explain.md` **原样结构**输出总览（状态句 → 验收失败 → 通过 → 报告 → C 落点 → 请选择）。禁止只贴 evtId / `not_fired`。
2. 对每条 `status=fail`：读 `results[].reasonZh`、`failFacts` / `failFactsZh` 与 `accept/_diagnostics/`；主文案用中文判定名（如「事件未触发」），机器码只可写在括号里。
3. 由**当前对话模型**写一句根因。不得改写脚本判定（`fired` 为空就不能说已触发）。有把握时把全文写入该条 `failExplain` 并重渲验收 HTML。
4. 给出验收 HTML 与 `accept/_diagnostics/`。
5. **必须原样列出两个选择**（不要增删、不要替用户选）。未回复 → 停在报告，**不改代码、不进入 E、不打开 B**。
6. 用户选 **1 自修复** → 进入路径 E，只修 1 轮；仍失败则自动打开人工矫正页（路径 B，禁止整轮 `--no-open`；服务已在跑则 `--force-open` 打开失败 evtId），优先带失败 evtId。
7. 用户选 **2 直接重新进入人工矫正页面** → 跳过 E，立刻跑路径 B（`serve-impl` / `confirm-event --force-open` 或 `confirm-sweep`，禁止整轮 `--no-open`），打开失败项矫正向导。

D 失败结束时**必须原样列出**（可替换花括号内容，不得改选项含义）：

```
请选择下一步（回复 1 或 2）：
1. 自修复（进入 E；修复失败后会自动打开人工矫正页面）
2. 直接重新进入人工矫正页面
未选择前不改代码、不进 E、不打开 B。
```

---

## 路径 E：空值自修复

**触发（须用户明确同意）**：用户点名「自修复 / 修空值 / 诊断空值」，或 D 验收失败后用户选择「1 自修复」。禁止因 `needConfirm > 0` 或 fail>0 擅自开修。

1. `diagnose-empty.js` → 读 `accept/{文档名}-空值修复.json`。
2. 对每条 `issues[]`：对照 `targetFile` 真实埋点调用、落库 expression/sourcePath/hint、验收 `fired`，校正 `category`（脚本仅为启发式）。分类见 `reference/accept-assert.md`。
3. **默认可写**：`impl.json` 的 `expression` / `sourcePath` / `accept.dataDeps|waitApis`（`fix_expression` / `fix_accept_timing`）。写完按需 `build-accept-chain.js`，对受影响 evtId `run-accept.js --evt=`，更新验收与终稿；回写 `proposedFix.applied=true` 与 `modelNotes`。
4. **禁止擅自改**业务源码：`needs_prop_plumb` / `needs_product_decision` 只填方案交用户；同意后再改。
5. `data_genuinely_empty`：标注可忽略，不改代码。
6. **最多 1 轮**。重验仍失败或仍空 → **不再自修复**，把验收 HTML、空值修复 JSON、终稿（若有）交给用户，并**自动打开人工矫正页**（路径 B，禁止整轮 `--no-open`；优先 `confirm-event --force-open --evt={失败evtId}`）。

---

## 路径 F：历史埋点关系

**触发**：用户说「梳理历史埋点 / 历史埋点关系 / 扫描已有埋点」，或 Agent 判断需要扫历史。先输出上面的扫描命令，等用户确认后再执行；未确认则跳过 F。

1. 仓库根执行 `scan-history-tracking.js`。**不读** `.env` seedUrl。
2. 探测 adaptor → 扫路由表 + 封装/`$ULOG.send` + `history.push`。规则见 `reference/history-tracking.md`。
3. 写出 `docs/historyTracking/YYYY/MMDD_HHmmss.html`（另存同名 `_raw/*.json`）。
4. 把绝对路径和 `file://` URL 发给用户。`--open` 可用系统浏览器打开。

**交付**：HTML 关系图（页面与埋点 + 页面跳转）。不改业务源码。

---

## 入口 7：文档 vs 代码缺失埋点列表

**触发**：用户回复 **7**，或说「缺失埋点列表 / 文档 vs 代码 / 哪些埋点没落地」。不跑 A–F，不对业务源码改写。

1. 取 `--excel=` / 用户给出的 xlsx。无可用文件则**原样询问**「需要梳理哪个历史埋点文档的数据，请给出该历史埋点 excel」，未回复不继续。
2. 仓库根执行 `diff-doc-vs-history.js --excel=docs/{文件名}.xlsx`。缺 `events.json` 时脚本会 `--skip-images` dump；缺扫描 JSON 时会先 `scan-history-tracking`。
3. 只比 **evtId 字面量**：文档有、历史扫描无 → 缺失。动态拼接 / 注释掉的调用会误报缺失。
4. 把缺失表交给用户（控制台 + `{文档名}-缺失埋点.html` / `.json`）。完整则说明文档 evtId 均已出现在扫描结果中。缺失表**不是**写码许可；要补全走入口 8 / 路径 H。

```bash
node <skillDir>/scripts/history/diff-doc-vs-history.js --excel=docs/2.6埋点需求文档.xlsx
node <skillDir>/scripts/history/diff-doc-vs-history.js --excel=docs/2.6埋点需求文档.xlsx --scan-json=docs/historyTracking/2026/_raw/0831_165400.json
```

---

## 路径 H：补全历史缺失埋点

**触发**：用户回复 **8**，或说「补全历史埋点 / 补缺失埋点 / 把缺失埋点写进代码 / `--run=H`」。不自动进 D/E。禁止无缺失表、未确认「进入 C」就改 `adaptor.sourceRoots`。

**前置 Excel**：与入口 7 相同。已有 `{文档名}-缺失埋点.json` 且能对上文档时，可直接用该 Excel，不必再问路径。既无 xlsx 也无缺失 JSON 时，原样询问「需要梳理哪个历史埋点文档的数据，请给出该历史埋点 excel」。

1. **门禁**：跑 `tracking-workflow.js --excel=... --run=H --json`（或先 `--status`）。
   - 无缺失 JSON（exit 5 / `needMissingList`）：先完整跑入口 7，禁止只凭对话记忆写码。
   - `missingCount === 0` 且无待分类假缺失：停，说明已完整，不写业务源码。
   - 有 `missing[]`：列出 evtId，进入假缺失分流。
2. **假缺失分流**（模型执行，不强制新脚本）。对每条 missing Grep `sourceRoots`：
   - `dynamic_id`：evtId 运行时拼接 / 非字面量 → 标扫描误报，不新增字面量调用。
   - `commented_out`：整段注释 → 问用户恢复注释或按现写法重开。
   - `feature_removed`：功能已下线 → 用户确认后跳过，不写码。
   - `literal_missing`：真实缺失 → 进入路径 A（只分析这些 evtId）。
3. **`trackingMode`**：要用旧页优先时提示写 `trackingMode=backfill`。未写则全局查找 + `trackingBaseline` 多入口优先级，写码仍只限 literal_missing。
4. **A**：只分析 missing 中的 `literal_missing`。`found[]` 标 `existing`，禁止重写/挪位置。dump / 示意图复用该文档已有 `_raw`。`needsConfirm` 当场 `confirm-event --wait`。
5. **B**：与现网相同；进 C 前 `serve-impl` 打开整份落库页，等「进入 C」。
6. **C**：只新增缺失 evtId（或同一 evtId 原处改参）。`check-old-tracking.js`；有删除则停下二选一。`backfill` 时 accept 按上节不走 `new_jump`。
7. **收尾**：再跑入口 7。`missingCount === 0`（或仅剩已标记的假缺失）才算补全完成。用户点名再跑 D，且仍要选 device。

**交付**：业务 diff（仅 missing）+ 更新后的 `impl.json` + 新的缺失表。假缺失 evtId 写进交付说明，不要改成字面量骗绿。

---

## 脚本速查

`<skillDir>` = 当前加载的本 Skill 目录（`SKILL.md` 所在目录）。仓库根执行。脚本按阶段分子目录：`lib/` 基础设施、`extract/` 落库、`confirm/` 矫正、`accept/` 验收、`history/` 历史埋点、`workflow/` 编排。

```bash
node <skillDir>/scripts/extract/dump-excel.js --excel=docs/2.3埋点需求文档.xlsx
node <skillDir>/scripts/extract/dump-excel.js --excel=docs/2.3埋点需求文档.xlsx --image-workers=6
node <skillDir>/scripts/extract/detect-adaptor.js --excel=docs/2.3埋点需求文档.xlsx
node <skillDir>/scripts/workflow/tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --status
node <skillDir>/scripts/workflow/tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=A
node <skillDir>/scripts/workflow/tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=B --json
node <skillDir>/scripts/workflow/tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=C --json
node <skillDir>/scripts/workflow/tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=H --json
node <skillDir>/scripts/accept/validate-impl.js --excel=docs/2.3埋点需求文档.xlsx
node <skillDir>/scripts/workflow/doctor.js --excel=docs/2.3埋点需求文档.xlsx
node <skillDir>/scripts/extract/render-html.js --excel=docs/2.3埋点需求文档.xlsx
node <skillDir>/scripts/confirm/serve-impl.js --excel=docs/2.3埋点需求文档.xlsx
node <skillDir>/scripts/confirm/serve-impl.js --excel=docs/2.3埋点需求文档.xlsx --evt=95936
# 必须自动打开浏览器（首次打断）；同 slug 已在跑则复用且不新开 tab；禁止整轮 `--no-open`；3920 占用时试到 3930
node <skillDir>/scripts/confirm/confirm-event.js --excel=docs/2.3埋点需求文档.xlsx --evt=95936 --if-needed --wait
# 打开 ?evt=&mode=confirm 向导；`--wait` 直到 confirmed 或 deferred；高置信且 --if-needed 则 skipped；超时或需再开 tab 用 --force-open
node <skillDir>/scripts/confirm/confirm-sweep.js --excel=docs/2.3埋点需求文档.xlsx --wait
# 按 docIndex 逐条扫待确认队列，全部处理后生成 {文档名}-矫正.html
node <skillDir>/scripts/accept/check-old-tracking.js --json
node <skillDir>/scripts/accept/check-old-tracking.js --vs=baseline --json
node <skillDir>/scripts/accept/resolve-entry-path.js --excel=docs/2.3埋点需求文档.xlsx --json
node <skillDir>/scripts/accept/resolve-entry-path.js --excel=... --evt=96793
node <skillDir>/scripts/accept/build-accept-chain.js --excel=docs/2.3埋点需求文档.xlsx --write-impl
node <skillDir>/scripts/accept/run-accept.js --excel=docs/2.3埋点需求文档.xlsx --plan-only
node <skillDir>/scripts/accept/run-accept.js --excel=docs/2.3埋点需求文档.xlsx --device=mobile
node <skillDir>/scripts/accept/run-accept.js --excel=docs/2.3埋点需求文档.xlsx --device=pc --evt=95941,95942
node <skillDir>/scripts/accept/run-accept.js --excel=docs/2.3埋点需求文档.xlsx --device=mobile --skip-evt=95936
node <skillDir>/scripts/accept/diagnose-empty.js --excel=docs/2.3埋点需求文档.xlsx
node <skillDir>/scripts/accept/render-final.js --excel=docs/2.3埋点需求文档.xlsx
node <skillDir>/scripts/history/scan-history-tracking.js
node <skillDir>/scripts/history/scan-history-tracking.js --open
node <skillDir>/scripts/history/diff-doc-vs-history.js --excel=docs/2.6埋点需求文档.xlsx
```

Playwright（优先本机 Chrome，`channel=chrome`）：

```bash
npm i -D playwright --prefix <skillDir> --registry=https://registry.npmjs.org
```

## 产物约定

```
docs/tracking/impl/{文档名}/
├── _raw/{文档名}.events.json
├── _raw/{文档名}.impl.json
├── _raw/adaptor.json
├── _raw/accept-chain.json
├── _raw/workflow.json
├── _raw/serve.json
├── _raw/images/{evtId}.png
├── _raw/hints/{evtId}/{paramKey}.png
├── _raw/apis.json
├── _raw/field-memory.json
├── {文档名}-落库.html
├── {文档名}-缺失埋点.html
├── {文档名}-缺失埋点.json
├── {文档名}-终稿.html
└── accept/
    ├── {文档名}-验收.json
    ├── {文档名}-验收.html
    ├── {文档名}-空值修复.json
    └── shots/
        ├── {evtId}.png
        └── {evtId}-page.png
```

可选人工锁定（覆盖 sdkId / defaultStyleId）：`docs/tracking/adaptor.json` 或 `.tracking/adaptor.json`。

历史埋点关系（路径 F）：

```
docs/historyTracking/YYYY/MMDD_HHmmss.html
docs/historyTracking/YYYY/_raw/MMDD_HHmmss.json
```

## impl.json 约定

```json
{
  "events": [
    {
      "evtId": "95936",
      "status": "existing",
      "accepted": false,
      "confirmed": false,
      "targetFile": "client/src/pages/priceV2/HomeV2/components/stats/DealRangeCard/index.jsx",
      "functionName": "handleViewRefClick",
      "lifecycle": "onClick",
      "pageKey": "homeV2",
      "styleId": "wrapper-sendLog",
      "entryUrlTemplate": "/priceV2/homeV2?housedelCode=107114981089",
      "insertHint": "点击「查看成交参考」时发送",
      "evidence": ["示意图文案匹配 DealRangeCard", "代码已有封装调用 95936"],
      "uicodeConflict": "",
      "code": "sendLog('Module_Click', '95936', 'a_app', 'aiprice2/home', {\n  housedel_id: housedelCode || '-'\n})",
      "parameters": [
        {
          "key": "housedel_id",
          "docDesc": "房源id",
          "expression": "housedelCode || '-'",
          "valueKind": "expression",
          "sourcePath": "URL query / 页面变量",
          "confidence": "high",
          "hint": {
            "images": [],
            "note": "",
            "api": { "url": "", "field": "" }
          }
        }
      ],
      "accept": {
        "trigger": {
          "kind": "click",
          "by": "testid",
          "value": "homeV2-deal-range-view-ref",
          "alternates": ["AI估价", "专家估价"],
          "preconditions": []
        },
        "navigatesAway": false,
        "assertParams": ["housedel_id"],
        "dataDeps": [
          { "paramKey": "housedel_id", "from": "url", "queryKey": "housedelCode" }
        ]
      },
      "unresolved": []
    }
  ]
}
```

上例 `code` 里的 `sendLog` 来自该仓 `_raw/adaptor.json` 探测到的封装，**不是 Skill 内置写法**。无封装的仓应写成 `$ULOG.send(...)`。

- `styleId`：adaptor.styles[].id（`sdk-send` / `wrapper-*` / v3 便捷方法 / `dom-attr`）
- `status`：`existing` 已落地 · `located` 已定位未写 · `unresolved` 找不到落点 · `pending` 未分析
- `accepted`：仅 `status === existing` 可 true；非已落地强制 false。自动验收不自动回写该字段（除非用户要求）
- `confirmed`：人工在落库页确认过这条埋点；任意 status 可 true。A 打断时用户勾选写入；全部参数 `high` 未打断的条可仍为 false，由 B 扫尾。合并写回不要覆盖
- `pageKey` + `accept`：模型按代码填写；`build-accept-chain.js` 只聚合/校验。缺 `pageKey` 或 `accept.trigger.kind` → pending
- **禁止**在 `impl.json` 写 `uicode` 字段；snippet / 业务调用里的 uicode 必须等于 `events.json` 同 evtId 的值，脚本会强制改回
- `confidence`：`high` / `medium` / `low`。`medium` / `low` 或表达式/备注为空 → 人工确认；不要因 `medium` 写入 `unresolved[]`
- `valueKind`：`expression`（可写入源码的 JS）或 `prompt`（自然语言备注，路径 C 当提示词）。未标时由脚本按内容粗判；含中文说明视为 `prompt`
- `fromMemory` / `fromEvtId`：参数由同文档上次确认值回填时由脚本写入；不因此跳过确认
- `hint`：人工矫正写入；`_raw/apis.json` 可手写接口目录供 HTML 下拉，本轮不自动抽接口
- 找不到图/文件/参数：缺示意图按 dump 失败处理，禁止继续分析；缺位置/参数时 `unresolved` 只写闭集短句（位置 / 参数 key），继续下一条，不用页面名称兜底，不写其它说明
