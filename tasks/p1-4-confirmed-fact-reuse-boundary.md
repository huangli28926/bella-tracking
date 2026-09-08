# P1-4 Confirmed Fact Reuse Boundary Closure

## 1. Status

```text
方案状态：候选 Closure 方案
所属阶段：P1 Parameter Resolution Determinism
目标：定义“已确认事实”的复用边界与失效规则
```

本方案不改变 bella-tracking 当前正式主链路：

```text
Excel
↓
parse_xlsx
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
├─ true → 人工确认 / 修正
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
```

P1-4 不新增新的事实层。

确认结果仍沉淀在：

```text
impl.json
```

中。

---

# 2. Problem

在 P1-1、P1-2、P1-3 完成后，参数解析已经具备：

```text
Parameter Schema
+
Deterministic Confidence
+
Parameter Validation Gate
```

但仍存在一个未闭环问题：

```text
某参数已经经过人工确认
↓
impl.json 中保存了确认结果
↓
后续再次执行 workflow
↓
Codex / Cursor / Claude Code 是否允许直接复用？
```

如果无条件复用：

```text
历史确认可能已经因为源码变化而失效
```

例如：

```text
原确认：
API.detail.houseCode
→ detail.houseCode
→ handleClick
→ action.house_id

代码重构后：
router.query.houseCode
→ handleClick
→ action.house_id
```

虽然：

```text
parameter name 相同
```

但数据源已经变化。

如果仍直接复用旧 confirmation：

```text
旧事实被错误继承
```

反之，如果每次都重新人工确认：

```text
人工确认无法形成可持久化事实
跨 Agent 复用价值消失
```

因此 P1-4 必须解决：

> 已确认事实可以在什么条件下继续复用，以及什么变化发生后必须失效。

---

# 3. Core Principle

P1-4 的核心 Contract：

```text
Confirmed
≠
Forever Valid
```

而是：

```text
Confirmed
=
Valid Within Verified Context Boundary
```

进一步定义：

> 历史人工确认只能复用“仍被当前源码证据证明成立的事实”，不能无条件复用人工确认本身。

因此任何历史 confirmation 在当前 workflow 中都必须经过：

```text
Historical Confirmation
+
Current Source Evidence
↓
Reuse Validation
↓
REUSED / STALE
```

禁止：

```text
发现 confirmed=true
↓
跳过当前参数来源分析
↓
直接使用旧 expression
```

---

# 4. Scope

P1-4 只负责：

```text
历史确认事实
是否仍然可以作为当前 impl fact 使用
```

P1-4 不负责：

```text
参数候选发现
参数语义理解
confidence 计算
参数最终 Gate
Runtime 验收
```

职责关系：

```text
P1-1
Parameter Schema

P1-2
Confidence Determinism

P1-4
Confirmation Reuse Boundary

P1-3
Parameter Validation Gate
```

推荐执行顺序：

```text
Parameter Resolution
↓
P1-1 Schema Validation
↓
P1-2 Confidence Determination
↓
P1-4 Confirmation Reuse Validation
↓
P1-3 Parameter Validation Gate
```

---

# 5. Fact Ownership

不得新增：

```text
confirmed-facts.json
parameter-memory.json
fact-cache.json
```

否则会产生：

```text
impl.json
vs
confirmation cache
```

两个事实源。

正式规则：

```text
impl.json
=
当前实现事实
+
参数来源事实
+
确认来源
+
复用状态
```

confirmation 必须作为对应参数事实的一部分存在。

建议结构：

```json
{
  "name": "house_id",
  "expression": "detail.houseCode",
  "sourcePath": [
    "api.detail.houseCode",
    "detail.houseCode",
    "handleClick",
    "action.house_id"
  ],
  "confidence": 0.95,
  "unresolved": [],
  "confirmation": {
    "status": "confirmed",
    "source": "human",
    "reuseScope": "same-dataflow",
    "confirmedAt": "2026-09-08T10:00:00+08:00",
    "evidence": {
      "parameterKey": "action.house_id",
      "sourceRoot": "api.detail.houseCode",
      "targetFile": "src/pages/detail/index.tsx",
      "targetSymbol": "handleClick"
    }
  }
}
```

