# P1-2 Closure：Confidence Determinism

## 1. 任务定位

本任务是 Parameter Resolution Contract 的第二阶段。

P1-1 已解决：

```text
参数事实如何结构化表达
```

P1-2 解决：

```text
这些参数事实
是否足以支持
confidence = high / medium / low
```

核心目标：

```text
相同 Parameter Facts
↓
无论 Claude Code / Codex / Cursor
↓
必须得到相同 confidence
```

本阶段重点不是提高 Agent 的推理能力，而是消除：

```text
Agent 自己决定 confidence
```

带来的不确定性。

---

# 2. 当前仓库事实

当前 `feat/0907` 实现需要以以下事实为基础：

```text
sourcePath
=
string

unresolved
=
当前主要存在于 event 级

P1-1 normalize
会为缺失参数补：

evidence: []
scopeReachable: null
conflicts: []

当前没有 impl version
```

另外：

```text
needsConfirm
```

已经会根据：

```text
confidence === medium
confidence === low
expression 为空
```

执行 Gate。

因此 P1-2：

```text
不修改 required / optional 语义
不重新设计 needsConfirm 主流程
```

只负责让 confidence 成为确定性派生事实。

---

# 3. 对正式主链路的影响

不改变：

```text
events.json
↓
adaptor.json
↓
参数解析
↓
impl.json
↓
validate-impl
↓
needsConfirm
↓
代码实现
↓
accept-chain.json
```

本阶段只增强：

```text
Parameter Facts
↓
calculateParameterConfidence
↓
confidence
↓
现有 needsConfirm Gate
```

不新增新的核心事实层。

---

# 4. 核心原则

从 P1-2 开始：

```text
Agent
不再拥有 confidence 最终决定权
```

Agent 只负责提供事实：

```text
expression
sourcePath
evidence
scopeReachable
conflicts
```

以及必要的 unresolved 上下文。

确定性程序负责：

```text
读取事实
↓
calculateParameterConfidence()
↓
生成 high / medium / low
```

最终原则：

> AI 找证据，程序判断这些证据是否足以支持 high。

---

# 5. Confidence 的事实输入

对于新结构 parameter：

```text
calculateParameterConfidence
```

只能基于以下事实判断：

```text
expression
sourcePath
evidence
scopeReachable
unresolved context
conflicts
```

不得使用：

```text
Agent 原始 confidence
模型名称
Prompt
自然语言 confidenceReason
模型自己输出的 probability / score
历史模型结论
```

即：

```text
stored confidence
```

不得参与新结构参数的 confidence 计算。

---

# 6. Confidence 是 Derived Fact

`confidence` 继续保存在：

```text
impl.json
```

中。

但语义必须改为：

```text
Derived Fact
```

而不是：

```text
Agent Fact
```

即：

```text
expression
sourcePath
evidence
scopeReachable
conflicts
=
Confidence Input Facts

confidence
=
Deterministic Derived Fact
```

---

# 7. Legacy Compatibility

P1-2 必须兼容历史 impl。

这是本阶段的重要边界。

历史参数可能只有：

```json
{
  "key": "house_id",
  "expression": "houseInfo.id",
  "sourcePath": "",
  "confidence": "high"
}
```

经过 P1-1 normalize 后会变成：

```json
{
  "key": "house_id",
  "expression": "houseInfo.id",
  "sourcePath": "",
  "evidence": [],
  "scopeReachable": null,
  "confidence": "high",
  "conflicts": []
}
```

此时仅看 normalize 后的数据：

```text
无法区分
历史参数
和
Agent 显式提交的新结构空值参数
```

因此禁止：

```text
normalize 后
通过 evidence=[] / scopeReachable=null
判断 legacy
```

---

# 8. Legacy 的正式识别规则

必须在：

```text
normalize 前
```

检查原始 Parameter JSON。

正式规则：

```text
原始 parameter 中：

evidence
scopeReachable
conflicts

三个字段一个都没有出现
```

则：

```text
legacy = true
```

如果三个字段中：

```text
任意一个 key 曾经出现
```

即使值是：

```json
{
  "evidence": [],
  "scopeReachable": null,
  "conflicts": []
}
```

