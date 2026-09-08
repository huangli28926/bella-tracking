# P2-1 DataDep Contract Closure

## 0. 状态

```text
方案状态：CLOSED
阶段：P2-1
目标：关闭 DataDep 事实契约的不确定性
后续阶段：DataDep Runtime Resolver（P2-2）
```

实施锁定口径见文末 **# 35. 确认口径与落地记录**。该节覆盖本文初稿中尚未写死的歧义（INVALID vs NEEDS_CONFIRM、是否为 assertParams 补桩、Event Gate 接入范围、unresolved 词表）。**与第 35 节冲突时，以第 35 节为准。**

本任务只解决：

> `impl.json` 中一个已经确认的参数血缘，如何被结构化表达为 Runtime 可消费的 `dataDep`。

本任务**不负责**：

* Playwright 如何读取 URL/API/User/Page 数据
* Runtime Resolver 的具体实现
* Expected / Actual Compare 的完整实现
* 自动推断新的参数来源
* 修改真实业务代码

---

# 1. 当前问题

当前正式链路：

```text
events.json
↓
adaptor.json
↓
代码定位 + Parameter Resolution
↓
impl.json
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

其中 Parameter Resolution 已经逐步收敛为：

```text
parameter
├── expression
├── sourcePath
├── evidence
├── scopeReachable
├── confidence
├── unresolved
└── confirmation
```

但是：

```text
parameter fact
↓
dataDep
```

这一段仍然没有闭环。

当前主要问题有 5 个。

---

## 1.1 `dataDep` Contract 过弱

当前结构大致为：

```json
{
  "paramKey": "housedel_id",
  "from": "url",
  "queryKey": "housedelCode",
  "expression": "housedelCode",
  "sourcePath": "..."
}
```

Schema 基本只强制：

```text
paramKey
from
```

因此下面这种数据目前理论上也可能存在：

```json
{
  "paramKey": "housedel_id",
  "from": "url"
}
```

但 Runtime 根本不知道：

```text
URL 中读取哪个 query？
```

---

## 1.2 当前存在二次猜测

当前 `accept-chain.js` 在：

```text
impl.accept.dataDeps
```

为空时，会继续根据：

```text
sourcePath
expression
hint.api
```

推断：

```text
api
url
user
page
```

甚至无法识别时：

```text
默认 from = page
```

这是 P2-1 必须关闭的核心问题。

正式原则：

```text
Parameter Resolution
已经确定数据来源

↓

DataDep
只能结构化表达该事实

↓

build-accept-chain
只能搬运/规范化

