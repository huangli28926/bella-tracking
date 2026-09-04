# 路径 C：写业务埋点

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

文案只使用 `scripts/workflow/prompts.js` 的 `formatDeleteOldTracking` / `DELETE_OLD_TRACKING`（`check-old-tracking` stdout）。

未回复则撤回或暂不提交删除。用户选 1 → 恢复被删调用后再继续。用户选 2 → 才允许保留删除并继续补 `accept`。
3. 写完后由模型根据代码补全 `pageKey` + `accept`（`trigger` / `preconditions`≈sharedSteps / `navigatesAway` / `dataDeps`）。先跑 `resolve-entry-path.js --excel=... --json`（可 `--evt=`），按 `lockMode` 写前置；再读 `reference/accept-chain-rules.md`。未配置 `backfill` 时：前置步骤覆盖 `.env` `trackingBaseline`（缺省 `master`）diff 能走到的本期入口（含本期新增跳转边；无新边则 seed→旧页最短路径）。`trackingMode=backfill` 时：即使用户分支上有新跳转，主 `accept` 也不走 `new_jump`，用 `existing_shortest` / `seed_is_page` / `no_inbound`。
4. 不要让用户填配置文件；不要在 skill 脚本写死业务 locator。
5. 跑 `build-accept-chain.js`（可选 `--write-impl` 仅规范化已有 accept）。检查同页聚类、`navigatesAway` 拆 path、pending 缺 pageKey/trigger → 模型补 `impl.json` 后再建链。

**交付**：代码 diff + 更新后的 `impl.json.accept`。若曾检出旧埋点删除，交付里写明用户已确认删除的 evtId。

---
