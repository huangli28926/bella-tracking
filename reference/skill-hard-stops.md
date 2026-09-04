# 硬性禁止与定位规则

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
- 选 7 或 8 且无可用埋点 Excel、也无 `{文档名}-缺失埋点.json` 时不打印 `prompts.ASK_HISTORY_EXCEL` 就开跑 dump/扫描/对账/写码
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