字段名称允许根据现有 `impl.schema.json` 做兼容调整。

但语义必须保留。

---

# 6. What Is Actually Confirmed

禁止将：

```text
expression = detail.houseCode
```

本身视为永久确认事实。

真正被确认的是：

```text
tracking parameter semantic
        ↓
maps to
source semantic
        ↓
through valid dataflow
        ↓
reachable at current tracking target
```

即：

```text
Parameter Identity
+
Source Identity
+
Dataflow Reachability
+
Target Context
```

例如：

原代码：

```ts
send({
  house_id: detail.houseCode
});
```

重构为：

```ts
const { houseCode } = detail;

send({
  house_id: houseCode
});
```

此时：

```text
expression:
detail.houseCode
→
houseCode
```

发生变化。

但是：

```text
sourceRoot:
api.detail.houseCode
```

没有变化。

且：

```text
source → target
```

仍然可达。

这种情况允许复用历史 confirmation。

因此：

```text
expression
```

是当前代码实现表达。

而：

```text
parameter ↔ source semantic mapping
```

才是可复用的确认事实。

---

# 7. Confirmation Status

原有 boolean：

```text
confirmed: true / false
```

不足以表达事实生命周期。

P1-4 建议至少支持：

```text
unconfirmed
confirmed
reused
stale
```

含义：

| status        | 含义                  |
| ------------- | ------------------- |
| `unconfirmed` | 当前事实未经过人工确认         |
| `confirmed`   | 当前 workflow 中人工确认   |
| `reused`      | 历史人工确认经过当前源码重新验证后复用 |
| `stale`       | 历史人工确认已经不能被当前源码证明   |

规则：

```text
confirmed
↓ 后续 workflow
reuse validation PASS
↓
reused
```

如果失败：

```text
confirmed
↓
reuse validation FAIL
↓
stale
```

`stale` 不代表：

```text
参数一定错误
```

只代表：

```text
旧人工确认不再具有当前授权效力
```

---

# 8. Reuse Scope

禁止让 Agent 自由决定：

```text
“看起来应该可以复用”
```

必须使用确定性枚举。

建议：

```json
{
  "reuseScope": "exact-target | same-dataflow | none"
}
```

## 8.1 exact-target

仅允许：

```text
相同 parameter
+
相同 source
+
相同 target
+
相同 target boundary
```

适合：

```text
lifecycle
特殊 insertion point
特殊 handler
调用位置相关确认
```

---

## 8.2 same-dataflow

允许 expression 因重构发生变化。

但必须保证：

```text
Parameter Identity 相同
+
Source Identity 相同
+
Source → Target 仍可达
+
Target Semantic Boundary 没发生变化
```

适合：

```text
参数来源人工确认
```

P1-4 默认推荐：

```text
parameter confirmation
→ same-dataflow
```

---

## 8.3 none

只允许当前确认使用。

后续 workflow 不允许自动继承。

适合：

```text
无法被静态证据稳定验证的业务语义
临时人工指定
存在明显业务假设
```

---

# 9. Forbidden Reuse Scope

本阶段禁止支持：

```text
same-project
same-page
same-component
same-param-name
same-event-name
```

作为自动复用边界。

原因：

这些条件不能充分证明：

```text
业务语义相同
+
数据源相同
+
当前 target 可访问
```

例如：

```text
同页面两个 house_id
```

可能分别来自：

```text
推荐房源
当前房源
```

不能因为字段名相同自动继承。

---

# 10. Reuse Validation Contract

历史确认事实必须经过：

```text
validateConfirmationReuse(
  previousFact,
  currentFact
)
```

才能进入 `reused`。

自动复用必须同时满足以下条件。

---

## 10.1 Parameter Identity Match

必须确定性判断：

```text
previous.parameterKey
===
current.parameterKey
```

例如：

```text
action.house_id
```

只能直接匹配：

```text
action.house_id
```

不能因为：

```text
houseId
house_code
standard_house_id
```

语义看起来相似就自动复用。

