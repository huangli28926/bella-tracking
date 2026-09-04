# P0-3：SKILL.md 瘦身 + 菜单/确认文案改由脚本打印

## 0. 与 P0-1 / P0-2 的关系

本文是跨平台稳定性切片，**不另起 Workflow**。

| 文档 | 收什么权 |
|---|---|
| `P0-1-workflow-determinism.md` | 目标模型：程序决定 WHAT / WHEN，Agent 决定 HOW |
| `P0-2-nexttask-run-a-status-json.md` | 机器协议：唯一 `nextTask` + `command` / `prompt` 字段；`--run=A` ≠ 业务 A |
| **本文 P0-3** | **人机文案权威** + **Skill 入口体积**：用户看到的菜单/确认只来自脚本；`SKILL.md` 只做路由 |

P0-2 已落地雏形：

```text
DEVICE_PROMPT          → scripts/accept/accept-device.js
FULL_PAGE_PROMPT       → scripts/workflow/next-task.js
B_CONFIRM_EVENT.prompt → next-task.js 拼闭集原因
schema nextAction      已含 choose_entry / choose_repair_mode
```

未闭环：

```text
8 项入口菜单仍写在 SKILL.md（模型「原样复述」）
resolveNextTask 从不返回 choose_entry
D 失败二选一、旧埋点删除二选一、缺 Excel 询问仍是 Skill 散文
SKILL.md ≈ 580+ 行，路径 A–H 细则与脚本/reference 重复
```

事实链不得改职责：

```text
events.json → adaptor.json → impl.json → accept-chain.json
```

状态仍只写 `_raw/workflow.json`。禁止新平行状态文件。

P0-2 的 Task ID 闭集、`--run=A` 只 dump+render、`command` 用仓库相对 `scripts/...`：**全部继承，禁止回退。**

---

## 1. 问题定义

跨 Codex / Claude / Cursor 时，**同一磁盘事实**仍可能对用户打出不同菜单，因为文案有两套 Authority：

```text
SKILL.md 里的「必须原样列出」
+
脚本 stdout / nextTask.prompt（P0-2 已有一部分）
+
模型改写后的聊天
```

长 `SKILL.md` 还会导致：前半记住、后半丢掉；与系统规则抢窗口；「按需读 reference」被理解成可以不读。

本次要解决的不是「再写更硬的禁止句」，而是：

```text
用户可见的选择/确认文案 = 脚本常量（唯一）
SKILL.md = 短路由（怎么读 JSON、怎么执行 HOW）
阶段细则 = reference/*.md（仅 nextTask.stage 命中时读）
```

---

## 2. 目标

1. **`SKILL.md` 目标体积：80–120 行**（含 frontmatter）。超出则本任务未完成。
2. **人机文案单一来源**：下列 prompt 只允许出现在 `scripts/` 常量（或由其拼出），SKILL / USER-GUIDE 只引用「跑命令后原样转发」，禁止再贴一份会漂的正文。
3. **未明确入口时**：`--status --json` 给出 `nextAction=choose_entry` 且 `prompt` 为 8 项原文；Agent 禁止自己拼菜单。
4. 阶段 HOW 不丢：从 SKILL 挪走的规则必须落到对应 `reference/`，并在 SKILL 用一张「何时读哪篇」表指向。

验收口径：

```text
同一脚本输出，三平台聊天里的菜单/确认选项字节级一致
（允许聊天前后加一句解释，禁止改选项编号与含义）
```

不要求三平台写出相同 `impl` 字段（那是事实收敛，不在本次）。

---

## 3. 目录结构（本次允许改动）