不能重新推断
```

即：

```text
Parameter fact
→ DataDep Contract
```

而不是：

```text
Parameter text
→ build-accept-chain 再猜一次
```

---

# 2. P2-1 核心目标

P2-1 完成后必须满足：

```text
同一份 impl.json
↓
Claude Code / Codex / Cursor
↓
得到完全一致的 DataDep 语义
```

DataDep 必须明确回答：

```text
1. 验证哪个埋点参数？
2. Runtime Expected 从哪里获取？
3. 从该来源中的哪个位置获取？
4. 当前依赖是否已经能够 Runtime resolve？
5. 如果不能，为什么？
```

---

# 3. DataDep 的职责边界

## Parameter 负责

```text
业务参数如何生成
```

例如：

```json
{
  "key": "housedel_id",
  "expression": "housedelCode || '-'",
  "sourcePath": "...",
  "confidence": "high"
}
```

回答：

```text
代码中 housedel_id 是怎么得到的？
```

---

## DataDep 负责

```text
Runtime 中从哪里取得独立事实，
用于验证 action.housedel_id 是否正确。
```

例如：

```json
{
  "paramKey": "housedel_id",
  "from": "url",
  "queryKey": "housedelCode"
}
```

回答：

```text
验收时应该从 URL 的 housedelCode
得到 housedel_id 的来源值。
```

---

## Runtime Resolver 负责

未来阶段：

```text
dataDep
↓
读取真实 Browser Runtime
↓
Runtime Expected Value
```

例如：

```text
location.search
↓
housedelCode=123456
↓
expectedSourceValue = "123456"
```

---

## Compare 负责

```text
Runtime Expected
vs
Tracking Actual
```

例如：

```text
123456
vs
action.housedel_id = 123456
```

---

# 4. DataDep Contract

保持当前 `dataDeps` 所属位置不变：

```text
impl.events[].accept.dataDeps[]
```

以及：

```text
accept-chain.paths[].targets[].dataDeps[]
```

不新增第五个事实文件。

---

# 5. DataDep 基础结构

建议结构：

```json
{
  "paramKey": "housedel_id",
  "from": "url",

  "queryKey": "housedelCode",

  "expression": "housedelCode || '-'",
  "sourcePath": "location.search -> housedelCode",

  "status": "resolved",
  "unresolved": []
}
```

其中：

```text
paramKey
```

表示：

```text
最终埋点 action 中待验证的参数
```

---

# 6. `from` 仍使用当前四类

P2-1 不扩大当前枚举：

```text
api
url
user
page
```

保持兼容：

```json
{
  "from": "url"
}
```

不在本阶段新增：

```text
dom
store
redux
global
hook
localStorage
cookie
...
```

这些属于 Runtime Resolver 的实现细节。

---

# 7. source-specific Contract

不同 `from` 必须满足不同的确定性字段。

---

## 7.1 URL

合法：

```json
{
  "paramKey": "housedel_id",
  "from": "url",
  "queryKey": "housedelCode",
  "status": "resolved",
  "unresolved": []
}
```

必须满足：

```text
paramKey != empty
from = url
queryKey != empty
```

缺少 `queryKey`：

```text
INVALID
```

不能再只是 warning。

禁止：

```json
{
  "paramKey": "housedel_id",
  "from": "url"
}
```

---

# 7.2 API

合法：

```json
{
  "paramKey": "price",
  "from": "api",
  "api": {
    "urlIncludes": "/api/estimate/detail",
    "field": "data.price"
  },
  "status": "resolved",
  "unresolved": []
}
```

必须满足：

```text
api.urlIncludes != empty
AND
api.field != empty
```

原因：

只知道：

```text
/api/estimate/detail
```

Runtime 不知道 response 中取哪个字段。

只知道：

```text
data.price
```

Runtime 又不知道监听哪个接口。

所以：

```text
urlIncludes + field
```

必须同时确定。

缺任意一个：

```text
needsConfirm
```

且不能进入可执行 accept-chain target。

---

# 7.3 User

当前：

```json
{
  "from": "user"
}
```

不足以 Runtime resolve。

增加：

```json
{
  "paramKey": "ucid",
  "from": "user",
  "user": {
    "path": "user.ucid"
  },
  "status": "resolved",
  "unresolved": []
}
```

Contract：

```text
user.path != empty
```

这里的 `path` 表示业务语义路径。

它不规定 Runtime Resolver：

```text
必须从 window.__user
还是 localStorage
还是登录接口
```

具体读取策略属于 Runtime Resolver。

---

# 7.4 Page

`page` 是目前最危险的 fallback。

P2-1 后：

```text
禁止 unknown → page
```

只有存在明确页面事实来源时才能声明：

```json
{
  "paramKey": "community_name",
  "from": "page",
  "page": {
    "path": "community.name"
  },
  "status": "resolved",
  "unresolved": []
}
```

Contract：

```text
page.path != empty
```

这里的：

```text
page.path
```

表示：

> 已确认的页面 Runtime 业务事实路径。

它不是 locator。

P2-1 不要求定义：

```text
DOM 如何读取
React state 如何读取
window 如何读取
接口缓存如何读取
```

这些全部交给后续 Runtime Resolver。

如果无法给出确定 page path：

```json
{
  "paramKey": "community_name",
  "from": "page",
  "status": "needsConfirm",
  "unresolved": [
    "cannot determine runtime page source"
  ]
}
```

---

# 8. status Contract

DataDep 增加：

```json
{
  "status": "resolved"
}
```

enum：

```text
resolved
needsConfirm
```

规则：

## resolved

表示：

```text
Runtime Resolver 已经拥有足够的结构化信息，
理论上可以执行数据读取。
```

---

## needsConfirm

表示：

```text
Parameter 来源可能已经知道，
但仍无法结构化成为 Runtime 可执行依赖。
```

例如：

```json
{
  "paramKey": "price",
  "from": "api",
  "api": {
    "urlIncludes": "/api/detail",
    "field": ""
  },
  "status": "needsConfirm",
  "unresolved": [
    "missing api.field"
  ]
}
```

---

# 9. unresolved Contract

统一：

```json
{
  "unresolved": []
}
```

规则：

```text
status = resolved
→ unresolved.length = 0
```

```text
status = needsConfirm
→ unresolved.length > 0
```

禁止：

```json
{
  "status": "resolved",
  "unresolved": ["不知道 API 字段"]
}
```

---

# 10. expression / sourcePath 的定位

当前 DataDep 中已有：

```text
expression
sourcePath
```

P2-1 保留，不删除。

但重新明确职责：

```text
expression / sourcePath
=
Parameter Resolution 的血缘解释信息
```

它们：

```text
可以用于 trace/debug/report
```

但：

```text
不得用于 build-accept-chain 自动推断 from
不得用于 Runtime Resolver 猜 selector
```

例如：

```json
{
  "paramKey": "housedel_id",
  "from": "url",
  "queryKey": "housedelCode",

  "expression": "housedelCode || '-'",
  "sourcePath": "location.search -> housedelCode",

  "status": "resolved",
  "unresolved": []
}
```

真正 executable contract 是：

```text
from=url
queryKey=housedelCode
```

而不是：

```text
解析 expression 字符串
```

---

# 11. DataDep 与 Parameter 必须建立 Identity

每一个：

```text
accept.dataDeps[].paramKey
```

必须对应：

```text
parameters[].key
```

即：

```text
DataDep 不允许凭空创造 Parameter
```

例如：

```json
parameters: [
  {
    "key": "housedel_id"
  }
]
```

才允许：

```json
dataDeps: [
  {
    "paramKey": "housedel_id"
  }
]
```

如果：

```text
dataDep.paramKey
```

在：

```text
parameters[].key
```

中不存在：

```text
INVALID
```

---

# 12. DataDep 生成原则

DataDep 来源顺序：

```text
已确认 Parameter
↓
Parameter source evidence
↓
结构化 DataDep
```

AI 可以执行的部分：

```text
理解 sourcePath / evidence 的业务语义
↓
提出 DataDep Candidate
```

确定性程序负责：

```text
验证结构是否合法
验证 required selector 是否存在
验证 paramKey 是否存在
验证 status/unresolved 是否一致
```

---

# 13. 禁止自动 fallback

删除当前这种行为：

```text
无法识别
↓
from = page
```

正式规则：

```text
不能确定 from
↓
不得生成 resolved DataDep
```

应成为：

```json
{
  "status": "needsConfirm",
  "unresolved": [
    "cannot determine runtime dependency source"
  ]
}
```

或者：

```text
不生成 dataDep
+
event Gate = NEEDS_CONFIRM
```

推荐采用前者。

原因：

```text
保留失败事实
>
静默丢失
```

---

# 14. build-accept-chain 职责变化

当前：

```text
parameters
↓
inferDataDep()
↓
dataDeps
```

修改为：

```text
impl.accept.dataDeps
↓
validate
↓
copy
↓
accept-chain.dataDeps
```

即：

```text
build-accept-chain
不得再负责 DataDep Resolution
```

删除或停止使用：

```js
inferDataDep()
```

以及：

```js
resolveDataDeps()
```

中的 fallback inference。

目标逻辑：

```js
function resolveDataDeps(impl) {
  return Array.isArray(impl.accept?.dataDeps)
    ? impl.accept.dataDeps.map(cloneDataDep)
    : []
}
```

但是缺失需要通过 Gate 拦住，而不是静默当作成功。

---

# 15. DataDep Gate

对于：

```text
assertParams
```

中要求进行 Runtime Source Compare 的参数：

必须存在：

```text
resolved dataDep
```

最少满足：

```text
assertParams contains X
+
parameter X 有可验证 source
+
dataDep.paramKey = X
+
dataDep.status = resolved
```

才能：

```text
READY
```

如果 DataDep：

```text
missing
needsConfirm
invalid
```

则：

```text
NEEDS_CONFIRM
```

或：

```text
INVALID
```

---

# 16. Gate 分类

## INVALID

结构本身错误，例如：

```text
unknown from
missing paramKey
paramKey 不存在于 parameters
url 缺 queryKey
status=resolved 但 API selector 不完整
resolved + unresolved 非空
```

---

## NEEDS_CONFIRM

事实尚未闭环，例如：

```text
无法确定 API field
无法确定 queryKey
不知道 user.path
不知道 page.path
无法确定数据来源类型
```

---

## READY

必须：

```text
schema valid
+
source selector complete
+
status = resolved
+
unresolved = []
+
param identity valid
```

---

# 17. Schema 修改

修改：

```text
schemas/impl.schema.json
schemas/accept-chain.schema.json
```

不要分别维护两套不同语义。

如果当前项目不方便做 `$ref` 跨文件，可以暂时保持重复定义，但两个定义必须完全一致，并由测试防漂移。

未来再考虑抽：

```text
schemas/data-dep.schema.json
```

P2-1 不强制增加新 Schema 文件。

---

# 18. 推荐 DataDep Schema

语义等价于：

```json
{
  "type": "object",
  "required": [
    "paramKey",
    "from",
    "status",
    "unresolved"
  ],
  "properties": {
    "paramKey": {
      "type": "string",
      "minLength": 1
    },

    "from": {
      "enum": [
        "api",
        "url",
        "user",
        "page"
      ]
    },

    "queryKey": {
      "type": "string"
    },

    "api": {
      "type": "object",
      "properties": {
        "urlIncludes": {
          "type": "string"
        },
        "field": {
          "type": "string"
        }
      }
    },

    "user": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        }
      }
    },

    "page": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        }
      }
    },

    "expression": {
      "type": "string"
    },

    "sourcePath": {
      "type": "string"
    },

    "status": {
      "enum": [
        "resolved",
        "needsConfirm"
      ]
    },

    "unresolved": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```

注意：

仅靠 JSON Schema 很难完整表达全部跨字段规则。

因此：

```text
Schema
+
validate-data-dep.js
```

共同形成 Closure。

---

# 19. 新增确定性 Validator

新增：

```text
scripts/accept/validate-data-dep.js
```

核心导出：

```js
validateDataDep(dep, event)
validateEventDataDeps(event)
dataDepGate(event)
```

建议：

```js
function validateDataDep(dep, event) {
  const issues = []

  // base contract
  // parameter identity
  // source-specific selector
  // status/unresolved consistency

  return {
    status: 'READY | NEEDS_CONFIRM | INVALID',
    issues
  }
}
```

---

# 20. source-specific Validation

伪代码：

```js
if (dep.from === 'url') {
  requireNonEmpty(dep.queryKey)
}

