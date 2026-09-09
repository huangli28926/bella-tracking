# 路径 B：人工矫正（扫尾）

只处理 A 未打断、或打断后仍未处理的条。**禁止整轮 `--no-open`。** 同 slug 服务已在跑时 `confirm-sweep` / `confirm-event` 不新开 tab。B 依赖 A：`needA` 时先走路径 A，不要对空 HTML 开向导。

1. 仍有待确认：`confirm-sweep.js --excel=... --wait`，按 `docIndex` 逐条 `--wait`（默认 http://127.0.0.1:3920）。**每条都打开确认页**；确认或跳过后关页，再处理下一条。用户在服务里矫正，不要只开本地文件。勾选「已确认落库内容」后点「确认并关闭」；也可「跳过稍后处理」。
2. 队列清空后生成 `{文档名}-矫正.html`。保存后以磁盘 `impl.json` 为准。
3. **进 C 前的整页确认（必做）**：无论过程中是否出现过 `needsConfirm`，启动 C 之前必须跑 `serve-impl.js --excel=...`（不要 `--evt`、不要 `--no-open`），打开整份 `{文档名}-落库.html`，把 URL 发给用户，等用户回复「进入 C」后再进入路径 C。队列已空也不能跳过这一步。

详见 `reference/confirm-flow.md`。

---

用户可见的整页确认 / 单条确认文案由 `scripts/workflow/prompts.js` 打印（FULL_PAGE_PROMPT / formatConfirmEvent），不要在对话里另写一份。
