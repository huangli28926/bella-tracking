# 关键路径验收规则

从矫正后的 `impl.json` 聚合 Playwright 精点路径。Excel / `events.json` 只作清单兜底，不按「页面名称」过滤。

**项目无关：** 引擎不硬编码任何 pageKey / Tab / locator / evtId。入口步骤与定位器一律由**对话模型根据代码**写入 `impl.json` 的 `accept`（及 `pageKey`）。用户无需配置文件。

## 目标

- 只点击验收目标埋点需要的步骤，禁止整页探索 / 随机点击
- 同页同入口、相同前置步骤的埋点聚成一条 path
- 会离开当前页的点击拆成独立 path，避免污染后续断言。`navigatesAway` **只拆 path、不拦跳转**；采集靠跨页抄本（sessionStorage / binding），不要改业务代码推迟跳转

## 输入优先级

1. 事件上已写的 `pageKey` + `accept`（模型根据代码填写，或人工矫正）
2. `events.json` 的 `eventType` / `uicode` / `evtId` 清单（无落点 / 无 accept → `pending`）

禁止：

- 用文档「页面名称」当路由
- 在 `accept-chain.js` 或项目配置里写死业务 locator / 入口步骤
- 缺 `accept.trigger` 时用 evtId 表猜定位器

## 模型必须写入的字段

每条可验收事件（`status` 为 `existing` / `located`）在 `impl.json` 中应具备：

| 字段 | 来源 | 说明 |
|---|---|---|
| `pageKey` | 读路由 / 页面目录 | 逻辑页标识，用于聚类；非文档「页面名称」 |
| `accept.trigger.kind` | `lifecycle` | `click` / `scrollIntoView` / `waitVisible` / `pageLoad` |
| `accept.trigger.by` + `value` | 代码 `data-testid` > insertHint 文案 > 事件名 | `pageLoad` 可空 value |
| `accept.trigger.alternates` | 同控件多文案 | 可选 |
| `accept.trigger.preconditions`（或 `accept.sharedSteps`） | 从 seed 到控件的最少点击 | 同页无前置则 `[]` |
| `accept.navigatesAway` | 点击后是否离开当前页 | 布尔；缺省按 `false` |
| `accept.assertParams` / `dataDeps` | 参数对账 | 可从已解析 parameters 整理 |

### 触发 kind

| lifecycle | kind | 说明 |
|---|---|---|
| `onClick` | `click` | 先确认 DOM 存在，滚入视口后再点目标文案 / testid |
| `IntersectionObserver` | `scrollIntoView` | 滚到模块，不伪造 click |
| `useEffect` | `waitVisible` 或 `pageLoad` | 数据到达 / 模块可见后等埋点发出 |
| 其它 | `pageLoad` | 进入页面即可 |

### 定位器优先级

`data-testid` > 示意图 / `insertHint` 可见文案 > 事件名称。禁止用不稳定 class 当主定位（除非无 testid 且文案不稳定、已注明）。

### 前置步骤（sharedSteps）

由落点组件与路由跳转代码决定，不由事件名称决定：

- 读 `targetFile`、父页面 Tab / 入口按钮、`history.push` / `Link` 等，写出从 **seedUrl** 到该控件的最少步骤
- 子页禁止直开精简 URL：步骤里应包含从种子页点进去的 click + 可选 `waitUrl`
- 同页默认 Tab / 头卡无前置 → `preconditions: []`
- **旧页新埋点**：先跑 `scripts/accept/resolve-entry-path.js`，倒推到达该页的入边，再和 `trackingBaseline`（缺省 `master`）diff 对比跳转是否本期新增。**不要由模型直接选定最终路径。** 把候选写入 `accept.candidatePaths`，跑 `scripts/accept/resolve-accept-path.js`（或由 `lockMode` 消费同一套规则）：
  - `new_jump`：只把新增跳转写成主验收前置（从 seed 走到 `from` 页，再点该跳转）。**`.env` `trackingMode=backfill` 时不要采用 `new_jump`**，即使 diff 里有新跳转也改走下面三条之一（旧页补点）
  - `existing_shortest`：没有新跳转且候选唯一时（或 backfill 收敛后唯一），用 seed→已有最短入边
  - `seed_is_page`：`preconditions: []`
  - `no_inbound`：仓内静态扫不到入边，按 seed 直达该页写，不要编仓内不存在的按钮
  - `needs_confirm`：多条历史路径或同级新增路径无法唯一收敛。列出候选请用户选一次，把 `accept.pathResolution`（`selectedPathId` + `candidateSignature` + `decision.context`）写入 `impl.json`。禁止 Agent 凭「更常见 / 更短 / 更好跑」自行挑选
  该脚本不发明 locator；click 的 `by`/`value` 仍按「定位器优先级」从代码填写。`trackingMode` 未配置时行为与原来一致（可出 `new_jump`）

### 页面入口

所有 path **只打开一次种子入口**（`.env` 的 `seedUrl`，path + 全部 query 原样保留）。禁止按落点页另拼精简 URL。

`baseUrl` 只提供 origin。业务 query（如房源号）从 `seedUrl` 解析；`--housedel=` 只替换这一 query，其它参数保留。子页额外参数由页面跳转带上，runner 不直开子页。

## 引擎职责（`build-accept-chain.js`）

1. 校验：缺 `pageKey` 或 `accept.trigger.kind`（及非 pageLoad 的 locator）→ `pending`
2. `pageKey` + `sharedSteps` 相同 → 一条 path
3. path 内顺序：`pageLoad` / `waitVisible` / `scrollIntoView` 先于 `click`
4. `navigatesAway === true` 的 click 单独成 path，仍复用同一 `sharedSteps`
5. 一条 path 跑完若发生跳转，下一条 path **重新 `goto` 种子入口**，再走 sharedSteps
6. 同一条 path 内：某条 click 失败且把后续目标挡掉（或未标 `navigatesAway` 却离开当前页），runner **跳过本条**（报告 `skip` + 原因），**不中断**后续 target；必要时 `goto(seed)` + sharedSteps 再验下一条
7. Runtime 失败不得改选另一条 Candidate。报告路径执行失败后回到路径分析，禁止 `run-accept` 重新推理事实

`--write-impl`：仅把链上已解析结果规范化写回；**不覆盖**已有 `accept.trigger.kind` 与 `hint`；**不发明**缺失的 locator。`pathId` 由规范化语义路径哈希计算，禁止用数组下标当长期 ID。

## 精点约束

- `targets` 之外的按钮一律不点
- 弹层只在 trigger 本身是打开弹层时才点；不要顺手关广告 / 乱点遮罩
- View 类禁止用 click 代替曝光
- `--evt=95941,95942` 时：只保留包含这些 evtId 的 path，并丢掉 path 内其它 target
