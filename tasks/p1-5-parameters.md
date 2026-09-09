# P1-5 Parameter Resolution Determinism Closure

## 1. 方案状态

```text
状态：已拍板收敛（schema / validator / closure tests）
日期：2026-09-09
```

本方案不改变正式主链路：

```text
Excel → parse_xlsx → events.json → adaptor.json
→ 代码定位 + 参数解析 → impl.json → validate-impl
→ needsConfirm Gate → 代码实现 → accept-chain → run-accept
```

P1-5 只增强 `impl.json.parameters[]` 的解析、规范化与门禁输入。不新增第五个独立事实层。

核心事实层仍然是：`events.json` / `adaptor.json` / `impl.json` / `accept-chain.json`。

第一版 **不改确认 UI**：内部使用结构化 `unresolved.code`，对外映射现有 `请确认参数 {key} 的取值`。

---

# 2. 核心问题与目标

问题不是 AI 不会推理，而是推理结果没有统一变成可验证事实，导致 confidence / READY 漂移、大量 needsConfirm。

目标：

```text
Inference 最大化，Fact 标准化，Confidence 确定化，Human Confirmation 最小化。
```

允许不同 Agent 推理过程不同。不允许同一组已规范化事实得出不同 Gate。

跨 Agent 一致性分两层：

1. **给定同一 candidate/evidence 包** → confidence 与 Gate 必须相同。
2. **给定同一 xlsx + 源码 + 图** → 扫描候选集合必须相同；允许 preferred / 分析文案不同；不得一方 READY、一方 NEEDS_CONFIRM。

---

# 3. 已拍板规则（不可回退）

## 3.1 语义匹配选 C

同 `parameter.key` 的已有埋点候选必须由 **确定性扫描完整列出**。

AI 只做：

- `descriptionSemanticCompatible`
- `preferred` 排序

AI **不得丢弃**竞争候选。语义不兼容的候选仍保留在 `candidates[]`，标记 `rejectedReason=semantic-incompatible`，不进入该档 uniqueness 池。

## 3.2 跨优先级：高优先级唯一候选优先

只在 **同一优先级档内** 判断 source conflict。

same-component 已有唯一合法（扫描存在 + 语义兼容）source 时，不得因为 same-page 还有其他候选而 NEEDS_CONFIRM。

## 3.3 多跳 acquisition 逐步 AND

`pathUniqueness` 与 `impact.referenceCount` 对 **每一步** 判定。任意中间节点 `referenceCount > 1` → 第一版 `IMPLEMENTATION_IMPACT_CONFIRM`，不自动改公共组件 API。

## 3.4 第一版自动 READY 范围

| 情况 | Gate |
|---|---|
| `scopeReachable===true`（程序计算）且 source 档内 unique、无 conflict | READY |
| prop-pass 单跳或多跳：每跳 JSX/reference 静态可证，且每步 `referenceCount===1` | READY |
| hook/context：hook 或 Context、Provider、target 关系静态闭环 | READY |
| URL：字段真实存在，且业务语义有 Strong Evidence 闭环（不能只靠字段名相似） | READY |
| 新 API、shared component、uniqueness unknown、语义无法闭环、同档多源 | NEEDS_CONFIRM |

## 3.5 程序独占字段

AI **禁止**写入最终值（normalize 阶段覆盖）：

- `scopeReachable`：AST / 作用域分析
- `confidence`：`calculate-confidence`
- `sourceUniqueness` / `pathUniqueness` / `impact.referenceCount`
- `parameterImplementable`
- `acquisition.status`（validate-acquisition 输出）
- 对外 `event.unresolved[]` 文案（由 code 映射）

## 3.6 职责切分

```text
AI：找全候选、图片消歧排序、description 语义、Lineage、提出 Acquisition
程序：候选完整性、可达性、唯一性、影响面、Evidence 字段校验、confidence、Gate
```

---

# 4. 目录结构（落地时，待写代码指令后再改仓库）

```text
schemas/
  impl.schema.json                          # 扩展 parameter（本方案字段）
scripts/
  params/
    scan-existing-tracking.js               # 同 key 已有埋点确定性扫描
    compute-scope-reachable.js              # AST 作用域
    validate-evidence.js
    validate-acquisition.js
    calculate-confidence.js                 # 闭集表
    map-unresolved-ui.js                    # code → 旧文案
    validate-parameter.js                   # READY / NEEDS_CONFIRM / INVALID
    normalize-parameter-facts.js            # 剥 AI 独占字段、回写程序字段
  params/fixtures/p1-5/                     # closure tests 输入包
reference/
  p1-5-parameter-contract.md                # 从本文件摘给 Agent 的短合同（不要把全文塞 prompt）
```

