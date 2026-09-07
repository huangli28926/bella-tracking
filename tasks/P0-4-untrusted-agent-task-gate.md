# P0-4：第三决策源降权 — 未信任补丁 + nextTask 闸

## 0. 与 P0-1 / P0-2 / P0-3 的关系

不另起 Workflow，不改事实链职责。

| 文档 | 收什么权 |
|---|---|
| `P0-1-workflow-determinism.md` | 目标模型：程序决定 WHAT / WHEN，Agent 决定 HOW |
| `P0-2-nexttask-run-a-status-json.md` | 机器协议：唯一 `nextTask` + `command` / `prompt`；`--run=A` ≠ 业务 A |
| `P0-3-skill-slim-script-prompts.md` | 人机文案权威 + Skill 路由体积 |
| **本文 P0-4** | **第三源（Agent 推理）降权**：模型不得自行宣布阶段、不得无闸改事实文件；跳步必须被脚本拒绝 |

P0-1～P0-3 完成后，冲突型 Authority（Skill / 脚本 / 模型各判阶段）在程序侧已收口为：

```text
磁盘事实 + resolveNextTask()  →  唯一 WHAT / WHEN
SKILL.md                      →  只教怎么执行当前 nextTask
Agent                         →  仍可做 HOW，也可不理引擎
```

**完成定义（本文）：** 第三个源还在，但只能影响**当前任务的字段质量**；**阶段跳转与事实入账**只剩 `next-task.js` + 磁盘 + apply/assert 闸。不是把 Agent 变成纯脚本，也不是再往 `SKILL.md` 加禁令。

原则：

```text
Agent 输出 = 未信任补丁
脚本 apply + validate = 唯一入账口
nextTask.id 对不上 = 整次写入丢弃
聊天 / Skill / 模型自称 completed 都不当状态
```

事实链不得改职责：

```text
events.json → adaptor.json → impl.json → accept-chain.json
```

状态仍只写：

```text
docs/tracking/impl/{文档名}/_raw/workflow.json
```

禁止新增 `workflow-state-v2.json` / `agent-state.json` 等平行状态文件。

P0-2 的 Task ID 闭集、`--run=A` 只 dump+render、`command` 用仓库相对 `scripts/...`、P0-3 的 prompt 单一来源：**全部继承，禁止回退。**

---

## 1. 问题定义（对照当前源码）

`scripts/workflow/next-task.js` 已能给出唯一 `nextTask`，但引擎只是建议。Codex / Claude / Cursor 仍可以：

- 不跑 `--status --json`，按对话记忆进 C / D
- 把 `--run=A` 当成路径 A 完成
- 直接改整份 `impl.json` 或 `adaptor.sourceRoots` 下源码
- 调用 `--mark=B` / `--mark=C` 伪造阶段完成

当前漏点：

```text
A_ANALYZE_EVENT     executor=agent
                    completionCondition 含 pendingEvents = 0
                    → 鼓励一次分析完全部事件，subject.evtId 形同虚设

C_WRITE_IMPL        executor=agent，整阶段一大块
                    → 写码 / 补 accept / 建链由模型自己编排

--mark=B|C          Agent CLI 可写 workflow.json
                    → 第三源后门：不经用户整页确认即可宣称 B 完成

dump / 写 impl / 写源码 / run-accept
                    不校验「当前 nextTask.id 是否允许该动作」
```

Skill 写「先 status」只是请求。跨平台稳定性不能依赖模型更认真读 Skill。

HOW（看示意图、Grep 源码、填 `targetFile` / `expression`）必须留在 Agent。本次消的是 **WHEN/WHAT 与入账权**，不是定位智能。

---

## 2. 目标

1. **单条入账**：路径 A 对 `impl.json` 的写入只允许「当前 `nextTask.subject.evtId` 的 patch」；禁止 Agent 手写整份 impl。
2. **`A_ANALYZE_EVENT` 完成条件**：该 `evtId` 不再 `pending`（有非空 `status` 且不是未分析）。禁止用 `pendingEvents = 0` 作为本条 task 的完成条件。
3. **任务闸**：写 impl、改业务源码、真实验收、`--mark` 在 `nextTask.id` 不允许时 **非 0 退出，磁盘不变**。
4. **去掉 Agent 可用的 `--mark=B|C`**：B 完成只允许落库页「进入 C」写入 `workflow.json`；C 完成由磁盘门禁（`impl.accept` + accept-chain 无 pending）计算或由专用脚本在校验通过后写，禁止裸 `--mark`。
5. **路径 C 拆步**（可与单 evt patch 同 PR 或紧随）：至少拆出可闸的 task id，见 4.3；禁止继续用一个 `C_WRITE_IMPL` 覆盖写码+accept+建链。
6. **Skill 再瘦（若仍讲流程）**：主循环只保留 status → prompt 原样转发 → script 跑 `command` → agent 交 patch 给 apply → 再 status。阶段表不回写 SKILL。
7. **拒绝用例进测试**：跳步改盘必须失败（见第 7 节）。不测三平台文采。

