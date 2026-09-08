# P0-4 Closure：Accept Path Determinism

## 1. 问题定义

### 1.1 P0-4 要解决什么

`bella-tracking` 在生成 `accept-chain.json` 时，需要从 `seedUrl` 到当前埋点目标状态构建一条可执行的验收路径。

真实项目中，同一个目标状态通常可能存在多条合法路径：

```text
seedUrl
├─ Path A
│  └─ Page A
│     └─ Target
│
└─ Path B
   └─ Page B
      └─ Target
```

如果路径选择依赖 Agent 自由判断，则：

```text
Cursor → Path A
Codex  → Path B
Claude → Path A / Path C
```

即使三条路径业务上都能到达目标，也会导致：

* `accept-chain.json` 不稳定
* Playwright 执行步骤不稳定
* locator 不稳定
* sharedSteps 不稳定
* Runtime 验收结果难以复现
* 跨 Agent 执行结果不一致
* 同一个需求重复执行时出现新的人工确认

因此 P0-4 的核心问题不是：

> “如何让 AI 找到一条能跑通的路径？”

而是：

> **在存在多个合法候选路径时，如何通过确定性规则收敛成唯一的 Accept Path，并把必要的人类决策持久化成可复用事实。**

---

# 2. 当前正式方案

当前正式主链路保持不变：

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
Playwright Runtime
↓
Runtime Actual
↓
Expected / Actual Compare
↓
验收报告
```

P0-4 不新增平行事实层。

主要修改发生在：

```text
impl.json
        ↓
build-accept-chain
        ↓
Accept Path Candidate Resolution
        ↓
accept-chain.json
```

即：

> **强化 `build-accept-chain` 阶段的路径选择确定性。**

---

# 3. 设计原则

Accept Path 的确定必须遵守：

```text
真实源码 / 路由事实
>
已确认结构化事实
>
本期代码变更事实
>
历史确认结果
>
Agent 推断
```

其中最重要的原则是：

> **能够由程序确定的路径，不让 Agent 自由选择。**

Agent 可以负责发现候选路径和理解业务语义。

最终路径选择必须尽量由：

```text
候选集合
+
确定性排序规则
+
人工 Gate
+
持久化事实
```

共同完成。

---

# 4. Accept Path 的基本模型

对于某条待验收事件：

```text
seedUrl
↓
sharedSteps[]
↓
Target State
↓
trigger
↓
expected event
```

其中：

```text
sharedSteps
=
到达目标业务状态的前置操作
```

而：

```text
trigger
=
真正触发当前埋点的最后动作
```

两者必须严格区分。

例如：

```text
seedUrl
↓
点击“二手房”
↓
进入列表页
↓
展开卡片
↓
scrollIntoView
↓
Module_View
```

则：

```text
sharedSteps:
1. 点击“二手房”
2. 进入列表页
3. 展开卡片
```

真正的：

```text
trigger:
scrollIntoView
```

不能为了简化 Playwright，把真实曝光逻辑改成：

```text
click
```

---

# 5. Candidate Path

`build-accept-chain` 不应该直接生成最终路径。

首先应生成：

```text
Candidate Path Set
```

例如：

```text
Target = DealRangeCard
```

源码分析得到：

```text
Candidate A
seedUrl
→ 首页
→ 二手房 Tab
→ 列表页
→ DealRangeCard

Candidate B
seedUrl
→ 搜索页
→ 搜索结果
→ DealRangeCard

Candidate C
seedUrl
→ 收藏页
→ DealRangeCard
```

程序首先回答：

> 哪些路径从现有源码和路由关系上能够到达 Target？

而不是直接回答：

> 最终使用哪条？

---

# 6. 第一类场景：本期新增代码

对于**本期新增或修改的业务链路**，路径选择采用确定性规则。

## 6.1 核心规则

在：

```text
能够到达当前 target 的候选路径集合
```

中：

> **优先选择包含本期新增有效跳转边的路径。**

例如本期新增：

```text
Home
→ NewTab
→ DetailPage
```

而 `DetailPage` 原本已经存在另一条历史入口：

```text
Search
→ DetailPage
```

则候选路径为：

```text
Path A

Home
→ NewTab        ← 本期新增 edge
→ DetailPage
→ Target
```

以及：

```text
Path B