不把本文件全文写入 `path-a.md`。Agent 只消费短合同 + Schema enum + validator 报错。

---

# 5. Parameter Resolution 总流程

```text
Parameter Requirement
↓
Deterministic Candidate Scan（同 key 已有埋点 + 静态 bindings）
↓
AI：semanticCompatible + preferred + Lineage + Acquisition 提案 + Supporting Evidence
↓
Reachability Check（程序：scopeReachable）
↓
directlyReachable？
├─ yes → acquisition.steps=[] , requiresCodeChange=false
└─ no  → Acquisition Resolution（AI 提案）→ validate-acquisition
↓
Evidence Normalization + uniqueness / impact
↓
impl.json（程序回写 confidence 等）
↓
validate-parameter → READY / NEEDS_CONFIRM
```

Lineage 只回答「值在哪里」（`sourcePath`）。  
Acquisition 只回答「如何让值到达 insertion point」（`acquisition.steps`）。  
local transform（三元/枚举映射）属于 `expression` / `transform`，不属于 acquisition。

---

# 6. Candidate 优先级档（闭集）

档位数字越小优先级越高。**只在同一档内**做 `sourceUniqueness`。

```text
1  same-component-tracking
2  same-page-tracking
3  local-binding（当前 insertion 作用域已有 props/state/变量）
4  existing-api-field（当前数据链上已有 response 字段，非新请求）
5  url-field
6  user-context
7  acquisition-only（无现成同 key 埋点，靠 prop-pass/hook/context 获取）
8  supporting-only（不得单独 high）
```

选档规则：

```text
compatibleCandidates = scan ∩ semanticCompatible
selectedBand = compatibleCandidates 中最高优先级档
```

- 该档 `sourceUniqueness=unique` → 采用该 source，忽略更低档（即使更低档有多个）。
- 该档 `multiple` → `SOURCE_CONFLICT`，NEEDS_CONFIRM。
- 该档 `unknown` → `PARAM_SOURCE_UNKNOWN` 或 uniqueness unknown，NEEDS_CONFIRM。
- `preferred` 不得把低档抬到高档之上，也不得从该档池中删掉其他兼容候选。

`same-component` = 同一 React/Vue **逻辑组件定义范围**，不是同文件。  
`same-page` = 同一已解析 `pageKey` / route owner，不是同目录。  
`pageKey` 取自 event 已定位事实 / adaptor，AI 不得自编 pageKey 后当作 same-page 证据。

已有埋点扫描必须覆盖项目封装调用，不得只靠 Agent「想起」。

Existing tracking **只提供 candidate expression**，必须再跑当前 target 的 reachability / acquisition，禁止直接复制即 READY。

---

# 7. uniqueness 三字段

禁止再用一个 `uniqueness` 混用。

| 字段 | 含义 | 程序如何算 |
|---|---|---|
| `sourceUniqueness` | 选中档内，语义兼容的数据源是否唯一 | 扫描表达式规范化后去重 |
| `pathUniqueness` | 选中 source 到达 target 的 acquisition 路径是否唯一 | validate-acquisition 路径枚举；existing 时为 `unique` |
| `impact.referenceCount` | **该步**目标组件被静态引用次数 | 每步独立；多跳逐步 AND |

取值：`unique` / `multiple` / `unknown`（后两个用于前两字段）。

第一版：任一步 `referenceCount > 1` 或 `impact.scope=shared-component` → 不得自动 READY。

---

# 8. impl.json Parameter Schema（P1-5 目标）

相对当前 `schemas/impl.schema.json` 的增量。兼容策略：

- 现有 `sourcePath` 为 string：normalize 成 `string[]`（按 `>` 或已有分隔符切分；无法切分则单元素数组）。
- 现有 `docDesc` 对应本方案 `description`：schema 同时允许 `docDesc`，normalize 复制到 `description`。
- `confidence` / `scopeReachable` 仍在 JSON 中出现，但 **只允许程序写入**。
- `parameter.unresolved` 第一版对外仍是 `string[]`（旧句）；另增 `unresolvedCodes` 给程序。

## 8.1 推荐结构

