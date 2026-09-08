# P2-2 DataDep Runtime Resolver

## 0. 状态

```text
方案状态：候选实施方案
阶段：P2-2
前置：P2-1 DataDep Contract Closure = CLOSED
目标：关闭 DataDep → Runtime Expected Value 的执行不确定性
```

本阶段只解决：

```text
resolved dataDep
↓
Browser Runtime
↓
Runtime Expected Value
```

核心原则：

> Runtime Resolver 只消费已经 `status = resolved` 的 DataDep Contract。
>
> 禁止重新读取 `parameter.expression / sourcePath / evidence / hint` 推断 Runtime 来源。

---

# 1. 当前问题

当前正式链路不变：

```text
events.json
↓
adaptor.json
↓
Parameter Resolution
↓
impl.json
↓
DataDep Contract
↓
build-accept-chain
↓
accept-chain.json
↓
run-accept
↓
Runtime Resolver
↓
Expected / Actual Compare
↓
验收报告
```

P2-1 已经解决：

```text
Parameter Fact
↓
明确 dataDep
↓
validate-data-dep
↓
resolved / needsConfirm / invalid
↓
build-accept-chain 只复制
```

P2-2 需要解决：

```text
resolved dataDep
↓
到底如何从真实 Browser Runtime 取得值
```

当前 `run-accept.js` 中仍存在局部硬编码：

```js
if (dep.from === 'url') {
  // housedel_id ↔ housedelCode 特例
}

if (dep.from === 'user') {
  userExpect(ctx.user, key)
}
```

并且：

```text
URL
User
API
Page
```

尚未形成统一 Resolver。

因此当前 Runtime Compare 仍然存在两个问题：

```text
DataDep Contract
≠
统一 Runtime 执行契约
```

以及：

```text
paramKey / 业务字段
↓
run-accept 内部特例
↓
Expected
```

这会导致新的业务字段继续往 `run-accept.js` 中添加 hardcode。

P2-2 必须关闭这个扩散点。

---

# 2. P2-2 核心目标

完成后必须形成：

```text
accept-chain.target.dataDeps[]
        ↓
filter status=resolved
        ↓
resolveDataDep(dep, runtimeContext)
        ↓
RuntimeResolveResult
        ↓
compareResolvedDep(result, trackingActual)
```

任何 Agent / 项目面对相同：

```json
{
  "paramKey": "housedel_id",
  "from": "url",
  "queryKey": "housedelCode",
  "status": "resolved",
  "unresolved": []
}
```

都必须确定性执行：

```text
当前 Browser URL
↓
query["housedelCode"]
↓
expectedValue
```

不能重新判断：

```text
housedelCode 看起来像 URL 参数
```

因为：

```text
from=url
queryKey=housedelCode
```

已经是上游确认后的事实。

---

# 3. P2-2 最重要的输入边界

Runtime Resolver 唯一业务输入：

```text
target.dataDeps[]
```

并且只接受：

```text
dep.status === "resolved"
```

正式规则：

```js
function isRuntimeResolvable(dep) {
  return dep && dep.status === 'resolved'
}
```

P2-2 禁止读取以下字段决定来源：

```text
parameter.expression
parameter.sourcePath
parameter.evidence
parameter.hint
parameter.confidence

dataDep.expression
dataDep.sourcePath
```

其中：

```text
dataDep.expression
dataDep.sourcePath
```

即使为了可追溯性继续保留在 Schema 中：

```text
也只能用于展示 / diagnosis
不能参与 Resolver 分支判断
```

因此：

```text
expression = "query.housedelCode"
```

不能触发：

```text
from=url
```

只有：

```json
{
  "from": "url",
  "queryKey": "housedelCode"
}
```

才能触发 URL Resolver。

---

# 4. Runtime Resolver 与 P2-1 的职责边界

## P2-1

回答：

```text
这个参数 Runtime 应该从哪里验证？
```

产出：

```json
{
  "paramKey": "...",
  "from": "...",
  "selector": "...",
  "status": "resolved"
}
```

---

## P2-2

回答：

```text
按照这个已经确定的 Contract，
当前 Browser Runtime 中实际读取到什么？
```

产出：

```json
{
  "paramKey": "...",
  "from": "...",
  "status": "resolved",
  "value": "...",
  "runtimeSource": {...}
}
```

---

## Compare

回答：

```text
Runtime Expected
和
Tracking Actual
是否一致？
```

