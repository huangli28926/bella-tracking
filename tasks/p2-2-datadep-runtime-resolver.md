# P2-2 DataDep Runtime Resolver

## 0. 状态

```text
方案状态：候选实施方案
阶段：P2-2

前置：
P2-1 DataDep Contract Closure = CLOSED
P2-1.1 Runtime Selector Contract Closure = CLOSED

目标：
关闭

resolved DataDep
→ Browser Runtime Expected Value
→ Expected / Actual Compare

之间的执行不确定性。
```

本阶段不重新判断：

```text
参数来源是什么
Runtime selector 应该是什么
parameter.expression 是否合理
sourcePath 是否合理
```

这些事实必须在 P2-1 / P2-1.1 已经关闭。

---

# 1. 当前真实代码状态

当前正式链路：

```text
impl.json
↓
validate-data-dep
↓
build-accept-chain
↓
accept-chain.json
↓
run-accept
↓
Runtime
↓
Expected / Actual Compare
```

`build-accept-chain` 当前行为已经正确：

```text
dataDepGate(event)
↓
INVALID
→ target pending

NEEDS_CONFIRM
→ target pending

READY
→ dataDeps 原样复制到 accept-chain
```

因此：

```text
进入 run-accept 的 target.dataDeps
```

理论上已经全部满足：

```text
status = resolved
+
Runtime Selector 完整
```

P2-2 不应再次做业务推断。

---

# 2. P2-2 要解决的唯一问题

当前缺失的是统一执行器：

```text
accept-chain.target.dataDeps[]
↓
Runtime DataDep Resolver
↓
Expected Runtime Value
```

应形成：

```text
DataDep Contract
↓
确定性 Resolver
↓
RuntimeResolveResult
↓
Compare
```

不能再出现：

```text
paramKey
↓
run-accept.js 业务 hardcode
↓
expected value
```

例如禁止：

```js
if (dep.paramKey === 'housedel_id') {
  expected = query.housedelCode
}
```

正确来源必须完全由 DataDep 决定：

```json
{
  "paramKey": "housedel_id",
  "from": "url",
  "queryKey": "housedelCode",
  "status": "resolved",
  "unresolved": []
}
```

---

# 3. P2-2 输入 Contract

Runtime Resolver 唯一业务输入：

```text
target.dataDeps[]
```

单条 DataDep 第一阶段合法形式：

## URL

```json
{
  "paramKey": "housedel_id",
  "from": "url",
  "queryKey": "housedelCode",
  "status": "resolved",
  "unresolved": []
}
```

## API

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

## User

```json
{
  "paramKey": "ucid",
  "from": "user",
  "user": {
    "runtime": {
      "kind": "windowPath",
      "path": "__user.id"
    }
  },
  "status": "resolved",
  "unresolved": []
}
```

## Page

```json
{
  "paramKey": "community_name",
  "from": "page",
  "page": {
    "runtime": {
      "kind": "windowPath",
      "path": "__PAGE_DATA__.community.name"
    }
  },
  "status": "resolved",
  "unresolved": []
}
```

---

# 4. 明确禁止读取

P2-2 禁止通过以下字段决定 Runtime 来源：

```text
parameter.expression
parameter.sourcePath
parameter.evidence
parameter.hint
parameter.confidence

insertHint
eventName
evtId
paramKey 业务名称
```

尤其禁止：

```text
expression 中有 query
→ 推断 from=url

sourcePath 中有 API
→ 推断 from=api

paramKey=ucid
→ 猜 window.__user.id
```

Runtime Resolver 必须是：

```text
Contract Interpreter
```

而不是：

```text
Runtime Reasoning Agent
```

---

# 5. 新增 runtime-data-dep.js

新增：

```text
scripts/accept/runtime-data-dep.js
```

职责只包含：

```text
resolved DataDep
→ Runtime Expected Value
```

建议导出：

```js
resolveDataDep
resolveDataDeps

resolveUrlDataDep
resolveApiDataDep
resolveWindowPathDataDep

getByPath
```

整体结构：

```js
const SOURCE_RESOLVERS = {
  url: resolveUrlDataDep,
  api: resolveApiDataDep,
  user: resolveUserDataDep,
  page: resolvePageDataDep
}

async function resolveDataDep(dep, ctx) {
  if (!dep || dep.status !== 'resolved') {
    return runtimeError(
      dep,
      'DATADEP_NOT_RESOLVED'
    )
  }

  const resolver = SOURCE_RESOLVERS[dep.from]

  if (!resolver) {
    return runtimeError(
      dep,
      'RUNTIME_RESOLVER_NOT_FOUND'
    )
  }

  return resolver(dep, ctx)
}
```