建议 parameter identity 至少来自：

```text
event identity
+
parameter path
```

例如：

```json
{
  "eventKey": "95083",
  "parameterKey": "action.house_id"
}
```

如果未来支持跨 event 的语义复用：

必须新增显式 semantic key。

禁止让 Agent 根据名称推断。

---

# 11. Source Identity Match

历史确认必须记录：

```text
sourceRoot
```

例如：

```text
api.detail.houseCode
```

当前参数解析也必须生成规范化 source identity。

只有：

```text
previous.sourceRoot
===
current.sourceRoot
```

才能继承 source confirmation。

例如：

允许：

```text
api.detail.houseCode
→ local detail.houseCode
```

重构为：

```text
api.detail.houseCode
→ const houseCode
```

因为 sourceRoot 未变化。

禁止：

```text
api.detail.houseCode
→ router.query.houseCode
```

即使最终值业务上可能相等，也必须：

```text
STALE
```

---

# 12. Scope Reachability Validation

历史 confirmation 永远不能替代当前 scope reachability 检查。

每次 workflow 必须重新验证：

```text
source
↓
props / state / hook / local binding
↓
target function
```

当前是否真实可达。

要求：

```text
current.scopeReachable === true
```

才允许 reuse。

禁止：

```text
历史 sourcePath 存在
↓
直接认为当前仍可达
```

因为源码可能已经发生变化。

---

# 13. Target Boundary Validation

需要区分：

```text
代码坐标变化
```

和：

```text
业务边界变化
```

例如：

```text
src/pages/detail/Card.tsx
```

移动到：

```text
src/pages/detail/components/Card.tsx
```

如果：

```text
同一组件
同一 symbol semantic
同一 dataflow
```

可以继续分析是否 reuse。

但：

```text
Page Component
→ Shared Component
```

或：

```text
Shared Component
→ Page Caller
```

属于：

```text
component boundary change
```

必须使历史 confirmation 至少进入重新验证。

不得自动认为语义一致。

---

# 14. Transformation Validation

参数来源相同，不代表最终上报值语义相同。

例如：

历史实现：

```ts
house_id: houseCode || "-"
```

当前实现：

```ts
house_id: Number(houseCode)
```

虽然：

```text
sourceRoot 相同
```

但 transformation 改变。

因此必须记录或可推导：

```text
source
→ reported value
```

之间的转换。

如果 transformation 发生语义变化：

```text
STALE
```

允许忽略纯语法等价变化，例如：

```ts
foo || "-"
```

与：

```ts
foo ?? "-"
```

是否视为等价不能由 Agent 自由判断。

本阶段若无法确定性证明等价：

```text
视为 changed
```

宁可重新 resolution。

---

# 15. Invalidation Rules

必须提供确定性 invalidation reason。

建议至少包括：

```json
[
  "requirement_changed",
  "source_changed",
  "source_unreachable",
  "target_changed",
  "component_boundary_changed",
  "lifecycle_changed",
  "transformation_changed",
  "evidence_missing"
]
```

---

## 15.1 requirement_changed

历史：

```text
action.house_id
```

当前需求：

```text
action.standard_house_id
```

结果：

```text
STALE
```

---

## 15.2 source_changed

历史：

```text
api.detail.houseCode
```

当前：

```text
router.query.houseCode
```

结果：

```text
STALE
```

---

## 15.3 source_unreachable

历史数据流：

```text
API
→ detail
→ handleClick
```

当前静态分析无法再证明：

```text
source → target
```

结果：

```text
STALE
```

---

## 15.4 target_changed

历史：

```text
A.tsx#handleClick
```

当前：

```text
B.tsx#handleClick
```

且不能证明属于同一 target semantic。

结果：

```text
STALE
```

---

## 15.5 component_boundary_changed

历史：

```text
Page
→ Card
```

当前：

```text
SharedCard
```

结果：

```text
STALE
```

然后重新分析：

```text
Caller
→ props
→ SharedCard
```

是否仍能闭环。

---

## 15.6 lifecycle_changed

历史：

```text
click
```

当前：