if (dep.from === 'api') {
  requireNonEmpty(dep.api?.urlIncludes)
  requireNonEmpty(dep.api?.field)
}

if (dep.from === 'user') {
  requireNonEmpty(dep.user?.path)
}

if (dep.from === 'page') {
  requireNonEmpty(dep.page?.path)
}
```

不能：

```text
warn and continue
```

对于：

```text
status = resolved
```

缺 selector 必须：

```text
INVALID
```

---

# 21. DataDep Gate 与现有 Parameter Gate 的关系

现有：

```text
Parameter Gate
```

继续负责：

```text
expression
sourcePath
confidence
scopeReachable
confirmation
```

新增：

```text
DataDep Gate
```

负责：

```text
Runtime dependency executable contract
```

最终 Event Gate：

```text
Parameter Gate
+
DataDep Gate
+
Accept Path Gate
```

不是相互替代。

---

# 22. 不要污染 Parameter Schema

不要为了 Runtime Resolver 修改：

```text
parameters[].evidence
parameters[].confidence
parameters[].scopeReachable
parameters[].confirmation
```

Parameter 是：

```text
Implementation Fact
```

DataDep 是：

```text
Acceptance Dependency Fact
```

两个层次不同，但必须从同一 `impl.json` 产生。

---

# 23. normalize-impl 行为

检查：

```text
scripts/accept/normalize-impl.js
```

原则：

```text
normalize
只能补默认结构
不能补业务事实
```

允许：

```json
{
  "status": "needsConfirm",
  "unresolved": []
}
```

这样的 structural normalization。

禁止：

```text
根据 expression 猜 from=url
根据 api 文字猜 field
unknown 自动变 page
```

---

# 24. build-accept-chain Gate

构建 Target 前增加：

```text
DataDep Gate
```

例如：

```js
const depGate = dataDepGate(impl)