禁止：

```js
const resolver =
  SOURCE_RESOLVERS[dep.from] ||
  resolveSomethingElse
```

不存在 fallback。

---

# 6. Runtime Context

P2-2 不新增新的事实文件。

只在本次 Runtime Execution 中维护：

```js
{
  page,

  url: {
    href,
    query
  },

  api: {
    responses: []
  },

  windowSnapshot
}
```

这里的：

```text
runtimeContext
```

只是：

```text
Runtime Evidence Container
```

不是新的：

```text
runtime.json
runtime-deps.json
resolver.json
```

---

# 7. URL Resolver

实现规则：

```text
dep.from = url
↓
dep.queryKey
↓
当前 Browser URL
↓
query[queryKey]
```

建议：

```js
async function resolveUrlDataDep(dep, ctx) {
  const query = ctx.url && ctx.url.query || {}

  if (!Object.prototype.hasOwnProperty.call(
    query,
    dep.queryKey
  )) {
    return {
      paramKey: dep.paramKey,
      from: 'url',
      status: 'missing',
      code: 'RUNTIME_URL_QUERY_MISSING',
      selector: {
        queryKey: dep.queryKey
      }
    }
  }

  return {
    paramKey: dep.paramKey,
    from: 'url',
    status: 'resolved',
    value: query[dep.queryKey],
    runtimeSource: {
      kind: 'urlQuery',
      queryKey: dep.queryKey,
      href: ctx.url.href
    }
  }
}
```

必须删除所有：

```text
housedel_id
housedelCode
```

之间的 Runtime 专有映射。

---

# 8. User / Page Resolver

这里是当前旧 P2-2 文档最需要修正的地方。

P2-1.1 已经明确：

```text
user.path
page.path
```

已经废弃。

所以不能实现：

```js
getByPath(ctx.user, dep.user.path)
```

正式实现必须完全使用：

```text
runtime.kind
runtime.path
```

第一阶段唯一支持：

```text
windowPath
```

统一实现：

```js
async function resolveWindowPath(page, runtime) {
  return page.evaluate(function (path) {
    var parts = String(path || '')
      .split('.')
      .filter(Boolean)

    var current = window

    for (var i = 0; i < parts.length; i += 1) {
      var key = parts[i]

      if (
        current == null ||
        !Object.prototype.hasOwnProperty.call(
          Object(current),
          key
        )
      ) {
        return {
          found: false
        }
      }

      current = current[key]
    }

    return {
      found: true,
      value: current
    }
  }, runtime.path)
}
```

User：

```js
async function resolveUserDataDep(dep, ctx) {
  return resolveRuntimeSelector(
    dep,
    dep.user && dep.user.runtime,
    ctx
  )
}
```

Page：

```js
async function resolvePageDataDep(dep, ctx) {
  return resolveRuntimeSelector(
    dep,
    dep.page && dep.page.runtime,
    ctx
  )
}
```

统一：

```js
async function resolveRuntimeSelector(
  dep,
  runtime,
  ctx
) {
  if (!runtime) {
    return runtimeError(
      dep,
      'RUNTIME_SELECTOR_MISSING'
    )
  }

  if (runtime.kind !== 'windowPath') {
    return runtimeError(
      dep,
      'RUNTIME_SELECTOR_UNSUPPORTED'
    )
  }

  const result = await resolveWindowPath(
    ctx.page,
    runtime
  )

  if (!result.found) {
    return {
      paramKey: dep.paramKey,
      from: dep.from,
      status: 'missing',
      code: 'RUNTIME_WINDOW_PATH_MISSING',
      runtimeSource: {
        kind: 'windowPath',
        path: runtime.path
      }
    }
  }

  return {
    paramKey: dep.paramKey,
    from: dep.from,
    status: 'resolved',
    value: result.value,
    runtimeSource: {
      kind: 'windowPath',
      path: runtime.path
    }
  }
}
```

注意：

```text
User 和 Page 第一阶段实际上共享同一个执行 Resolver。
```

二者区别只存在于：

```text
DataDep 业务来源语义
```

而不是执行机制。

---

# 9. API Runtime Collector

API Resolver 要先有确定性的 Runtime Evidence。

建议在：

```text
run-accept.js
```

初始化 page 时挂：

```js
attachApiRuntimeCollector(page)
```

但 Collector 与 Resolver 分离。

新增可放：

```text
scripts/accept/runtime-api-store.js
```

或者第一阶段放进：

```text
runtime-data-dep.js
```

如果代码量仍小。

推荐结构：