因此明确禁止：

```text
P2-2 发现读取失败
↓
回头根据 sourcePath 换一个来源继续猜
```

正确行为：

```text
Runtime resolution failed
↓
返回明确失败结果
↓
验收 FAIL / PENDING
↓
指出 Runtime Source 不可解析
```

而不是：

```text
偷偷换数据源
```

---

# 5. 不新增第五个事实层

保持当前：

```text
impl.json
↓
accept-chain.json
↓
Runtime Actual / Report
```

不新增：

```text
runtime-deps.json
resolver.json
expected-runtime.json
```

P2-2 的结果属于：

```text
本次 Runtime Execution Evidence
```

可以直接进入：

```text
验收 result row
```

例如：

```json
{
  "evtId": "95941",
  "dataDepResults": [
    {
      "paramKey": "housedel_id",
      "from": "url",
      "status": "resolved",
      "value": "123456",
      "actualValue": "123456",
      "compareStatus": "PASS"
    }
  ]
}
```

它不是新的设计事实层。

---

# 6. 推荐代码结构

新增：

```text
scripts/accept/runtime-data-dep.js
```

职责只包含：

```text
DataDep Runtime Resolution
```

建议接口：

```js
async function resolveDataDep(dep, runtimeContext)

async function resolveDataDeps(deps, runtimeContext)

async function resolveUrlDataDep(dep, runtimeContext)

async function resolveApiDataDep(dep, runtimeContext)

async function resolveUserDataDep(dep, runtimeContext)

async function resolvePageDataDep(dep, runtimeContext)
```

统一入口：

```js
const RESOLVERS = {
  url: resolveUrlDataDep,
  api: resolveApiDataDep,
  user: resolveUserDataDep,
  page: resolvePageDataDep
}
```

核心：

```js
async function resolveDataDep(dep, ctx) {
  if (!dep || dep.status !== 'resolved') {
    return {
      paramKey: dep && dep.paramKey || '',
      status: 'not_resolvable',
      code: 'DATADEP_NOT_RESOLVED'
    }
  }

  const resolver = RESOLVERS[dep.from]

  if (!resolver) {
    return {
      paramKey: dep.paramKey,
      status: 'error',
      code: 'RUNTIME_RESOLVER_NOT_FOUND'
    }
  }

  return resolver(dep, ctx)
}
```

注意：

```text
这里不存在 default resolver
不存在 fallback page
不存在 expression inference
```

---

# 7. Runtime Context

不要让四个 Resolver 自己到处访问 Playwright 对象。

建立统一 Runtime Context：

```js
{
  page,

  url: {
    href,
    query
  },

  user: runtimeUserSnapshot,

  api: apiRuntimeStore,

  pageData: pageRuntimeStore
}
```

它表示：

```text
本次 target 执行时的 Runtime Evidence
```

不是新的业务事实。

---

# 8. URL Resolver

DataDep：

```json
{
  "paramKey": "housedel_id",
  "from": "url",
  "queryKey": "housedelCode",
  "status": "resolved",
  "unresolved": []
}
```

Resolver：

```js
function resolveUrlDataDep(dep, ctx) {
  const query = ctx.url && ctx.url.query || {}

  if (!Object.prototype.hasOwnProperty.call(query, dep.queryKey)) {
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
    selector: {
      queryKey: dep.queryKey
    }
  }
}
```

禁止：

```js
dep.queryKey || 'housedelCode'
```

禁止：

```js
if (paramKey === 'housedel_id')
```

因此必须删除当前：

```text
housedel_id ↔ housedelCode
```

Runtime 特例。

---

# 9. API Resolver

DataDep：

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

需要在 Playwright Runtime 采集 API response。

推荐统一维护：

```js
apiRuntimeStore
```

结构例如：

```js
[
  {
    url: "/api/estimate/detail?...",
    method: "GET",
    status: 200,
    timestamp: 123456,
    body: {
      "data": {
        "price": 500
      }
    }
  }
]
```

Resolver 只做两步：

```text
1. 按 api.urlIncludes 找 response
2. 按 api.field 取字段
```

例如：

