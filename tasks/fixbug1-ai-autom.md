# AI 推断优先 + 人工审核不确定结果 技术方案

## 1. 目标

将当前流程从：

```text
AI 无法完全确认
→ needsConfirm = true
→ 用户重新填写 targetFile / functionName / expression / locator ...
```

调整为：

```text
AI 尽可能完成分析
→ 输出「AI 推断结果 + 证据 + confidence + unresolved」
→ 用户审核 AI 推断结果
├─ 正确 → 一键确认
├─ 部分错误 → 只修改错误字段
└─ AI 无法形成候选 → 用户补充
→ 形成 confirmed fact
→ 后续流程继续
```

核心原则：

> AI 负责尽可能完成推断，人工负责审核不确定结果，而不是让人工重新完成 AI 本应完成的分析。

本方案不改变当前正式主链路：

```text
events.json
→ adaptor.json
→ impl.json
→ validate-impl
→ needsConfirm Gate
→ 代码实现
→ accept-chain.json
→ Runtime Acceptance
```

只调整 `impl.json` 的不确定性表达方式和 `needsConfirm Gate` 的交互方式。

---

# 2. 当前问题

当前 `needsConfirm = true` 更接近：

```text
AI 不能确定
=
AI 不填写
=
人工填写
```

这会导致两个问题。

### 2.1 AI 已经具备候选判断能力，但结果被丢弃

例如 AI 已经能够判断：

```text
targetFile 很可能是 A.tsx
functionName 很可能是 handleClick
参数 houseCode 很可能来自 props.houseCode
```

只是证据不足以自动落码。

当前如果直接留下空值：

```json
{
  "targetFile": null,
  "functionName": null,
  "needsConfirm": true
}
```

用户实际上需要重新完成一次代码分析。

这降低了自动化价值。

---

### 2.2 `needsConfirm` 混淆了两个概念

当前实际上存在两类情况：

```text
A. AI 有明确候选，但证据不足
B. AI 根本无法形成可靠候选
```

这两种情况不应该使用相同交互。

应该分别处理为：

```text
A → AI 预填 + 人工确认
B → 人工补充
```

---

# 3. 新的核心模型

将事实分为三种状态：

```text
confirmed
inferred
unresolved
```

## confirmed

已有充分证据，可以直接作为事实消费。

例如：

```json
{
  "value": "src/pages/detail/index.tsx",
  "status": "confirmed",
  "confidence": 1
}
```

---

## inferred

AI 已形成最佳候选，但证据不足以自动执行。

例如：

```json
{
  "value": "src/components/PriceCard/index.tsx",
  "status": "inferred",
  "confidence": 0.76,
  "evidence": [
    "该组件包含需求中的按钮文案",
    "页面直接引用该组件",
    "相邻埋点位于同一组件"
  ],
  "unresolved": [
    "该组件存在两个调用页面，尚不能完全确认应修改公共组件还是调用方"
  ]
}
```

此时用户只需要：

```text
确认
/
修改候选
```

而不是重新输入。

---

## unresolved

无法形成具有实际参考价值的候选。

例如：

```json
{
  "value": null,
  "status": "unresolved",
  "confidence": 0,
  "unresolved": [
    "源码中没有找到与需求对应的页面或组件证据"
  ]
}
```

只有这种情况才要求人工提供信息。

---

# 4. impl.json Contract 调整

不要新建新的事实文件。

仍然以：

```text
impl.json
```

作为实现事实层。

建议将需要人工确认的关键事实统一增加 `resolution` 信息。

例如：