if (depGate.status === 'INVALID') {
  return {
    error: 'invalid accept.dataDeps'
  }
}

if (depGate.status === 'NEEDS_CONFIRM') {
  return {
    error: 'accept.dataDeps needsConfirm'
  }
}
```

最终进入：

```text
accept-chain.paths[].targets[]
```

的 DataDep 必须全部：

```text
status = resolved
```

---

# 25. accept-chain 中是否保留 status

建议：

```text
保留。
```

原因：

accept-chain 是可执行事实层。

例如：

```json
{
  "paramKey": "housedel_id",
  "from": "url",
  "queryKey": "housedelCode",
  "status": "resolved",
  "unresolved": []
}
```

这样 Runtime Resolver 不需要根据字段完整度重新判断：

```text
这个 DataDep 是否已经确认。
```

---

# 26. Runtime Resolver 的未来输入

P2-1 完成后，下一阶段 Resolver 只接：

```json
{
  "paramKey": "housedel_id",
  "from": "url",
  "queryKey": "housedelCode",
  "status": "resolved"
}
```

执行：

```text
from=url
↓
读取 browser URL
↓
queryKey=housedelCode
↓
得到 Runtime Source Actual
```

而不允许：

```text
重新读取 expression
↓
猜 housedelCode 是 query
```

这就是 P2-1 Closure 的核心价值。

---

# 27. Tests

至少新增：

```text
scripts/accept/validate-data-dep.test.js
```

---

## Case 1：合法 URL

```json
{
  "paramKey": "housedel_id",
  "from": "url",
  "queryKey": "housedelCode",
  "status": "resolved",
  "unresolved": []
}
```

Expected：

```text
READY
```

---

## Case 2：URL 缺 queryKey

```json
{
  "paramKey": "housedel_id",
  "from": "url",
  "status": "resolved",
  "unresolved": []
}
```

Expected：

```text
INVALID
```

---

## Case 3：合法 API

```json
{
  "paramKey": "price",
  "from": "api",
  "api": {
    "urlIncludes": "/api/detail",
    "field": "data.price"
  },
  "status": "resolved",
  "unresolved": []
}
```

Expected：

```text
READY
```

---

## Case 4：API 缺 field

Expected：

```text
INVALID
```

如果：

```text
status=needsConfirm
```

则：

```text
NEEDS_CONFIRM
```

---

## Case 5：unknown 不得 fallback page

Input：

```text
Parameter source 无法确认
```

Expected：

```text
不能自动生成
from=page
status=resolved
```

---

## Case 6：dataDep.paramKey 不存在

```text
parameters = [community_id]