```json
{
  "key": "house_id",
  "description": "房源ID",
  "expression": "houseId",
  "sourcePath": [
    "API.response.house.id",
    "HousePage.houseInfo.id",
    "HouseCard.props.houseId"
  ],
  "scopeReachable": false,
  "parameterImplementable": true,
  "sourceUniqueness": "unique",
  "pathUniqueness": "unique",
  "selectedBand": 7,
  "preferredCandidateId": "acq-prop-1",
  "candidates": [
    {
      "id": "sc-1",
      "band": 1,
      "parameterKey": "house_id",
      "expression": "houseInfo.id",
      "file": "src/components/HouseCard.tsx",
      "component": "HouseCard",
      "description": "房源ID",
      "semanticCompatible": true,
      "rejectedReason": "",
      "origin": "scan"
    }
  ],
  "acquisition": {
    "status": "RESOLVED",
    "requiresCodeChange": true,
    "steps": [
      {
        "kind": "prop-pass",
        "from": {
          "file": "src/pages/HousePage.tsx",
          "component": "HousePage",
          "expression": "houseInfo.id"
        },
        "to": {
          "file": "src/components/HouseCard.tsx",
          "component": "HouseCard",
          "binding": "houseId"
        },
        "impact": {
          "scope": "component-api",
          "referenceCount": 1
        }
      }
    ],
    "impact": {
      "scope": "component-api",
      "referenceCount": 1
    }
  },
  "evidence": [
    { "type": "prop-chain", "file": "src/pages/HousePage.tsx" },
    { "type": "component-reference", "file": "src/pages/HousePage.tsx" },
    { "type": "ui-object-match", "file": "" }
  ],
  "confidence": "high",
  "conflicts": [],
  "unresolvedCodes": [],
  "unresolved": []
}
```

`scopeReachable=true` 时：

```json
{
  "acquisition": {
    "status": "RESOLVED",
    "requiresCodeChange": false,
    "steps": [],
    "impact": { "scope": "local", "referenceCount": 0 }
  }
}
```

约束：`scopeReachable===true` → `steps` 必须为空。  
未来 binding（prop-pass `to.binding`）允许当前源码尚不存在；`from.expression` 必须已存在。

## 8.2 acquisition.steps.kind（第一版）

```text
prop-pass
hook-call
context-read
url-read
user-context-read
```

不保留 `local-derive`。

禁止自动新增 API request。发现「另一个未调用 API 能查到」→ `NEW_DATA_SOURCE_REQUIRED`，NEEDS_CONFIRM。

编造 props：无 resolved acquisition 不得新增 prop；validated prop-pass 且逐步 `referenceCount===1` 允许新增。

## 8.3 Evidence 闭集

**Strong（可参与 high，且 high 至少 1 条 Strong）：**

```text
same-component-tracking
same-page-tracking
same-module-tracking
local-binding
jsx-binding
prop-chain
state-chain
hook-chain
context-chain
url-field
api-field
user-context
component-reference
```

**Supporting（不能单独 high）：**

```text
ui-object-match
field-memory
repository-convention
variable-name-similarity
historical-pattern
manual-confirm
```

相对现 schema 新增：`local-binding`、`component-reference`、`ui-object-match`、`variable-name-similarity`、`historical-pattern`。

图片 → 只能生成 `ui-object-match`（Supporting），用于 preferred / 消歧，**不能单独 high**，不能单独决定 `expression` / `scopeReachable` / `acquisition.status`。

每种 Strong type 必填字段（validator 检查，缺则该条作废）：

| type | 必填 |
|---|---|
| same-component-tracking | file, component, parameterKey, expression；且扫描命中同一逻辑组件 |
| same-page-tracking | file, parameterKey, expression；event.pageKey 与证据 pageKey 相同 |
| prop-chain / component-reference | from/to 或 file+component；静态引用存在 |
| hook-chain | file, expression；hook export/import 可解析 |
| context-chain | file；Context 标识 |
| url-field | 真实 query/path key（不得只写「看起来像」） |
| api-field | 已存在调用链上的 url/field |
| local-binding / jsx-binding | file, expression |

`description semantic compatible` **不是**程序可证伪字段：程序只验证 key 全等、expression 在 file 中存在、component/pageKey 扫描一致。语义对错留在 `candidates[].semanticCompatible`（AI），但 uniqueness 池 = 扫描 ∩ compatible。

禁止自定义 `evidence.type`。

## 8.4 程序 vs AI 可写字段