```js
{
  responses: [
    {
      t,
      url,
      method,
      status,
      bodyParsed,
      body
    }
  ]
}
```

监听：

```js
page.on('response', async response => {
  ...
})
```

只保存：

```text
可读取 JSON response
```

不要把图片、埋点 GIF、HTML 全存进去。

---

# 10. API Resolver

执行：

```text
api.urlIncludes
↓
当前 target Runtime Window 中 response
↓
api.field
↓
Expected Value
```

建议：

```js
function getByPath(obj, path) {
  const parts = String(path || '')
    .split('.')
    .filter(Boolean)

  let current = obj

  for (const key of parts) {
    if (
      current == null ||
      !Object.prototype.hasOwnProperty.call(
        Object(current),
        key
      )
    ) {
      return {
        found: false
      }
    }

    current = current[key]
  }

  return {
    found: true,
    value: current
  }
}
```

API Resolver：

```js
async function resolveApiDataDep(dep, ctx) {
  const selector = dep.api || {}

  const responses =
    ctx.api && Array.isArray(ctx.api.responses)
      ? ctx.api.responses
      : []

  const candidates = responses
    .filter(item =>
      item.url.includes(selector.urlIncludes)
    )
    .filter(item => item.bodyParsed)

  if (!candidates.length) {
    return {
      paramKey: dep.paramKey,
      from: 'api',
      status: 'missing',
      code: 'RUNTIME_API_NOT_CAPTURED'
    }
  }

  const withField = candidates.map(item => {
    return {
      response: item,
      field: getByPath(
        item.body,
        selector.field
      )
    }
  }).filter(item => item.field.found)

  if (!withField.length) {
    return {
      paramKey: dep.paramKey,
      from: 'api',
      status: 'missing',
      code: 'RUNTIME_API_FIELD_MISSING'
    }
  }

  ...
}
```

---

# 11. API 多响应确定性

这里不要让 Agent 自由决定。

首先限制候选范围：

```text
当前 target Runtime Window
```

建议 target 开始前记录：

```js
const targetRuntimeStart = Date.now()
```

只看：

```text
response.t >= targetRuntimeStart
```

如果接口通常发生在 trigger 之前，则 window 可从：

```text
完成 sharedSteps 后
```

开始。

关键原则：

```text
Window Boundary 必须由 run-accept 明确定义，
不能由 API Resolver 自己猜。
```

候选规则：

```text
1. url.includes(api.urlIncludes)
2. status 2xx
3. bodyParsed = true
4. field 存在
```

如果只有一个：

```text
resolved
```

如果多个候选，并且：

```text
field value 全部相同
```

可以确定性返回：

```text
最后一个 response
```

如果多个候选：

```text
field value 不同
```

返回：

```text
RUNTIME_API_AMBIGUOUS
```

不要偷偷选最后一个。

原因：

```text
urlIncludes Contract 不足以区分这些 response。
```

此时真正该修改的是：

```text
P2-1 DataDep Contract
```

例如未来增加：

```text
method
query selector
request body selector
```

而不是增强 Runtime 猜测。

---

# 12. RuntimeResolveResult

统一输出：

```json
{
  "paramKey": "housedel_id",
  "from": "url",
  "status": "resolved",
  "value": "123456",
  "code": "",
  "runtimeSource": {
    "kind": "urlQuery",
    "queryKey": "housedelCode"
  }
}
```

失败：

```json
{
  "paramKey": "ucid",
  "from": "user",
  "status": "missing",
  "code": "RUNTIME_WINDOW_PATH_MISSING",
  "runtimeSource": {
    "kind": "windowPath",
    "path": "__user.id"
  }
}
```

建议 Runtime status 只使用：

```text
resolved
missing
error
not_resolvable
```

注意不要与：

```text
DataDep.status
```

混为一个语义。

DataDep 的：

```text
resolved
```

表示：

```text
Contract 已关闭
```

Runtime 的：

```text
resolved
```

表示：

```text
本次 Browser Runtime 真正读到了值
```

---

# 13. Compare 层

Resolver 不负责 PASS / FAIL。

保持职责：

```text
Resolver
→ Expected Runtime Value

SDK Hook
→ Tracking Actual Value

Compare
→ PASS / FAIL
```

新增：

```js
function compareDataDepResult(
  resolved,
  firedAction
)
```

结果例如：

```json
{
  "paramKey": "housedel_id",
  "expectedValue": "123456",
  "actualValue": "123456",
  "status": "PASS"
}
```

不一致：

```json
{
  "paramKey": "housedel_id",
  "expectedValue": "123456",
  "actualValue": "654321",
  "status": "FAIL",
  "code": "DATADEP_VALUE_MISMATCH"
}
```

