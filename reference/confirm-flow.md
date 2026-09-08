# 矫正向导流程（confirm-flow）

逐条定位埋点 → 有待确认项则**必须打开浏览器**确认 → 确认或跳过后下一条 → 全部处理完生成矫正汇总页 → **进 C 前再打开整份落库页**等用户确认。

## 入口

```bash
# 逐条扫待确认队列（推荐）
node scripts/confirm/confirm-sweep.js --excel=docs/2.3埋点需求文档.xlsx --wait

# 单条打开矫正向导
node scripts/confirm/confirm-event.js --excel=docs/2.3埋点需求文档.xlsx --evt=95936 --if-needed --wait
```

## URL 形态

```
http://127.0.0.1:3920/{文档名}-落库.html?evt={evtId}&mode=confirm
```

- `evt`：定位到当前事件
- `mode=confirm`：进入矫正向导 UI（隐藏侧栏，显示进度条与底部操作栏）

## 向导 UI

| 操作 | 行为 |
|---|---|
| 勾选「已确认落库内容」 | 启用「确认并继续」按钮 |
| 确认并继续 | 写回 `confirmed=true`，自动跳下一条；队列清空则跳转 `{文档名}-矫正.html` |
| 跳过稍后处理 | 写回 `deferred=true`，自动跳下一条；该条暂不进入待确认队列 |

**规则：未勾选「已确认」时，「确认并继续」不可点击。**

向导只展示埋点待确认项（闭集），不要渲染模型散文：

- `请确认埋点位置` → 高亮落点文件 / 函数 / 生命周期
- `请确认参数 {key} 的取值` → 只高亮该参数（表达式为空，或 `confidence` 为 `low` / `medium`）
- `请确认 uicode（文档与落点不一致）` → 只展示冲突字段

聊天超时提醒同样只列 `evtId`、事件名、上述短句、URL。

`unresolved[]` 只允许前两类短句；禁止写入分析过程、猜测代码、业务说明。

## API

### GET `/api/confirm-queue?evt={evtId}`

返回待确认队列、进度与原因列表。

### POST `/api/save-impl`

普通保存与向导保存共用。向导模式额外传 `wizardAction`：

- `confirm`：须 `confirmed=true`
- `skip`：写 `deferred=true`

响应 `wizard` 字段：

```json
{
  "action": "confirm",
  "nextEvtId": "95931",
  "reviewUrl": "",
  "done": false,
  "progress": { "index": 1, "total": 5, "label": "1 / 5" }
}
```

队列全部处理完时 `reviewUrl` 指向 `{文档名}-矫正.html`。

## 同名字段回填

用户确认一条埋点后，其参数 `expression` / `valueKind` / `sourcePath` 按 **key** 写入 `_raw/field-memory.json`。后续未确认事件出现同一 key，且表达式为空或 confidence 为 `low`/`medium` 时，自动回填上次确认值（confidence 设为 `medium`），向导提示「已回填上次确认值」，**仍须勾选确认**。不覆盖 `high` 且非空的表达式；不回填落点文件 / uicode。跳过（deferred）不写入记忆。

`field-memory` 只是跨事件同名 key 的提示回填，**不是** confirmation reuse。同一 `evtId`+`key` 的历史 `confirmation` 必须先按当前源码重建参数事实，再经 `validate-confirmation-reuse` 得到 `reused` 或 `stale`。不得只因为上一轮 `confirmed=true` 就跳过解析。`stale` 不等于 `needsConfirm=true`。

落库页参数栏为「表达式或备注」：可填 JS，也可填自然语言（`valueKind: prompt`），后者在路径 C 作为写码提示词，不直接粘进源码。

## 产物

```
docs/tracking/impl/{文档名}/
├── {文档名}-落库.html      # 矫正页（mode=confirm 为向导）
├── {文档名}-矫正.html      # 全部处理后的汇总页
└── _raw/
    ├── {文档名}.impl.json  # confirmed / deferred 写回
    └── field-memory.json   # 同 key 上次确认的 expression / valueKind / sourcePath
```

## 浏览器打开策略

- 第一次打断：`confirm-event` 拉起 `serve-impl` 并 `open` 矫正向导。
- 同一轮后续条：向导「确认并继续」已在当前 tab 切到 `nextEvtId`；`confirm-event` 发现同 slug 服务在跑则**不再** `open` 新 tab，只 `--wait`。
- `--wait` 超时：脚本再 `open` 一次该条 URL；Agent 也可 `--force-open`。
- 进 C 前的整份落库页：`serve-impl` 无 `--evt`，即使服务已在跑也要打开（与向导 URL 不同）。

## confirm-event --wait 退出条件

- `confirmed === true` → exit 0，status=confirmed
- `deferred === true` → exit 0，status=deferred
- 超时 → exit 2

## 与路径 B 门禁

`tracking-workflow --status` 的待确认队列以 `loadConfirmQueue().pendingCount === 0` 为准（仅统计需确认且未 confirmed、未 deferred 的条数）。

**进 C 前必须整页确认**（与队列是否为空无关）：

```bash
node <skillDir>/scripts/confirm/serve-impl.js --excel=docs/2.3埋点需求文档.xlsx
```

- 不要 `--evt`（打开整份 `{文档名}-落库.html`，不是单条向导）
- 不要 `--no-open`（必须主动打开浏览器）
- 把 Open URL 发给用户，等回复「进入 C」后再写业务源码

有 `needsConfirm` 时先 `confirm-event` / `confirm-sweep`（禁止整轮 `--no-open`；服务已在跑则不新开 tab），队列清空后再走整页确认。

**只跑 C / 落库到写码**：先 `tracking-workflow --run=C --json`。`landing.needA` 时不要 `serve-impl` 空页，先完整路径 A 再本文件 B。`needB` 时从 `confirm-sweep` 开始。脚本 exit 3 = 补 A，exit 4 = 补 B。