Search
→ DetailPage
→ Target
```

默认选择：

```text
Path A
```

原因不是：

```text
Path A 更短
```

也不是：

```text
Agent 觉得 Path A 更符合业务
```

而是：

```text
Path A 覆盖了本期新增业务事实
```

---

# 7. 什么叫“本期新增有效跳转边”

必须避免仅根据 Git diff 中出现代码就判定为新增路径。

一个 edge 必须同时满足：

```text
source
+
action
+
target
+
真实调用 / 路由证据
```

才能认为是：

```text
effective navigation edge
```

例如：

```text
HomePage
-- click「查看详情」 -->
DetailPage
```

需要至少能够从源码确认：

```text
UI / handler
+
navigate / router.push / href
+
目标 route
```

而不是看到：

```js
router.push(...)
```

就直接认为存在业务路径。

推荐结构：

```json
{
  "from": "home",
  "to": "detail",
  "action": "click",
  "sourceFile": "src/pages/home/index.tsx",
  "evidence": [
    "jsx",
    "handler",
    "router"
  ],
  "changeStatus": "added"
}
```

---

# 8. 新增代码路径唯一性规则

对于本期新增代码，推荐按以下优先级排序：

```text
1. 路径能够到达 target
2. 路径包含本期新增有效 edge
3. 本期新增 edge 与当前 target 属于同一业务变化链
4. 路径事实完整
5. 路径可执行
6. 路径步骤更少
7. 稳定 locator 更多
8. 最后才进行稳定 tie-break
```

注意：

```text
最短路径
```

不是第一优先级。

因为：

```text
历史旧路径可能更短
```

但本次真正需要验收的是：

```text
新代码是否完成了新的业务链路
```

---

# 9. 同时存在多条新增路径

例如：

```text
Path A
Home
→ 新入口 A
→ Target

Path B
Home
→ 新入口 B
→ Target
```

两条都包含本期新增 edge。

这时不能重新退化成：

```text
让 Agent 随便选择
```

必须继续使用确定性规则排序。

例如：

```text
score =
change relevance
+
business reachability
+
runtime executability
+
locator stability
+
path length
```

但评分维度必须由程序固定。

Agent 只能提供证据，不能修改排序规则。

最终仍然无法唯一确定时：

```text
needsConfirm = true
```

进入人工 Gate。

---

# 10. 第二类场景：历史代码

历史代码不存在：

```text
本期新增 edge
```

因此不能使用：

```text
优先新增路径
```

的规则。

例如历史 Target 有：

```text
Path A
Home
→ List
→ Detail

Path B
Search
→ Detail

Path C
Favorite
→ Detail
```

三条路径都真实存在。

此时：

```text
源码
```

只能证明：

```text
这些路径都能到达目标
```

却无法证明：

```text
产品验收应该使用哪一条
```

这是一个业务选择，而不是代码事实。

因此不能让 AI 假装确定。

---

# 11. 历史路径的处理规则

对于历史路径：

```text
candidateCount == 1
```

则：

```text
自动选择
```

如果：

```text
candidateCount > 1
```

且没有足够强的确定性事实可以唯一收敛：

```text
needsConfirm = true
```

由用户进行一次选择。

例如：

```text
请选择 DealRangeCard 的验收入口：

A.
首页
→ 二手房
→ 列表
→ Target

B.
搜索页
→ 搜索结果
→ Target