```json
{
  "targetFile": "src/components/PriceCard/index.tsx",
  "functionName": "handleDetailClick",

  "resolution": {
    "targetFile": {
      "status": "inferred",
      "confidence": 0.82,
      "evidence": [
        {
          "type": "component-reference",
          "detail": "DetailPage imports PriceCard"
        },
        {
          "type": "ui-text",
          "detail": "PriceCard contains 查看详情"
        }
      ],
      "unresolved": [
        "PriceCard is reused by another page"
      ]
    },

    "functionName": {
      "status": "inferred",
      "confidence": 0.91,
      "evidence": [
        {
          "type": "jsx-binding",
          "detail": "target button onClick points to handleDetailClick"
        }
      ],
      "unresolved": []
    }
  },

  "needsConfirm": true
}
```

注意：

```text
needsConfirm = true
```

不再意味着：

```text
字段为空
```

而意味着：

```text
至少存在一个 inferred / unresolved 事实，需要人工审核
```

---

# 5. Parameter Resolution 同样采用该模型

参数不能因为 confidence 不够高就直接要求人工填写。

例如原来：

```json
{
  "name": "houseCode",
  "expression": null,
  "confidence": 0.6,
  "needsConfirm": true
}
```

调整为：

```json
{
  "name": "houseCode",
  "expression": "props.houseCode",
  "sourcePath": [
    "DetailPage.apiData.houseCode",
    "PriceCard.props.houseCode",
    "handleClick",
    "$ULOG.send.action.houseCode"
  ],
  "confidence": 0.72,
  "status": "inferred",
  "evidence": [
    {
      "type": "props-flow",
      "detail": "DetailPage passes apiData.houseCode to PriceCard.houseCode"
    }
  ],
  "unresolved": [
    "未找到同字段历史埋点用于验证业务语义"
  ]
}
```

用户看到的是：

```text
AI 推测：
houseCode = props.houseCode

来源：
API apiData.houseCode
→ PriceCard props
→ handleClick
→ 埋点 action.houseCode

可信度：72%

[确认] [修改]
```

而不是：

```text
请输入 houseCode 的代码表达式
```

---

# 6. needsConfirm Gate 新语义

建议明确区分：

```text
autoReady
reviewRequired
manualRequired
```

可以不增加新的顶层字段，也可以由程序计算。

推荐计算规则：

```text
所有关键字段 status = confirmed
→ autoReady

至少一个 status = inferred
且没有 unresolved value=null
→ reviewRequired

至少一个关键字段 status = unresolved
且 value = null
→ manualRequired
```

例如：

```js
function resolveGate(impl) {
  const facts = collectResolutionFacts(impl)

  if (facts.some(
    fact =>
      fact.status === 'unresolved' &&
      (fact.value === null || fact.value === undefined)
  )) {
    return 'manualRequired'
  }

  if (facts.some(fact => fact.status === 'inferred')) {
    return 'reviewRequired'
  }

  return 'autoReady'
}
```

---

# 7. 人工确认交互

确认页面的核心不应该是：

```text
表单填写页
```

而应该是：

```text
AI 分析结果 Review 页
```

每个字段展示：

```text
字段
AI 推测值
confidence
主要证据
未解决问题
操作
```

例如：

| 字段           | AI 推测                 | Confidence | 状态  | 操作      |
| ------------ | --------------------- | ---------: | --- | ------- |
| targetFile   | `PriceCard/index.tsx` |        82% | 待确认 | 确认 / 修改 |
| functionName | `handleDetailClick`   |        91% | 待确认 | 确认 / 修改 |
| houseCode    | `props.houseCode`     |        72% | 待确认 | 确认 / 修改 |
| trigger      | `click`               |        98% | 已确认 | 查看      |
| locator      | 无候选                   |         0% | 需补充 | 输入      |

人工只处理：

```text
AI 判断不确定的部分
```

而不是重新填写整条 impl。

---

# 8. 确认后的事实升级

用户点击：

```text
确认
```

之后：

```text
inferred
→ confirmed
```

但必须记录确认来源。

例如：

```json
{
  "value": "props.houseCode",
  "status": "confirmed",
  "confidence": 1,
  "confirmedBy": "human",
  "confirmedAt": "2026-09-09T11:30:00+08:00",
  "origin": "ai-inference"
}
```

