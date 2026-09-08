# 执行 nextTask（按需读）

初始化只允许先跑（用户消息里已有路径再带 `--excel=`，没有路径不要编造、不要列出 `docs/`）：

```bash
node scripts/workflow/tracking-workflow.js --status --json
# 或
node scripts/workflow/tracking-workflow.js --excel=docs/{文档名}.xlsx --status --json
```

Excel 门禁（先于入口）：

- 未给 `--excel=`：`ASK_EXCEL`，prompt 为 `prompts.ASK_EXCEL`（要求用户给出路径，禁止扫描代选），`nextAction=ask_excel`
- `--excel=` 路径不存在或不是 xlsx：`ASK_EXCEL_INVALID`，prompt 为 `当前埋点文档路径无效，请核实后，重新输入`
- 入口 7/8 且无可用 xlsx：`ASK_HISTORY_EXCEL`，prompt 为 `ASK_HISTORY_EXCEL` 常量

用户已明确入口时加 `--entry=1..8` 或 `--run=A|B|C|D|H`。有效文档已给出、未带且 `workflow.json` 无 `entry` 时：

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