```js
async function resolveApiDataDep(dep, ctx) {
  const api = dep.api

  const candidates = ctx.api.responses.filter(item =>
    item.url.includes(api.urlIncludes)
  )

  if (!candidates.length) {
    return {
      status: 'missing',
      code: 'RUNTIME_API_NOT_CAPTURED'
    }
  }

  const response = selectRuntimeResponse(candidates)

  const result = getByPath(response.body, api.field)

  if (!result.found) {
    return {
      status: 'missing',
      code: 'RUNTIME_API_FIELD_MISSING'
    }
  }

  return {
    paramKey: dep.paramKey,
    from: 'api',
    status: 'resolved',
    value: result.value,
    runtimeSource: {
      url: response.url,
      field: api.field
    }
  }
}
```

---

# 10. API 多响应确定性规则

不能：

```text
同一路径出现 3 次接口
↓
随便 pop() 一个
```

P2-2 必须定义确定性选择规则。

建议：

```text
只考虑当前 Accept Target Runtime Window 内的 response
```

Runtime Window：

```text
path opened
↓
sharedSteps
↓
target trigger
↓
event fired
```

对于候选响应：

```text
优先最后一个成功完成且 body 可解析的 response
```

确定性排序：

```text
timestamp DESC
```

如果：

```text
存在多个满足 urlIncludes
+
结果字段值不同
+
无法确定哪个与当前 target 对应
```

不要猜。

返回：

```text
RUNTIME_API_AMBIGUOUS
```

P2-2 不增加复杂 AI 消歧。

如果未来确实需要更精细 API 身份：

```text
method
request query
request body
response selector
```

应扩充 DataDep Contract，而不是偷偷在 Resolver 中推断。

---

# 11. User Resolver

P2-1 当前 Contract：

```json
{
  "paramKey": "agent_ucid",
  "from": "user",
  "user": {
    "path": "user.id"
  },
  "status": "resolved",
  "unresolved": []
}
```

这里必须注意：

P2-1 已定义：

```text
user.path 是业务语义路径
```

但没有规定 Runtime 必须读取：

```text
window.__user
```

因此当前 `run-accept.js`：

```js
window.__user
```

以及：

```js
userExpect(user, key)
```

不能继续作为通用 Contract。

P2-2 推荐把：

```text
业务 user.path
→ Runtime user snapshot
```

交给项目 `adaptor` / SDK profile 提供的统一 User Provider。

形式例如：

```js
runtimeContext.user = await runtimeProviders.readUser(page)
```

然后 Resolver：

```js
resolveUserDataDep(dep, ctx) {
  return getByPath(ctx.user, dep.user.path)
}
```

关键原则：

```text
paramKey 不参与 user path 推断
```

禁止：

```js
if (key === 'agent_ucid') return user.id
if (key === 'city_id') return user.officeAddress
```

正确：

```json
{
  "paramKey": "city_id",
  "from": "user",
  "user": {
    "path": "user.officeAddress"
  }
}
```

Resolver 完全按照：

```text
user.path
```

取值。

---

# 12. User Runtime Provider 的边界

这里存在一个需要明确的工程边界：

```text
DataDep
```

负责：

```text
业务事实路径
```

而：

```text
adaptor / Runtime Provider
```

负责：

```text
如何取得该项目的 user root object
```

例如某项目：

```text
window.__user
```

另一个项目：

```text
window.__INITIAL_STATE__.user
```

再一个项目：

```text
登录接口缓存
```

这些不能写进公共：

```text
runtime-data-dep.js
```

因此：

```text
通用 Resolver
+
项目 Runtime Provider
```

是推荐结构。

这不改变 adaptor.json 的事实定位，只扩展其 Runtime 适配职责。

---

# 13. Page Resolver

DataDep：

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

P2-1 已明确：

```text
page.path 不是 DOM locator
```

因此 P2-2 禁止把：

```text
community.name
```

直接猜成：

```text
CSS selector
React variable
window path
```

Page Resolver 与 User 相同：

```text
page.path
```

只能访问已经由 Runtime Page Provider 暴露出的：

```text
pageRuntimeStore
```

例如：

```js
runtimeContext.pageData =
  await runtimeProviders.readPageData(page)
```

然后：

```js
resolvePageDataDep(dep, ctx) {
  return getByPath(ctx.pageData, dep.page.path)
}
```

---

# 14. Page Provider 没有实现时怎么办

这是 P2-2 很重要的失败边界。

例如：

```json
{
  "from": "page",
  "page": {
    "path": "community.name"
  },
  "status": "resolved"
}
```

但是当前项目没有：

```text
page Runtime Provider
```

禁止：