也视为：

```text
structured parameter
```

必须执行新的：

```text
calculateParameterConfidence
```

---

# 9. Legacy 参数处理

Legacy Parameter：

```text
保留原 confidence
```

不执行新 Confidence Contract。

流程：

```text
raw parameter
↓
detectLegacyParameter(rawParameter)
↓
legacy = true
↓
保留原 confidence
↓
normalize
```

这样避免：

```text
P1-2 上线
↓
历史 high 大量自动降级
↓
全部进入 needsConfirm
```

---

# 10. Legacy 的生命周期

Legacy 兼容不是永久规则。

如果一个历史 Parameter：

```text
被 Agent 重新分析
被人工重新确认
被重新生成
```

并开始写入：

```text
evidence
scopeReachable
conflicts
```

则立即进入：

```text
Structured Parameter
```

之后必须使用新 Confidence Contract。

即：

```text
旧数据
允许继续使用旧 confidence

重新分析后的数据
必须使用新规则
```

---

# 11. 不新增 impl version

当前仓库没有 impl version。

P1-2 不为了 Legacy Recognition 新增：

```text
implVersion
migrationVersion
parameterVersion
```

等新的版本体系。

第一版直接使用：

```text
normalize 前字段是否存在
```

进行判断。

未来若系统已有统一 Schema Version，再迁移到版本判断。

---

# 12. unresolved 的当前事实

当前仓库：

```text
unresolved
```

主要位于：

```text
event
```

而不是 parameter。

因此原方案中的：

```js
parameter.unresolved.length
```

不能作为当前实现的硬前提。

P1-2 不在本阶段修改 Parameter Schema 增加：

```text
parameter.unresolved
```

避免把 Confidence Determinism 和 Schema Evolution 混在一次任务中。

---

# 13. unresolved 兼容读取

正式接口建议：

```js
calculateParameterConfidence(parameter, eventContext)
```

Confidence 计算需要判断：

```text
当前 parameter 是否仍 unresolved
```

读取顺序：

```text
1. 如果 parameter.unresolved 存在
   → 使用 parameter.unresolved

2. 否则读取 eventContext.unresolved
   → 判断是否存在针对当前 parameter 的 unresolved
```

---

# 14. Event unresolved 参数匹配

如果当前事件存在：

```text
请确认参数 house_id 的取值
```

则：

```text
house_id
```

对应 parameter 必须：

```text
hasUnresolved = true
```

不得 high。

建议集中实现：

```js
hasParameterUnresolved(parameter, eventContext)
```

不要把字符串匹配逻辑散落在：

```text
normalize
validate
confidence
```

多个文件中。

---

# 15. unresolved 的长期状态

当前方案：

```text
event unresolved
→ 参数级兼容映射
```

属于：

```text
Compatibility Strategy
```

而不是最终理想结构。

长期可以单独评估：

```text
是否将 unresolved
真正下沉到 parameter
```

但不属于 P1-2。

---

# 16. Evidence 分类

P1-1 已有固定 Evidence enum。

P1-2 将 Evidence 分成：

```text
Strong Evidence
Supporting Evidence
```

但这只是程序规则分类。

不得由 Agent 输出：

```text
strength = strong
```

---

# 17. Strong Evidence

第一版定义：

```text
same-component-tracking
same-page-tracking

jsx-binding
api-field

prop-chain
state-chain
hook-chain
context-chain

url-field
user-context

manual-confirm
```

Strong 表示：

```text
可以直接支撑当前参数事实的重要代码证据
```

但：

```text
Strong Evidence
≠
confidence high
```

例如：

```text
api-field
```

只证明 API 中存在字段。

不能证明：

```text
当前 tracking scope
能够访问该字段
```

---

# 18. Supporting Evidence

以下定义为 Supporting：

```text
same-module-tracking
field-memory
repository-convention
```

这些只能用于：

```text
候选辅助
```

不能单独产生：

```text
high
```

---

# 19. Evidence 分类集中定义

Evidence 强度必须集中定义。

例如：