```text
bella-tracking/
├── SKILL.md                                 # 瘦身为路由页（见第 5 节）
├── USER-GUIDE.md                            # 删重复菜单正文，改为「以脚本 prompt 为准」+ 指向常量文件
├── schemas/
│   ├── task-result.schema.json              # nextAction 如需补 ask_excel / confirm_delete_old（见 4.3）
│   └── workflow-status.schema.json          # 与上对齐
├── scripts/
│   └── workflow/
│       ├── prompts.js                       # 新增：全部用户可见 prompt 常量 + 少量插值函数
│       ├── next-task.js                     # 入口未定时返回 CHOOSE_ENTRY；prompt 改从 prompts.js 取
│       ├── tracking-workflow.js             # --status 无入口意图时走 choose_entry；stdout 打印 prompt
│       └── tracking-workflow.test.js        # 文案快照 + 瘦身后仍能解析入口
├── scripts/accept/
│   ├── accept-device.js                     # DEVICE_PROMPT 改为 require prompts.js（或 re-export）
│   ├── check-old-tracking.js                # 删除二选一改用 prompts.js（exit + stdout）
│   └── format-fail-explain.js               # D 失败总览尾部二选一改用 prompts.js
├── scripts/history/
│   └── diff-doc-vs-history.js               # 无 excel 时 stdout 用 ASK_HISTORY_EXCEL（若该入口会直接跑）
├── reference/
│   ├── workflow-next-task.md                # 补：prompt 原样转发；入口未定 = choose_entry
│   ├── path-a.md                            # 新增：现 SKILL「路径 A」全文迁入（可微调标题，禁止改硬规则语义）
│   ├── path-b.md                            # 新增：路径 B
│   ├── path-c.md                            # 新增：路径 C + 旧埋点删除门（文案指向脚本）
│   ├── path-d.md                            # 新增：路径 D（设备/失败选择指向脚本）
│   ├── path-e.md                            # 新增：路径 E
│   ├── path-f.md                            # 新增：路径 F
│   ├── path-7.md                            # 新增：入口 7
│   ├── path-h.md                            # 新增：路径 H
│   ├── skill-hard-stops.md                  # 新增：现「硬性禁止」+ .env sourceRoot/baseline/trackingMode + 定位优先级
│   ├── confirm-flow.md                      # 已有，B 细节可继续指向这里，避免和 path-b 双份；迁完后 path-b 只留门禁+链到本文
│   └── accept-fail-explain.md               # 总览结构保留；固定二选一句子改为「以 prompts.D_FAIL_CHOICE 为准」
└── tasks/
    ├── P0-1-workflow-determinism.md
    ├── P0-2-nexttask-run-a-status-json.md
    └── P0-3-skill-slim-script-prompts.md    # 本文
```

允许合并：`path-f.md` + `path-7.md` + `path-h.md` 合成 `path-history.md`，若单文件更易按需读。禁止再把细则写回 `SKILL.md`。

禁止改：

```text
events / adaptor / impl / accept-chain 字段职责
dump / validate / run-accept 的业务判定
P0-2 已定的 nextTask.id 闭集（可新增 CHOOSE_ENTRY 等「文案任务」id，见 4.2）
```

---

## 4. 文案单一来源

### 4.1 必须搬进 `scripts/workflow/prompts.js` 的闭集

字符串必须与**当前 SKILL 已发布原文**一致（编号、【强烈推荐】、句号、换行）。本次只搬家，不改产品文案。若要改字，另开任务。

| 常量名 | 现出处 | nextAction |
|---|---|---|
| `ENTRY_MENU` | SKILL「请选择本次入口」8 项 | `choose_entry` |
| `ASK_HISTORY_EXCEL` | 「需要梳理哪个历史埋点文档的数据，请给出该历史埋点 excel」 | 见 4.3 |
| `DEVICE_PROMPT` | 已在 `accept-device.js`，迁入后 re-export | `choose_device` |
| `FULL_PAGE_PROMPT` | 已在 `next-task.js` | `confirm_full_page` |
| `CONFIRM_EVENT_TEMPLATE` | `请在已打开的矫正向导中确认 evtId=…` + 闭集原因 + tail | `confirm_event` |
| `D_FAIL_CHOICE` | 「请选择下一步（回复 1 或 2）」自修复 / 人工矫正 | `choose_repair_mode` |
| `DELETE_OLD_TRACKING` | 「检测到旧埋点将被删除…」1 保留 / 2 确认删除 | 见 4.3 |
| `F_SCAN_CONFIRM` | 历史扫描：先给出 `scan-history-tracking.js` 命令、等确认（若仍要人确认） | 可选，有则进表 |

插值规则：

- 只允许替换花括号槽位（`{evtId}`、`{evtId 列表}`、`{文档名}`）。
- 禁止模型改选项含义；Skill 只写：「`prompt` 非空则原样发给用户」。

`format-fail-explain` 的**总览骨架**（失败/通过/报告/C 落点）仍由脚本拼事实；**二选一尾巴必须调用 `D_FAIL_CHOICE`**，禁止第三份拷贝。

### 4.2 新增 Task ID（仅文案门，可进闭集）

在 P0-2 闭集上只允许增加：

```text
CHOOSE_ENTRY          user   未解析到入口意图
ASK_HISTORY_EXCEL     user   入口 7/8 且无可用 xlsx / 缺失 JSON
C_CONFIRM_DELETE_OLD  user   check-old-tracking removedCount>0
D_CHOOSE_REPAIR       user   真实验收 fail>0 且用户未选 1/2
```

