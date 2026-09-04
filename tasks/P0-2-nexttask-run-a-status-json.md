# P0-2：唯一 nextTask + `--run=A` 对齐业务 A + status JSON 带 prompt/command

## 0. 与 P0-1 的关系

本文是 `tasks/P0-1-workflow-determinism.md` 的**可实施切片**，不另起一套 Workflow。

P0-1 定义目标模型：

```text
程序决定 WHAT / WHEN
Agent 决定 HOW
```

P0-2 只落地三件事，使 Codex / Claude / Cursor 读到同一份机器协议：

1. `--status --json` / `--run=* --json` 始终给出**唯一** `nextTask`（或明确 `null`）。
2. `--run=A` 的程序语义与 SKILL 业务 A 对齐：dump+render **不等于** A 完成。
3. status JSON 为当前 `nextTask` 带上可原样执行的 `command` 与可原样发给用户的 `prompt`。

P0-1 中更广的 Task Graph 拆分、SKILL 大幅瘦身、单 evt patch schema，**不在本次范围**；发现则记 follow-up。

事实链不得改职责：

```text
events.json → adaptor.json → impl.json → accept-chain.json
```

状态仍只写：

```text
docs/tracking/impl/{文档名}/_raw/workflow.json
```

禁止新增 `workflow-state-v2.json` / `agent-state.json` 等平行状态文件。

---

## 1. 问题定义（对照当前源码）

当前实现已经有 `resolveNextTask()` 与测试，但三条 P0 仍未闭环。

### 1.1 `--run=A` ≠ 业务 A

`scripts/workflow/tracking-workflow.js` 中：

```text
--run=A
  → dump-excel.js
  → render-html.js
  → 结束（不再 completeStage('A')）
```

Help 文案仍写「A dump+render」。Agent 在三平台都会把「我已经 `--run=A`」理解成路径 A 完成，从而跳过逐条分析 / validate / confirm。

业务 A（`SKILL.md` + `inspectLanding`）至少包括：

```text
dump（含示意图 png）
→ render
→ 逐条分析写入 impl.json
→ normalize-impl
→ validate-impl 无 error
→ needsConfirm 条当场 confirm-event
```

`inspectLanding.artifactsReady` 在 `pendingEvents > 0` 时为 false（`needA=true`）。`--run=A` 跑完后磁盘上通常仍是 pending impl，**程序侧 A 未完成**，但 CLI 语义仍像「阶段 A 已执行」。

本次必须让 CLI、JSON、`stageStatus.A.done`、`nextTask` 说同一句话。

### 1.2 nextTask 已有雏形，但不是完整执行契约

`resolveNextTask()` 已能返回：

```text
id / stage / executor / status / subject / inputs / outputs / completionCondition / blockingReason
```

缺口：

- 没有 `command`：Agent 自己拼 `<skillDir>` / 工具名，三平台分叉。
- 没有 `prompt`：菜单、确认、设备选择依赖模型「原样复述」SKILL 长文本，必漂。
- `--run=A` 的 JSON 不声明「脚本只完成了 A 的前置 dump/render，下一步仍是 A_ANALYZE_EVENT」。
- `A_PREPARE_ARTIFACTS` 过粗：缺 xlsx、缺 dump、缺图、缺 HTML 都挤在一个 id，Agent 仍要猜先跑哪条命令。
- `firstPendingEvent()` 用 `status !== 'existing'`，会把 `located` / `unresolved` 与 `pending` 混在一起；唯一 nextTask 应以 **docIndex 上第一条未完成分析的事件** 为准，避免每次 status 跳到不同 evtId。

### 1.3 status JSON 不能当跨平台下一跳输入

当前 `--json` 大致为：

```text
next, nextTask, stages, validation, accept, landing, missing, trackingMode, run, workflowPath
```

缺：

```text
prompt
command
nextAction
status（completed | blocked | needs_user_input | failed）
```

`schemas/task-result.schema.json` 已有 `nextAction` / `status` / `nextTask`，但 workflow 输出未对齐该协议，Agent 无法「只读 JSON、不读聊天历史」恢复。

---

## 2. 目标

同一磁盘事实 F，任意平台、任意 session：