```js
const STRONG_EVIDENCE_TYPES = new Set([
  'same-component-tracking',
  'same-page-tracking',
  'jsx-binding',
  'api-field',
  'prop-chain',
  'state-chain',
  'hook-chain',
  'context-chain',
  'url-field',
  'user-context',
  'manual-confirm'
])

const SUPPORTING_EVIDENCE_TYPES = new Set([
  'same-module-tracking',
  'field-memory',
  'repository-convention'
])
```

不得在：

```text
calculate-confidence
validate-impl
normalize
```

分别维护三套不同定义。

---

# 20. Source Path

当前真实 Schema：

```text
sourcePath = string
```

P1-2 不把它重构成数组。

第一版只需要确定性判断：

```text
sourcePath
是否存在
```

例如：

```js
function hasSourcePath(parameter) {
  return typeof parameter.sourcePath === 'string'
    && parameter.sourcePath.trim().length > 0
}
```

P1-2 不负责证明：

```text
sourcePath 内的整个数据流
是否经过 AST 静态证明
```

这是后续 Parameter Evidence / Static Analysis 的能力。

---

# 21. Scope Reachability

`scopeReachable` 是 High 的硬条件。

正式规则：

```text
scopeReachable === true
```

才可能：

```text
high
```

如果：

```text
scopeReachable === false
```

则：

```text
low
```

如果：

```text
scopeReachable === null
```

则：

```text
不得 high
```

在其它信息有效的情况下：

```text
medium
```

---

# 22. 为什么 scopeReachable 是硬条件

因为：

```text
知道值在哪里
≠
当前埋点能使用这个值
```

例如：

```text
Parent
有 houseInfo.id

Child handler
没有 props / hook / context 能拿到 houseInfo
```

则：

```text
scopeReachable=false
```

无论：

```text
已有埋点
API
图片
manual-confirm
```

提供多少语义证据：

```text
confidence 都不能 high
```

---

# 23. Conflicts 正式判定规则

P1-2 固定 conflicts 行为。

首先判断硬 Low：

```text
expression 为空
OR
scopeReachable === false
OR
没有任何有效 evidence
```

满足任意一个：

```text
confidence = low
```

---

# 24. Conflicts 无人工确认

如果：

```text
conflicts.length > 0
AND
不存在 manual-confirm evidence
```

则：

```text
confidence = low
```

例如：

```text
same-component-tracking:
house_id = houseInfo.id

API hint:
house_id = property.id
```

系统不能由 Agent 自己选择一个。

必须：

```text
low
+
needsConfirm
```

---

# 25. Conflicts 已有人工作为证据

如果：

```text
conflicts.length > 0
AND
存在 manual-confirm
```

则：

```text
confidence = medium
```

不能：

```text
high
```

原因：

```text
manual-confirm 存在
但 conflicts 仍未清除
```

表示结构化事实仍然自相矛盾。

---

# 26. 正确的冲突解决方式

正确流程：

```text
conflicts 存在
↓
人工确认
↓
修改最终事实
↓
删除已解决 conflicts
↓
增加 manual-confirm evidence
↓
重新 calculateParameterConfidence
```

而不是：

```text
conflicts 仍存在
+
manual-confirm
→ high
```

---

# 27. Manual Confirm 的边界

`manual-confirm` 属于 Strong Evidence。

但是：

```text
manual-confirm
不能绕过源码事实
```

例如：

```text
manual-confirm
+
scopeReachable=false
```

结果仍然：

```text
low
```

因为人工确认可以确认：

```text
业务语义
```

但不能把：

```text
源码中不可访问的变量
```

变成可访问。

---

# 28. High 判定规则

Structured Parameter 只有同时满足：

```text
expression 非空

AND

sourcePath 非空

AND

scopeReachable === true

AND

至少存在一个 Strong Evidence

AND

当前参数没有 unresolved

AND

conflicts.length === 0
```

才能：

```text
confidence = high
```

伪代码：

```js
function isHighConfidence(parameter, eventContext) {
  return (
    hasExpression(parameter) &&
    hasSourcePath(parameter) &&
    parameter.scopeReachable === true &&
    hasStrongEvidence(parameter.evidence) &&
    !hasParameterUnresolved(parameter, eventContext) &&
    parameter.conflicts.length === 0
  )
}
```

---

# 29. Low 判定规则