`resolveNextTask` 仍是纯函数，**不读对话**。入口意图从**显式参数**来，不从聊天猜：

```text
--entry=1|2|3|4|5|6|7|8
或已有 --run=A|B|C|D|H
或 workflow.json 已记录本次 entry（由 --entry / --run 写入，不新文件）
```

无 `--entry` 且无 `--run` 且 `workflow.json` 无本次入口：

```text
nextTask.id = CHOOSE_ENTRY
executor = user
nextAction = choose_entry
prompt = ENTRY_MENU
command = null
status JSON status = needs_user_input
exit：建议 10（固定码，Skill 只写「exit 10 则把 stdout/prompt 原样发出后停」）
```

禁止：无入口时默默 `A_DUMP`。这与现 Skill「未明确先问」对齐，并第一次变成程序门禁。

用户回复 `3` / 「只跑 A」后，Agent 再带 `--entry=3` 或 `--run=A` 重跑 `--status`（`--run=A` 仍只 dump+render）。**不要**让模型把数字映射写进自己的记忆；映射表只存在于脚本：

```text
1 → 路径 A→B→C→D（E 不自动）
2 → A→B→C
3 → 只 A
4 → D
5 → E
6 → F
7 → 缺失列表
8 → H
```

该映射可放 `prompts.js` 旁的 `parseEntry(input) → { entry, run }`，供 CLI `--entry=` 与测试使用。Agent 不实现映射，只把用户原话交给脚本或原样重跑 status 并带上用户选的数字。

推荐 CLI（本次应做）：

```bash
node scripts/workflow/tracking-workflow.js --excel=docs/x.xlsx --status --json
# 无入口 → CHOOSE_ENTRY

node scripts/workflow/tracking-workflow.js --excel=docs/x.xlsx --entry=3 --status --json
# 写入 workflow.json.entry 后按 P0-2 优先级给 A_DUMP / A_ANALYZE_EVENT …
```

### 4.3 schema

`choose_entry` / `choose_repair_mode` 已在 schema。若增加：

```text
ask_excel
confirm_delete_old
```

必须同时改 `task-result.schema.json` 与 `workflow-status.schema.json`。也允许复用 `needs_user_input` + 现有 enum，用 `nextTask.id` 区分，**不要两套含义打架**。实现时选一种并在本文件落地说明。

建议（减少 enum 膨胀）：

```text
CHOOSE_ENTRY         → choose_entry
ASK_HISTORY_EXCEL    → choose_entry（prompt 不同）或 ask_excel
C_CONFIRM_DELETE_OLD → 新增 confirm_delete_old
D_CHOOSE_REPAIR      → choose_repair_mode
```

### 4.4 stdout 规则（非 --json 也要稳）

人类可读模式（无 `--json`）在 `needs_user_input` 时：

1. 先打印简短状态一行（现有 next 说明可保留）
2. **空一行后原样打印 `prompt`（禁止再包一层 Markdown 标题改写选项）**

`--json` 时 `prompt` 在 JSON 内；Agent 规则：把该字段原文发给用户，不要从 SKILL 补一份菜单。

---

## 5. SKILL.md 目标骨架（实现时按此裁，禁止超 120 行）

允许保留的块（顺序固定）：

```text
1. YAML frontmatter（name + description，中英触发词保留）
2. 权威顺序：磁盘 > 脚本 JSON > Schema > 当前模型 > 对话
3. 主循环（约 15 行）：
   - 仓库根执行
   - 先 --status --json
   - prompt 非空 → 原样发给用户后停
   - executor=script → 只跑 nextTask.command
   - executor=agent → 只读 nextTask.inputs + 下表对应 reference，写 outputs，然后 normalize+validate
   - validate error / nextTask.status=blocked → 停
   - 成功后再 --status
4. 工具契约：只允许读文件 / 搜文本 / 跑命令 / 改文件；打开浏览器只通过 confirm-event / serve-impl；禁止平台工具名、<skillDir>、block_until_ms
5. 何时读哪篇 reference（一张表，8 行内）
6. 确定性生成（枚举 / unresolved 闭集 / POSIX / 纯 JSON）可留 8 行；细节链到 impl schema
7. 硬禁止只留 8 条「标题级」：不猜页面名、不编 props、不改 uicode、不删旧埋点未确认、不跳过 confirm 开浏览器、D 未选设备不跑、未选入口不跑、dump 失败不分析
   每条一句，展开在 skill-hard-stops.md
```

必须迁出 SKILL 的块：