```text
exposure
```

或：

```text
useEffect
→ IntersectionObserver
```

结果：

```text
STALE
```

---

## 15.7 transformation_changed

历史：

```text
foo || "-"
```

当前：

```text
Number(foo)
```

结果：

```text
STALE
```

---

## 15.8 evidence_missing

历史记录存在：

```text
confirmed
```

但当前无法找到：

```text
targetFile
targetSymbol
sourceRoot
sourcePath
```

中的关键证据。

结果：

```text
STALE
```

禁止：

```text
证据找不到
但因为历史 confirmed=true
继续 PASS
```

---

# 16. Semantic Fingerprint

P1-4 可以增加 fingerprint 辅助比较。

但禁止使用：

```text
whole file SHA
```

作为 confirmation 是否失效的唯一依据。

原因：

```text
CSS 修改
文案修改
无关 JSX 修改
```

都会改变文件 hash，但不代表参数事实发生变化。

建议计算：

```text
semanticFingerprint
```

输入至少包括：

```text
parameterKey
sourceRoot
target semantic identity
normalized sourcePath
normalized transformation
```

伪代码：

```ts
semanticFingerprint = hash(
  parameterKey +
  sourceRoot +
  targetIdentity +
  normalizedSourcePath +
  normalizedTransformation
)
```

用途：

```text
快速判断上下文是否明显未变化
```

但最终：

```text
reuse decision
```

仍必须经过具体规则校验。

不得设计成：

```text
fingerprint same
→ unconditional reuse
```

---

# 17. Deterministic Reuse Algorithm

建议新增确定性函数：

```ts
resolveConfirmationReuse()
```

伪代码：

```ts
function resolveConfirmationReuse(
  previousFact,
  currentFact
) {
  const confirmation = previousFact.confirmation;

  if (!confirmation) {
    return {
      reusable: false,
      reason: "no_confirmation"
    };
  }

  if (
    confirmation.status !== "confirmed" &&
    confirmation.status !== "reused"
  ) {
    return {
      reusable: false,
      reason: "not_confirmed"
    };
  }

  if (confirmation.reuseScope === "none") {
    return {
      reusable: false,
      stale: true,
      reason: "reuse_disabled"
    };
  }

  if (
    previousFact.parameterKey !==
    currentFact.parameterKey
  ) {
    return stale("requirement_changed");
  }

  if (
    previousFact.sourceRoot !==
    currentFact.sourceRoot
  ) {
    return stale("source_changed");
  }

  if (!currentFact.scopeReachable) {
    return stale("source_unreachable");
  }

  if (
    !isTargetCompatible(
      previousFact,
      currentFact,
      confirmation.reuseScope
    )
  ) {
    return stale("target_changed");
  }

  if (
    hasComponentBoundaryChanged(
      previousFact,
      currentFact
    )
  ) {
    return stale("component_boundary_changed");
  }

  if (
    hasLifecycleChanged(
      previousFact,
      currentFact
    )
  ) {
    return stale("lifecycle_changed");
  }

  if (
    !isTransformationCompatible(
      previousFact,
      currentFact
    )
  ) {
    return stale("transformation_changed");
  }

  if (!hasRequiredCurrentEvidence(currentFact)) {
    return stale("evidence_missing");
  }

  return {
    reusable: true,
    status: "reused"
  };
}
```

核心要求：

```text
reuse decision
=
deterministic program
```

而不是：

```text
Agent recommendation
```

---

# 18. AI / Deterministic Boundary

## AI 负责

```text
理解业务参数语义
发现当前 source 候选
理解复杂数据流
生成 current resolution
发现可能的 target
```

AI 输出：

```text
current parameter resolution facts
```

---

## Static Analysis / Script 负责

```text
parameter identity compare
source identity compare
scope reachability
target identity compare
reuseScope enforcement
invalidation rules
confirmation state transition
```

程序输出：

```text
REUSED
STALE
NOT_APPLICABLE
```

---

## Human 负责

仅当当前事实经过重新解析后仍然：

```text
cannot close semantic/dataflow evidence
```

才进入：