按以下固定优先级执行。

## Low Rule 1

```text
expression 为空
```

结果：

```text
low
```

---

## Low Rule 2

```text
scopeReachable === false
```

结果：

```text
low
```

---

## Low Rule 3

```text
没有任何有效 evidence
```

结果：

```text
low
```

注意：

```text
只适用于 Structured Parameter
```

Legacy Parameter 不进入新算法。

---

## Low Rule 4

```text
conflicts.length > 0
AND
没有 manual-confirm
```

结果：

```text
low
```

---

# 30. Medium 判定规则

Structured Parameter：

```text
不满足 Hard Low
AND
不满足 High
```

统一：

```text
medium
```

典型情况：

### Case A

```text
expression 有
sourcePath 有
scopeReachable=true
但只有 Supporting Evidence
```

例如：

```text
field-memory
```

结果：

```text
medium
```

---

### Case B

```text
expression 有
Strong Evidence 有
scopeReachable=true
sourcePath 为空
```

结果：

```text
medium
```

---

### Case C

```text
expression 有
sourcePath 有
Strong Evidence 有
scopeReachable=null
```

结果：

```text
medium
```

---

### Case D

```text
存在 parameter unresolved
```

但没有其它 Hard Low 条件：

```text
medium
```

---

### Case E

```text
conflicts > 0
+
manual-confirm
```

结果：

```text
medium
```

---

# 31. 固定计算顺序

必须严格：

```text
1. Legacy 判断
2. Structured Hard Low
3. Structured High
4. Structured Medium fallback
```

伪代码：

```js
function resolveParameterConfidence(
  rawParameter,
  normalizedParameter,
  eventContext
) {
  if (isLegacyParameter(rawParameter)) {
    return normalizedParameter.confidence
  }

  return calculateParameterConfidence(
    normalizedParameter,
    eventContext
  )
}
```

Structured：

```js
function calculateParameterConfidence(parameter, eventContext) {
  if (isHardLow(parameter)) {
    return 'low'
  }

  if (
    hasConflicts(parameter) &&
    !hasManualConfirm(parameter)
  ) {
    return 'low'
  }

  if (
    hasConflicts(parameter) &&
    hasManualConfirm(parameter)
  ) {
    return 'medium'
  }

  if (
    isHighConfidence(parameter, eventContext)
  ) {
    return 'high'
  }

  return 'medium'
}
```

---

# 32. stored confidence 不得影响计算

例如两个 Agent 输出完全相同 Facts：

```json
{
  "expression": "houseInfo.id",
  "sourcePath": "pageData.house -> props.houseInfo -> handleClick",
  "evidence": [
    {
      "type": "same-component-tracking"
    }
  ],
  "scopeReachable": true,
  "conflicts": []
}
```

但是：

```text
Agent A:
confidence=high

Agent B:
confidence=medium

Agent C:
confidence=low
```

Structured Parameter 最终结果必须全部：

```text
high
```

即：

```text
stored confidence
必须被忽略 / 覆盖
```

---

# 33. Field Memory

`field-memory` 是：

```text
Supporting Evidence
```

它永远不能单独产生：

```text
high
```

例如：

```json
{
  "expression": "houseInfo.id",
  "sourcePath": "field-memory",
  "evidence": [
    {
      "type": "field-memory"
    }
  ],
  "scopeReachable": true,
  "conflicts": []
}
```

结果：

```text
medium
```

需要当前源码重新验证。

---

# 34. Repository Convention

```text
repository-convention
```

同样只能：

```text
Supporting
```

例如：

```text
这个仓库通常 house_id 都用 houseInfo.id
```

只能证明：

```text
这是一个候选
```

不能证明：

```text
当前页面就是这个业务对象
```

因此单独存在时：

```text
medium
```

---

# 35. same-module-tracking

第一版：

```text
same-module-tracking
=
Supporting Evidence
```

因为同模块仍可能：

```text
不同页面
不同业务对象
不同组件语义
```

不能单独 High。

---

# 36. same-page-tracking

定义为：

```text
Strong Evidence
```

但必须同时满足：

```text
sourcePath
scopeReachable
无 unresolved
无 conflicts
```