dataDep.paramKey = price
```

Expected：

```text
INVALID
```

---

## Case 7：resolved + unresolved

```json
{
  "status": "resolved",
  "unresolved": ["missing api field"]
}
```

Expected：

```text
INVALID
```

---

## Case 8：needsConfirm 无 unresolved

Expected：

```text
INVALID
```

---

## Case 9：build-accept-chain 不再 infer

Parameter：

```json
{
  "key": "housedel_id",
  "expression": "query.housedelCode",
  "sourcePath": "URL query"
}
```

但：

```text
accept.dataDeps missing
```

Expected：

```text
build-accept-chain 不得自动创建 from=url
```

---

## Case 10：显式 resolved DataDep 原样传递

```text
impl.accept.dataDeps
```

↓

```text
accept-chain.target.dataDeps
```

语义必须一致。

---

# 28. 需要修改的当前代码

Codex 应检查并按真实代码调整，重点文件：

```text
schemas/impl.schema.json
schemas/accept-chain.schema.json

scripts/accept/accept-chain.js
scripts/accept/validate-impl.js
scripts/accept/normalize-impl.js

新增：
scripts/accept/validate-data-dep.js
scripts/accept/validate-data-dep.test.js
```

如果存在其它：

```text
dataDeps
inferDataDep
resolveDataDeps
```

消费点，也必须搜索仓库后统一处理。

禁止只改上述文件而不搜索所有调用方。

---

# 29. Codex 实施顺序

```text
Step 1
全仓搜索：
dataDeps
inferDataDep
resolveDataDeps
queryKey
DEP_FROM
```

↓

```text
Step 2
确认当前 DataDep producer / validator / consumer
```

↓

```text
Step 3
修改 impl.schema.json
```

↓

```text
Step 4
修改 accept-chain.schema.json
```

↓

```text
Step 5
新增 validate-data-dep.js
```

↓

```text
Step 6
validate-impl 接入 DataDep Validator
```

↓

```text
Step 7
删除 build-accept-chain 的文本推断 fallback
```

↓

```text
Step 8
接入 build-accept-chain Gate
```

↓

```text
Step 9
补充 tests
```

↓

```text
Step 10
运行全部现有 P0/P1 tests + P2-1 tests
```

---

# 30. Codex 禁止事项

Codex 不得：

```text
1. 实现 Runtime Resolver
2. 改 run-accept 的 Runtime 数据读取逻辑
3. 新增第五个事实 JSON
4. 根据 expression/sourcePath 猜 from
5. unknown 自动 fallback page
6. 为让测试通过编造 queryKey/api.field/user.path/page.path
7. 修改 Parameter confidence 规则
8. 修改 P1 confirmation reuse 规则
9. 修改 Accept Path determinism 规则
10. 修改真实业务项目代码
```

---

# 31. Closure 验收标准

只有下面全部满足，P2-1 才算 CLOSED。

### Contract

```text
[ ] DataDep 有统一结构
[ ] from 仍限定 api/url/user/page
[ ] 每类 source 有确定 selector contract
[ ] status/unresolved 有确定规则
[ ] DataDep 与 Parameter paramKey 建立 identity
```

### Determinism

```text
[ ] inferDataDep 不再根据文本猜来源
[ ] unknown 不再 fallback page
[ ] build-accept-chain 不进行业务语义推断
```

### Gate

```text
[ ] invalid DataDep 可被 deterministic validator 拒绝
[ ] needsConfirm DataDep 不进入可执行 target
[ ] resolved DataDep selector 必须完整
```

### Fact Flow

```text
[ ] impl.accept.dataDeps 是唯一上游事实
[ ] accept-chain 只消费该事实
[ ] expression/sourcePath 只作解释，不作 runtime selector inference
```

### Tests

```text
[ ] URL cases
[ ] API cases
[ ] User cases
[ ] Page cases
[ ] param identity cases
[ ] status/unresolved cases
[ ] no-fallback cases
[ ] build-chain passthrough cases
[ ] 原有 P0/P1 tests 全部通过
```

---

# 32. P2-1 完成后的正式链路

```text
Parameter Resolution
↓
parameters[]
├── expression
├── sourcePath
├── evidence
├── confidence
└── confirmation