Runtime Source 没取到：

```json
{
  "paramKey": "ucid",
  "expectedValue": null,
  "actualValue": "1001",
  "status": "PENDING",
  "code": "RUNTIME_WINDOW_PATH_MISSING"
}
```

第一阶段建议：

```text
Runtime source 无法读取
≠
implementation mismatch
```

所以应该：

```text
PENDING / unverifiable
```

而不是把业务实现直接判 FAIL。

而：

```text
expected resolved
+
actual 不等于 expected
```

才是：

```text
FAIL
```

---

# 14. run-accept.js 改造

`run-accept.js` 应只负责编排：

```text
target Runtime Window start
↓
sharedSteps
↓
trigger
↓
捕获 fired event
↓
构造 runtimeContext
↓
resolveDataDeps()
↓
compareDataDepResults()
↓
写 result
```

禁止继续增加：

```text
if paramKey === xxx
if from=user then猜字段
if housedel_id...
```

建议导入：

```js
const {
  resolveDataDeps
} = require('./runtime-data-dep')
```

执行：

```js
const dataDepResults =
  await resolveDataDeps(
    target.dataDeps,
    runtimeContext
  )
```

然后：

```js
const paramDiffs =
  compareDataDepResults(
    dataDepResults,
    fired && fired.action
  )
```

---

# 15. 报告输出

现有报告已经携带：

```text
dataDeps
paramDiffs
fired
```

继续扩充：

```json
{
  "dataDepResults": [
    {
      "paramKey": "housedel_id",
      "from": "url",
      "status": "resolved",
      "value": "123",
      "runtimeSource": {
        "kind": "urlQuery",
        "queryKey": "housedelCode"
      }
    }
  ],
  "paramDiffs": [
    {
      "paramKey": "housedel_id",
      "expectedValue": "123",
      "actualValue": "123",
      "status": "PASS"
    }
  ]
}
```

这样报告可以明确展示：

```text
为什么 Expected 是这个值
```

符合 bella-tracking 的：

```text
Runtime Evidence
```

原则。

---

# 16. 不修改 accept-chain Contract

本阶段原则上不需要新增：

```text
accept-chain schema 字段
```

因为 P2-1.1 已经保证：

```text
target.dataDeps
```

足够执行。

P2-2 只是：

```text
消费 Contract
```

而不是：

```text
再次改 Contract
```

只有实际实现过程中发现：

```text
某种来源无法仅靠当前 DataDep 确定执行
```

才回退到：

```text
P2-1 Contract Gap
```

而不是在 Runtime 加推断。

---

# 17. 需要新增测试

至少新增：

```text
scripts/accept/runtime-data-dep.test.js
```

## Case 1 URL resolved

输入：

```json
{
  "from": "url",
  "queryKey": "housedelCode",
  "status": "resolved"
}
```

Runtime：

```text
?housedelCode=123
```

期望：

```text
value = 123
```

---

## Case 2 URL missing

期望：

```text
RUNTIME_URL_QUERY_MISSING
```

---

## Case 3 User windowPath

```text
window.__user.id = 1001
```

DataDep：

```json
{
  "user": {
    "runtime": {
      "kind": "windowPath",
      "path": "__user.id"
    }
  }
}
```

期望：

```text
1001
```

---

## Case 4 Page windowPath

同 User。

---

## Case 5 windowPath missing

期望：

```text
RUNTIME_WINDOW_PATH_MISSING
```

不能 fallback。

---

## Case 6 API single candidate

匹配：

```text
urlIncludes
+
field
```

期望：

```text
resolved
```

---

## Case 7 API field missing

期望：

```text
RUNTIME_API_FIELD_MISSING
```

---

## Case 8 API ambiguous

两个候选：

```text
field value 不同
```

期望：

```text
RUNTIME_API_AMBIGUOUS
```

---

## Case 9 unresolved DataDep

即使调用 Resolver：

```json
{
  "status": "needsConfirm"
}
```

也必须：

```text
DATADEP_NOT_RESOLVED
```

禁止执行。

---

## Case 10 禁止 expression fallback

DataDep：

```json
{
  "from": "url",
  "queryKey": "missing",
  "status": "resolved"
}
```

即使 parameter.expression 是：

```text
window.foo
```

也必须：

```text
RUNTIME_URL_QUERY_MISSING
```

不能读取：

```text
window.foo
```

---

# 18. 集成测试

除了 unit test，还应增加一个 Runtime Integration Test：

```text
fake page
+
URL query
+
window global
+
mock API
+
fake tracking action
```