才能 High。

---

# 37. same-component-tracking

属于最强的代码实现证据之一。

但仍不能：

```text
same-component-tracking
→ 直接 high
```

必须满足：

```text
同语义事实成立
+
sourcePath 存在
+
当前 scope 可访问
+
无 unresolved
+
无 conflicts
```

---

# 38. validate-impl 职责

不要在：

```text
validate-impl
```

重新实现一套 confidence 算法。

推荐：

```text
raw impl
↓
legacy detection
↓
normalize
↓
calculate confidence
↓
写入 derived confidence
↓
validate-impl
```

`validate-impl` 负责检查：

```text
结构是否合法
结果是否满足 Gate
```

而不是：

```text
再次自行判断 high / medium / low
```

---

# 39. 推荐实现模块

在真实仓库结构允许的前提下，增加单一实现：

```text
calculateParameterConfidence
```

例如：

```text
scripts/impl/calculate-confidence.js
```

但：

> Codex / Cursor 必须先读取真实目录，不得仅因为本文档出现这个文件名就新建重复模块。

---

# 40. 推荐导出能力

可以集中提供：

```js
isLegacyParameter(rawParameter)

calculateParameterConfidence(
  parameter,
  eventContext
)

hasStrongEvidence(parameter)

hasManualConfirm(parameter)

hasParameterUnresolved(
  parameter,
  eventContext
)
```

但不要求为了拆函数而过度工程化。

核心要求是：

```text
confidence 规则只有一个事实来源
```

---

# 41. needsConfirm

P1-2 不重新设计 needsConfirm。

沿用当前已有规则：

```text
confidence = high
→ 参数本身不触发 needsConfirm

confidence = medium
→ needsConfirm

confidence = low
→ needsConfirm
```

事件级 Gate 继续使用现有实现。

不在 P1-2 修改：

```text
required / optional
```

参数语义。

---

# 42. 测试要求

至少覆盖以下测试。

---

## Case 1：完整事实 → high

```json
{
  "expression": "houseInfo.id",
  "sourcePath": "api.house.id -> props.houseInfo -> handleClick",
  "evidence": [
    {
      "type": "same-component-tracking"
    }
  ],
  "scopeReachable": true,
  "conflicts": []
}
```

没有对应 unresolved。

结果：

```text
high
```

---

## Case 2：stored confidence 不参与计算

完全相同 Facts，分别输入：

```text
confidence=high
confidence=medium
confidence=low
confidence missing
```

最终全部：

```text
相同
```

---

## Case 3：无 evidence

Structured Parameter：

```text
expression 有
sourcePath 有
scopeReachable=true
evidence=[]
```

结果：

```text
low
```

即使 Agent 写：

```text
confidence=high
```

也不能 high。

---

## Case 4：scopeReachable=false

其它条件完整。

结果：

```text
low
```

---

## Case 5：scopeReachable=null

其它条件完整。

结果：

```text
medium
```

不得 high。

---

## Case 6：field-memory only

结果：

```text
medium
```

---

## Case 7：repository-convention only

结果：

```text
medium
```

---

## Case 8：conflicts，无 manual-confirm

结果：

```text
low
```

---

## Case 9：conflicts + manual-confirm

结果：

```text
medium
```

不得 high。

---

## Case 10：manual-confirm + scopeReachable=true

且：

```text
expression
sourcePath
无 unresolved
无 conflicts
```

结果：

```text
high
```

---

## Case 11：manual-confirm + scopeReachable=false

结果：

```text
low
```

---

## Case 12：event unresolved 命中当前参数

Parameter：

```text
house_id
```

Event：

```text
请确认参数 house_id 的取值
```

其它 High 条件满足。

结果：

```text
medium
```

不得 high。

---

## Case 13：event unresolved 属于其它参数

当前参数：

```text
house_id
```

Event：

```text
请确认参数 city_id 的取值
```

当前 house_id 的其它 High 条件全部满足。

不得因为：

```text
event.unresolved 非空
```

直接阻断 house_id High。

必须进行：

```text
parameter-specific unresolved matching
```

---

## Case 14：Legacy parameter

原始 JSON：