```text
F  →  唯一 nextTask T  →  唯一 command / prompt
```

验收口径（继承 P0-1）：

```text
Workflow Determinism = 100%
```

不要求三平台写出相同 `impl` 字段（那是后续事实收敛）。只要求流程节点一致。

---

## 3. 目录结构（本次允许改动）

```text
bella-tracking/
├── SKILL.md                                      # 仅改「先 --status --json，按 nextTask 执行」一小段；禁止加长流程 if
├── schemas/
│   ├── task-result.schema.json                   # 扩展：prompt / command；与 workflow JSON 对齐
│   └── workflow-status.schema.json               # 新增：--status/--run JSON 的机器协议（可 $ref nextTask）
├── scripts/
│   └── workflow/
│       ├── tracking-workflow.js                  # resolveNextTask / --run=A / 输出 prompt+command
│       ├── tracking-workflow.test.js             # 确定性回归
│       └── next-task.js                          # 可选拆出：纯函数 resolveNextTask + 文案表（便于测、主文件不膨胀）
├── reference/
│   └── workflow-next-task.md                     # 可选：Agent 执行 nextTask 的短说明（按需读，不写进 SKILL 正文）
└── tasks/
    ├── P0-1-workflow-determinism.md
    └── P0-2-nexttask-run-a-status-json.md        # 本文
```

不强制新建 `next-task.js` / `workflow-status.schema.json`。若继续放在 `tracking-workflow.js` + 只扩展 `task-result.schema.json`，须在实现报告说明为何不必拆文件。

禁止改：

```text
events / adaptor / impl / accept-chain 的字段职责
dump-excel / render-html / validate-impl 的业务规则（除非为了暴露 A 未完成所必需的退出码）
```

---

## 4. 唯一 nextTask 契约

### 4.1 解析必须是纯函数

```text
resolveNextTask(diskFacts, workflow.json) → nextTask | null
```

禁止读取对话、环境里的「当前模型打算做什么」、`--run` 参数去**改写** nextTask 身份。

`--run=A` 只执行脚本副作用；跑完后 **重新** `resolveNextTask`。不得出现：

```text
用户要跑 A  →  于是 nextTask 变成 A_COMPLETE
```

### 4.2 同时只允许一个 ready 任务

优先级（主链路，本次必须实现；E/F/7/H 保持现有 gate，不扩 Task Graph）：

```text
1. 缺 excel / 产物不足以分析     →  script  A_DUMP 或 A_RENDER 或 A_PREPARE_IMAGES
2. 有产物但存在 pending 事件     →  agent   A_ANALYZE_EVENT（subject.evtId = 第一条 pending）
3. validate-impl error            →  script  A_VALIDATE_IMPL（status=blocked，command=normalize+validate）
4. 分析完成且有 needsConfirm      →  user    B_CONFIRM_EVENT（或 A 打断用同一 user task，见 5.3）
5. 队列已清、未整页确认进 C       →  user    B_CONFIRM_FULL_PAGE
6. 已 mark B / 用户已进 C         →  agent   C_WRITE_CODE（现有 C_WRITE_IMPL 可改名但须稳定 id）
7. C 完成、无验收报告             →  script  D_RUN_ACCEPT（无 device 则 user 选设备，见 4.4）
8. 非 plan 验收报告已存在         →  nextTask = null
```

同一优先级若有多条事件：按 `docIndex` 取 **一条** `subject.evtId`。多次 `--status` 不得轮换 evtId。

### 4.3 `nextTask` 字段（Workflow → Executor）

在现有字段上增加：

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | string | 稳定 Task ID，禁止中文、禁止自由发挥新 id |
| `stage` | enum | A/B/C/D/E/F/7/H |
| `executor` | enum | script / agent / user |
| `status` | enum | ready / blocked |
| `subject` | object | 如 `{ "evtId": "95936" }` |
| `inputs` | string[] | 相对仓库 POSIX 路径或逻辑名 |
| `outputs` | string[] | 同上 |
| `completionCondition` | string[] | 程序尽量可校验 |
| `blockingReason` | string\|null | blocked 时必填 |
| `command` | string\|null | **一条**可在仓库根执行的 shell；user 任务可为 null 或打开向导的命令 |
| `prompt` | string\|null | 原样发给用户的文案；script/agent 且无需用户输入时为 null |
| `nextAction` | enum | 与 `task-result.schema.json` 对齐 |