如果用户修改 AI 推测：

```json
{
  "value": "detailData.houseCode",
  "status": "confirmed",
  "confidence": 1,
  "confirmedBy": "human",
  "origin": "human-correction",
  "previousInference": "props.houseCode"
}
```

这样可以区分：

```text
AI 推测正确并被确认
```

和：

```text
AI 推测错误并被人工修正
```

这对后续分析 AI 准确率很重要。

---

# 9. AI 推断策略

AI 的职责必须从：

```text
不能确认 → 留空
```

改成：

```text
尽量形成最佳候选
```

但禁止无证据猜测。

处理逻辑：

```text
收集候选
↓
证据排序
↓
形成最佳候选
↓
计算 confidence
↓
判断是否存在实际证据
```

结果：

```text
证据充分
→ confirmed

有合理最佳候选，但仍存在歧义
→ inferred

没有足够证据形成有效候选
→ unresolved
```

关键区别：

```text
低 confidence ≠ 必须 value=null
```

应该是：

```text
有真实证据链
+
存在最佳候选
=
允许填写 inferred value
```

---

# 10. 不允许 AI 推测的情况

为了防止变成“AI 随便填”，以下情况仍然必须：

```text
value = null
status = unresolved
```

包括：

```text
源码中不存在候选
```

```text
多个候选证据完全接近，无法形成最佳候选
```

```text
expression 没有真实变量链支持
```

```text
sourcePath 无法从源码追通
```

```text
locator 没有 DOM / JSX / Runtime Evidence
```

例如禁止：

```json
{
  "expression": "data.houseCode",
  "status": "inferred"
}
```

如果源码中根本不存在：

```text
data.houseCode
```

AI 不能为了给用户一个候选而构造变量。

---

# 11. Confidence 与执行权限分离

需要避免：

```text
confidence 高
=
自动执行
```

推荐改为：

```text
confidence
=
证据强弱

status
=
事实状态

gate
=
是否允许继续执行
```

例如：

```json
{
  "value": "handleClick",
  "confidence": 0.95,
  "status": "inferred"
}
```

仍然可能需要人工确认。

因为：

```text
95%
```

只是模型对当前证据的确定程度，不等于系统已经获得“确认事实”。

因此最终执行应该主要依赖：

```text
status
```

而不是 confidence 数值。

---

# 12. validate-impl 调整

`validate-impl` 不应该继续使用：

```text
字段为空 → needsConfirm
```

作为主要判断。

改为校验：

```text
1. resolution status 是否合法
2. inferred 是否存在 value
3. inferred 是否存在 evidence
4. unresolved 是否存在 unresolved reason
5. confirmed 字段是否满足完整 Contract
6. 所有代码执行需要的字段是否已经 confirmed
```

伪代码：

```js
if (fact.status === 'inferred') {
  assert(fact.value !== null)
  assert(fact.evidence.length > 0)
}

if (fact.status === 'unresolved') {
  assert(fact.unresolved.length > 0)
}

if (phase === 'implementation') {
  assert(allRequiredFactsConfirmed())
}
```

---

# 13. workflow 调整

当前：

```text
AI Build impl
↓
validate-impl
↓
needsConfirm
↓
人工填写
↓
代码实现
```

调整为：

```text
AI Build impl
↓
输出 confirmed / inferred / unresolved
↓
validate-impl
↓
resolve Gate
├─ autoReady
│    ↓
│  代码实现
│
├─ reviewRequired
│    ↓
│  Review AI 推断
│    ↓
│  confirm / correct
│    ↓
│  impl.json 更新为 confirmed
│    ↓
│  validate-impl
│    ↓
│  代码实现
│
└─ manualRequired
     ↓
   用户只补 unresolved 字段
     ↓
   impl.json 更新
     ↓
   validate-impl
     ↓
   代码实现
```