| 字段 | AI | 程序 |
|---|---|---|
| key, description, expression 提案 | 可 | 校验 |
| candidates 骨架（scan 命中） | 否 | 扫描写入 |
| semanticCompatible, preferredCandidateId | 可 | 不得因 AI 删除 scan 项 |
| evidence[] | 可提 | validate-evidence 删非法 type / 缺字段 |
| acquisition.steps 提案 | 可 | validate-acquisition 写 status |
| scopeReachable, confidence, *Uniqueness, parameterImplementable, impact.referenceCount | 否 | 独占 |
| unresolvedCodes | 建议可提 | 最终以 validator 为准 |
| unresolved（旧文案） | 否 | map-unresolved-ui |

---

# 9. Validator 管线

顺序固定，禁止 Agent 跳过：

```text
scan-existing-tracking
→ merge AI semantic / lineage / acquisition / evidence
→ validate-evidence
→ compute-scope-reachable
→ validate-acquisition（仅 scopeReachable===false）
→ uniqueness / impact
→ calculate-confidence
→ map-unresolved-ui
→ validate-parameter
```

## 9.1 validate-evidence

- type ∈ enum
- Strong 必填字段存在且文件/表达式能在源码定位（supporting 可无 file）
- `same-*-tracking` 的 parameterKey 与需求 key 全等
- 不得把 scan 未列出的 same-component/page 证据当作 Strong（必须能关联 `candidates[].origin=scan`）

## 9.2 compute-scope-reachable

对 **最终 expression 依赖的标识符** 在 `targetFile` + `functionName` 作用域做解析。

- 全部可解析 → `true`
- 明确不可解析 → `false`
- 解析器失败 / 非 JS 目标 → `null`（不得 READY）

忽略 AI 传入的旧值。

## 9.3 validate-acquisition

输出 `status`: `RESOLVED` | `UNRESOLVED` | `CONFLICT`。

检查：source file/component/expression 存在；target component 存在；每跳 JSX/静态 reference 存在；`from→to` 调用关系存在；binding 明确；sourcePath 与 steps 一致；任一步 `referenceCount>1` → 不得 RESOLVED 为自动闭环（记 `SHARED_COMPONENT_IMPACT`，status 可为 UNRESOLVED）。

hook-call：export、import、target 允许调用、Provider 祖先可证。  
context-read：Context、Provider、target 在树下、字段存在。  
url-read：URL 字段存在 + 至少一条非 `variable-name-similarity` 的语义证据（url-field Strong 或同 key 扫描兼容）。

AI 不得仅凭 schema 合法自称 RESOLVED。

## 9.4 parameterImplementable

```text
directlyReachable = (scopeReachable === true)
validatedAcquisition =
  scopeReachable === false
  AND acquisition.status === RESOLVED
  AND pathUniqueness === unique
  AND 每步 referenceCount === 1
  AND impact.scope !== shared-component
  AND 第一版 READY 范围命中（prop-pass / hook / context / url）

parameterImplementable = directlyReachable OR validatedAcquisition
```

`scopeReachable===null` → 不可 implementable。

## 9.5 calculate-confidence（闭集，禁止「例如」）

先算布尔输入，再查表。**没有落在 high/low 的剩余可实现中间态 = medium。**

输入：

```text
E  expression 非空
S  sourcePath 闭环（非空，且最后一跳与 expression 或 to.binding 一致）
G  至少 1 条通过 validate-evidence 的 Strong
I  parameterImplementable
U  sourceUniqueness === unique
P  pathUniqueness === unique（directlyReachable 时视为 unique）
C  conflicts 空
R  unresolvedCodes 空
K  不存在 NEW_DATA_SOURCE_REQUIRED
M  不存在 SOURCE_CONFLICT / ACQUISITION 路径 CONFLICT
H  不存在 SHARED_COMPONENT_IMPACT
N  sourceUniqueness !== unknown 且 pathUniqueness !== unknown
Q  不是「仅有 Supporting、零 Strong」
```

**high** 当且仅当：`E ∧ S ∧ G ∧ I ∧ U ∧ P ∧ C ∧ R ∧ K ∧ M ∧ H ∧ N ∧ Q`

**low** 当且仅当 **非 high** 且下列任一：

```text
!E
!K
!M
sourceUniqueness === multiple
pathUniqueness === multiple
acquisition.status === CONFLICT
expression 空且 PARAM_SOURCE_UNKNOWN
```

**medium** 当且仅当 **非 high 且非 low**。典型落入 medium 的（由上式推出，不另开后门）：