验收口径：

```text
同一磁盘事实 + 错误动作
→ apply / assert 拒绝（固定 exit）
→ impl.json / 业务源码 / workflow.json 与动作前一致
```

不要求一次分析的 `expression` 在三平台字节级相同（那是 HOW 质量，另开任务）。

---

## 3. 目录结构（本次允许改动）

```text
bella-tracking/
├── SKILL.md
│     # 主循环改为：status → 转发 prompt → command / apply-impl-patch
│     # 禁止再写「如何从 A 跳到 C」
├── schemas/
│   ├── impl-event-patch.schema.json     # 新增：单 evt upsert 闭集
│   ├── task-result.schema.json          # 仅当新增 nextTask.id / nextAction 时改
│   └── workflow-status.schema.json
├── scripts/
│   └── workflow/
│       ├── next-task.js                 # 单 evt 完成条件；C 拆步后的 id
│       ├── assert-task.js               # 新增：assertCurrentTask(expectedId[, evtId])
│       ├── apply-impl-patch.js          # 新增：校验 nextTask → merge → normalize → validate
│       ├── tracking-workflow.js         # 去掉或禁用 Agent --mark=B|C；status 指向 apply
│       └── tracking-workflow.test.js    # 第 7 节拒绝用例 + 单 evt 完成条件
├── scripts/confirm/
│   └── serve-impl.js                    # 「进入 C」按钮写入 B.done（唯一合法 mark B）
├── scripts/accept/
│   ├── validate-impl.js                 # 可选：被 apply 调用，本身可不感知 task
│   ├── normalize-impl.js
│   ├── run-accept.js                    # 入口 assertCurrentTask('D_RUN_ACCEPT')（真实验收）
│   └── check-old-tracking.js            # 与 C_CONFIRM_DELETE_OLD 闸对齐
├── scripts/extract/
│   └── dump-excel.js                    # 可选：assert A_DUMP / A_PREPARE_IMAGES
├── reference/
│   ├── workflow-next-task.md            # 补：只通过 apply 写 impl；跳步会被拒绝
│   ├── path-a.md                        # 改为：对当前 evtId 写 patch，不手改整文件
│   └── path-c.md                        # 对齐拆步后的 task id
└── tasks/
    └── P0-4-untrusted-agent-task-gate.md  # 本文
```

禁止改：

```text
events / adaptor / impl / accept-chain 字段语义
dump 示意图失败继续分析 等已有硬判定
P0-3 prompts 原文（除非只改引用处）
为 Cursor / Claude / Codex 各写一套业务流程
```

平台 hook（Cursor hooks、Claude stop hook）**不在本次范围**。若做，只能是「每次工具后强制 `--status`」的薄适配，业务闸必须留在 Node 脚本。另开 follow-up。

---

## 4. 未信任补丁与任务闸

### 4.1 `impl-event-patch.schema.json`

一次 upsert **一个** `evtId`。字段闭集从 `impl.schema.json` 的单条 event 抽取允许 Agent 写的子集，至少：

```text
允许：status, targetFile, functionName, lifecycle, pageKey, styleId,
      insertHint, evidence, uicodeConflict, code, parameters[],
      accept（A 阶段可空；C 步再写）, unresolved[]
禁止出现：uicode
禁止：覆盖已有 hint / confirmed / fromMemory（merge 层丢掉这些写入）
路径：仓库相对 POSIX；非法则 validate error
```

`additionalProperties: false`。模型输出必须是纯 JSON 文件或 stdin，禁止 Markdown fence；apply 脚本不解析聊天。

建议 CLI：

```bash
node scripts/workflow/apply-impl-patch.js \
  --excel=docs/{文档名}.xlsx \
  --task=A_ANALYZE_EVENT \
  --evt={evtId} \
  --patch=path/to/patch.json
```

行为：

1. `assertCurrentTask('A_ANALYZE_EVENT', evtId)`：与 `--status` 算出的 `nextTask.id` / `subject.evtId` 不一致 → 固定 exit（建议 **20**），不写盘。
2. 读磁盘 `impl.json`，按 `docIndex` 合并该 evtId；无则按 events.json 插入并保持文档顺序；同一 evtId 一条。
3. 不覆盖 `hint` / `confirmed` / `deferred` / `fromMemory` / `fromEvtId`（除非 patch 显式走后续专用 task，本次 A 分析不要开放）。
4. `normalize-impl` + `validate-impl --json`。
5. validate error → 回滚本次 merge 或写回前备份后失败（实现选一种，**失败后 impl 不得留下半套非法文件**）；exit 非 0。
6. stdout `--json` 可回显新的 `nextTask`（内部再 `buildStatus`），避免 Agent 凭感觉进下一步。

