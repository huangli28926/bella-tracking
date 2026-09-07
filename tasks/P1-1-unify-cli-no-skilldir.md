# P1-1：统一 CLI — 去掉 `<skillDir>` / 专属工具名

## 0. 与已落地切片的关系

不另起 Workflow，不改事实链职责。

| 文档 | 收什么权 |
|---|---|
| `P0-2` | `nextTask.command` 已是仓库相对 `node scripts/...` |
| `P0-3` | `SKILL.md` 已禁止 `<skillDir>` / 平台工具名；菜单在脚本 |
| `P0-4` | 入账只走 `apply-impl-patch`；跳步脚本拒绝 |
| **本文 P1-1** | **Agent 可读文档与命令入口**与引擎 `command` 字节级同构 |

图中原句：「统一 CLI，去掉 `<skillDir>` / 专属工具名」。

P0-2～P0-4 只收了 **JSON command + SKILL 路由**。`reference/`、`SKILL.html`、`REFERENCE.html` 仍教 `node <skillDir>/scripts/...`，`path-a.md` 仍写 Cursor 专属 `block_until_ms`。三平台读 HOW 文档时会重新分叉。

原则：

```text
唯一命令形：仓库根  node scripts/<area>/<file>.js --excel=docs/{文件}.xlsx
禁止：<skillDir>、本机绝对路径、平台工具名写进「必须执行」的命令
```

事实链不得改职责：

```text
events.json → adaptor.json → impl.json → accept-chain.json
```

状态仍只写 `_raw/workflow.json`。P0-2 Task ID 闭集、P0-3 prompt 常量、P0-4 闸：**全部继承，禁止回退。**

---

## 1. 问题定义（对照当前源码）

已对齐：

```text
next-task.js 的 command     →  node scripts/...
SKILL.md                    →  禁止 skillDir / 平台工具名
USER-GUIDE.md               →  无 skillDir
prompts.js 的 F_SCAN_CONFIRM →  node scripts/history/scan-history-tracking.js
```

未对齐（本次必须清）：

| 文件 | 残留 |
|---|---|
| `reference/confirm-flow.md` | `node <skillDir>/scripts/confirm/serve-impl.js ...` |
| `reference/path-history.md` | `node <skillDir>/scripts/history/diff-doc-vs-history.js ...`（两处） |
| `reference/accept-assert.md` | `node <skillDir>/scripts/accept/diagnose-empty.js ...` |
| `reference/path-a.md` | 「Agent 调脚本时 `block_until_ms` 须大于超时（建议 620000）」 |
| `reference/path-history.md` | 「对每条 missing Grep `sourceRoots`」（平台词当硬步骤） |
| `reference/REFERENCE.html` | `node &lt;skillDir&gt;/scripts/accept/diagnose-empty.js` |
| `SKILL.html` | 整段脚本速查 + `npm i ... --prefix &lt;skillDir&gt;` |

`package.json` 无 `bin`。P0-3 把 `npx bella-tracking` 记为 follow-up：**本文不强制做 bin**。统一 CLI = 一种命令形，不是新包装器。

---

## 2. 目标

1. **Agent 必读路径**（`SKILL.md`、`reference/*.md`、`USER-GUIDE.md`）里，可复制命令全部是 `node scripts/...`，从仓库根执行。
2. **删除** `<skillDir>` / `&lt;skillDir&gt;`（含 HTML 镜像）。
3. **删除「必须用某平台工具」的句子**：`block_until_ms`、把 `Read` / `Grep` / MCP `browser_*` 写成唯一做法。允许用普通动词「搜索源码 / 读示意图文件」。
4. 长等待只写：`confirm-event --wait` 会阻塞，超时 exit 2；不要写平台 timeout 字段。
5. Playwright 安装改为仓库根：`npm i -D playwright`（不要 `--prefix <skillDir>`）。
6. 用测试锁住：工作区文本（见第 7 节）不得再出现禁用令牌。

验收口径：

```text
同一条业务命令
在 nextTask.command / reference / HTML 镜像
三者前缀同为  node scripts/
```

不要求新增 `npx bella-tracking`。不改 dump / validate / apply 业务判定。

---

## 3. 目录结构（本次允许改动）

```text
bella-tracking/
├── SKILL.md                         # 不回写 skillDir；不写平台工具名
├── SKILL.html                       # 脚本速查改为 node scripts/...；删 skillDir 说明段
├── USER-GUIDE.md                    # 若有命令样例，对齐 node scripts/...
├── package.json                     # 不强制加 bin
├── reference/
│   ├── path-a.md                    # 删 block_until_ms；改 --wait / exit 2
│   ├── path-history.md              # 命令去 skillDir；Grep → 搜索源码
│   ├── confirm-flow.md              # serve-impl 命令去 skillDir
│   ├── accept-assert.md             # diagnose-empty 命令去 skillDir
│   ├── workflow-next-task.md        # 保持现有 node scripts/...（勿回退）
│   └── REFERENCE.html               # 与 md 同步，去 skillDir
├── scripts/workflow/
│   └── tracking-workflow.test.js    # 第 7 节：禁令扫描
└── tasks/
    └── P1-1-unify-cli-no-skilldir.md  # 本文
```

