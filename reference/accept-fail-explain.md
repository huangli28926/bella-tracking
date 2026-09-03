# 验收失败中文说明 + 模型归因

脚本只提供**事实**和中文判定名。根因由**当前对话模型**写。禁止用英文机器码（`not_fired` 等）作为对用户的主文案。

## 分工

| 层 | 谁 | 字段 |
|---|---|---|
| 判定 | `run-accept.js` | `reason`（机器码，给脚本） |
| 中文码 | `format-fail-explain.js` | `reasonKind` / `reasonZh` / `failFacts` / `failFactsZh` |
| 归因 | 对话模型 | 对话里的完整说明；有把握时写回 `results[].failExplain` 再 `render-accept-report.js` |

模型**不得改写**脚本判定：`fired` 为空就不能说已经触发。

## `reason` → 中文

| `reason` / 前缀 | `reasonZh` |
|---|---|
| `not_fired` | 事件未触发 |
| `param_mismatch` | 参数不一致 |
| 含「未捕获到埋点上报 GIF」 | 未捕获上报 GIF |
| `eventType 期望…` | 事件类型不一致 |
| `uicode 期望…` | uicode 不一致 |
| `DOM 中找不到 click …` | 找不到点击目标 |
| `DOM 中找不到 …` | 找不到前置步骤节点 |
| `plan-only` | 仅计划未执行 |
| `path_blocker` | 路径阻断已跳过 |

## 对用户输出格式（中文，必用）

D `fail>0` 时先出**总览**（结构固定，禁止改成单一「是否自动修复」），再按需展开单条归因。

### 总览（必用，结构对齐）

```
阶段 C 已写完，并已跑 D 验收。

**验收失败**
- 失败：{evtId}、{evtId}（{reason}，主文案用「{reasonZh}」）
- 原因：{模型一句根因，须能被 failFacts 支撑}

**通过**
- {evtId}、{evtId}…

**报告**
- accept/{文档名}-验收.html
- accept/_diagnostics/

**C 落点**
- {targetFile 或页面名}：{evtId} {事件名}、…

请选择下一步（回复 1 或 2）：
1. 自修复（进入 E；修复失败后会自动打开人工矫正页面）
2. 直接重新进入人工矫正页面
未选择前不改代码、不进 E、不打开 B。
```

- 「阶段 C 已写完」按实际改：若本轮只跑 D，写成「已跑 D 验收」。
- 失败行可带机器码作括号备注，**主文案仍是 reasonZh**（禁止只写 `not_fired`）。
- **C 落点**按本轮写入的 `targetFile` 聚类，列出 evtId + 事件名。
- 未得到 1 或 2 前禁止进 E、禁止打开 B。

### 单条展开（需要解释时）

```
{evtId}「{事件名}」验收失败，直接判定原因是「{reasonZh}」：{一句话}。

具体是这样：

1. 主因：「{reasonZh}」
验收步骤：… → …
失败时页面：{url}（标题）
当时可见：…
要点击 / 触发：…
结合诊断 / 代码的结论（模型写，须能被 failFacts 支撑）

2. 附带提示
- uicode 冲突、HTTP 200 已落地等 — 标明是否主因
```

`failFactsZh` 是脚本事实稿，可当骨架；模型补「为什么会停在这页 / 为什么点不到」。

## 模型必读

1. `accept/{文档名}-验收.json` 里该条的 `failFacts`、`failFactsZh`、`steps`、`http`、`paramDiffs`
2. `accept/_diagnostics/{evtId}-*.json`：`url`、`title`、`trigger`、`visibleCandidates`
3. 必要时 `targetFile` 里真实埋点调用

## 禁止

- 对用户只输出 `not_fired` / `param_mismatch`
- D 失败后只问「是否自动修复」，不给出「自修复 / 直接人工矫正」二选一
- 用户未选 1/2 就进 E 或打开 B
- 编造 fired.action 或未出现在诊断里的按钮文案
- 把 `uicodeConflict` 当成主因，除非 `reasonZh` 就是「uicode 不一致」
