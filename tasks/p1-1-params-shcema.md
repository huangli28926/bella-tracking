# P1-1 Closure：Parameter Schema

## 1. 任务定位

本任务是：

> **Parameter Resolution Contract 的第一阶段落地。**

只解决：

```text
参数事实应该如何结构化保存
```

不解决：

```text
confidence 如何计算
参数如何自动发现
Runtime 如何解析
```

---

# 2. 当前正式主链路

本任务不得改变当前正式主链路：

```text
events.json
↓
adaptor.json
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
↓
Runtime Acceptance
```

本任务只增强：

```text
impl.json.parameters[]
```

---

# 3. 本任务目标

当前 parameter 通常包含：

```json
{
  "key": "house_id",
  "expression": "houseInfo.id",
  "sourcePath": [],
  "confidence": "high",
  "unresolved": []
}
```

存在的问题：

```text
expression 为什么成立？
当前埋点位置真的能访问吗？
有没有冲突事实？
```

无法从结构化字段中回答。

因此新增：

```text
evidence
scopeReachable
conflicts
```

最终参数事实应能够回答：

```text
这个参数取什么？
↓
expression

这个值从哪里来？
↓
sourcePath

为什么认为它成立？
↓
evidence

当前埋点位置是否能拿到？
↓
scopeReachable

有没有相互冲突的事实？
↓
conflicts
```

---

# 4. Parameter Schema

目标结构：

```json
{
  "key": "house_id",

  "expression": "houseInfo.id",

  "sourcePath": [
    "api.response.data.house.id",
    "pageData.house",
    "DealCard.props.houseInfo",
    "handleClick"
  ],

  "evidence": [
    {
      "type": "same-component-tracking",
      "file": "src/components/DealCard/index.tsx"
    },
    {
      "type": "prop-chain",
      "from": "pageData.house",
      "to": "DealCard.props.houseInfo"
    }
  ],

  "scopeReachable": true,

  "confidence": "high",

  "unresolved": [],

  "conflicts": []
}
```

---

# 5. evidence

## 5.1 定义

`evidence` 表示：

> 支撑当前 parameter expression 的真实代码事实。

它不是 Agent 分析过程，也不是自然语言推理记录。

---

## 5.2 evidence 必须是数组

```json
{
  "evidence": []
}
```

不得使用：

```json
{
  "evidence": "same component"
}
```

---

## 5.3 evidence.type 必须使用闭集

第一版允许：

```text
same-component-tracking
same-page-tracking
same-module-tracking

jsx-binding

api-field

prop-chain
state-chain
hook-chain
context-chain

url-field
user-context

field-memory
repository-convention

manual-confirm
```

Schema 中必须使用：

```text
enum
```

禁止 Agent 自由创建新的 `type`。

例如禁止：

```json
{
  "type": "looks-similar"
}
```

---

# 6. Evidence 数据结构

第一版不要求所有 Evidence 类型拥有完全不同 Schema。

统一允许以下字段：

```json
{
  "type": "prop-chain",
  "file": "src/components/DealCard/index.tsx",
  "from": "pageData.house",
  "to": "props.houseInfo",
  "expression": "houseInfo.id",
  "source": "source-code"
}
```

推荐通用字段：

```text
type
file
from
to
expression
source
```

除：

```text
type
```

之外，其余字段可以为空或缺失。

---

# 7. scopeReachable

## 7.1 定义

`scopeReachable` 表示：

> 当前 parameter expression 在最终埋点插入位置是否真实可访问。

Schema：

```json
{
  "scopeReachable": true
}
```

允许：

```text
true
false
null
```

含义：

```text
true
=
已经证明当前埋点作用域可访问

false
=
已经证明当前埋点作用域不可访问

null
=
尚未完成判断
```

---

# 8. 为什么不能只用 boolean

禁止设计成：

```text
true / false
```

两态。

因为：

```text
false
```

和：

```text
尚未分析
```

是不同事实。

因此必须允许：

```text
null
```

。

---

# 9. conflicts

## 9.1 定义

`conflicts` 用于记录：

> 当前 parameter 分析过程中存在的事实冲突。

例如：