```text
看到 community.name
↓
搜索 DOM
↓
尝试 window
↓
尝试 React internals
↓
尝试接口
```

正确结果：

```json
{
  "status": "unsupported",
  "code": "RUNTIME_PAGE_PROVIDER_UNAVAILABLE"
}
```

这意味着：

```text
DataDep 业务事实已 resolved
≠
当前 Runtime 环境一定具备读取能力
```

需要区分：

```text
Contract Resolution
和
Runtime Resolution
```

---

# 15. RuntimeResolveResult Contract

四类 Resolver 必须返回统一结构。

推荐：

```json
{
  "paramKey": "housedel_id",
  "from": "url",

  "status": "resolved",

  "value": "123456",

  "selector": {
    "queryKey": "housedelCode"
  },

  "runtimeSource": {
    "url": "/detail?housedelCode=123456"
  },

  "code": null
}
```

Runtime Status：

```text
resolved
missing
ambiguous
unsupported
error
```

语义：

```text
resolved
= Runtime Expected 已取得

missing
= 已按确定 selector 查找，但 Runtime 没有数据

ambiguous
= selector 命中多个互相冲突的 Runtime 候选

unsupported
= 当前 Runtime Provider 不支持该已确认 Contract

error
= Runtime 执行异常
```

这些状态不反写：

```text
dataDep.status
```

因为：

```text
dataDep.status
= Design-time fact resolution status

runtime result.status
= 本次 Browser execution status
```

两者不能混淆。

---

# 16. Compare Contract

当前：

```js
assertParams(target, fired, ctx)
```

应拆分为：

```text
Resolve
↓
Compare
```

推荐：

```js
const depResults = await resolveDataDeps(
  target.dataDeps,
  runtimeContext
)

const paramDiffs = compareParams(
  target,
  fired,
  depResults
)
```

Compare 不再了解：

```text
URL
API
User
Page
```

只接受：

```text
expectedValue
actualValue
```

伪代码：

```js
function compareResolvedDataDeps(depResults, fired) {
  const action = fired && fired.action || []
  const diffs = []

  for (const result of depResults) {
    if (result.status !== 'resolved') {
      diffs.push({
        key: result.paramKey,
        reason: result.code,
        kind: 'runtime_source_unresolved'
      })
      continue
    }

    const actual = action[result.paramKey]

    if (!sameRuntimeValue(actual, result.value)) {
      diffs.push({
        key: result.paramKey,
        expected: result.value,
        actual,
        kind: 'value_mismatch'
      })
    }
  }

  return diffs
}
```

---

# 17. 修正当前 `sameish()`

当前 `sameish()` 存在非常危险的宽松逻辑：

```text
expected 为空 → true
actual 为空 → true
boolean 不好比较 → true
```

这会让：

```text
没有取得 Runtime Expected
```

看起来像：

```text
PASS
```

P2-2 不应继续如此。

原则：

```text
Runtime Source 没取得
≠
Compare PASS
```

应该区分：

```text
Runtime source missing
value mismatch
actual missing
value equal
```

建议：

```js
function sameRuntimeValue(actual, expected) {
  if (actual === undefined || expected === undefined) {
    return false
  }

  return String(actual) === String(expected)
}
```

如果需要：

```text
boolean / number / null / enum
```

规范化，应增加明确 deterministic normalization contract。

不能用：

```text
不好比就 true
```

规避错误。

---

# 18. assertParams 与 dataDeps 的关系

继续保留：

```text
assertParams
```

负责：

```text
哪些 action 参数必须存在
```

DataDep 负责：

```text
哪些参数还需要 Runtime Source Value Compare
```

所以两个维度应分开。

例如：

```json
{
  "assertParams": [
    "city_id",
    "source"
  ],

  "dataDeps": [
    {
      "paramKey": "city_id",
      "from": "user",
      ...
    }
  ]
}
```

表示：

```text
source
→ 只检查 action 是否存在

city_id
→ 检查 action 是否存在
+
检查 Runtime Expected Value
```

不要强制：

```text
每个 assertParam 都必须有 dataDep
```

除非上游 Contract 明确将它定义为 Runtime Source Compare 参数。

---

# 19. Runtime Window

DataDep 的 Runtime Evidence 必须和当前 target 有时间边界。

推荐：

```text
openPath
↓
记录 pathOpenedAt
↓
sharedSteps
↓
记录 triggerStartedAt
↓
执行 trigger
↓
event firedAt
↓
resolve target Runtime deps
```

