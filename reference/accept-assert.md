# 验收断言规则

断言层：埋点已发出 + 关键参数对账。不做整包字节级比对。

## 发出（必须）

从页面注入的 SDK 主方法包装器采集（默认 `window.$ULOG.send`，按 `_raw/adaptor.json` 的 sdkId 选档案）。发出当时就会抄一份到：页面内存、同域 `sessionStorage`、Playwright binding。点击后立刻跳转也不再只靠新页的 `window.__trackAcceptLogs`。一条通过需同时满足：

- `evtId` 一致
- `eventType` 与文档 / `expect.eventType` 一致（`Module_Click` / `Module_View` / …）
- `uicode` **只以文档 `events.json` 为准**（`expect.uicode` 由建链从文档写入）。文档有值则必须一致；实发为空也 `fail`。禁止用 impl / 现网旧值覆盖 expect
- `pid` 若 `expect` 有值则一致

采集窗口：执行该 target 的 trigger 之后、下一条 trigger 之前。`pageLoad` / `waitVisible` 类在进入页面或前置步骤完成后采集。

click / sharedSteps 的 click：先 `attached` 确认 DOM 存在，再滚入视口（`scrollIntoViewIfNeeded`，失败则 `element.scrollIntoView({ block: 'center' })`），最后再 click。元素在折叠区 / 内部 `overflow` 容器里不算「找不到」。

未采集到 → `fail`，原因 `not_fired`（对用户展示中文「事件未触发」，见 `accept-fail-explain.md`）。跳转后仍无 hook 抄本、也无同域 persist 时才算未发出（GIF 单独断言）。

采集到的整包写入报告 `results[].fired`（eventType / pid / uicode / action），验收 HTML 展示「真实上报」，通过/失败均可查看。

## 上报接口 HTTP

SDK `$ULOG.send` 只证明本地调用了。真正发出看埋点像素：

- 测试：`http://dig.lianjia.com/check.gif`
- 线上：`https://dig.lianjia.com/alliance.gif`

Playwright 监听匹配 URL（档案 `reportUrlIncludes`），按 query `evt` / `evtid` 对上当前 evtId。采集窗口：trigger 之后约 2s。

采集挂在 **BrowserContext**（`request` / `response` / `requestfailed`），不挂在单页 `page`：点击后立刻跳转时，旧文档的 GIF 请求仍能记下来。请求一旦发出即算捕获（`matched=true`）；响应被导航打断、HTTP 非 2xx 只展示、不改 pass/fail。

`results[].http.reasonZh` 必须写清未拿到完整 HTTP 结果的原因（跳页中断 / 仅 hook 拦到 / 见到请求无响应 / 4xx·5xx / 窗口内完全未听到 GIF）。报告「上报接口状态」展示该文案，禁止只留 `status=0` 或英文 `no matching report request`。

另外 init hook 会拦 `HTMLImageElement.src` / `sendBeacon`，把 GIF URL 写入同域 `sessionStorage` 与 Playwright binding，避免只靠 Network 事件。

写入 `results[].http`（status / statusText / ok / url / matched / error），验收 HTML / 终稿展示如 `200 OK`。

| 情况 | 判定 |
|---|---|
| 未捕获匹配 GIF | **fail**。GIF 在引入 SDK 后一定能捕获到；提示用户确认页面是否已引入 dig-log SDK（`lianjiaUlog.js`），并排查脚本未加载、被拦截或未真正发出 |
| HTTP 2xx | 只展示，不改 pass/fail |
| HTTP 非 2xx / requestfailed | 只展示，不改 pass/fail |

未发出 SDK 调用且已捕获到 GIF 时，仍按 `not_fired` 处理（hook / persist / binding 都未采到 `$ULOG.send`）。同域跳转导致页面数组被清空、但 persist 或 binding 仍有记录的，不算这种情况。

## 关键参数（assertParams）

默认断言该事件 `parameters` 里 `confidence` 为 `high` / `medium` 的 key；`low` 或 `unresolved` 只检查 key 是否出现，不对值。

按 `dataDeps.from` 对账：

| from | 期望值 |
|---|---|
| `url` | `action[key]` 等于当前页 query（如 `housedelCode`），空则 `'-'` 也可接受 |
| `user` | 等于 `window.__user` 对应字段（id / officeAddress / officeAddressName） |
| `api` | 若运行时录到匹配 `urlIncludes` 的响应，按 `field` 取值对账；没录到接口则只检查 key 存在且非 `undefined` |
| `page` | 只检查 key 存在；值允许 `'-'` / `false` / `0` |

`'-'` 视为合法兜底，**不判 fail**，但写入报告 `results[].emptyParams`，验收 HTML / 终稿须提醒人工确认。key 缺失 → `fail`，写入 `paramDiffs`；同时也进入 `emptyParams`。