```text
needsConfirm = true
```

---

# 19. Relationship With P1-2 Confidence

必须严格区分：

```text
confidence
```

和：

```text
confirmation
```

`confidence` 表示：

```text
当前证据对参数解析结果的支持强度
```

`confirmation` 表示：

```text
该事实是否经过人工授权，以及历史授权当前是否仍有效
```

禁止：

```text
confirmed
→ 强行 confidence = 1
```

也禁止：

```text
confidence high
→ 等于 human confirmed
```

建议：

```json
{
  "confidence": 0.92,
  "confirmation": {
    "status": "reused",
    "source": "human"
  }
}
```

这样：

```text
P1-2
回答：
当前代码证据有多强

P1-4
回答：
历史人工确认现在还能不能用
```

二者职责独立。

---

# 20. Relationship With P1-3 Gate

P1-4 不直接决定最终：

```text
needsConfirm
```

正确流程：

```text
previous confirmation
↓
P1-4
├─ REUSED
│   ↓
│   保留 confirmation authority
│
└─ STALE
    ↓
    删除旧 confirmation 对 Gate 的授权作用
    ↓
    使用当前 resolution
    ↓
    P1-2 confidence
    ↓
    P1-3 gate
```

因此：

```text
STALE
≠
needsConfirm=true
```

例如：

历史 confirmation 已失效。

但当前源码出现了新的确定性证据：

```text
same event parameter
+
existing identical tracking implementation
+
direct source reachability
+
无 unresolved
```

P1-3 仍可能：

```text
PASS
```

因此 P1-4 只负责：

```text
历史确认是否仍有效
```

不负责：

```text
当前事实最终是否需要人工确认
```

---

# 21. Workflow Integration

建议参数解析 workflow 调整为：

```text
1. Load events.json
2. Load adaptor.json
3. Load previous impl.json if exists

4. Resolve current target
5. Resolve current parameter source
6. Build current sourcePath
7. Determine current evidence

8. Run P1-2 confidence determination

9. If previous confirmation exists:
      run confirmation reuse validation

10. Apply confirmation state:
      confirmed / reused / stale / unconfirmed

11. Run P1-3 parameter validation gate

12. Generate current impl.json

13. validate-impl
```

关键约束：

```text
Step 4-7 永远不能因为存在历史 confirmation 而跳过
```

---

# 22. Schema Changes

需要检查当前 `impl.schema.json`。

若尚无对应能力，应增加：

```json
{
  "confirmation": {
    "type": "object",
    "properties": {
      "status": {
        "enum": [
          "unconfirmed",
          "confirmed",
          "reused",
          "stale"
        ]
      },
      "source": {
        "enum": [
          "human"
        ]
      },
      "reuseScope": {
        "enum": [
          "exact-target",
          "same-dataflow",
          "none"
        ]
      },
      "confirmedAt": {
        "type": ["string", "null"]
      },
      "evidence": {
        "type": "object",
        "properties": {
          "parameterKey": {
            "type": "string"
          },
          "sourceRoot": {
            "type": "string"
          },
          "targetFile": {
            "type": ["string", "null"]
          },
          "targetSymbol": {
            "type": ["string", "null"]
          },
          "semanticFingerprint": {
            "type": ["string", "null"]
          }
        }
      },
      "invalidReason": {
        "type": ["string", "null"]
      }
    }
  }
}
```

必须尽量兼容当前 Schema。

禁止为了 P1-4 大规模重构 impl 数据模型。

---

# 23. Script Changes

建议新增确定性实现：

```text
scripts/
├── validate-confirmation-reuse.*
└── validate-impl.*
```

职责拆分：

## validate-confirmation-reuse

输入：

```text
previous parameter fact
+
current parameter fact
```

输出：

```json
{
  "status": "reused",
  "valid": true,
  "checks": {
    "parameterIdentity": true,
    "sourceIdentity": true,
    "scopeReachable": true,
    "targetCompatible": true,
    "componentBoundaryCompatible": true,
    "lifecycleCompatible": true,
    "transformationCompatible": true,
    "currentEvidencePresent": true
  },
  "invalidReason": null
}
```