C.
收藏页
→ Target
```

用户选择：

```text
A
```

之后该决定需要持久化。

---

# 12. 为什么人工选择要持久化

假设第一次在 Cursor 中：

```text
Candidate A
Candidate B
Candidate C
```

用户已经确认：

```text
Candidate A
```

如果这个决定没有进入结构化事实，则下一次换成：

```text
Codex
```

Codex 仍然只能看到：

```text
A / B / C
```

于是它会：

```text
重新推理
```

甚至：

```text
再次询问用户
```

这意味着：

```text
跨 Agent 不稳定
```

真正的问题不是：

> Agent 是否记得用户选择？

而是：

> **用户选择是否已经成为系统事实。**

因此：

```text
Human Decision
↓
Structured Fact
↓
Next Agent Reads Fact
```

才是正确模型。

---

# 13. 历史选择不是永久无条件复用

持久化并不意味着：

```text
用户选过 Path A
→ 永远使用 Path A
```

这是错误设计。

历史选择只能在它的适用前提仍然成立时复用。

正确逻辑是：

```text
历史选择
+
当前路径事实校验
↓
仍然有效？
├─ yes → 复用
└─ no  → 重新计算 / 人工确认
```

---

# 14. Historical Decision 的适用条件

一次人工选择应该携带自己的适用上下文。

例如：

```json
{
  "selectedPathId": "path-home-list-detail",
  "decisionSource": "human",
  "decisionReason": "preferred business entry",
  "context": {
    "pageKey": "detail",
    "target": "DealRangeCard",
    "seedUrlKey": "default",
    "candidateSignature": "..."
  }
}
```

下一次执行时必须验证：

```text
selected path 是否仍存在
selected path 是否仍能到达 target
相关 route 是否仍存在
关键 edge 是否仍存在
locator 是否仍然可执行
target 是否发生迁移
seedUrl 上下文是否发生变化
```

任一核心事实失效：

```text
历史选择失效
```

重新进入 Candidate Resolution。

---

# 15. 历史选择的状态

建议至少区分：

```text
valid
stale
invalid
superseded
```

例如：

### valid

路径仍然存在并适用于当前目标。

```text
直接复用
```

### stale

代码发生相关修改，历史选择可能仍有效，但需要重新验证。

```text
重新检查
```

### invalid

路径已经不存在。

```text
不能复用
```

### superseded

本期出现新的业务链路，根据新增代码规则已经有更高优先级路径。

```text
新路径覆盖历史选择
```

但保留历史 decision 作为审计记录。

---

# 16. 新增路径与历史选择冲突

这是 P0-4 的关键规则。

假设历史上用户选择：

```text
Search
→ Detail
```

后来本期新增：

```text
Home
→ NewEntry
→ Detail
```

此时不能因为存在历史选择，就继续强制使用：

```text
Search
→ Detail
```

否则新的业务入口不会被验收。

正确规则：

```text
本期新增有效路径事实
>
历史人工路径偏好
```

即：

```text
Candidate A
Search
→ Detail
historical selected

Candidate B
Home
→ NewEntry
→ Detail
contains current change
```

选择：

```text
Candidate B
```

同时将旧的历史选择标记为：

```text
superseded
```

而不是删除。

---

# 17. 推荐 Path Resolution 状态机

```text
Build Candidate Paths
        ↓
candidateCount == 0 ?
├─ yes
│   ↓
│ needsConfirm = true
│ unresolved = no reachable path
│
└─ no
    ↓
是否存在本期新增有效 edge？
    │
    ├─ yes
    │   ↓
    │ 筛选包含相关新增 edge 的候选
    │   ↓
    │ 唯一？
    │   ├─ yes → SELECT
    │   └─ no
    │       ↓
    │   deterministic ranking
    │       ↓
    │   唯一？
    │       ├─ yes → SELECT
    │       └─ no → HUMAN GATE
    │
    └─ no
        ↓
是否存在仍然有效的历史 confirmed decision？
        │
        ├─ yes → SELECT
        │
        └─ no
            ↓
        candidateCount == 1 ?
            ├─ yes → SELECT
            └─ no → HUMAN GATE
