# P0-1：Workflow Determinism

## 1. 问题定义

bella-tracking 当前存在多个 Workflow Authority：

```text
SKILL.md
+
scripts/workflow/tracking-workflow.js
+
Agent 自身推理
```

这导致同一份输入、同一个 Agent，在不同 session 或不同上下文中可能产生不同的流程跳转。

当前真实代码中：

```bash
tracking-workflow.js --run=A
```

只执行：

```text
dump-excel
→
render-html
```

随后调用：

```text
completeStage(..., 'A', 'dump + render complete')
```

但是业务语义中的完整 A 实际还包含：

```text
Excel
↓
dump / parse
↓
events.json
↓
adaptor.json
↓
Agent 逐条代码定位
↓
参数来源追踪
↓
impl.json
↓
normalize-impl
↓
validate-impl
↓
needsConfirm Gate
↓
人工确认
↓
A 完成
```

因此当前存在：

```text
程序认为 A 已完成
≠
业务 Workflow 中 A 已完成
```

这是本任务需要解决的核心问题。

---

# 2. 本次目标

将 Workflow Authority 尽可能收归确定性 Workflow Engine。

目标从：

```text
SKILL.md
↓
Agent 阅读规则
↓
Agent 判断下一步
↓
调用脚本
```

变为：

```text
Workflow Engine
↓
计算唯一 nextTask
↓
script / agent / user 执行
↓
result
↓
确定性 validation
↓
计算下一 nextTask
```

核心原则：

```text
程序决定 WHAT / WHEN
Agent 决定 HOW
```

Agent 不应该自行决定：

* 当前属于哪个阶段
* 下一步执行哪个流程节点
* 是否应该 normalize
* 是否应该 validate
* needsConfirm 是否应该进入人工 Gate
* B 是否已经完成
* 是否允许进入 C
* C 是否已经完成
* 是否允许执行 D

---

# 3. 不改变的正式基线

本次属于 **Workflow Engine 重构**。

不得修改 bella-tracking 的正式事实链：

```text
events.json
↓
adaptor.json
↓
impl.json
↓
accept-chain.json
```

四个事实层职责保持不变。

正式业务主链路保持：

```text
Excel
↓
parse_xlsx / dump
↓
events.json
↓
adaptor.json
↓
代码定位 + 参数来源追踪
↓
impl.json
↓
validate-impl
↓
needsConfirm Gate
├─ true → 人工确认
└─ false
↓
代码实现
↓
build-accept-chain
↓
accept-chain.json
↓
run-accept
↓
Runtime Actual
↓
Expected / Actual Compare
↓
验收报告
```

本任务不能建立新的平行事实层。

---

# 4. 目标执行模型

Workflow Engine 应逐步从 Stage Gate 升级为 Task Orchestrator。

建议形成：

```text
                    tracking-workflow
                           │
                           ▼
                     inspect facts
                           │
                           ▼
                      resolveTask()
                           │
                           ▼
                       nextTask
                           │
          ┌────────────────┼───────────────┐
          │                │               │
          ▼                ▼               ▼
       script            agent           user
          │                │               │
          └────────────────┼───────────────┘
                           │
                           ▼
                     validateTask()
                           │
                     ┌─────┴─────┐
                     │           │
                    PASS        FAIL
                     │           │
                     ▼           ▼
                 nextTask      blocked
```

---

# 5. nextTask Contract

设计明确的 Task Contract。

建议至少包含：

```json
{
  "id": "A_ANALYZE_EVENT",
  "stage": "A",
  "executor": "agent",
  "status": "ready",
  "subject": {
    "evtId": "95083"
  },
  "inputs": [],
  "outputs": [],
  "completionCondition": [],
  "blockingReason": null
}
```

字段含义：

### id

稳定、机器可消费的 Task ID。

不得使用自然语言作为流程判断依据。

### stage

允许：

```text
A
B
C
D
E
F
7
H
```

### executor

至少：

```text
script
agent
user
```

含义：

```text
script
= 确定性脚本执行

agent
= 必须进行代码语义推理

user
= 必须等待人工输入
```

### inputs

当前 Task 所消费的事实文件或运行上下文。

例如：

```json
[
  "events.json",
  "adaptor.json",
  "_raw/images/95083.png"
]
```

### outputs

完成 Task 后必须产生或更新的事实。

例如：

```json
[
  "impl.json"
]
```

### completionCondition

必须由程序尽可能校验。

禁止仅由 Agent 声称：

```text
“我已经完成”
```

就视为 Task 完成。

---

# 6. A 阶段建议 Task Graph