或：

```json
{
  "status": "stale",
  "valid": false,
  "checks": {
    "parameterIdentity": true,
    "sourceIdentity": false
  },
  "invalidReason": "source_changed"
}
```

---

# 24. Validation Rules

`validate-impl` 至少增加以下确定性检查。

## Rule 1

```text
confirmation.status = reused
```

时必须存在：

```text
reuse validation evidence
```

禁止 Agent 直接生成：

```json
{
  "status": "reused"
}
```

而没有程序验证结果。

---

## Rule 2

```text
status = stale
```

时：

```text
invalidReason
```

必须存在。

---

## Rule 3

```text
status = confirmed / reused
```

时必须存在：

```text
parameterKey
sourceRoot
reuseScope
```

---

## Rule 4

```text
scopeReachable = false
```

时不得：

```text
confirmation.status = reused
```

---

## Rule 5

发现：

```text
sourceRoot changed
```

时不得：

```text
reused
```

---

## Rule 6

发现：

```text
component boundary changed
```

且没有显式重新 confirmation 时：

```text
不得继承旧确认
```

---

# 25. Test Cases

P1-4 必须建立 fixture tests。

建议至少覆盖：

```text
tests/confirmation-reuse/
```

---

## Case 1: exact unchanged

历史：

```text
detail.houseCode
```

当前：

```text
detail.houseCode
```

相同 target。

Expected：

```text
REUSED
```

---

## Case 2: local variable rename

历史：

```ts
detail.houseCode
```

当前：

```ts
const houseCode = detail.houseCode;
```

sourceRoot 相同。

Expected：

```text
REUSED
```

---

## Case 3: destructure refactor

历史：

```ts
detail.houseCode
```

当前：

```ts
const { houseCode } = detail;
```

Expected：

```text
REUSED
```

---

## Case 4: source changed

历史：

```text
api.detail.houseCode
```

当前：

```text
router.query.houseCode
```

Expected：

```text
STALE
reason = source_changed
```

---

## Case 5: source unreachable

历史：

```text
detail.houseCode
→ handleClick
```

当前 target 已无法访问 detail。

Expected：

```text
STALE
reason = source_unreachable
```

---

## Case 6: component boundary changed

历史：

```text
Page → LocalCard
```

当前：

```text
Page → SharedCard
```

Expected：

```text
STALE
reason = component_boundary_changed
```

---

## Case 7: lifecycle changed

历史：

```text
click
```

当前：

```text
intersection exposure
```

Expected：

```text
STALE
reason = lifecycle_changed
```

---

## Case 8: transformation changed

历史：

```ts
houseCode || "-"
```

当前：

```ts
Number(houseCode)
```

Expected：

```text
STALE
reason = transformation_changed
```

---

## Case 9: unrelated file modification

只修改：

```text
CSS
文案
其他无关函数
```

参数 dataflow 不变。

Expected：

```text
REUSED
```

用于证明系统不能依赖：

```text
whole-file hash
```

判断失效。

---

## Case 10: stale but current evidence strong

旧 confirmation 因 target change 失效。

当前重新解析可以确定性闭环。

Expected：

```text
confirmation.status = stale
```

但：

```text
P1-3 may PASS
needsConfirm = false
```

用于证明：

```text
STALE ≠ needsConfirm
```

---

# 26. Cross-Agent Determinism Requirement

P1-4 的最终目标之一：

给定完全相同的：

```text
源码
+
events.json
+
adaptor.json
+
previous impl.json
```

在：

```text
Claude Code
Codex
Cursor
```

执行后，必须得到一致的：

```text
confirmation.status
reuseScope result
invalidReason
needsConfirm gate input
```

Agent 可以在：

```text
source discovery
semantic analysis
```

阶段存在推理差异。

但进入 P1-4 以后：

```text
是否允许复用旧 confirmation
```

必须由程序规则决定。

---

# 27. Implementation Boundary

Codex / Cursor 实施时：

必须先读取真实仓库。

重点检查：