```json
{
  "key": "house_id",
  "expression": "houseInfo.id",
  "confidence": "high"
}
```

完全没有：

```text
evidence
scopeReachable
conflicts
```

结果：

```text
legacy=true
confidence 保持 high
```

---

## Case 15：显式新结构空字段

原始 JSON：

```json
{
  "key": "house_id",
  "expression": "houseInfo.id",
  "evidence": [],
  "scopeReachable": null,
  "conflicts": [],
  "confidence": "high"
}
```

结果：

```text
legacy=false
```

必须：

```text
重新 calculate
```

不得因为 normalize 后与 Legacy 相似而保留 high。

---

## Case 16：Legacy normalize 后仍保持 Legacy

验证：

```text
Legacy Detection
必须发生在 normalize 前
```

不能：

```text
normalize
↓
再猜 legacy
```

---

# 43. Cross-Agent Determinism Test

必须专门增加：

```text
Given
完全相同 Parameter Facts

When
Agent 提供不同 stored confidence

Then
Structured Parameter 最终 confidence 完全相同
```

这是 P1-2 的核心验收测试。

---

# 44. Legacy Determinism Test

还必须增加：

```text
Given
相同 normalize 后 Parameter

But
一个 raw parameter 是 legacy
另一个 raw parameter 显式包含新结构字段

Then
前者保留历史 confidence
后者进入新算法
```

用于证明：

```text
Legacy Recognition
确实基于 raw facts
```

---

# 45. unresolved Determinism Test

必须证明：

```text
event.unresolved
```

不会粗暴阻断整个事件所有参数。

应该：

```text
event unresolved
↓
定位具体 parameter key
↓
只影响对应 parameter confidence
```

---

# 46. 测试统一入口

当前仓库已有：

```text
npm test
→ node --test scripts
```

P1-2 新增测试必须能够通过：

```text
npm test
```

被稳定执行。

不能只新增：

```text
confidence.test.js
```

但不进入统一测试入口。

---

# 47. 不允许的实现

## 禁止 1：Agent Confidence 参与新算法

不得：

```js
if (parameter.confidence === 'high') {
  ...
}
```

影响 Structured Parameter 最终判定。

---

## 禁止 2：Evidence 数量打分

不得：

```text
3 个 evidence = high
2 个 evidence = medium
```

Evidence 类型和事实闭环比数量重要。

---

## 禁止 3：概率评分

不得新增：

```text
0.9
0.7
0.4
confidenceScore
```

P1-2 只使用：

```text
明确条件
↓
high / medium / low
```

---

## 禁止 4：自动修改 expression

Confidence 计算只消费 Facts。

不得：

```text
confidence 低
↓
自动寻找另一个 expression
```

---

## 禁止 5：新增参数发现能力

以下属于 P1-4：

```text
自动扫描同组件埋点
自动找同页面参数
自动追 JSX
```

P1-2 不做。

---

## 禁止 6：新增 Parameter unresolved Schema

本阶段不修改 Parameter Schema 增加：

```text
unresolved
```

只做 eventContext 兼容读取。

---

## 禁止 7：重构 sourcePath

继续使用当前：

```text
string
```

---

## 禁止 8：修改 accept-chain

不得修改：

```text
dataDeps
Runtime Resolver
accept path
trigger
sharedSteps
```

---

## 禁止 9：修改 Runtime

P1-2 与 Runtime Actual 无关。

---

## 禁止 10：新增平行事实层

不得新增：

```text
parameter-confidence.json
parameter-resolution.json
confidence-facts.json
```

所有结果继续进入：

```text
impl.json
```

---

# 48. Codex / Cursor 执行顺序

执行前必须读取真实：

```text
impl schema
normalize-impl
validate-impl
needsConfirm 当前实现
P1-1 tests
package.json
```

确认真实代码后执行：

```text
1. 找 raw parameter → normalize 的入口

2. 在 normalize 前识别 Legacy

3. 找 confidence 当前写入/保留位置

4. 实现唯一 calculateParameterConfidence

5. 实现 parameter unresolved context 读取

6. 固定 conflicts low / medium 规则

7. 保证 stored confidence 不参与 Structured Parameter 计算

8. Legacy 保留历史 confidence

9. Structured Parameter 重算 confidence

10. 接入现有 needsConfirm

11. 增加测试

12. npm test
```