不要一次性重写所有能力。

首先把目前最容易产生流程漂移的 A 收敛。

目标结构：

```text
A_PREPARE
↓
A_DUMP
↓
A_RENDER
↓
A_BUILD_REQUIREMENT_FACTS
↓
A_BUILD_ADAPTOR
↓
A_ANALYZE_EVENT
↓
A_TRACE_PARAMETERS
↓
A_WRITE_IMPL
↓
A_NORMALIZE_IMPL
↓
A_VALIDATE_IMPL
↓
A_CHECK_CONFIRM
↓
needsConfirm?
├─ yes
│   ↓
│ A_CONFIRM_EVENT
│   ↓
│ A_VALIDATE_IMPL
│
└─ no
    ↓
A_COMPLETE
```

注意：

如果真实源码中某些步骤目前并非独立脚本，不要求为了 Task 名字机械拆成大量新文件。

重点是：

```text
Workflow state
必须能识别当前应该做哪个 Task。
```

---

# 7. Executor 边界

## script

能由确定性程序完成的，必须归 script。

包括但不限于：

```text
dump
render
normalize
validate
needsConfirm 判断
文件存在性
Schema 校验
accept-chain 构建
Runtime 执行
```

Agent 不负责决定这些步骤是否应该执行。

---

## agent

只负责无法完全规则化的语义任务：

```text
代码定位
组件语义判断
参数来源追踪
sourcePath 分析
expression 收敛
多候选消歧
impl 事实补充
```

Agent 完成 Task 后必须交回结构化事实。

Agent 不拥有 Workflow 跳转权。

---

## user

以下情况进入 user Task：

```text
业务语义无法从源码确认
needsConfirm
完整落库页确认
进入 C 确认
验收设备选择
D 失败后的修复方式选择
```

user Task 未解决时：

```text
workflow = blocked
```

重新运行 workflow 必须仍然返回相同阻塞 Task。

---

# 8. workflow.json

继续沿用当前：

```text
_raw/workflow.json
```

不要额外建立：

```text
workflow-state-v2.json
agent-state.json
task-memory.json
```

等平行状态文件。

允许升级现有 schema/version。

例如：

```json
{
  "version": 2,
  "currentTask": "A_ANALYZE_EVENT",
  "tasks": {
    "A_DUMP": {
      "status": "done"
    },
    "A_ANALYZE_EVENT": {
      "status": "ready"
    }
  },
  "history": []
}
```

但不要重复存储：

```text
events
adaptor
impl
accept-chain
```

中的业务事实。

workflow.json 只保存执行状态。

---

# 9. tracking-workflow.js 修改要求

重点检查并调整：

```text
scripts/workflow/tracking-workflow.js
```

当前：

```js
STAGES = ['A', 'B', 'C', 'D']
```

以及：

```js
buildStatus()
runStage()
gateStage()
completeStage()
```

是本次重构核心区域。

目标逐步引入类似：

```text
resolveNextTask()
getTaskStatus()
executeScriptTask()
validateTaskCompletion()
completeTask()
```

具体函数命名由实现者根据真实代码决定，不强制照抄。

重要的是最终不能继续只返回：

```json
{
  "next": "A"
}
```

而应能够返回明确：

```json
{
  "nextTask": {
    "id": "...",
    "stage": "...",
    "executor": "..."
  }
}
```

---

# 10. A Stage 完成语义修复

当前最大问题之一：

```text
--run=A
```

执行 dump + render 后调用：

```text
completeStage(A)
```

这与业务 A 定义冲突。

必须修复。

dump + render 完成只能表示：

```text
A 的前置脚本任务完成
```

不能表示：

```text
完整 A 完成
```

完整 A 的完成条件应至少与现有：

```text
inspectLanding.artifactsReady
validate-impl
needsConfirm
```

保持一致。

不得制造第二套 A 完成定义。

---

# 11. task-result.schema.json

当前已经存在：

```text
schemas/task-result.schema.json
```

不要废弃它重新建立完全平行协议。

应评估是：

```text
扩展现有 task-result
```

还是：

```text
将 nextTask Contract 单独定义为 workflow task schema
```

如果增加新 Schema，必须说明：

```text
为什么 task-result 无法承担该职责。
```

推荐职责区分：

```text
nextTask
=
Workflow Engine → Executor 的任务协议

task-result
=
Executor → Workflow Engine 的结果协议
```

避免两者重复表达业务事实。

---

# 12. SKILL.md 修改原则

本次不能继续往 SKILL.md 增加更多 Workflow 规则。