```text
需求图显示 house.price
但已有埋点使用 listing.totalPrice
```

或者：

```text
API hint 指向 house_id
但当前 JSX 使用 property_id
```

---

## 9.2 Schema

第一版使用字符串数组即可：

```json
{
  "conflicts": []
}
```

例如：

```json
{
  "conflicts": [
    "same-page tracking uses property.id but API hint points to house.id"
  ]
}
```

暂不在 P1-1 中设计复杂 conflict object。

---

# 10. unresolved 保持现有规则

现有：

```text
unresolved
```

继续保留。

必须明确区分：

```text
unresolved
=
缺失信息 / 尚未确认

conflicts
=
已经找到两个或多个相互冲突的事实
```

例如：

```json
{
  "unresolved": [
    "请确认参数 house_id 的取值"
  ],
  "conflicts": []
}
```

和：

```json
{
  "unresolved": [],
  "conflicts": [
    "same component tracking and API hint use different source fields"
  ]
}
```

语义不同。

---

# 11. confidence 暂时保留

P1-1 不修改现有：

```text
confidence
```

字段。

即仍允许：

```text
high
medium
low
```

本任务不得实现：

```text
calculateConfidence()
```

也不得改变现有 confidence 行为。

这将在：

```text
P1-2 Confidence Determinism
```

中处理。

---

# 12. Backward Compatibility

已有 impl.json 可能没有：

```text
evidence
scopeReachable
conflicts
```

P1-1 不得导致历史文件全部无法读取。

因此推荐默认值：

```json
{
  "evidence": [],
  "scopeReachable": null,
  "conflicts": []
}
```

旧数据：

```json
{
  "key": "house_id",
  "expression": "houseInfo.id",
  "confidence": "high",
  "unresolved": []
}
```

读取后等价于：

```json
{
  "key": "house_id",
  "expression": "houseInfo.id",
  "sourcePath": [],
  "evidence": [],
  "scopeReachable": null,
  "confidence": "high",
  "unresolved": [],
  "conflicts": []
}
```

---

# 13. 不允许的实现

## 禁止 1：自动把 scopeReachable 设成 true

不得因为：

```text
expression 非空
```

就自动：

```text
scopeReachable=true
```

这是错误的。

---

## 禁止 2：自动生成 evidence

不得根据：

```text
expression
```

字符串猜 Evidence。

例如不得：

```text
houseInfo.id
↓
自动生成 prop-chain
```

Evidence 必须来自真实分析事实。

---

## 禁止 3：P1-1 中改变 confidence

本任务不得实现：

```text
evidence → confidence
```

映射。

---

## 禁止 4：新增新的事实文件

不得新增：

```text
parameter-resolution.json
parameter-evidence.json
runtime-parameter.json
```

所有事实继续进入：

```text
impl.json
```

---

## 禁止 5：修改 accept-chain 参数逻辑

不得修改：

```text
inferDataDep
resolveDataDeps
Runtime Resolver
```

P1-1 只处理 impl parameter schema。

---

# 14. Schema 修改要求

需要检查仓库当前实际的：

```text
impl schema
parameter schema
```

并在真实结构基础上修改。

如果项目当前：

```text
parameters
```

不是数组，或者字段命名不同：

> 以真实代码为准，不得为了符合本文档强行重构整个 impl.json。

必须保持现有结构兼容，只增加对应能力。

---

# 15. Normalize

如果仓库存在 impl normalize / migration / load 层，则增加：

```text
evidence: []
scopeReachable: null
conflicts: []
```

默认值。

如果当前没有统一 normalize 层：

> 不得为 P1-1 单独设计大型 migration framework。

只做最小必要兼容。

---

# 16. UI / 落库页面

如果当前落库 HTML 页面直接读取 parameter 字段：

P1-1 不要求新增复杂 Evidence 编辑器。

最低要求：

```text
已有页面不能因为新增字段报错
```

如果成本较低，可以只读展示：

```text
Evidence
Scope Reachable
Conflicts
```

但不是本阶段 Closure 必需项。

---

# 17. 测试要求

至少增加以下测试。

## Case 1：完整新结构合法

输入：

