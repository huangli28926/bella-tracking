# bella-tracking 跨 Agent 最终版变更

本版以 `bella-tracking_v6_codex` 为基线，不改变 A→B→C→D 主流程，重点降低 Claude Code / Codex / Cursor 的执行漂移。

## 1. Skill 平台中立化
- frontmatter `name` 从 `bella-tracking_v6_codex` 改为 `bella-tracking`。
- 增加“跨 Agent 执行契约”，禁止依赖平台专属工具名、隐藏状态和对话记忆。
- 固定事实优先级：磁盘事实 > 脚本 JSON > Schema > 模型判断 > 对话文本。

## 2. 新增 normalize → validate 门禁
- 新增 `scripts/accept/normalize-impl.js`。
- 对 status / lifecycle / confidence / valueKind / unresolved 等模型易漂移字段做确定性归一。
- 归一只修格式，不补业务事实。
- `validate-impl.js` 新增 lifecycle 闭集和 unresolved 闭集校验。

## 3. 收紧 impl Schema
- `lifecycle` 由任意字符串收紧为固定枚举。
- `unresolved[]` 仅允许两类确认语句：位置确认、参数取值确认。
- 继续兼容现有 report / confirm / accept 脚本的数据结构，不做破坏性 schema 重构。

## 4. 统一 Agent 返回协议
- 新增 `schemas/task-result.schema.json`。
- 外层 Agent 之间传递阶段结果时统一 stage / status / nextAction / artifacts / issues。
- 聊天自然语言不再作为下一阶段机器输入。

## 5. 确定性输出规则
- JSON 文件必须纯 JSON，不包 Markdown fence。
- 数组保持 docIndex 顺序；同 evtId 只保留一条。
- 路径只写仓库相对 POSIX 路径。
- 不确定事实留空或进入 unresolved，禁止写推测性散文。