```text
schemas/impl.schema.json
scripts/validate-impl.*
参数 resolution workflow
当前 confidence 实现
当前 needsConfirm Gate
tests
```

不得假设这些文件或字段一定存在。

如果当前代码已有同类能力：

```text
优先扩展现有实现
```

而不是重复创建新的：

```text
confirmation subsystem
```

---

# 28. Failure Handling

如果当前源码无法构造：

```text
parameter identity
sourceRoot
scope reachability
target identity
```

则：

```text
不得自动复用 confirmation
```

处理方式：

```text
confirmation.status = stale
或
reuse validation = not-provable
```

然后使用：

```text
当前 resolution
→ P1-2
→ P1-3
```

决定：

```text
needsConfirm
```

原则：

> 无法证明可以复用时，默认不复用。

---

# 29. Non-Goals

P1-4 本阶段不解决：

```text
跨项目 confirmation 复用
跨 event 参数语义知识库
全局业务参数 ontology
长期 semantic cache
自动学习用户所有历史确认
Runtime 自动修正 confirmation
```

这些能力如果未来需要，应独立设计。

不得借 P1-4 引入新的大规模事实系统。

---

# 30. Closure Criteria

满足以下条件后，P1-4 才可以标记为 CLOSED。

```text
[ ] 1. impl schema 能表达 confirmation status

[ ] 2. 能表达 confirmation provenance

[ ] 3. reuseScope 使用固定 enum

[ ] 4. 默认不存在 project/page/name 级宽松自动复用

[ ] 5. 每次执行都会重新构造 current parameter resolution

[ ] 6. 历史 confirmation 不会跳过当前源码分析

[ ] 7. Parameter Identity 有确定性比较规则

[ ] 8. Source Identity 有确定性比较规则

[ ] 9. scopeReachable 每次重新验证

[ ] 10. target boundary 变化能够使历史 confirmation 失效

[ ] 11. component boundary 变化能够使历史 confirmation 失效

[ ] 12. lifecycle 变化能够使历史 confirmation 失效

[ ] 13. transformation 变化能够使历史 confirmation 失效

[ ] 14. evidence missing 时不能 reuse

[ ] 15. stale confirmation 不会直接通过 Gate

[ ] 16. stale 不会被简单等价成 needsConfirm=true

[ ] 17. stale 后重新进入 P1-2/P1-3 判断

[ ] 18. reused 状态必须有程序验证证据

[ ] 19. whole-file hash 不能作为唯一失效依据

[ ] 20. fixture tests 覆盖 reuse / stale 主要路径

[ ] 21. 同一输入在 Codex / Cursor / Claude Code 中得到一致 reuse decision
```

---

# 31. Expected Final Architecture

P1 参数事实闭环最终形成：

```text
                   Parameter Resolution
                           ↓
                 P1-1 Parameter Schema
                           ↓
              P1-2 Confidence Determinism
                           ↓
       ┌──── Previous Confirmation Exists? ────┐
       │                                       │
      NO                                      YES
       │                                       ↓
       │                         P1-4 Confirmation Reuse
       │                              Validation
       │                               ↓       ↓
       │                            REUSED    STALE
       │                               │       │
       └───────────────────────────────┴───────┘
                           ↓
               P1-3 Parameter Validation Gate
                           ↓
                  PASS / needsConfirm
                           ↓
                        impl.json
```

最终确保：

```text
历史人工确认
不是永久缓存

而是：

可被当前源码重新证明的
结构化事实
```

---

# 32. Final Rule

P1-4 最终必须在 workflow / reference 中明确写入以下规则：

> Never reuse a historical confirmation only because it was previously confirmed.

> A historical confirmation may be reused only when the current source evidence deterministically proves that the confirmed parameter identity, source identity, dataflow reachability, target boundary, and transformation remain compatible with the configured reuse scope.

中文规则：

> 不得因为一个事实历史上经过人工确认，就直接继续使用。只有当前源码能够重新证明其参数身份、数据源、数据流可达性、目标边界以及转换语义仍符合既定复用范围时，才允许将历史确认状态转换为 `reused`。

该规则是 P1-4 的最终 Contract。