禁止：apply 成功后由脚本把所有剩余事件标成 analyzed。

### 4.2 `assertCurrentTask`

`scripts/workflow/assert-task.js` 纯函数 + CLI：

```text
输入：paths, args, expectedId, optional evtId
内部：与 tracking-workflow 同一套 resolveNextTask / buildStatus
不一致：exit 20，stdout JSON { expected, actual, blockingReason }
```

挂载点（本次必须闸的动作）：

| 动作 | 仅当 nextTask.id（及 subject） |
|---|---|
| `apply-impl-patch`（分析） | `A_ANALYZE_EVENT` 且 evtId 一致 |
| 直接写 `impl.json`（若仍有其它脚本） | 同上或 `A_VALIDATE_IMPL` |
| 改 `adaptor.sourceRoots` 下业务源码 | 拆步后的 C 写码 id（见 4.3），且 `stageStatus.B.done` |
| `run-accept` 非 plan-only | `D_RUN_ACCEPT` 且已有 device |
| `confirm-event` / `serve-impl --evt` | `B_CONFIRM_EVENT` / `B_CONFIRM_FULL_PAGE`（允许同 slug 复用） |

`dump-excel` 建议闸 `A_DUMP` | `A_PREPARE_IMAGES`，避免无入口时 dump。若与「用户已 `--run=A`」冲突：`--run=A` 视为入口意图（P0-3），此时 nextTask 应为 `A_DUMP` 或后续 A 脚本任务，不断网已有 dump 路径。

无入口（`CHOOSE_ENTRY`）时上述写盘动作全部拒绝。

### 4.3 路径 C 拆步（最小闭集）

在 P0-2/P0-3 闭集上只允许增加（或把 `C_WRITE_IMPL` 替换为下列，测试与 schema 同步）：

```text
C_WRITE_EVENT            agent   对当前/队列中的 evt 写调用（可再按 evt 循环，nextTask 一次一个）
C_CONFIRM_DELETE_OLD     user    已有：removedCount>0（P0-3）
C_FILL_ACCEPT            agent   补 pageKey + accept（可仍按 evt）
C_BUILD_CHAIN            script  build-accept-chain.js
```

完成条件必须程序可验：`check-old-tracking`、`validate-impl`、chain 无 pending 关键项。不要用「Agent 声称写完」。

若单 PR 过大：先做 4.1+4.2+去掉 `--mark`，C 拆步记 follow-up **但必须在本文「未完成则不得宣称 P0-4 完成」列出**。推荐同一任务做完 4.3，否则 `C_WRITE_IMPL` 仍是第三源最大洞。

### 4.4 去掉 Agent `--mark=B|C`

当前 `tracking-workflow.js --mark=B|C` 写入 `completeStage`。本次：

- CLI `--mark=B|C|D`：**拒绝**（或仅 `--mark=D` 仍由真实验收脚本在生成报告后调用内部函数，不暴露给 Agent）。
- `B.done`：仅 `serve-impl`（整页、非 `--evt`）在用户确认「进入 C」的 API/按钮处理里写入。
- `A.done`：继续只由磁盘门禁计算（P0-2），禁止 mark A。
- `C.done`：由 `stageStatus` 从 accept 字段 + chain 计算，或 `C_BUILD_CHAIN` 成功且无 pending 时由该脚本写；禁止 Agent 参数 mark。

测试：磁盘已分析完、队列已清、但无 B.done 时，`--mark=C` 或直接 apply 写源码 → 拒绝；`nextTask` 仍为 `B_CONFIRM_FULL_PAGE`。

### 4.5 `A_ANALYZE_EVENT` 完成条件修正

改前（问题）：

```text
completionCondition: pendingEvents = 0
```

改后：

```text
subject.evtId = firstUnanalyzedEvent（docIndex 序，仅 status 空或 pending）
completionCondition:
  - impl.events 中该 evtId 存在
  - 该条 status 不是 pending / 空
  - 若本条写入后 validate 失败 → 下一跳 A_VALIDATE_IMPL blocked，而不是下一条 evt
```

`located` / `unresolved` / `existing` 都算「已分析」，与 P0-2「不要把 located 混进 first pending」一致。下一次 `--status` 再指向下一条 `pending`。

禁止 apply 一次 patch 带多个 evtId（schema 层拒绝）。

---

## 5. Skill / reference 配合（薄）