↓ 已确认事实转换

accept.dataDeps[]
├── paramKey
├── from
├── selector
├── status
└── unresolved

↓ deterministic validation

DataDep Gate

├─ INVALID
│
├─ NEEDS_CONFIRM
│   ↓
│   Human Gate
│
└─ READY
    ↓

build-accept-chain
↓
copy DataDep Contract
↓
accept-chain.json
↓
P2-2 Runtime Resolver
```

---

# 33. 对现有主链路的影响

不改变：

```text
events.json
→ adaptor.json
→ impl.json
→ accept-chain.json
```

不新增平行事实层。

本次只是把：

```text
impl.parameters
→ impl.accept.dataDeps
→ accept-chain.dataDeps
```

之间的 Contract 从：

```text
弱 Schema
+
字符串猜测
```

收敛成：

```text
显式事实
+
Schema
+
确定性 Validator
+
Gate
```

因此属于：

```text
Closure
```

而不是：

```text
架构替换
```

---

# 34. Codex 执行指令

请基于当前仓库真实代码完成 P2-1，不要机械照抄本文中的伪代码。

执行：

```text
1. 阅读 tasks/P2-1-data-dep-contract-closure.md
2. 全仓搜索所有 DataDep producer / validator / consumer
3. 对照真实代码形成最小修改集
4. 完成 DataDep Contract
5. 删除隐式 DataDep inference
6. 增加 deterministic validation + gate
7. 增加 tests
8. 运行现有相关 tests
9. 输出修改文件列表
10. 输出测试结果
11. 逐条对照第 31 节 Closure 验收标准
```

最终回复必须明确：

```text
P2-1 CLOSED
```

或者：

```text
P2-1 NOT CLOSED
```

如果 NOT CLOSED，列出尚未关闭的具体 Contract 缺口。

不得仅以：

```text
代码已修改
tests passed
```

作为 CLOSED 依据。

---

# 35. 确认口径与落地记录

本节是 P2-1 实施前拍板、并已写入代码的补充 Contract。后续 Agent 不得回退到本文前半的模糊写法。

## 35.1 INVALID vs NEEDS_CONFIRM

```text
status=resolved 但 source-specific selector 不完整
→ INVALID