```text
uniqueness unknown
仅 Supporting
sourcePath 未闭环但有 expression
URL 字段在但语义未闭环（URL_SEMANTIC_UNKNOWN → 有 unresolved → 非 high；若未进 low 条件则为 medium）
scopeReachable===null
acquisition UNRESOLVED 但无 CONFLICT
```

**不得 READY**：confidence !== high（P1-3 保持）。

程序写回 `confidence`；若发现 AI 已写，直接覆盖，不比较。

## 9.6 validate-parameter Gate

```text
READY =
  confidence === high
  AND parameterImplementable === true
  AND unresolvedCodes 空
  AND conflicts 空

NEEDS_CONFIRM = 非 INVALID 且非 READY

INVALID = schema / 扫描完整性失败 / AI 删除了 scan 候选 / 伪造 evidence type
```

INVALID 回 Resolution 修事实，不进人工「选值」流程。

## 9.7 unresolvedCodes 与旧 UI 映射

第一版 codes：

```text
PARAM_SOURCE_UNKNOWN
PARAM_SEMANTIC_AMBIGUOUS
ACQUISITION_PATH_UNKNOWN
ACQUISITION_NOT_UNIQUE
SHARED_COMPONENT_IMPACT
SOURCE_CONFLICT
URL_SEMANTIC_UNKNOWN
NEW_DATA_SOURCE_REQUIRED
REACHABILITY_UNKNOWN
```

内部确认分类（供后续 UI，第一版不展示）：

```text
PARAMETER_VALUE_CONFIRM     ← PARAM_SOURCE_UNKNOWN, PARAM_SEMANTIC_AMBIGUOUS, URL_SEMANTIC_UNKNOWN, SOURCE_CONFLICT
ACQUISITION_CONFIRM         ← ACQUISITION_*
IMPLEMENTATION_IMPACT_CONFIRM ← SHARED_COMPONENT_IMPACT
```

`map-unresolved-ui`：上述任意 code → 事件/参数对外字符串仍为 `请确认参数 {key} 的取值`（位置类仍用 `请确认埋点位置`）。  
`event.unresolved` pattern **不改**。

`conflicts` 使用闭集字符串，第一版至少：`multiple-valid-parameter-sources`、`multiple-valid-acquisition-paths`。

---

# 10. Implementation / P2 边界

实现 Agent 只消费 `impl.json` 的 `expression`、`sourcePath`、`acquisition.steps`、`targetFile`、`functionName`。禁止重推参数来源。acquisition 不完整必须回 Parameter Resolution。

P2 Runtime Resolver 只消费 resolved `dataDep`，不得回读 acquisition 猜 runtime source。

P1-5 产出 Parameter Facts；P1-2 的 `calculate-confidence` 与本文件 9.5 **合并为同一实现**（避免两套表）。P1-3 Gate 消费本文件 9.6。

---

# 11. AI Stop Condition

自动推导在以下情况停止（写入 unresolvedCodes，不假装 READY）：

```text
扫描后无任何语义兼容 source，且无法提出可验证 acquisition
同档多个兼容 source
新增业务 API 才能取值
任一步 shared component / referenceCount>1
静态程序无法验证 acquisition
源码与需求冲突
scopeReachable===null 且无法 acquisition
```

禁止：当前函数没有局部变量就立即确认。必须先扫描同组件/同页、再追树、再 acquisition。

---

# 12. Closure Tests

固定输入包：同一 `events.json` 片段、adaptor、源码 fixture、可选「图片语义事实」文件（`ui-object-match` 已结构化，用于层 1）。层 2 另用未结构化截图说明文档，不强制本仓库 CI 跑多模型。

比较字段：`candidates` 集合（id 除外，比 file+key+expression）、`expression`、`sourcePath`、`acquisition.steps`、`evidence.type`、`confidence`、Gate。允许 analysis 文案不同。

### Case 1

same-component，同 key，语义兼容，AST 可达。  
Expected：scan 含该候选，`scopeReachable=true`，steps=[]，high，READY。

### Case 2

same-page 兼容候选，数据链 AST 可达。无更高档兼容候选。  
Expected：READY。

### Case 3

Child 不可达；唯一 Parent 有 source；单跳 prop-pass；该步 `referenceCount=1`。  
Expected：`validatedAcquisition`，READY。允许未来 `to.binding` 尚不存在。

### Case 4

A→B→C 多跳，每跳静态引用可证，**每步** `referenceCount===1`。  
Expected：READY。