不同 source 的时间规则：

```text
url
→ trigger 后当前 URL snapshot

user
→ target Runtime snapshot

page
→ target Runtime snapshot

api
→ 当前 path / target window 捕获的 response
```

不能从整个浏览器生命周期的无限历史中取 API。

否则：

```text
上一个 Path 的 response
```

可能污染当前 target。

---

# 20. 推荐 Runtime Context 构建

将当前：

```js
openPath()
```

返回的：

```js
{
  query,
  user
}
```

升级为更明确的：

```js
{
  pathOpenedAt,

  url: {
    href,
    query
  },

  user: ...,

  pageData: ...,

  api: {
    responses: []
  }
}
```

注意：

```text
openPath 不负责判断 dataDep
```

它只构建 Runtime Evidence Context。

真正需要哪些数据：

```text
由 dataDeps.from
决定
```

---

# 21. Lazy Resolution

不建议每次都无条件采集所有 Runtime 数据。

可根据 resolved dataDeps 构建需求：

```js
const requirements = {
  url: false,
  api: false,
  user: false,
  page: false
}
```

例如：

```text
target.dataDeps = [url, api]
```

则：

```text
只需要 URL snapshot
+
API collector
```

不需要：

```text
User Provider
Page Provider
```

这样保持项目通用性。

---

# 22. DataDep Consumer Guard

即使 P2-1 Gate 已经拦住 `needsConfirm`，P2-2 自己仍必须 defensive check：

```js
if (dep.status !== 'resolved') {
  return DATADEP_NOT_RESOLVED
}
```

原因：

```text
accept-chain.json
可能来自旧版本
可能被人工修改
可能绕过 build-accept-chain
```

但：

```text
P2-2 只报告错误
不尝试修复 Contract
```

---

# 23. 禁止 DataDep Runtime fallback

以下全部禁止：

```text
URL query missing
→ 尝试 API

API field missing
→ 尝试 page

User provider missing
→ window 上搜索类似字段

Page provider missing
→ 搜 DOM 文案

selector 错误
→ 根据 expression 猜新的 selector

runtime source missing
→ 使用 actual tracking value 当 expected
```

核心原则：

```text
Expected 必须独立于 Actual。
```

否则：

```text
Actual
→ Expected
→ Compare
```

变成自证循环，验收失去意义。

---

# 24. Error Code

建议新增稳定枚举：

```text
DATADEP_NOT_RESOLVED

RUNTIME_URL_QUERY_MISSING

RUNTIME_API_NOT_CAPTURED
RUNTIME_API_FIELD_MISSING
RUNTIME_API_AMBIGUOUS
RUNTIME_API_BODY_UNREADABLE

RUNTIME_USER_PROVIDER_UNAVAILABLE
RUNTIME_USER_PATH_MISSING

RUNTIME_PAGE_PROVIDER_UNAVAILABLE
RUNTIME_PAGE_PATH_MISSING

RUNTIME_RESOLVER_NOT_FOUND
RUNTIME_RESOLVE_ERROR
```

报告层只消费这些 code 做中文展示。

不要让不同 Agent 自由生成：

```text
"URL值没找到"
"query不存在"
"missing URL"
```

---

# 25. Runtime Evidence

报告中建议保留：

```json
{
  "paramKey": "price",
  "from": "api",
  "status": "resolved",
  "value": 500,

  "runtimeSource": {
    "url": "/api/estimate/detail?id=1",
    "field": "data.price",
    "capturedAt": 123456789
  }
}
```

但避免写入：

```text
整个 API response body
```

原因：

```text
报告体积
敏感信息
无关字段
```

只保存验证需要的最小 evidence。

---

# 26. 推荐文件修改范围

重点修改：

```text
scripts/accept/run-accept.js
```

新增：

```text
scripts/accept/runtime-data-dep.js
scripts/accept/runtime-data-dep.test.js
```

可能需要调整：

```text
scripts/accept/accept-report.js
scripts/accept/format-fail-explain.js
scripts/lib/sdk.js
```

如果 Runtime Provider 与项目 SDK adaptor 已有合适抽象，应复用真实代码，不重复创建一套。

原则：

```text
先全仓搜索现有 API/user/page runtime collector
再决定最小修改点
```

---

# 27. 不应该修改

原则上不修改 P2-1 已闭环的：

