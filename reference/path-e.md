# 路径 E：空值自修复

**触发（须用户明确同意）**：用户点名「自修复 / 修空值 / 诊断空值」，或 D 验收失败后用户选择「1 自修复」。禁止因 `needConfirm > 0` 或 fail>0 擅自开修。

1. `diagnose-empty.js` → 读 `accept/{文档名}-空值修复.json`。
2. 对每条 `issues[]`：对照 `targetFile` 真实埋点调用、落库 expression/sourcePath/hint、验收 `fired`，校正 `category`（脚本仅为启发式）。分类见 `reference/accept-assert.md`。
3. **默认可写**：`impl.json` 的 `expression` / `sourcePath` / `accept.dataDeps|waitApis`（`fix_expression` / `fix_accept_timing`）。写完按需 `build-accept-chain.js`，对受影响 evtId `run-accept.js --evt=`，更新验收与终稿；回写 `proposedFix.applied=true` 与 `modelNotes`。
4. **禁止擅自改**业务源码：`needs_prop_plumb` / `needs_product_decision` 只填方案交用户；同意后再改。
5. `data_genuinely_empty`：标注可忽略，不改代码。
6. **最多 1 轮**。重验仍失败或仍空 → **不再自修复**，把验收 HTML、空值修复 JSON、终稿（若有）交给用户，并**自动打开人工矫正页**（路径 B，禁止整轮 `--no-open`；优先 `confirm-event --force-open --evt={失败evtId}`）。

---
