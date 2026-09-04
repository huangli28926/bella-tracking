# 执行 nextTask（按需读）

先跑：

```bash
node scripts/workflow/tracking-workflow.js --excel=docs/{文档名}.xlsx --status --json
```

然后：

- 只执行返回的 `nextTask.command`（仓库相对 `node scripts/...`）。
- 若 `prompt` 非空，原样发给用户，不要改写菜单或设备选项。
- `executor=agent` 时按 SKILL 做 HOW（分析/写码），做完再 `--status --json`。
- `--run=A` 只 dump+render，不等于路径 A 完成，不要 `completeStage(A)`。
