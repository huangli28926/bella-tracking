# P1-5 Parameter Contract（Agent 短合同）

AI 找候选、标 `semanticCompatible` / `preferred`、写 Lineage 与 `acquisition.steps` 提案。

程序独占：`scopeReachable`、`confidence`、`sourceUniqueness`、`pathUniqueness`、`impact.referenceCount`、`acquisition.status`、`parameterImplementable`。

规则：
- 同 key 扫描候选必须完整；禁止丢弃竞争项。
- 只在最高优先级档内 conflict。
- 多跳任一步 `referenceCount > 1` → 不自动 READY。
- 图片只能用 `ui-object-match`（Supporting），不能单独 high。
- `unresolvedCodes` 对内；对外仍映射 `请确认参数 {key} 的取值`。

写回 impl 后必须 `normalize-impl` + `validate-impl`。
