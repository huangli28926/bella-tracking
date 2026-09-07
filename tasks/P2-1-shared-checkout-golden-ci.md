# P2-1：三平台同一 checkout + 黄金轨迹 CI

## 0. 与已落地切片的关系

不另起 Workflow，不改事实链职责。

| 文档 | 收什么权 |
|---|---|
| `P0-2`～`P0-4` | 引擎：唯一 `nextTask`、prompt 脚本化、单 evt 闸 |
| `P1-1` | 文档命令与 `command` 同形（**应先于本文落地**） |
| **本文 P2-1** | **同一份仓库 + 机器可重复的黄金轨迹**，锁住三平台不漂 |

图中原句：「三平台同一 `checkout` + 黄金轨迹 CI」。

P0-4 明确不测三平台文采、不做真业务仓 E2E。本文补的是**程序可重复的回归**，不是让三个模型写出相同 `expression`。

原则：

```text
Codex / Claude / Cursor 加载同一 git commit 的本仓库
CI 对同一 fixture 磁盘事实
→ 同一 nextTask（含 command / prompt）
→ 同一套拒绝（exit 20，磁盘不变）
```

事实链不得改职责。状态仍只写 `_raw/workflow.json`。禁止平行状态文件。

**依赖：** P1-1 未完成时，本文可以先写 CI 跑已有测试，但「文档命令与 command 一致」的扫描应等 P1-1 合入，否则 CI 会红。

---

## 1. 问题定义

当前：

```text
确定性测试只在本地  node --test scripts/workflow/tracking-workflow.test.js
仓库无 .github/workflows
无「黄金轨迹」命名与固定 fixture 目录约定
三平台 Skill 副本（~/.codex/skills、~/.claude/skills、.cursor/skills）
可能与本仓库 commit 不一致
```

因此即使用引擎已确定性，仍可能：

- Agent 读到旧 `SKILL.md`（带菜单、带 skillDir）
- 本机改了脚本、平台 Skill 仍是旧拷贝
- 回归只靠人工跑测试

「同一 checkout」不是再写三套 Skill，而是：

```text
唯一真相 = 本 git 仓库
平台只是 runner：读这份 SKILL.md + 跑这份 scripts/
禁止长期维护第二份业务 Skill 正文
```

---

## 2. 目标

1. **同一 checkout 约定**（文档，短）：三平台启用本 Skill 时，以**当前业务仓或本仓库的同一 commit** 为准；不要从用户家目录旧拷贝执行 `scripts/`。
2. **黄金轨迹 fixture**：一组只读磁盘事实（无浏览器），覆盖主链路节点：
   - 无入口 → `CHOOSE_ENTRY` + `ENTRY_MENU`
   - dump/render 后 pending → `A_ANALYZE_EVENT` + apply command
   - 错 evt / 无入口 apply → exit 20，impl 不变
   - 队列已清未整页确认 → `B_CONFIRM_FULL_PAGE`；`--mark` 拒绝
   - 无 device → `D_CHOOSE_DEVICE`；真实验收 assert 拒绝
3. **CI**：push / PR 跑黄金轨迹（即现有 + 本文增补的 `node --test`），失败不可合并。
4. **不测**：三平台聊天措辞、真 xlsx 下载示意图、Playwright 真站、HOW 字段字节级相同。

验收口径：

```text
同一 commit + 同一 fixture
在 CI 与本地
nextTask.id / command / prompt 与锁定快照一致
跳步改盘用例全拒绝
```

---

## 3. 目录结构（本次允许改动）

```text
bella-tracking/
├── SKILL.md
│     # 可加 2～4 行：以本仓库 scripts/ 为准，不要用家目录旧 Skill 副本跑命令
├── reference/
│   └── workflow-next-task.md        # 补：checkout = 本仓库；command 只跑这份 scripts
├── fixtures/workflow-golden/        # 新增（或沿用测试里已有 tmp fixture，抽成稳定目录）
│   ├── choose-entry/
│   ├── analyze-pending/
│   ├── confirm-full-page/
│   └── choose-device/
│       └── （最小 docs/tracking/impl/.../_raw 事实；无真实密钥）
├── scripts/workflow/
│   └── tracking-workflow.test.js    # 黄金轨迹读 fixtures/；保持不启浏览器
├── .github/workflows/
│   └── golden-workflow.yml          # 新增：node --test
└── tasks/
    └── P2-1-shared-checkout-golden-ci.md  # 本文
```