```

---

# 18. Path ID

不能使用数组下标：

```text
path-1
path-2
```

作为长期路径标识。

因为候选排序一旦改变：

```text
path-1
```

可能代表另一条路径。

Path ID 应由路径事实稳定计算。

例如：

```text
seed
→ home
→ click:second_hand_tab
→ list
→ target:deal_range_card
```

生成：

```text
SHA256(normalizedPath)
```

或稳定字符串：

```text
home__second-hand-tab__list__deal-range-card
```

建议：

```text
pathId
=
hash(normalized semantic path)
```

---

# 19. Candidate Signature

除了单一路径 `pathId`，还建议记录候选集合签名：

```text
candidateSignature
```

例如：

```text
sort(candidate.pathId)
↓
join
↓
hash
```

作用是判断：

> 当前候选环境是否已经发生变化。

例如原来：

```text
A
B
```

用户选择：

```text
A
```

后来代码新增：

```text
C
```

则：

```text
candidateSignature
```

发生变化。

系统可以重新判断：

```text
历史 decision 是否仍然应该直接复用
```

而不是无条件沿用。

---

# 20. 建议的数据结构

P0-4 不建议新增第五个核心事实层。

路径决策可以作为：

```text
acceptance related implementation semantics
```

进入 `impl.json`，随后由 `build-accept-chain` 消费。

例如：

```json
{
  "eventKey": "deal-range-view",
  "targetFile": "src/xxx",
  "functionName": "xxx",
  "lifecycle": "exposure",

  "accept": {
    "pageKey": "detail",

    "pathResolution": {
      "status": "resolved",
      "selectedPathId": "abc123",

      "selectedBy": "current-change",

      "candidateSignature": "def456",

      "decision": {
        "source": "deterministic-rule",
        "reason": "contains-current-change-edge"
      },

      "unresolved": []
    }
  }
}
```

历史人工选择：

```json
{
  "pathResolution": {
    "status": "resolved",
    "selectedPathId": "abc123",

    "selectedBy": "historical-human-decision",

    "candidateSignature": "def456",

    "decision": {
      "source": "human",
      "reason": "confirmed acceptance entry"
    }
  }
}
```

---

# 21. `accept-chain.json` 的职责

`impl.json`：

```text
记录最终路径选择事实及决策来源
```

`accept-chain.json`：

```text
记录已经展开后的可执行步骤
```

即：

```text
impl.json
selectedPath
↓
build-accept-chain
↓
sharedSteps
trigger
locator
expected
```

不要让 `run-accept` 再次从候选路径中做选择。

`run-accept` 只负责：

```text
执行事实
```

而不是：

```text
重新推理事实
```

---

# 22. build-accept-chain 的职责边界

## AI 可以负责

```text
发现业务候选路径
理解 UI → handler → route 关系
理解组件调用关系
识别候选路径业务语义
提供候选 evidence
```

---

## 确定性程序负责

```text
Candidate Path 标准化
Path ID
Candidate Signature
变更 edge 判断
路径优先级
历史 decision 校验
tie-break
Schema 校验
needsConfirm Gate
```

---

## 人工负责

只有以下情况进入人工确认：

```text
多个历史路径无法从代码事实唯一确定
新增路径仍然存在同等级候选
路径业务语义存在歧义
历史 decision 已失效
关键 locator 无法可靠确定
```

---

# 23. 不允许 Agent 做什么

禁止：

```text
“Path A 看起来最合理，所以选择 A”
```

禁止：

```text
“Path A 比较符合常见用户操作”
```

禁止：

```text
“Path A 更简单，所以选择 A”
```

除非：

```text
简单 / 路径长度
```

本身已经是确定性排序规则的一部分，并且优先级明确固定。

也禁止 Agent：

```text
修改 accept-chain 使 Playwright 更容易执行
```

而改变真实业务路径。

---

# 24. tie-break 规则

如果所有更高优先级事实完全一致，可以使用纯确定性 tie-break。

例如：

```text
1. path cost
2. stable locator count
3. normalized path lexical order
4. pathId lexical order
```

最后一级必须保证：

```text
Cursor
Codex
Claude
```

拿到同一 Candidate Set 时：

```text
100% 得到相同结果
```

而不是依赖模型概率。

---

# 25. needsConfirm Gate

以下任何情况必须：

```text
needsConfirm = true
```

### 情况 1

```text
没有任何 reachable path
```

### 情况 2

```text
多个候选路径经过确定性规则后仍无法唯一收敛
```

### 情况 3

```text
历史人工选择对应路径已不存在
```

### 情况 4

```text
当前 target / pageKey / seedUrl 与 decision context 不再一致
```

### 情况 5

```text
路径存在，但关键步骤没有可靠 locator
```

### 情况 6

```text
源码与已有结构化事实冲突
```

此时：

```text
不要生成假 sharedSteps
不要构造假 locator
不要偷偷选择一个 candidate
```

---

# 26. Runtime 失败如何处理

即使静态阶段已经确定唯一 Accept Path：

```text
run-accept
```

仍可能执行失败。

例如：

```text
locator 不存在
route 改变
页面状态改变
登录态失效
动态数据不足
target 不出现
```

此时不能：

```text
自动切换到 Candidate B
```

因为这样 Runtime 又开始重新决定事实。

正确行为：

```text
Runtime Failure
↓
标记当前 Path execution failure
↓
回到 path analysis
↓
判断：
implementation mismatch
path fact stale
locator stale
environment failure
```

必要时重新生成 Candidate Set。

---

# 27. Expected / Actual 原则

即使另一条路径能够成功产生相同 event，也不能自动说明当前路径事实错误。

必须区分：

```text
Event correctness
```

与：

```text
Acceptance Path correctness
```

例如：

```text
Path A 失败
Path B 能产生 Module_View
```

不能自动把验收路径从 A 改成 B。

应报告：

```text
PENDING / FAIL

