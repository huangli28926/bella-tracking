# 历史埋点（F / 7 / H）

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

1. 取 `--excel=` / 用户给出的 xlsx。无可用文件则**原样询问**「`prompts.ASK_HISTORY_EXCEL`（`diff-doc-vs-history` / `--entry=7|8` 无 xlsx 时 stdout）」，未回复不继续。
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

**前置 Excel**：与入口 7 相同。已有 `{文档名}-缺失埋点.json` 且能对上文档时，可直接用该 Excel，不必再问路径。既无 xlsx 也无缺失 JSON 时，原样询问「`prompts.ASK_HISTORY_EXCEL`（`diff-doc-vs-history` / `--entry=7|8` 无 xlsx 时 stdout）」。

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