若现有测试已自建 tmp fixture 且稳定，允许**先不抽目录**，CI 只跑现有测试。抽 fixture 目录不是完成门禁，**CI 全绿 + 第 7 节用例都在 CI 里跑到** 才是门禁。

禁止改：

```text
impl / events / adaptor 字段语义
为三平台写三份 SKILL.md
在 CI 里跑 dump 真网 / Playwright 真站
```

---

## 4. 同一 checkout（文档契约，不做平台插件）

写进 `SKILL.md` 或 `workflow-next-task.md` 的短约定：

```text
1. 以当前 git 仓库根为 cwd。
2. 只执行该根下的 node scripts/...（即 nextTask.command）。
3. 若平台 Skill 目录与本仓库不是同一 checkout：以本仓库脚本为准，不要跑 ~/.cursor 或 ~/.codex 里的旧 scripts。
```

本次**不做**：

- Cursor / Claude / Codex 的自动 sync hook
- 把本仓发布到三套市场的流水线
- MCP 浏览器替代 `confirm-event`

平台 hook 仍是 follow-up（P0-4 §6）。

---

## 5. 黄金轨迹（程序）

最小节点闭集（与已有测试对齐，缺则补）：

| 轨迹点 | 期望 |
|---|---|
| 无 `--entry` / `--run` | `CHOOSE_ENTRY`，`prompt === ENTRY_MENU` |
| `--run=A` 后 pending | `A.done === false`，`A_ANALYZE_EVENT` |
| apply 错 evtId | exit 20，第一条仍 pending |
| 无 B.done | `B_CONFIRM_FULL_PAGE`，`--mark` 拒绝 |
| C 后无 device | `D_CHOOSE_DEVICE` |
| 同一 fixture 跑两次 status | `nextTask` 稳定（P0-2） |

快照锁的是 `id` / `command` 前缀 / `prompt` 常量引用，不锁时间戳、不锁本机绝对路径。

---

## 6. CI

建议 `.github/workflows/golden-workflow.yml`：

```text
on: pull_request, push (main / 默认分支)
runs-on: ubuntu-latest
steps:
  - checkout
  - setup-node（LTS，与本地一致即可）
  - node --test scripts/workflow/tracking-workflow.test.js
    （若有 docs-cli-contract.test.js 一并列入）
```

不装 Playwright 浏览器（本轨迹不启浏览器）。不访问外网下示意图。

---

## 7. 必须增加的测试 / 门禁

1. 现有 P0-2 / P0-3 / P0-4 测试在 CI 跑绿。
2. 若抽 `fixtures/workflow-golden/`：每个子目录有 README 一行说明对应轨迹点；测试只读不写回 git。
3. **不**在 CI 断言三平台产品 UI。

运行（本地与 CI 同一条）：

```bash
node --test scripts/workflow/tracking-workflow.test.js
```

---

## 8. 实施顺序

1. 确认 P1-1 已合入，或先让 CI 只跑现有测试、文档扫描随后加。
2. 加 `.github/workflows/golden-workflow.yml`。
3. 需要时把内联 tmp fixture 抽到 `fixtures/workflow-golden/`。
4. `SKILL.md` / `workflow-next-task.md` 补同一 checkout 短约定（不超过 4 行，禁止 SKILL 重新膨胀）。
5. 用空 PR 或本 PR 看 CI 绿。
6. 写第 10 节报告。

不要顺手做真仓 E2E 或发布 Skill 包。

---

## 9. 兼容与风险

- GitHub Actions 权限：本仓需允许 workflow。
- fixture 不得含业务仓源码或 cookie。
- 旧平台 Skill 副本不会被 CI 删除；文档约定 + 同一 commit 是唯一约束。

---

## 10. 实施结束后必须报告

```text
1. 修改 / 新增文件列表
2. CI workflow 名与触发条件
3. 黄金轨迹覆盖的 nextTask.id 列表
4. 是否抽取 fixtures/ 目录
5. checkout 约定写在哪个文件
6. 测试命令与 CI 链接
7. follow-up：平台 sync hook、真仓 E2E、Playwright CI
```

Scope：只做本文第 2 节。P1-1 未做完不要在本文里清 skillDir。