reason:
accept path execution mismatch
```

再重新分析路径事实。

---

# 28. 对现有 Schema 的影响

## events.json

```text
无影响
```

它仍然只表达：

```text
需求要求上报什么
```

---

## adaptor.json

可扩展但非必须。

可以提供：

```text
route graph
navigation rules
page entry hints
```

帮助 Candidate Discovery。

---

## impl.json

建议扩展：

```text
accept.pathResolution
```

表达：

```text
selectedPathId
candidateSignature
decision source
decision reason
status
unresolved
```

---

## accept-chain.json

保持职责：

```text
可执行验收路径
```

可增加：

```json
{
  "pathId": "...",
  "pathDecisionSource": "current-change"
}
```

用于审计。

---

# 29. 对 scripts 的影响

建议新增或拆出：

```text
scripts/
├── build-accept-chain
├── resolve-accept-path
├── validate-accept-path
└── run-accept
```

其中：

### resolve-accept-path

输入：

```text
impl
route graph
candidate paths
git change facts
historical decisions
```

输出：

```text
selectedPath
或
needsConfirm
```

---

### validate-accept-path

确定性检查：

```text
pathId 存在
path 可以到达 target
所有 edge 存在
selectedPath 属于 Candidate Set
decision context 未失效
sharedSteps 可展开
trigger 独立存在
```

---

# 30. 对 workflow 的影响

`build-accept-chain` 阶段由：

```text
直接构建 sharedSteps
```

调整为：

```text
发现候选路径
↓
resolve-accept-path
↓
needsConfirm ?
├─ yes → Human Gate
└─ no
↓
锁定 selectedPath
↓
生成 sharedSteps
↓
生成 trigger
↓
accept-chain.json
```

---

# 31. Human Gate 输出

进入人工 Gate 时不要让用户重新理解代码。

应输出结构化 Candidate。

例如：

```text
事件：
DealRangeCard_View

Target：
DealRangeCard

候选路径：

[A]
首页
→ 二手房 Tab
→ 列表
→ DealRangeCard

证据：
- route xxx
- handler xxx
- component reference xxx


[B]
搜索页
→ 搜索结果
→ DealRangeCard

证据：
- route xxx
- handler xxx
- component reference xxx
```

用户只需要：

```text
选择 A / B
```

而不是重新做代码分析。

---

# 32. 用户选择后的处理

用户确认：

```text
A
```

系统执行：

```text
Human Decision
↓
selectedPathId
↓
decision context
↓
candidateSignature
↓
impl.json
```

之后：

```text
Cursor
Codex
Claude
```

都消费同一事实。

原则：

> **Agent 不记忆选择，Repository 记忆选择。**

---

# 33. 为什么这能解决跨 Agent 不稳定

修复前：

```text
Source Code
↓
Agent
↓
Agent chooses path
```

结果：

```text
模型行为决定系统行为
```

修复后：

```text
Source Code
↓
Candidate Paths
↓
Deterministic Resolver
↓
Human Gate when necessary
↓
Persisted Decision
↓
Accept Path
```

结果：

```text
结构化事实决定系统行为
```

Agent 仅参与：

```text
无法完全规则化的候选发现
```

而不再拥有：

```text
最终自由决策权
```

---

# 34. Closure 验收标准

P0-4 只有满足以下条件才能视为 Closure。

## 34.1 同一代码版本重复执行

连续执行：

```text
3 次
```

生成：

```text
selectedPathId
```

必须一致。

---

## 34.2 跨 Agent 执行

分别使用：

```text
Cursor
Codex
Claude Code
```

同一代码版本、同一输入下：

```text
selectedPathId
```

必须一致。

---

## 34.3 新增业务路径

当：

```text
历史路径 A
+
本期新增路径 B
```

都可到达 target：

```text
必须选择 B
```

如果 B 包含本期相关新增有效 edge。

---

## 34.4 历史多路径

如果没有新增 edge，存在两个以上等价候选：

```text
禁止 Agent 自由选择
```

必须：

```text
needsConfirm = true
```

---

## 34.5 人工确认复用

人工选择后再次执行：

```text
不得再次询问
```

前提：

```text
decision context 仍然有效
```

---

## 34.6 历史选择失效

如果相关路径被删除：

```text
禁止继续复用
```

必须重新进入：

```text
Candidate Resolution
```

---

## 34.7 新路径覆盖历史选择

存在历史人工选择 A，本期新增明确业务路径 B：

```text
B 应成为当前 selectedPath
```

历史 A：

```text
保留记录
+
标记 superseded
```

---

## 34.8 Runtime 失败

当前选定路径运行失败时：

```text
禁止 run-accept 自动更换另一条路径
```

必须输出明确失败原因。

---

# 35. 建议自动化测试

至少覆盖以下测试：

```text
case 1
single candidate
→ auto select