### Case 4b（新增，锁定 3.3）

A→B→C，中间 B 的 `referenceCount=8`。  
Expected：`SHARED_COMPONENT_IMPACT`，NEEDS_CONFIRM，不得 high READY。

### Case 5

hook 存在，import/export 可解析，Provider 祖先静态可证，target 可调用。  
Expected：READY。

### Case 6

hook 存在，Provider 不在祖先。  
Expected：acquisition UNRESOLVED，NEEDS_CONFIRM。

### Case 7

URL 字段真实存在 + Strong `url-field`（或同 key 扫描兼容）语义闭环。  
Expected：READY。

### Case 8

URL 仅变量名相似（`variable-name-similarity`），无 Strong 语义闭环。  
Expected：不得 high；`URL_SEMANTIC_UNKNOWN`；NEEDS_CONFIRM。

### Case 9

同 key，AI 标 description 不兼容。  
Expected：候选仍在 `candidates[]`（`rejectedReason=semantic-incompatible`）；不进入 uniqueness 池；若无其他兼容源则 NEEDS_CONFIRM。

### Case 10

同档两个语义兼容 source，无法再消歧。  
Expected：`sourceUniqueness=multiple`，`SOURCE_CONFLICT`，low 路径，NEEDS_CONFIRM。`ui-object-match` / preferred 不得把其中一条从池中删除后 READY。

### Case 10b（新增，锁定 3.2）

档 1 唯一兼容 source + 档 2 另有不同 expression。  
Expected：采用档 1，READY，不得因档 2 进入 CONFIRM。

### Case 11

source 可达，仅 boolean/enum transform。  
Expected：`scopeReachable=true`，steps=[]，READY。

### Case 12

prop-pass 终点或任一步 `referenceCount=10`。  
Expected：`impact.scope=shared-component` 或逐步 count>1，NEEDS_CONFIRM。

### Case 13

只有变量名相似。  
Expected：`Q=false`，不得 high。

### Case 14

字段只在另一个未调用 API。  
Expected：`NEW_DATA_SOURCE_REQUIRED`，low，NEEDS_CONFIRM。

### Case 15

AI 输出 prop-pass，静态 reference 不存在。  
Expected：validate-acquisition 非 RESOLVED，NEEDS_CONFIRM。不得因 AI 自证 READY。

### Case 16

`scopeReachable=false` 且 acquisition 空。  
Expected：NEEDS_CONFIRM。

### Case 17（程序独占）

AI 写入 `scopeReachable=true` 且 `confidence=high`，但 AST 不可达。  
Expected：程序覆盖为 `false`，不得因 AI 字段 READY。

### Case 18（候选完整性）

扫描命中 3 条同 key，AI 输出只含 1 条。  
Expected：INVALID 或 normalize 把缺失扫描项补回后按完整池判定；**禁止**按残缺池 READY。第一版推荐：缺扫描项 → INVALID。

### Case 19（跨 Agent preferred）

同一完整池，Agent A preferred=X，Agent B preferred=Y，但档 1 仅一个兼容源 Z。  
Expected：两 Agent 均采用 Z，Gate 相同 READY。

### Case 20（图片）

仅 `ui-object-match`，无 Strong。  
Expected：不得 high。

### Case 21（对外 UI）

内部 `SHARED_COMPONENT_IMPACT`。  
Expected：`event.unresolved` 仍匹配 `请确认参数 .+ 的取值`。

---

# 13. Closure Criteria

```text
[x] 语义匹配 C：扫描完整列出，AI 只做兼容与 preferred
[x] 跨档不冲突：只在选中档内 conflict
[x] 多跳逐步 AND：中间 referenceCount>1 第一版 CONFIRM
[x] 第一版 READY 范围（可达 / 合规 prop-pass / 静态闭环 hook-context / 语义闭环 URL）
[x] scopeReachable / confidence 程序独占
[x] uniqueness 三字段
[x] Medium/Low 闭集表
[x] ui-object-match Supporting
[x] unresolved code 对内、旧文案对外
[x] 仓库落地：schema 增量、validator、fixtures（等写代码指令）
[x] 短合同写入 reference，禁止全文塞 prompt
```

---

# 14. 最终原则

> AI 尽量从图片与代码找全候选、理解语义、追 Lineage、提出 Acquisition。  
> 高置信必须经 Evidence Contract 与确定性验证才能成为 impl 正式事实。  
> **推理可以不同；同一真实证据规范化后，Gate 必须收敛。**