禁止改：

```text
events / adaptor / impl / accept-chain 字段语义
nextTask.id 闭集与 apply / assert 闸
prompts.js 用户可见菜单原文
为 Cursor / Claude / Codex 各写一套命令
```

---

## 4. 命令与用词闭集

### 4.1 允许的命令形

```bash
node scripts/workflow/tracking-workflow.js --excel=docs/{文档名}.xlsx --status --json
node scripts/workflow/apply-impl-patch.js --excel=docs/{文档名}.xlsx --task=A_ANALYZE_EVENT --evt={evtId} --patch=-
node scripts/confirm/confirm-event.js --excel=docs/{文档名}.xlsx --evt={evtId} --if-needed --wait
node scripts/confirm/serve-impl.js --excel=docs/{文档名}.xlsx
```

规则：

- 前缀固定 `node scripts/`（POSIX，正斜杠）。
- 仓库根 cwd。禁止 `node /Users/...`、禁止 `node <skillDir>/...`。
- Agent 执行时优先跑 `nextTask.command` 原文，不要从文档重拼。

### 4.2 禁用令牌（Agent 必读 + HTML 镜像）

实现后下列子串不得出现在第 3 节列出的文档里（`tasks/` 历史方案除外）：

```text
<skillDir>
&lt;skillDir&gt;
block_until_ms
--prefix <skillDir>
```

平台工具名不得作为「唯一/必须」步骤出现：

```text
Read / Grep / Glob          （Cursor / Codex 工具）
browser_* / mcp__           （MCP）
block_until_ms
```

允许：

```text
读 _raw/images/{evtId}.png
在 adaptor.sourceRoots 里搜索 evtId
打开浏览器只通过 confirm-event.js / serve-impl.js
```

### 4.3 `path-a.md` 替换句（必须）

删：

```text
Agent 调脚本时 block_until_ms 须大于超时（建议 620000）。
```

改为与 `SKILL.md` 同义：

```text
confirm-event --wait 会阻塞，超时 exit 2。脚本会再 open 一次。
```

### 4.4 HTML 镜像

`SKILL.html` / `REFERENCE.html` 若仍给 Agent 或人复制命令，必须与 md 同步。不要只改 md 留 HTML 旧速查。说明段「`<skillDir>` = 当前加载的本 Skill 目录」整段删除，改为一句「仓库根执行 `node scripts/...`」。

---

## 5. 不在本次做

- `package.json` `bin` / `npx bella-tracking`（另开）。
- 黄金轨迹 CI、三平台 hook（P2-1）。
- 改 8 项菜单、设备文案、D 失败二选一原文。
- 改 HOW 定位规则（看图 / 追参数）。
- 把 `SKILL.html` 整站重设计。

---

## 6. Skill / 脚本配合（薄）

`SKILL.md` 已有禁令则保持，不要加长。`workflow-next-task.md` 已写「只跑 `node scripts/...`」则保持。

脚本 `command` 生成器已合规：**禁止为了 HTML 再改回 skillDir。**

---

## 7. 必须增加的测试

在 `tracking-workflow.test.js`（或旁路 `docs-cli-contract.test.js`）固定，不启浏览器：

1. **禁令扫描**：对 `SKILL.md`、`USER-GUIDE.md`、`reference/*.md` 断言不含 `<skillDir>`、`block_until_ms`。
2. **HTML 镜像**：`SKILL.html`、`reference/REFERENCE.html` 不含 `&lt;skillDir&gt;` / `<skillDir>`。
3. **command 前缀**：对一组 fixture `--status --json`，凡 `nextTask.command` 非空，必须以 `node scripts/` 开头。
4. **回归**：已有 P0-2 确定性测试、P0-3 SKILL 行数、P0-4 拒绝用例继续绿。

`tasks/*.md` 不扫（历史方案会提到旧词）。

运行：

```bash
node --test scripts/workflow/tracking-workflow.test.js
```

---

## 8. 实施顺序

1. 列出仓库内全部 `<skillDir>` / `block_until_ms` 命中（md + html）。
2. 改 `reference/*.md` 命令与 `path-a.md` 等待句。
3. 同步 `SKILL.html` / `REFERENCE.html`。
4. 加第 7 节测试。
5. 全绿后写第 10 节变更报告。

不要顺手做 bin 或 CI。

---

## 9. 兼容与风险

- 旧对话 / 外拷 Skill 仍可能带 skillDir；以**本仓库当前 checkout** 为准。
- HTML 若由脚本生成，改生成源而不是只手改产物；若是手维护镜像，与 md 同 PR 改完。
- 不迁移 `workflow.json`。

---

## 10. 实施结束后必须报告

```text
1. 修改 / 新增文件列表
2. 清除的 skillDir / block_until_ms 命中表
3. 是否改动 nextTask.command 生成器（期望：否）
4. HTML 是否与 md 对齐
5. 测试命令与结果
6. follow-up：npx bin、P2-1 CI
```

Scope：只做本文第 2 节。发现 P0 回归则修回归；新需求记 follow-up。