status=needsConfirm 且 unresolved 用合法 reason code 记录缺口
→ NEEDS_CONFIRM
```

```text
INVALID = Contract 自相矛盾
NEEDS_CONFIRM = 事实尚未闭环
```

身份/结构错误一律 INVALID：

```text
missing paramKey
unknown from
paramKey 不在 parameters[].key
缺 status
resolved 且 unresolved 非空
needsConfirm 且 unresolved 为空
unresolved 含非 enum 值
```

## 35.2 不自动生成 dataDep，也不绑定 assertParams

```text
脚本不得自动生成任何 dataDep 桩
不得根据 expression / sourcePath / hint.api 推断 from
```

不要建立：

```text
assertParams 中存在 paramKey
→ 必须存在 dataDep
```

职责分离：

```text
assertParams = 要对账的埋点参数列表
dataDeps     = 显式的 Runtime Source Compare 事实
```

```text
未声明 dataDep
→ 不因 assertParams 自动进入 NEEDS_CONFIRM

已声明 dataDep
→ 必须通过 DataDep Gate
```

## 35.3 Event Gate 接入范围（最小集）

接入：

```text
validate-impl.collectImplGates
  = worse(Parameter Gate, DataDep Gate)

needs-confirm.js
  DataDep NEEDS_CONFIRM 必须进入待确认队列
  event.confirmed=true 不得绕过 dataDep.status=needsConfirm