```text
8 项菜单原文
设备选择原文
D 失败二选一原文
旧埋点删除二选一原文
缺历史 Excel 询问原文
路径 A/B/C/D/E/F/7/H 逐步操作
脚本速查长列表（改到 USER-GUIDE 或 reference/commands.md，本次可只链 workflow --help）
impl.json 大样例（链 schemas/impl.schema.json）
产物目录树（链 USER-GUIDE 或 reference）
```

`description` 不要为瘦身删触发词（xlsx / 落库 / 验收 / 缺失埋点等），否则 Cursor 召回变差。

---

## 6. Agent 执行契约（写进瘦身后的 SKILL + `workflow-next-task.md`）

```text
1. 解析到 xlsx 后只跑 tracking-workflow --status --json（可带用户已明确的 --entry / --run）
2. 若 nextAction 为 choose_* / confirm_* 或 prompt 非空：把 prompt 原样发给用户，停止
3. 禁止从记忆或 SKILL 补菜单
4. executor=agent 时才读 path-*.md；一次只读 nextTask.stage 对应一篇 + 必要时 call-adaptor / sdk-profiles
5. 写入 impl 后必须跑 JSON 里的 normalize/validate command（或 nextTask 指向的 A_VALIDATE_IMPL）
6. 聊天解释不是下一跳输入
```

平台专属词（`Read` / `Grep` / `block_until_ms`）从 SKILL 删除；长等待只写「`confirm-event --wait` 会阻塞，超时 exit 2」。

---

## 7. 测试（必须）

在 `tracking-workflow.test.js`（或 `prompts.test.js`）增加：

1. **无 `--entry` 无 `--run`**：`nextTask.id === 'CHOOSE_ENTRY'`，`prompt === ENTRY_MENU`（全文 equal，不是 regex 猜）
2. **`--entry=3`**：不再是 CHOOSE_ENTRY，进入 P0-2 的 A_* 优先级
3. **`ENTRY_MENU` 快照**：8 行选项与当前产品原文一致（fixture 字符串）
4. **`DEVICE_PROMPT` / `D_FAIL_CHOICE` / `DELETE_OLD_TRACKING` / `ASK_HISTORY_EXCEL`**：`format-fail-explain` / `check-old-tracking` / device 门输出包含同一常量（`indexOf` 或 equal）
5. **同一事实跑两次 status**：`prompt` 字节级相同
6. **SKILL 体积**：测试或 CI 断言 `SKILL.md` 行数 ≤ 120（可用简单 node 断言，避免靠人工）
7. **SKILL 不再内嵌菜单头**：`SKILL.md` 不含 `请选择本次入口`、`请选择 Playwright 打开方式`、`请选择下一步（回复 1 或 2）`、`检测到旧埋点将被删除`、`需要梳理哪个历史埋点文档的数据`

不测：模型是否遵守（那是评测集）。本任务锁的是**脚本输出与 Skill 不再双份**。

---

## 8. 非目标（记 follow-up，禁止本次做）

- 单 evt patch schema / 禁止手写整份 impl（P0 后续）
- 统一 `npx bella-tracking` bin（可另开）
- 改 8 项菜单产品文案或推荐项
- 重写 A–H 业务规则
- 为 Cursor / Claude / Codex 写三套 Skill
- 把 USER-GUIDE 改成教程长文

---

## 9. 建议实现顺序

1. 抽出 `prompts.js`，现有 `DEVICE_PROMPT` / `FULL_PAGE_PROMPT` 改为引用；测试 equal 旧字符串。
2. `CHOOSE_ENTRY` + `--entry` + `workflow.json.entry`；无入口时 status 停。
3. `D_FAIL_CHOICE` / `DELETE_OLD_TRACKING` / `ASK_HISTORY_EXCEL` 接到现有脚本 stdout。
4. 把 SKILL 路径章节原样搬到 `reference/path-*.md` 与 `skill-hard-stops.md`。
5. 重写短 `SKILL.md`，加行数与禁词测试。
6. USER-GUIDE / `accept-fail-explain.md` 去掉重复原文，改为指向常量名。

---

## 10. 完成定义

- [ ] `SKILL.md` ≤ 120 行，且测试 7 的禁词不出现
- [ ] 用户可见 6 类文案只从 `prompts.js` 出（设备、入口、整页进 C、单条确认、D 失败、删旧埋点；缺 Excel 若保留则一并）
- [ ] 未带 `--entry`/`--run` 的 `--status --json` 得到 `CHOOSE_ENTRY` + 原文菜单
- [ ] `reference/path-*.md`（或合并的 history 篇）覆盖迁出的 HOW，硬规则语义不减
- [ ] P0-2 既有 nextTask 测试全绿
- [ ] 未改 impl / events / adaptor / accept-chain 职责