## 空值待确认（needConfirm）

实发值为以下任一即记入 `emptyParams`：

- `'-'`（代码兜底）
- `''` / `null` / `undefined`
- assertParams / dataDeps 声明的 key 在 action 中缺失

`false`、`0` 不算空值。`summary.needConfirm` = 含空值参数的事件数。通过/失败均可带 `emptyParams`；报告顶部与参数格用橙色「待确认」提示，不改写 pass/fail。

## 空值自修复

触发：用户点名「自修复 / 修空值 / 诊断空值」，或 **D 验收失败后用户选择「1 自修复」**。禁止因 `needConfirm > 0` 或 fail>0 擅自开修。

D 失败时的顺序：按 `accept-fail-explain.md` 输出总览（失败 / 通过 / 报告 / C 落点）→ **必须二选一**（1 自修复进 E，失败后自动打开人工矫正页；2 直接重新进入人工矫正页面）→ 未选择则停、不改代码 → 选 1 后只修 **1 轮** → 仍失败则自动打开人工矫正页。

### 诊断（无模型）

```bash
node <skillDir>/scripts/accept/diagnose-empty.js --excel=docs/xxx.xlsx
# 可选：--include-fail 一并收录 fail（paramDiffs / not_fired）
```

产出：`accept/{文档名}-空值修复.json`。`issues[].category` 为启发式，**模型必须对照代码再校正**。

### 分类

| category | 含义 | 默认可自动写 |
|---|---|---|
| `fix_expression` | 表达式 / 接口字段名错或缺失 | 默认可写 `impl.json`；同步改业务源码里的埋点调用须用户确认 |
| `fix_accept_timing` | 验收过早、缺 `waitApis` / `urlIncludes` / trigger 不准 | `impl.accept` → 重建 chain 后重验 |
| `needs_prop_plumb` | 页面有数据、组件未透传 | **只出方案**，改业务源码须用户确认 |
| `needs_product_decision` | 文档口径与现网不一致 | **只标注**，禁止擅自改口径 |
| `data_genuinely_empty` | 该样本房源确实无值 | 不改，报告保留待确认即可 |
| `unknown` | 启发式无法判定 | 模型读代码后再归类 |

### 应用边界

- 脚本 `diagnose-empty.js` **只诊断、不写业务**。
- 自动应用默认允许：`impl.json`、`accept` 相关字段；业务源码一律 `requires_user_confirm`。
- 改完对受影响 `evtId` 跑 `run-accept.js --evt=`，再 `render-final.js`。
- 最多 **1 轮**；重验仍失败或仍空则停止自修复，把验收 HTML 与空值修复 JSON 交给用户，并**自动打开人工矫正页**（禁止整轮 `--no-open`，失败 evt 用 `--force-open`）。禁止为消掉 `needConfirm` 而编造字段、硬编码假数据、或改 Excel 文档口径。

### 与 pass/fail 的关系

自修复针对 `emptyParams`（及可选的 fail）。空值本身**不改写**原验收的 pass；修表达式后重验，以新报告为准。

## 接口等待

target 若声明 `dataDeps` 且 `from=api` 且有 `urlIncludes`：trigger 前尽量等到该请求（超时不阻断发出断言，报告里标 `api_missed`）。

## skip

- `impl.status` 不是 `existing`（未落地）→ 终稿「未落地」
- 无 `targetFile` / 缺 `pageKey` 或 `accept.trigger.kind`（进 chain `pending`）→ 终稿「有埋点但验不了」
- `--evt` 过滤未选中
- **路径跳过**（`path_blocker`）：同 path 上本条 click 会阻断后续（离开页面 / 点完后下一条找不到），脚本自动 skip 并写 `skipReason`，恢复种子页后继续。`--skip-evt` 供对话模型补跑时强制跳过
- `--plan-only`

skip 不计入 fail。路径跳过不阻止生成终稿。

## 运行环境

- `baseUrl` 从仓库根目录 `.env` 读取（`--base-url` 可覆盖）
- Playwright 设备须由用户选择：`--device=mobile`（iPhone 13，390×844，touch + iPhone UA）或 `--device=pc`（1440×900 桌面 UA）；也可写 `.env` 的 `acceptDevice`。未指定时脚本退出并打印二选一提示，禁止默认开手机视口。有头打开；浏览器优先本机 Chrome
- 登录：先打开目标页；若跳到 `login.ke.com` / SSO，等你在窗口里登完（最多 5 分钟），再把登录态写到 `docs/tracking/.auth/storage.json`，下次直接复用
- 登录态失效会再次停住等登录，然后继续验收