build-accept-chain / buildTarget
  INVALID  → pending: invalid accept.dataDeps
  NEEDS_CONFIRM → pending: accept.dataDeps needsConfirm
  不得进入可执行 target
```

明确不接入：

```text
confirm-gate.applyConfirmAction
仍只确认 Parameter
不得把 DataDep 自动标为 resolved
```

```text
DataDep 必须自身变为 status=resolved 后才能通过 DataDep Gate
```

## 35.4 normalize-impl

允许：

```text
已有 dataDep 缺 unresolved → 补 []
```

禁止：

```text
缺 status 自动补 needsConfirm / resolved
根据 expression 猜 from / queryKey / api.field / user.runtime / page.runtime
unknown 自动变 page
```

缺 `status` 交给 validator 判 INVALID。

## 35.5 unresolved 封闭 reason code

机器 Contract 只用 enum，不用英文自然语言，也不复用事件级中文 `unresolved` 句式。

```text
MISSING_QUERY_KEY
MISSING_API_URL
MISSING_API_FIELD
MISSING_USER_RUNTIME_SELECTOR
MISSING_PAGE_RUNTIME_SELECTOR
UNSUPPORTED_RUNTIME_SELECTOR
SOURCE_UNRESOLVED
PAGE_SOURCE_UNRESOLVED
```

P2-1.1 已删除 `MISSING_USER_PATH` / `MISSING_PAGE_PATH`。User/Page resolved 必须有 `runtime.kind=windowPath` 与非空 `runtime.path`，禁止 `user.path` / `page.path`。

展示文案由 `DATADEP_UNRESOLVED_LABELS`（UI / report）映射，不作为机器输入。

不在表内的字符串 → INVALID。

## 35.6 Schema

`schemas/impl.schema.json` 与 `schemas/accept-chain.schema.json` 中：

```text
required: paramKey, from, status, unresolved
```

两套定义必须语义一致，由测试防漂移。

P2-1 是 Contract Closure，不为旧的不完整 DataDep 保留隐式兼容。P2-1.1 起 `user`/`page` 只允许 `runtime`，`additionalProperties: false`。

## 35.7 已落地文件

```text
schemas/impl.schema.json
schemas/accept-chain.schema.json
scripts/accept/validate-data-dep.js
scripts/accept/validate-data-dep.test.js
scripts/accept/validate-impl.js
scripts/accept/normalize-impl.js
scripts/accept/accept-chain.js
scripts/confirm/needs-confirm.js
```

已删除：`inferDataDep()` 文本推断与 unknown→page fallback。

未改（本阶段禁止）：

```text
confirm-gate.applyConfirmAction
Parameter confidence / confirmation reuse
Accept Path determinism
run-accept Runtime 读数
真实业务项目代码
```

## 35.8 测试

```text
npm test
136 / 136 通过
（原有 P0/P1 + P2-1 DataDep cases）
```

## 35.9 明确留给 P2-2 的缺口

本阶段不实现 Runtime Resolver。

`run-accept.js` 中仍存在：

```text
queryKey || 'housedelCode'
```

这类 Runtime 对账兜底。按第 30 节不得在 P2-1 修改，**不构成 P2-1 Contract 缺口**，由 P2-2 消费已闭环的 DataDep Contract。

## 35.10 Closure 结论

```text
P2-1 CLOSED
```

依据第 31 节 + 本节锁定口径，而非“代码已改 / tests passed”单独成立。