允许的 `id` 本次闭集（未列的不要发明）：

```text
A_DUMP
A_RENDER
A_PREPARE_IMAGES
A_ANALYZE_EVENT
A_NORMALIZE_IMPL
A_VALIDATE_IMPL
B_CONFIRM_EVENT
B_CONFIRM_FULL_PAGE
C_WRITE_IMPL
D_CHOOSE_DEVICE
D_RUN_ACCEPT
H_NEED_MISSING_LIST
```

若缺图与缺 events 同时发生：只返回 `A_DUMP`（dump 负责图），不要同时返回两个 task。

### 4.4 顶层 status JSON（给 Agent 的唯一输入）

`--status --json` 与 `--run=* --json` 共用同一形状（`--run` 多一个 `run` 描述本次脚本做了什么）：

```json
{
  "version": "1.0",
  "stage": "A",
  "status": "needs_user_input",
  "next": "A",
  "nextAction": "confirm_event",
  "nextTask": {
    "id": "B_CONFIRM_EVENT",
    "stage": "B",
    "executor": "user",
    "status": "ready",
    "subject": { "evtId": "95936" },
    "inputs": ["docs/tracking/impl/{slug}/_raw/{slug}.impl.json"],
    "outputs": ["docs/tracking/impl/{slug}/_raw/{slug}.impl.json"],
    "completionCondition": ["confirmed=true or deferred=true"],
    "blockingReason": null,
    "command": "node scripts/confirm/confirm-event.js --excel=docs/{file}.xlsx --evt=95936 --if-needed --wait",
    "prompt": "请在已打开的矫正向导中确认 evtId=95936 后保存。",
    "nextAction": "confirm_event"
  },
  "stages": {},
  "validation": {},
  "landing": {},
  "run": {
    "requested": "A",
    "did": ["dump-excel", "render-html"],
    "didNot": ["analyze-events", "complete-stage-A"],
    "stageAComplete": false
  },
  "workflowPath": "docs/tracking/impl/{slug}/_raw/workflow.json"
}
```

约束：

- `command` 使用**仓库内相对路径** `scripts/...`，禁止 `<skillDir>`、禁止本机绝对路径。
- `prompt` 由脚本常量生成，SKILL 不得再维护一份会漂的长菜单（菜单若仍要问入口，用 `nextAction=choose_entry` 的固定 `prompt`，本次若改动入口菜单只许把现有 8 项原文搬进脚本常量）。
- `stage` 取 `nextTask.stage`；`nextTask=null` 时 `stage` 可为 D 且 `status=completed`。
- `status`：`completed` / `blocked` / `needs_user_input` / `failed`。`executor=user` → `needs_user_input`；validate error → `blocked` 或 `failed`。
- 聊天回复不是下一阶段输入。

扩展 `schemas/task-result.schema.json`（或新增 `workflow-status.schema.json` 再 $ref）：`nextTask.properties` 增加 `command`、`prompt`、`nextAction`。若两套 schema 并存，必须写清：

```text
nextTask = Engine → Executor
task-result = Executor → Engine（本次可不强制 Agent 回写，记 follow-up）
```

---

## 5. `--run=A` 与业务 A 对齐

### 5.1 禁止的语义

```text
--run=A 成功  ≠  路径 A 完成
--run=A 成功  ≠  completeStage(A)
--run=A 成功  ≠  允许 --run=C 写源码
```

当前源码已不再 `completeStage('A')`（仅 D 与 `--mark` 会写 done）。**禁止改回去**。`--mark=A` 若保留，不得让 `stageStatus.A.done` 仅凭 mark 变 true；A.done 只由磁盘门禁计算。

### 5.2 `--run=A` 只做脚本前置

保持只跑：

```text
dump-excel.js
render-html.js
```

dump 非 0（含缺示意图 URL / 下载失败）：整个 `--run=A` 非 0，**不** render，JSON：

```text
status=failed
nextTask.id=A_DUMP 或 A_PREPARE_IMAGES
run.did 反映实际停在哪一步
```