---

# 49. 输出要求

完成后必须输出：

```text
Modified Files
Confidence Rules
Legacy Strategy
Unresolved Strategy
Tests
Not Changed
```

---

# 50. Not Changed 必须明确

至少明确：

```text
Parameter Discovery 未修改

Parameter Schema 未新增 unresolved

sourcePath Schema 未修改

required / optional 规则未修改

accept-chain dataDeps 未修改

Runtime Resolver 未修改

Runtime Acceptance 未修改
```

---

# 51. Closure Criteria

只有以下全部满足才算 P1-2 Closure：

```text
[ ] Structured Parameter confidence 不再由 Agent 最终决定

[ ] calculateParameterConfidence 只有一个正式实现

[ ] stored confidence 不参与 Structured Parameter 计算

[ ] 相同 Facts 得到相同 confidence

[ ] High 规则明确

[ ] Medium 规则明确

[ ] Low 规则明确

[ ] scopeReachable=false → low

[ ] scopeReachable=null → 不得 high

[ ] 无有效 evidence → Structured Parameter low

[ ] conflicts + 无 manual-confirm → low

[ ] conflicts + manual-confirm → medium

[ ] conflicts 非空永远不能 high

[ ] manual-confirm 不能绕过 scopeReachable

[ ] field-memory 单独不能 high

[ ] repository-convention 单独不能 high

[ ] event unresolved 能精确影响对应 parameter

[ ] event unresolved 不会粗暴阻断所有 parameter

[ ] Legacy 在 normalize 前识别

[ ] 原始三个新字段均不存在 → Legacy

[ ] 任一新字段原始出现 → Structured

[ ] Legacy 保留原 confidence

[ ] Structured Parameter 必须重算 confidence

[ ] 不新增 impl version

[ ] 不新增 parameter unresolved schema

[ ] 不修改 sourcePath schema

[ ] medium / low 继续触发现有 needsConfirm Gate

[ ] Cross-Agent Determinism Test 完成

[ ] Legacy Recognition Test 完成

[ ] unresolved 参数匹配 Test 完成

[ ] npm test 能稳定执行新增测试

[ ] 不修改 Parameter Discovery

[ ] 不修改 Runtime Resolver

[ ] 不修改 accept-chain dataDeps

[ ] 不新增平行事实层
```

---

# 52. P1-2 完成后的系统状态

完成后：

```text
Agent
↓
expression
sourcePath
evidence
scopeReachable
conflicts
unresolved context

↓
Deterministic Program

Legacy?
├─ Yes
│   ↓
│ 保留历史 confidence
│
└─ No
    ↓
calculateParameterConfidence
    ↓
high / medium / low

↓
现有 needsConfirm Gate
```

---

# 53. 与后续阶段的关系

P1-2 只解决：

```text
已有 Parameter Facts
如何得到确定 confidence
```

它不解决：

```text
这些 Facts 怎么更稳定地找到
```

下一阶段：

```text
P1-3 Parameter Validation Gate
```

解决：

```text
Parameter Facts / Confidence
出现哪些异常时
必须 ERROR / WARNING / needsConfirm
```

再之后：

```text
P1-4 Parameter Evidence Discovery
```

才解决：

```text
同组件
同页面
已有埋点
JSX
API
props
state
hook
```

等证据如何通过静态程序更稳定发现。

---

# 54. 最终原则

P1-2 不保证：

```text
Claude
Codex
Cursor
```

一定找到相同：

```text
expression
sourcePath
evidence
```

这是更上游的 Parameter Resolution / Evidence Discovery 问题。

P1-2 保证：

> 当它们最终提交相同 Parameter Facts 时，系统必须得到相同的 confidence 和相同的 Gate 结果。

即：

```text
Parameter Facts
↓
Deterministic Confidence
↓
Deterministic Gate
```

而对于旧数据：

```text
Legacy Facts
↓
Backward Compatible
```

对于新数据：

```text
Structured Facts
↓
No Agent Confidence
```

这就是 P1-2 Confidence Determinism 的 Closure Definition。