`SKILL.md` 主循环改为与引擎同构，且写明入账口：

```text
1. --status --json
2. prompt 非空 → 原样发给用户后停
3. executor=script → 只跑 nextTask.command
4. executor=agent → 只读 inputs，写出单 evt patch，只调用 apply-impl-patch
5. 再 --status --json
6. apply / assert exit 20 → 停，禁止改 command 重试写盘
```

`reference/path-a.md`：删除「按 evtId 合并写回整份 impl.json」若会诱导手写整文件；改为 apply。硬规则语义（不确定留空、unresolved 闭集）保持。

不要把 assert 的 exit 码再抄进三份 prose；Skill 只写「非 0 则停」。

---

## 6. 不在本次做

- 把看图定位、参数追变量改成纯脚本（HOW 质量另开任务）。
- 单 evt 之外的 `impl` 字段语义改造。
- 三平台 hook / MCP 浏览器替代 `confirm-event`。
- 黄金 E2E 真业务仓验收（可用 fixture；真仓 follow-up）。
- 改 Excel dump、SDK adaptor 探测规则。

---

## 7. 必须增加的测试（fixture，不启浏览器）

在 `tracking-workflow.test.js`（或 `apply-impl-patch` 旁测试）固定：

1. **无 entry**：`CHOOSE_ENTRY` 时 `apply-impl-patch` / 模拟写 impl → exit 20，impl 不变。
2. **dump 后假完成**：`--mark=C` 或写源码闸 → 拒绝；`stageStatus.A.done === false` 仍可（pending impl）。
3. **evt 错位**：nextTask 为 evt=1，patch `--evt=2` → 拒绝，evt=1 仍 pending。
4. **队列未清**：`needsConfirm` 时非 plan-only `run-accept`（或 assert D）→ 拒绝。
5. **无 device**：`D_CHOOSE_DEVICE` 时真实验收入口 → 拒绝。
6. **单条完成条件**：两条 pending，apply 只分析第一条后，`nextTask` 为第二条的 `A_ANALYZE_EVENT`，`A.done === false`。
7. **B 后门**：队列已清、未整页确认，`--mark=B` 不可用或无效；`nextTask.id === B_CONFIRM_FULL_PAGE`。

已有 P0-2 确定性测试（同一磁盘两次 status 相同）必须继续绿。

运行：

```bash
node --test scripts/workflow/tracking-workflow.test.js
```

若新增 `apply-impl-patch.test.js`，一并纳入。

---

## 8. 实施顺序

1. `assert-task.js` + 将 `buildStatus` / `resolveNextTask` 抽成 assert 可复用（禁止复制第二套优先级）。
2. `impl-event-patch.schema.json` + `apply-impl-patch.js`。
3. 修正 `A_ANALYZE_EVENT` 的 `completionCondition` 与 `firstUnanalyzedEvent` 语义（若有回归则先修测试期望）。
4. 去掉 Agent `--mark=B|C`；`serve-impl` 写入 B.done。
5. 危险入口挂 assert（至少 apply、run-accept 真实验收、写源码路径若已有脚本入口）。
6. C 拆步（4.3）与 `path-c.md` / next-task 闭集。
7. Skill / `workflow-next-task.md` 指向 apply。
8. 第 7 节测试全绿。
9. 输出变更报告（第 10 节）。

不要先改 Skill 文案再补闸：无闸时瘦 Skill 不能约束第三源。

---

## 9. 兼容与风险

- 已习惯「手改整份 impl.json」的 Agent 会失败，这是预期；USER-GUIDE 补一句「分析阶段只许 apply-impl-patch」。
- 旧 `workflow.json` 里已被 `--mark=B` 的仓：磁盘已 done 则行为与现在一致；不要迁移第二份状态。
- `completeStage('D')` 内部调用可保留，不要暴露为 Agent `--mark=D`。
- exit 20 与现有 3/4/5/10 并存；Skill/reference 只写「非 0 停」，测试锁 20。

---

## 10. 实施结束后必须报告

```text
1. 修改 / 新增文件列表
2. nextTask.id 闭集（相对 P0-3 的 diff）
3. --mark 行为变化
4. apply-impl-patch 成功/失败契约（exit、是否回滚）
5. 哪些跳步从「Skill 禁止」变成「脚本拒绝」
6. 哪些 HOW 仍由 Agent 完成
7. Schema 是否变化
8. events/adaptor/impl/accept-chain 职责是否未动
9. 测试命令与结果
10. 未做的 follow-up（平台 hook、C 拆步若延期、真仓 E2E）
```

Scope：只做本文第 2 节目标。发现 P0-2/P0-3 回归则修回归；新需求记 follow-up，不扩大 PR。