dump+render 成功后：

```text
禁止 stages.A.status=done
stageStatus.A.done === inspectLanding 业务完成（见 5.3）
nextTask 指向下一条未完成分析（通常 A_ANALYZE_EVENT）
run.did = ["dump-excel","render-html"]
run.didNot 含 "analyze-events"
run.stageAComplete = false（除非磁盘上分析+校验已碰巧完成）
```

Help / `--help` 改为：

```text
--run=A  只执行 dump+render（路径 A 的脚本前置），不分析 impl、不标记 A 完成
```

SKILL 中「`--run=A` 只做 dump+render，不等于路径 A 完成」与 CLI 必须一致；不要再暗示「跑完 A 入口就结束落库」。

### 5.3 `stageStatus.A.done` 的唯一定义

与 `inspectLanding` **同一套**，禁止第二套 A 完成定义。

建议（实现时以源码为准，若与下表冲突须改代码对齐本文，并在报告写差异）：

```text
A.done = true  当且仅当
  artifacts 齐（events / adaptor / impl / 落库.html / 每条非空 png）
  且 pendingEvents === 0（无 status 空或 pending）
  且 validate-impl errors === 0
```

`needsConfirm` 队列未清：

- **不**阻止 `A.done`（分析已完成），否则 A/B 永远缠在一起，`--run=A` 对齐无出口。
- `nextTask` 进入 `B_CONFIRM_EVENT`（executor=user）。
- 与 SKILL「A 阶段当场打断 confirm」兼容：打断仍是 user task，只是完成位在 B 队列上推进；**不要**为了当场打断再把 A.done 设回 false。

当前代码用 `queueCleared` / `readyForCPreflight` 参与 `stageAComplete`，会把「待确认」算进 A 未完成。P0-2 **必须拆开**：

```text
A.done     = 产物 + 已分析 + validate
B.done     = 待确认队列清 + workflow 整页确认（现有 mark B 或等价磁盘位）
needA      = 分析未完成（pending / 缺产物 / 缺图）
needB      = A.done 且 pendingConfirm > 0
```

`gateStage` 的 exit 3（needA）/ exit 4（needB）继续有效，且须用上述定义。

### 5.4 `--run=B|C` 不变原则

`--run=B|C` 仍只做依赖门禁，不写业务源码。JSON 同样带 `nextTask.command` / `prompt`（例如 needA 时 command 指向 dump，prompt 说明须完整路径 A 而非只 dump）。

---

## 6. command / prompt 生成规则

集中一张表（`next-task.js` 或 `tracking-workflow.js` 内常量），禁止 Agent 拼命令。

示例：

| nextTask.id | command | prompt |
|---|---|---|
| A_DUMP | `node scripts/extract/dump-excel.js --excel={excel}` | null |
| A_RENDER | `node scripts/extract/render-html.js --excel={excel}` | null |
| A_ANALYZE_EVENT | null 或 status 命令 | null（HOW 在 reference；WHAT 已是分析该 evtId） |
| A_NORMALIZE_IMPL | `node scripts/accept/normalize-impl.js --excel={excel}` | null |
| A_VALIDATE_IMPL | `node scripts/accept/validate-impl.js --excel={excel} --json` | null |
| B_CONFIRM_EVENT | `node scripts/confirm/confirm-event.js --excel={excel} --evt={evtId} --if-needed --wait` | 闭集待确认项 + 禁止附猜测（沿用 confirm-flow 短句） |
| B_CONFIRM_FULL_PAGE | `node scripts/confirm/serve-impl.js --excel={excel}` | 请打开整份落库页，回复「进入 C」 |
| D_CHOOSE_DEVICE | null | 现有 1 移动端 / 2 PC 原文 |
| D_RUN_ACCEPT | `node scripts/accept/run-accept.js --excel={excel} --device={device}` | null |

`executor=agent` 的 `command` 可为：

```text
node scripts/workflow/tracking-workflow.js --excel={excel} --status --json
```

表示「做完 HOW 后重新拉 nextTask」，避免模型接着猜阶段。

excel 占位必须是 `docs/{文件名}.xlsx` 相对路径。

---

## 7. SKILL.md 最小改动

只允许：

