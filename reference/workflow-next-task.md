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
- `executor=agent` 时按对应 `reference/path-*.md` 做 HOW，做完再 `--status --json`。
- `--run=A` 只 dump+render，不等于路径 A 完成，不要 `completeStage(A)`。
- 入口 7/8 且无可用 xlsx：`ASK_HISTORY_EXCEL`，prompt 为 `ASK_HISTORY_EXCEL` 常量。