验证：

```text
DataDep
→ Runtime Expected
→ Actual
→ Compare
```

完整闭环。

重点不是 Playwright UI 本身，而是证明：

```text
相同 DataDep Contract
在 Claude Code / Codex / Cursor 修改出的执行逻辑
都只能得到同一个结果。
```

---

# 19. AI 与确定性程序边界

## AI

P2-2 不需要 AI。

AI 只存在于上游：

```text
Parameter Resolution
↓
DataDep Candidate
↓
Runtime Selector Candidate
```

---

## Schema / Validator

负责：

```text
resolved Contract 是否完整
```

---

## Runtime Resolver

负责：

```text
严格解释 DataDep Contract
```

---

## Playwright

负责：

```text
提供真实 Browser Runtime Evidence
```

---

## Compare

负责：

```text
Expected vs Actual
```

因此：

```text
P2-2 应该是纯确定性程序。
```

---

# 20. 失败处理

## Contract 不合法

理论上：

```text
P2-1 Gate
```

已经挡住。

若 Runtime 再收到：

```text
status != resolved
```

返回：

```text
DATADEP_NOT_RESOLVED
```

属于：

```text
internal contract violation
```

---

## Runtime Source 不存在

例如：

```text
windowPath 不存在
URL query 不存在
API 没捕获
```

输出：

```text
Runtime Resolution PENDING
```

并保留 Runtime Evidence。

---

## Runtime Source 成功但值不一致

输出：

```text
FAIL
```

属于：

```text
implementation mismatch
```

---

## API Selector ambiguous

输出：

```text
PENDING
RUNTIME_API_AMBIGUOUS
```

并提示：

```text
DataDep Contract selector precision insufficient
```

需要重新进入：

```text
P2-1 Contract
```

而不是 Runtime 推断。

---

# 21. 对当前主链路的影响

正式主链路不变：

```text
events.json
↓
adaptor.json
↓
impl.json
↓
accept-chain.json
↓
run-accept
↓
Runtime Actual
↓
Expected / Actual Compare
↓
Report
```

只把：

```text
run-accept 内部零散的 Runtime Expected 推导
```

替换为：

```text
统一 Runtime Resolver
```

不新增事实层。

---

# 22. 推荐改动范围

主要新增：

```text
scripts/accept/runtime-data-dep.js
scripts/accept/runtime-data-dep.test.js
```

视 API Collector 代码量决定是否新增：

```text
scripts/accept/runtime-api-store.js
scripts/accept/runtime-api-store.test.js
```

修改：

```text
scripts/accept/run-accept.js
scripts/accept/accept-report.js
```

必要时修改：

```text
templates/accept-report.html
```

原则上不应修改：

```text
schemas/impl.schema.json
schemas/accept-chain.schema.json
scripts/accept/validate-data-dep.js
scripts/accept/accept-chain.js
```

除非实施过程中发现真实 Contract Gap。

---

# 23. Codex 实施要求

Codex 必须先读取：

```text
tasks/p2-1-datadeps-contract-closure.md
tasks/p2-1.1-runtime-selector-contract-closure.md

scripts/accept/validate-data-dep.js
scripts/accept/accept-chain.js
scripts/accept/run-accept.js
scripts/accept/accept-report.js
```

然后实施 P2-2。

不得恢复：

```text
user.path
page.path
```

不得：

```text
根据 expression/sourcePath 推断 Runtime 来源
```

不得：

```text
新增 paramKey 业务 hardcode
```

不得：

```text
为了兼容旧格式增加 fallback
```

---

# 24. Closure 判定

P2-2 只有同时满足以下条件才算 CLOSED：

```text
[ ] target.dataDeps 是 Runtime Resolver 唯一业务输入

[ ] 只执行 status=resolved

[ ] URL 只读取 queryKey

[ ] API 只读取 urlIncludes + field

[ ] User/Page 只读取 runtime.kind/path

[ ] 第一阶段 runtime.kind 只支持 windowPath

[ ] 不读取 expression/sourcePath 推断来源

[ ] 不存在 paramKey 业务特例

[ ] 不存在 fallback resolver

[ ] Runtime Source 读取失败有结构化结果

[ ] API 多响应有确定性歧义处理

[ ] Expected Runtime Value 与 Tracking Actual 分层

[ ] dataDepResults 进入 Runtime Report

[ ] 单元测试覆盖四类 source

[ ] 有至少一个 Expected/Actual 集成测试

[ ] 不新增第五事实层
```

全部满足：

```text
P2-2 DataDep Runtime Resolver
=
CLOSED
```