应逐步将确定性流程逻辑移到 Workflow Engine。

SKILL.md 最终更接近：

```text
识别 bella-tracking 任务
↓
读取 workflow status
↓
读取 nextTask
↓
executor=agent 时执行对应 Workflow 文档
↓
提交结构化结果
↓
重新读取 nextTask
```

仍然可以保留：

```text
事实优先级
不确定性原则
AI 推理边界
SDK / 项目规则入口
```

但不要继续依赖几十条：

```text
if A...
if B...
if C...
if needsConfirm...
```

驱动流程。

---

# 13. 不允许的修改

本任务禁止：

1. 重写整个 bella-tracking。
2. 修改 events/adaptor/impl/accept-chain 的核心职责。
3. 创建第二套 Workflow。
4. 用 Prompt 代替状态机。
5. 为了统一流程删除现有人工 Gate。
6. 自动跳过 needsConfirm。
7. 将 Agent 推断结果当作确定性事实。
8. 修改 Expected 去适配 Runtime Actual。
9. 为了重构引入不必要的新 Agent。
10. 假设任务文档中的文件、函数一定存在。

如果本文与真实源码冲突：

```text
真实源码优先
```

并在最终报告中说明冲突。

---

# 14. Determinism Tests

必须补 Workflow Determinism Test。

至少覆盖：

## Case 1：Fresh workflow

同样空状态：

```text
same repo
+
same Excel
+
same artifacts
```

多次：

```text
--status --json
```

必须产生相同：

```text
nextTask.id
executor
blocking state
```

---

## Case 2：dump/render 完成

必须保证：

```text
A_DUMP / A_RENDER = done
```

但：

```text
A_COMPLETE != done
```

如果 impl 等事实尚未完成。

这是本任务最重要的回归测试。

---

## Case 3：needsConfirm

当：

```text
needsConfirm = true
```

Workflow 必须稳定返回：

```text
executor=user
```

对应确认 Task。

重复执行 status 不得跳过。

---

## Case 4：resume

模拟：

```text
A 已完成一半
→ 中断
→ 新 session
```

不能依赖对话历史。

重新：

```text
--status --json
```

必须从磁盘事实恢复到同一个 nextTask。

---

## Case 5：validation failure

当：

```text
validate-impl errors > 0
```

Workflow 必须进入 blocked/fix 状态。

禁止进入 B/C。

---

## Case 6：B pending

A 已完成但待确认未清。

必须稳定：

```text
nextTask = B confirmation task
```

不得进入 C。

---

## Case 7：C Gate

只有：

```text
A ready
+
B queue cleared
+
full-page user confirmation
```

满足后才能进入写码 Task。

---

## Case 8：completed

全部 Task 完成后：

```text
nextTask = null
workflow status = completed
```

---

# 15. 验收核心指标

P0-1 的验收目标不是：

```text
Claude / Codex / Cursor 每次生成完全一样的 impl
```

那属于之后的事实收敛问题。

本任务只验证：

```text
同样事实状态
→
同样 nextTask
→
同样 Workflow Transition
```

定义：

```text
Workflow Determinism = 100%
```

对于 Workflow Engine 来说：

```text
State S
+
Facts F
=
NextTask T
```

必须是确定性函数。

---

# 16. Codex 实施步骤

执行时：

1. 阅读 `SKILL.md`。
2. 阅读 `scripts/workflow/tracking-workflow.js`。
3. 阅读 `schemas/task-result.schema.json`。
4. 阅读与 `inspectLanding / needsConfirm / validate-impl` 有关的真实实现。
5. 先画出当前实际 state transition。
6. 找出当前由 Agent 自行决定的 transition。
7. 设计最小 nextTask Contract。
8. 优先完成 A/B/C 主链路，不扩大范围。
9. 增加 determinism tests。
10. 运行现有测试和新增测试。
11. 输出完整变更报告。

不要先写代码再理解 Workflow。

---

# 17. Codex 最终输出要求

修改结束后必须报告：

```text
1. 修改文件列表
2. 新增文件列表
3. 当前 Workflow transition
4. 新 Workflow transition
5. 哪些判断从 Agent 移到了程序
6. 哪些判断仍必须由 Agent 完成
7. Schema 是否发生变化
8. events/adaptor/impl/accept-chain 是否受影响
9. 测试命令
10. 测试结果
11. 尚未解决的问题
12. 是否存在兼容性风险
```

特别说明：

```text
不要把 P0-2 / P0-3 顺手一起大改。
```

若实施过程中发现相关问题，记录为：

```text
follow-up
```

不要扩大本次 PR Scope。