1. 「每次先跑 `--status --json`，只执行返回的 `nextTask.command` / 对用户打印 `prompt`」。
2. 修正 `--run=A` 不等于路径 A 完成（与 CLI help 同句）。
3. 删除或缩短与引擎重复的「if 用户说只跑 A / B / C」跳转细则中**会和 JSON 打架**的句子；跳转以引擎为准。

禁止：把 prompt 全文再抄进 SKILL；禁止新增阶段 if。

---

## 8. 测试（必须）

在 `scripts/workflow/tracking-workflow.test.js` 增补，fixture 风格沿用现有 `baseFixture`。

| Case | 断言 |
|---|---|
| 同事实两次 status | `nextTask` 深相等，含 `id/executor/subject/command/prompt` |
| dump+render 齐、impl 仍 pending | `A.done===false`；`nextTask.id==='A_ANALYZE_EVENT'`；`run.stageAComplete` 在模拟 `--run=A` 后为 false |
| `--run=A` 不得写 `stages.A=done` | 读 `workflow.json` 无 A done |
| 多 pending 事件 | 两次 status 的 `subject.evtId` 相同且为最小 docIndex |
| validate error | `nextTask.id==='A_VALIDATE_IMPL'`，`status=blocked`，`command` 含 `validate-impl` |
| needsConfirm | `executor=user`，`prompt` 非空，`command` 含 `confirm-event`；A.done 在已分析+validate 通过时为 true |
| 队列清、未 mark B | `B_CONFIRM_FULL_PAGE`，`prompt` 含进入 C |
| needA 时 `--run=C` | exit 3，JSON `nextTask` 仍在 A，不出现写源码 command |
| 无 device 要真实验收 | `D_CHOOSE_DEVICE`，prompt 为设备二选一原文 |
| A 业务完成 | pending=0、图齐、validate ok → 不再返回 `A_ANALYZE_EVENT` |

测 `resolveNextTask` / `buildStatus` 纯函数即可；`--run=A` 不写 mark 可用临时目录调 `runStage` 或抽 `didNot completeStage` 的单测。

---

## 9. 不允许的修改

1. 重写整个 bella-tracking。
2. 改 events/adaptor/impl/accept-chain 职责。
3. dump+render 成功后 `completeStage('A')`。
4. 自动跳过 needsConfirm / 整页进 C。
5. 为对齐 A 而让 `--run=A` 去跑模型分析。
6. 第二套 workflow 状态文件。
7. 把 MCP 浏览器 / `block_until_ms` / `Read` / `Grep` 写进 JSON command。
8. 顺手做 P0-3（SKILL 大瘦身、单 evt patch）。记 follow-up。

与真实源码冲突时：**源码结构优先，语义以本文 5.3 / 5.2 为准改行为**。

---

## 10. 实施步骤

1. 读 `tracking-workflow.js`、`landing-ready.js`、`task-result.schema.json`、现有 test。
2. 画出当前 `needA/needB/A.done/nextTask` 真值表；列出与 5.3 的差异。
3. 扩展 schema；实现 `command`/`prompt`/`nextAction`/`run.did`。
4. 拆开 A.done 与 confirm 队列；修正 `gateStage` 是否仍与 `inspectLanding.needA` 一致。
5. 改 `--help` 与 `--run=A` JSON；禁止 mark A。
6. 补测试并跑 `node --test scripts/workflow/tracking-workflow.test.js`。
7. SKILL 最小同步。
8. 按 P0-1 §17 输出变更报告。

---

## 11. 验收清单

- [ ] 任意两次相同 fixture 的 `--status --json`，`nextTask` 字节级稳定（字段顺序可 normalize 后比）。
- [ ] `--run=A` 成功后 `stageStatus.A.done===false`（除非分析已预先完成）。
- [ ] `--run=A` 不写 `workflow.json` 的 A done。
- [ ] JSON 含 `prompt` 与 `command`，command 为仓库相对 `node scripts/...`。
- [ ] `needA` 时不能通过 JSON 得到 C 写码 command。
- [ ] 现有 determinism 测试仍通过，且新增 5.2/5.3 回归通过。
- [ ] SKILL 未变长；流程以 JSON 为准。