---

# 14. 与当前四层事实链的关系

方案不增加新的事实层。

仍然保持：

```text
events.json
↓
adaptor.json
↓
impl.json
↓
accept-chain.json
```

变化只是：

```text
impl.json
```

从：

```text
确定值 / 空值
```

升级为：

```text
confirmed
inferred
unresolved
```

因此不会建立另一套平行流程。

---

# 15. AI 与确定性程序职责

## AI 负责

```text
候选 targetFile 推理
候选 functionName 推理
组件 / 页面关系语义判断
parameter sourcePath 分析
expression 候选形成
多候选消歧
生成 evidence
生成 unresolved
```

---

## 确定性程序负责

```text
Schema 校验
status 合法性
evidence 是否存在
字段完整性
Gate 计算
confirmed 状态校验
人工确认后的状态更新
实现前阻断
accept-chain 构建前阻断
```

不要通过 Prompt 让每个 Agent 自己决定：

```text
什么时候需要人工确认
什么时候可以自动执行
```

这些必须由统一程序决定。

---

# 16. 建议修改范围

建议至少检查和修改：

```text
schemas/impl.schema.json

scripts/validate-impl.*

workflow 中 build impl 阶段

needsConfirm Gate

人工确认页面 / report 页面

人工确认结果写回逻辑
```

如果当前存在：

```text
confidence threshold → 清空字段
```

或：

```text
needsConfirm → 要求用户重新填写
```

应改掉。

---

# 17. 第一阶段最小改造

不建议一次性重构全部 Schema。

可以先完成 MVP：

### Step 1

AI 即使需要确认，也保留：

```text
targetFile
functionName
expression
sourcePath
trigger
locator
```

的最佳候选。

---

### Step 2

每个候选增加：

```json
{
  "confidence": 0.8,
  "evidence": [],
  "unresolved": []
}
```

---

### Step 3

确认页面默认展示 AI 候选。

用户操作从：

```text
填写
```

改成：

```text
确认 / 修改
```

---

### Step 4

人工确认后写回：

```text
confirmed = true
```

或者正式升级为：

```text
status = confirmed
```

---

### Step 5

只有：

```text
AI 完全无法形成候选
```

时才展示空输入框。

---

# 18. 验收标准

本方案完成后，至少需要通过以下场景。

## Case 1：AI 高可信推断

AI：

```text
targetFile = A.tsx
confidence = 0.96
```

如果规则允许自动确认：

```text
直接进入 implementation
```

如果项目要求人工审核：

```text
展示 A.tsx
用户只需点击确认
```

---

## Case 2：AI 中等可信推断

AI：

```text
targetFile = A.tsx
confidence = 0.72
```

页面必须展示：

```text
AI 推测 A.tsx
证据
未解决问题
```

用户：

```text
确认 / 修改
```

禁止要求重新输入完整路径。

---

## Case 3：AI 推测错误

AI：

```text
expression = props.id
```

用户修改为：

```text
detail.id
```

最终事实：

```text
status = confirmed
origin = human-correction
```

后续 Agent 不再重新推断。

---

## Case 4：AI 完全无法判断

AI：

```text
locator = null
status = unresolved
```

此时才允许：

```text
人工输入 locator
```

---

# 19. 最终原则

整个系统应该遵循：

```text
AI 有证据
→ AI 给候选

AI 有候选但不确定
→ 用户审核

AI 候选错误
→ 用户修正

AI 无法形成候选
→ 用户补充

用户确认后
→ 升级为 confirmed fact

confirmed fact
→ 后续 Agent 直接消费
```

最终交互模式从：

```text
AI 不确定
→ 把问题交给用户
```

变成：

```text
AI 尽最大能力完成分析
→ 把“判断权”交给用户
```

这才符合 bella-tracking 的自动化目标：

```text
减少人工分析
而不是
把 AI 的不确定性转嫁成人工填写
```