```json
{
  "key": "house_id",
  "expression": "houseInfo.id",
  "sourcePath": [
    "pageData.house",
    "props.houseInfo"
  ],
  "evidence": [
    {
      "type": "prop-chain",
      "from": "pageData.house",
      "to": "props.houseInfo"
    }
  ],
  "scopeReachable": true,
  "confidence": "high",
  "unresolved": [],
  "conflicts": []
}
```

应：

```text
PASS
```

---

## Case 2：旧结构兼容

输入：

```json
{
  "key": "house_id",
  "expression": "houseInfo.id",
  "sourcePath": [],
  "confidence": "high",
  "unresolved": []
}
```

P1-1 阶段不得仅因为缺：

```text
evidence
scopeReachable
conflicts
```

直接失败。

---

## Case 3：未知 evidence type

输入：

```json
{
  "evidence": [
    {
      "type": "agent-guess"
    }
  ]
}
```

应：

```text
FAIL
```

---

## Case 4：scopeReachable 类型错误

输入：

```json
{
  "scopeReachable": "yes"
}
```

应：

```text
FAIL
```

---

## Case 5：conflicts 类型错误

输入：

```json
{
  "conflicts": "API conflict"
}
```

应：

```text
FAIL
```

---

# 18. Codex 执行要求

Codex 必须先读取真实仓库：

```text
feat/0907
```

并定位：

```text
impl schema
impl normalize/load
validate-impl
相关 tests
```

再执行修改。

禁止根据本文档猜文件名直接创建重复实现。

---

# 19. Codex 修改原则

执行顺序：

```text
1. 找当前 impl parameter schema

2. 找 parameter 的 load / normalize 逻辑

3. 找 validate-impl 对 parameter 的现有校验

4. 找现有 tests

5. 最小化增加：
   evidence
   scopeReachable
   conflicts

6. 补 backward compatibility

7. 补 tests

8. 跑相关测试
```

---

# 20. 输出要求

Codex 完成后必须给出：

```text
Modified Files
Tests
Behavior Changes
Backward Compatibility
Not Changed
```

其中：

## Modified Files

列出真实修改文件。

## Tests

列出：

```text
执行的 test command
通过 / 失败
```

## Behavior Changes

只描述 P1-1 新增能力。

## Backward Compatibility

明确说明：

```text
旧 impl 是否仍可读取
```

## Not Changed

必须明确写：

```text
confidence calculation 未修改
parameter discovery 未修改
accept-chain dataDeps 未修改
Runtime Resolver 未修改
```

---

# 21. Closure Criteria

只有以下全部满足才算 P1-1 完成：

```text
[ ] impl parameter 支持 evidence

[ ] evidence.type 使用闭集 enum

[ ] impl parameter 支持 scopeReachable

[ ] scopeReachable 支持 true / false / null

[ ] impl parameter 支持 conflicts

[ ] conflicts 为数组

[ ] 历史 impl 参数结构保持兼容

[ ] 未自动推断 evidence

[ ] 未自动设置 scopeReachable=true

[ ] 未修改 confidence 计算规则

[ ] 未修改 parameter discovery

[ ] 未修改 accept-chain dataDeps

[ ] 未新增平行参数事实层

[ ] 测试覆盖新旧参数结构

[ ] 所有相关测试通过
```

---

# 22. 本阶段完成后的状态

P1-1 完成以后，只代表：

```text
Parameter Facts
已经可以结构化表达完整证据
```

还不代表：

```text
不同 Agent 已经能稳定得到相同 confidence
```

下一阶段：

```text
P1-2 Confidence Determinism
```

负责将：

```text
expression
sourcePath
evidence
scopeReachable
unresolved
conflicts
```

转换成确定性的：

```text
confidence
needsConfirm
```

---

# 23. 最终边界

P1-1 只回答：

> 参数事实应该保存哪些信息？

不回答：

> 这些信息是否足够可信？

后一个问题必须留给：

```text
P1-2 Confidence Determinism
```

避免一次改动同时混入：

```text
Schema
+
AI Prompt
+
Confidence Algorithm
+
Runtime
```

导致边界再次失控。