```text
scripts/accept/validate-data-dep.js
scripts/accept/accept-chain.js
schemas/impl.schema.json
schemas/accept-chain.schema.json
```

除非实现过程中发现：

```text
P2-2 所需执行信息在 DataDep Contract 中客观缺失
```

此时不能由 Resolver 猜。

必须：

```text
停止
↓
指出 Contract Gap
↓
回到 P2-1 Contract
↓
明确是否需要 Schema Upgrade
```

不能为了让 Resolver 跑起来偷偷补 fallback。

---

# 28. 第一阶段支持范围

P2-2 第一阶段推荐完整支持：

```text
URL
API
```

并建立：

```text
User / Page Provider Contract
```

如果当前 repository 已有稳定 User/Page Runtime root，则一并完成。

否则：

```text
user/page
```

可以明确返回：

```text
unsupported
```

但不能硬编码业务字段。

原因：

```text
URL/API
都有浏览器层稳定 Runtime Evidence

User/Page
涉及项目 Runtime root 的适配问题
```

这个差异属于事实，不应靠公共 Resolver 猜测填平。

---

# 29. 测试矩阵

## URL

### Case 1

```text
resolved url + query exists
```

Expected：

```text
resolved
value 正确
```

### Case 2

```text
resolved url + query missing
```

Expected：

```text
RUNTIME_URL_QUERY_MISSING
```

### Case 3

```text
expression 写着 location.search
但 status != resolved
```

Expected：

```text
DATADEP_NOT_RESOLVED
```

证明：

```text
不看 expression
```

---

## API

### Case 4

```text
urlIncludes 命中
field 存在
```

Expected：

```text
resolved
```

### Case 5

```text
没有匹配 response
```

Expected：

```text
RUNTIME_API_NOT_CAPTURED
```

### Case 6

```text
response 存在
field 不存在
```

Expected：

```text
RUNTIME_API_FIELD_MISSING
```

### Case 7

```text
多个 response 值冲突
```

Expected：

```text
RUNTIME_API_AMBIGUOUS
```

或者按照已明确的 deterministic time rule 选定一个。

必须在测试中写死，不允许依赖数组偶然顺序。

---

## User

### Case 8

```text
provider available
+
user.path exists
```

Expected：

```text
resolved
```

### Case 9

```text
provider unavailable
```

Expected：

```text
RUNTIME_USER_PROVIDER_UNAVAILABLE
```

禁止：

```text
paramKey → user property hardcode
```

---

## Page

### Case 10

```text
provider unavailable
```

Expected：

```text
RUNTIME_PAGE_PROVIDER_UNAVAILABLE
```

禁止自动：

```text
query DOM
```

---

## Anti-Inference

### Case 11

```json
{
  "paramKey": "housedel_id",
  "expression": "query.housedelCode",
  "sourcePath": "location.search -> housedelCode",
  "status": "needsConfirm"
}
```

Expected：

```text
绝不能解析 URL
```

### Case 12

```json
{
  "paramKey": "price",
  "from": "page",
  "page": {
    "path": "price"
  },
  "expression": "response.data.price",
  "status": "resolved"
}
```

Expected：

```text
只能走 page resolver
绝不能因为 expression 含 response 改走 API
```

这是 P2-2 最重要的 Determinism Test。

---

# 30. Integration Test

必须至少增加一个：

```text
accept-chain
↓
run-accept
↓
Runtime Resolver
↓
Compare
```

闭环测试。

例如：

```text
URL:
?housedelCode=123456

DataDep:
{
  paramKey: "housedel_id",
  from: "url",
  queryKey: "housedelCode",
  status: "resolved"
}

Actual:
action.housedel_id = "123456"
```

Expected：

```text
PASS
```

再测试：

```text
Actual = "999"
```

Expected：

```text
FAIL
expected = 123456
actual = 999
```

---

# 31. Codex 实施顺序

```text
Step 1
全仓搜索：

dataDeps
assertParams
assertParams(
sameish
userExpect
window.__user
queryKey
response
page.on('response')
```

↓

```text
Step 2
确认当前 Runtime collectors：
URL / Network / User / Page
```

↓

```text
Step 3
新增 runtime-data-dep.js
建立统一 Resolver Contract
```

↓

```text
Step 4
先实现 URL Resolver
```

↓

```text
Step 5
实现 API response collector + API Resolver
```

↓