case 2
multiple candidates
+ one current-change path
→ select current-change path

case 3
multiple current-change candidates
+ deterministic priority
→ stable result

case 4
historical multiple candidates
+ no decision
→ needsConfirm

case 5
historical decision still valid
→ reuse

case 6
historical decision path removed
→ invalidate

case 7
historical decision exists
+ new current-change path
→ new path supersedes history

case 8
same candidate set different ordering
→ same selectedPathId

case 9
run-accept fails
→ no automatic path fallback
```

---

# 36. Non-Goals

P0-4 不解决：

```text
如何自动生成完美 locator
如何自动理解所有业务流程
如何穷举整个网站
如何保证所有页面都可自动操作
如何替代 Runtime
```

P0-4 只解决：

> **已经发现多个可达路径后，如何稳定地产生唯一 Accept Path。**

---

# 37. 最终规则

可以将 P0-4 收敛为以下规则：

```text
1.
先生成所有真实可达的 Candidate Paths。

2.
对于本期新增代码：
在能够到达当前 target 的候选路径集合中，
优先选择包含本期相关新增有效跳转边的路径。

3.
如果仍存在多个同优先级候选：
使用固定的确定性规则继续排序。

4.
如果仍无法唯一确定：
needsConfirm = true。

5.
对于历史代码：
如果存在唯一 Candidate，自动选择。

6.
如果历史代码存在多个合法 Candidate，
且代码事实无法决定业务首选路径：
进入人工 Gate。

7.
人工选择必须持久化成结构化事实，
供 Cursor / Codex / Claude Code 共同消费。

8.
历史选择不是永久无条件复用。
每次复用前必须验证其适用上下文。

9.
本期新增有效业务路径的优先级
高于历史路径偏好。

10.
run-accept 只执行已经确定的路径，
不得在 Runtime 阶段自动切换 Candidate。
```

---

# 38. P0-4 Closure 后的稳定边界

完成 P0-4 后：

```text
AI
=
发现候选路径
理解业务语义
提供 evidence
```

```text
程序
=
路径标准化
变更检测
Candidate Ranking
Path ID
Decision Validation
Gate
```

```text
人工
=
只解决无法从事实确定的业务路径歧义
```

```text
Repository Fact
=
保存最终选择及其适用上下文
```

最终形成：

```text
Source Evidence
↓
Candidate Paths
↓
Deterministic Resolution
↓
Human Gate if necessary
↓
Persisted Path Decision
↓
accept-chain.json
↓
Playwright Runtime
```

这使 Accept Path 从：

```text
Agent 推理结果
```

正式变成：

```text
可验证
可持久化
可失效
可审计
跨 Agent 可复现
```

的工程事实。

---

# 39. Closure 结论

P0-4 的最终目标不是：

```text
永远不需要人工选择
```

而是：

```text
能够确定的路径，由程序唯一确定；

不能确定的路径，只人工选择一次；

人工选择进入事实层；

事实发生变化时，旧选择自动失效或重新评估；

不同 Agent 不再重复推理同一个路径决策。
```

因此 P0-4 的最终 Closure 标准可以概括为：

> **同一份源码、同一份结构化事实、同一份变更事实，在 Cursor / Codex / Claude Code 中必须得到相同的 Accept Path；只有业务事实本身无法唯一决定路径时，才允许进入 Human Gate。**
