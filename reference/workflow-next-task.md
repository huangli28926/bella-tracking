# 执行 nextTask（按需读）

先跑：

```bash
node scripts/workflow/tracking-workflow.js --excel=docs/{文档名}.xlsx --status --json
```

用户已明确入口时加 `--entry=1..8` 或 `--run=A|B|C|D|H`。未带且 `workflow.json` 无 `entry` 时：

```text
nextTask.id = CHOOSE_ENTRY
nextAction = choose_entry
prompt = scripts/workflow/prompts.js 的 ENTRY_MENU
exit 10
```

把 `prompt` 原样发给用户，不要改写菜单或设备选项，不要从 SKILL 补一份。

然后：

- 只执行返回的 `nextTask.command`（仓库相对 `node scripts/...`）。
- `executor=agent` 时只交单 evt patch 给 `apply-impl-patch.js`，再 `--status --json`。
- 给人看的阶段收尾只转发脚本 `report` / `format-stage-report` stdout，不要改写。
- `--run=A` 只 dump+render，不等于路径 A 完成，不要 `completeStage(A)`。
- `--mark` 已禁用（exit 20）。整页确认进 C：`serve-impl.js --enter-c`。
- apply / assert 非 0：停，禁止改 command 强写。
- 入口 7/8 且无可用 xlsx：`ASK_HISTORY_EXCEL`，prompt 为 `ASK_HISTORY_EXCEL` 常量。