```text
Step 6
把 User/Page 接到现有 Runtime Provider；
不存在稳定 Provider 时显式 unsupported
```

↓

```text
Step 7
重构 run-accept：

assertParams
→ presence check

dataDeps
→ resolve + compare
```

↓

```text
Step 8
删除 housedel_id / agent_ucid / city_id 等业务硬编码
```

↓

```text
Step 9
把 dataDepResults 写入 Runtime Result / Report
```

↓

```text
Step 10
补 unit + integration tests
```

↓

```text
Step 11
运行 P0 / P1 / P2-1 / P2-2 全量测试
```

---

# 32. Codex/cursor 禁止事项

Codex 不得：

```text
1. 根据 expression 推断 from
2. 根据 sourcePath 推断 from
3. 根据 paramKey 推断 selector
4. unknown fallback page
5. URL 读取失败后换 API
6. API 读取失败后换 page
7. 用 Tracking Actual 填 Runtime Expected
8. 为 user/page 写业务字段 hardcode
9. 修改真实业务代码
10. 新增第五个事实 JSON
11. 为了 Runtime 能跑而放宽 P2-1 Gate
12. 自动把 runtime failure 反写成 dataDep.needsConfirm
13. 把 Runtime Actual 当成 impl.json 的新事实
```

---

# 33. Closure 验收标准

只有以下全部满足，P2-2 才算 CLOSED。

## Input Boundary

```text
[ ] Runtime Resolver 只消费 dataDep
[ ] 只执行 status=resolved
[ ] expression 不参与 Resolution
[ ] sourcePath 不参与 Resolution
[ ] paramKey 不参与来源推断
```

## Resolver

```text
[ ] URL 有通用 Resolver
[ ] API 有通用 Resolver
[ ] User 不存在业务字段 hardcode
[ ] Page 不存在 DOM / variable fallback inference
[ ] resolver 不存在 default fallback
```

## Runtime

```text
[ ] DataDep 产生 Runtime Expected Value
[ ] Runtime Source 读取失败有稳定错误码
[ ] Runtime Evidence 与当前 target window 绑定
[ ] API 不读取其它 Path 的陈旧 response
```

## Compare

```text
[ ] Expected 来源独立于 Tracking Actual
[ ] Compare 不再知道 url/api/user/page
[ ] Runtime source missing 不会被判 PASS
[ ] actual missing 不会被 sameish 静默通过
```

## Determinism

```text
[ ] expression/sourcePath 即使与 from 冲突，也只按 from 执行
[ ] 相同 dataDep + 相同 Runtime Evidence 得到相同 Expected
[ ] Claude Code / Codex / Cursor 无需重新理解参数业务语义
```

## Regression

```text
[ ] P0 tests PASS
[ ] P1 tests PASS
[ ] P2-1 tests PASS
[ ] P2-2 tests PASS
[ ] npm test PASS
```

---

# 34. P2-2 完成后的职责链

最终形成：

```text
Parameter Resolution
        │
        │ AI / Static Analysis
        ▼
Parameter Fact
expression / sourcePath / evidence
        │
        │ P2-1
        ▼
resolved DataDep
from + selector
        │
        │ build-accept-chain
        │ validate + copy
        ▼
accept-chain
        │
        │ P2-2 Deterministic Resolver
        ▼
Runtime Expected
        │
        ├──────────────┐
        │              │
        ▼              ▼
Expected Value    Tracking Actual
        │              │
        └──── Compare ─┘
               │
               ▼
         PASS / FAIL
```

其中最重要的边界是：

```text
expression/sourcePath
      ╳
Runtime Resolver
```

而正式关系是：

```text
resolved DataDep
      ↓
Runtime Resolver
```

---

# 35. 最终设计原则

P2-2 不解决：

> “这个参数到底来自哪里？”

这个问题已经在 Parameter Resolution + P2-1 中解决。

P2-2 只解决：

> “既然 DataDep 已经明确说它来自这里，那么浏览器运行时怎样按照这份 Contract 确定性地把值读取出来？”

因此 P2-2 的核心不是增加 AI 能力，而是：

```text
减少 AI
+
统一 Resolver
+
明确 Runtime Context
+
稳定错误码
+
Expected / Actual 解耦
```

最终保证：

```text
Parameter Fact
→ resolved DataDep
→ Runtime Expected
→ Actual Compare
```

整条链只在上游发生一次业务语义判断。

Runtime 阶段不再重新猜测。
