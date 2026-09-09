# 路径 A：落库文档

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
8. 参数解析顺序：已有 `expression`（及 `valueKind`）→ `_raw/field-memory.json`（或同文档已确认事件）同 key 上次确认值 → `hint.api` → hint 图/note + 示意图 → 仓级惯例 → 同文件已有埋点 → 按「用途说明」追变量。扫描到的候选全部写入 `candidates[]`，禁止丢弃。同档能排出唯一最佳候选时写入 `expression` / `preferredCandidateId`；同档完全打平则 `expression` 可空，但 `candidates[]` 必须保留，交给确认页选择。只有源码里没有可用候选时才把 `expression` 留空。`confidence` 由程序推导；`medium` / `low` **不得清空**已有 `expression`。记忆只回填空表达式，禁止覆盖任何已有候选；记忆回填后 `confidence` 为 `medium`，**仍须人工确认**。代码里已有调用优先于记忆。不回填 `targetFile` / `uicode`。用户在落库页可 **确认 / 修改 / 从候选中选择**，或在无候选时填 **JS 表达式** / **备注**（`valueKind: prompt`）。备注非空也算已给出取值。
8b. **每次**根据当前源码重建参数事实（禁止因上一轮 `confirmed` / `confirmation.status` 跳过定位与 sourcePath）。若上一份 impl 同 `evtId`+`key` 已有 `confirmation.status=confirmed|reused`：用 `validate-confirmation-reuse.js` 的 `applyConfirmationReuse(previous, current)` 写入 `reused` 或 `stale`。不得手写 `reused`。`stale` 只表示旧确认失效，**不等于** `needsConfirm=true`；当前事实仍走 P1-2 / P1-3。`field-memory` 不是 confirmation reuse。
9. 按 evtId 合并写回 `_raw/{文档名}.impl.json`。**不要覆盖 hint / confirmed。**
10. 写回后立刻重渲 HTML（`render-html` / `lockImplFile` 会把记忆回填进未确认条）。若该条 `needsConfirm` 且尚未 `confirmed`：跑 `confirm-event.js --excel=... --evt={evtId} --if-needed --wait`。**每次打断都打开浏览器**（服务可复用，tab 必须新开或重新打开该条 URL）。禁止整轮 `--no-open`。用户勾选「已确认」并点「确认并关闭」（或跳过）后关页，脚本退出 0，再分析下一条。全部参数 `high` 且落点明确的条不打断（`medium` / `low` 须人工确认）。

`needsConfirm`（任一命中即打断）：
- `status` 为 `unresolved` / `pending`
- `unresolved[]` 非空
- 缺 `targetFile`
- 任一参数 `expression` 为空，或 `confidence` 为 `low` / `medium`
- 有 `uicodeConflict`

**不确定时禁止自由发挥（硬规则）**
- 缺位置且源码没有可排序的落点证据：`status: unresolved`，`targetFile` / `functionName` / `lifecycle` 留空。不要猜文件。有证据的最佳落点必须预填，即使仍需人工确认。
- 缺参数取值且没有可用候选：该参数 `expression` 留空。不要编造源码中不存在的变量。有证据的最佳候选必须预填并保留 `candidates[]`。不要把分析过程写进事件级 `unresolved[]`。
- `unresolved[]` **只允许**短句闭集，禁止散文：`请确认埋点位置`、`请确认参数 {key} 的取值`。uicode 不一致只填 `uicodeConflict`，不要另写说明。
- 对用户（聊天 / 超时提醒）**只列**：`evtId`、事件名、闭集待确认项、向导 URL。禁止附业务流程、禁止附猜测 snippet、禁止附未要求的参数说明。

`confirm-event.js`：复用已在跑的 `serve-impl`（同 slug），否则后台拉起。**每条需要确认都打开系统浏览器**（不因服务已复用而跳过 `open`）。确认或跳过后关闭该条确认页，再分析下一条。`--wait` 默认 600s，轮询该条 `confirmed === true` 或 `deferred === true`。Agent 调脚本时 `block_until_ms` 须大于超时（建议 620000）。超时 exit 2：脚本会再 `open` 一次；聊天只把 URL + 闭集待确认项发给用户。禁止只贴链接、禁止整轮 `--no-open`。

**再做**
- 不要等全部事件写完才开服务。每条 `needsConfirm` 由 `confirm-event` 打开浏览器；确认后关页，再分析下一条，需要时再开。
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
