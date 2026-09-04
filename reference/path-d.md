# 路径 D：关键验收

**先做**
1. 确认 `impl.json` 已有 `pageKey` + `accept.trigger`；缺则先补再 `build-accept-chain.js`。
2. `validate-impl.js --excel=...` 无 error 后再继续；`--plan-only` 把路径给用户看。

**确认后跑**
0. **设备选择（硬规则）**：非 `--plan-only` 启动 Playwright 前，若命令与 `.env` 都没有 `device` / `acceptDevice`，必须停下并原样列出（不要替用户选）：

设备文案只使用 `prompts.DEVICE_PROMPT`（`accept-device.js` / `--status` 的 `D_CHOOSE_DEVICE.prompt`）。

用户回复后带 `--device=mobile` 或 `--device=pc` 再跑。也可写仓库根 `.env` 的 `acceptDevice=mobile|pc`。`--plan-only` 可不选设备。
1. `run-accept.js`（可 `--evt=` 精点）。按 adaptor.sdkId 注入 SDK hook（默认拦 `$ULOG.send`），发出时抄到 sessionStorage 与 Playwright binding（点击后跳走仍能对账）。上报 GIF 挂在 BrowserContext 的 request/response，并拦 Image.src / sendBeacon 做 persist：跳页打断响应仍算已捕获请求。同 path 内若某条 click 阻断后续，脚本自动 skip 该条并恢复种子入口继续；漏判时对话模型可 `--skip-evt=` 再跑 1 轮。
2. 根目录 `.env`：`baseUrl`=origin，`seedUrl`=完整 path+query（禁止删减）。`trackingBaseline` 仅用于 A/C 锁定本期入口（缺省 `master`），`run-accept` 不读。每条 path 都 `goto(seed)` 再点到子页。
3. Playwright 视口由 `--device` 决定：`mobile` = iPhone 13（390×844，touch + iPhone UA）；`pc` = 1440×900 桌面 UA。遇登录页先登录，态写入 `docs/tracking/.auth/storage.json` 复用。click / sharedSteps 先等 DOM `attached`，不在可视区则 `scrollIntoView`（含内部滚动容器兜底）后再点；禁止因「未进视口」当成找不到节点。
4. 报告每条三图：`accept/shots/{evtId}.png`（滚入视口后、click 前截按钮；view 在 trigger 后截视口）+ `accept/shots/{evtId}-page.png`（按钮所在完整页面，含内部滚动容器兜底）+ `_raw/images/{evtId}.png`。验收 JSON / HTML 写入当时完整 `pageUrl`（可复制）。
5. 失败会额外写 `accept/_diagnostics/{evtId}-*.json/png`，含当前 URL、标题、可见候选元素、已采集日志和失败截图，用于快速修 trigger / sharedSteps。

**断言要点**（详 `reference/accept-assert.md`）
- 必须发出：evtId + eventType；`uicode` 以文档为准，有 expect 则必须一致（空上报也 fail）。
- 必须捕获上报 GIF（测试 `check.gif` / 线上 `alliance.gif`）。请求已发出即算捕获（含跳页导致无响应）。完全未捕获 → `fail`。HTTP 非 2xx 只展示、不改 pass/fail。
- `'-'` / 空 / 缺失 → 不判 fail，写入 `emptyParams`，`summary.needConfirm` 提醒人工确认。
- plan-only 的 skip 不算失败。
- 同 path 上某条 click 离开页面或点完后下一条找不到目标：脚本自行把本条标为 **路径跳过**（`reason=path_blocker` + `skipReason`），恢复种子入口后继续后续埋点。用户无需事先勾选。对话模型若发现连锁失败漏判，可对挡路 evtId **最多再跑 1 轮** `--skip-evt=`（仍算 D，不算 E）。
- 找不到点击目标（未点下去）仍记 **fail**，不因「怕挡住后面」改成 skip。

**交付**
- `accept/{文档名}-验收.html`（含 `fired.action` 与 `http` 状态，如 `200 OK`）。
- 真实验收（非 plan-only）**无论 fail/skip 多少** 都生成 `{文档名}-终稿.html` 并打开；终稿是结果快照。plan-only 不生成终稿。`--no-open` 可关掉自动打开。

**验收失败（硬规则）**
1. 按 `reference/accept-fail-explain.md` **原样结构**输出总览（状态句 → 验收失败 → 通过 → 报告 → C 落点 → 请选择）。禁止只贴 evtId / `not_fired`。
2. 对每条 `status=fail`：读 `results[].reasonZh`、`failFacts` / `failFactsZh` 与 `accept/_diagnostics/`；主文案用中文判定名（如「事件未触发」），机器码只可写在括号里。
3. 由**当前对话模型**写一句根因。不得改写脚本判定（`fired` 为空就不能说已触发）。有把握时把全文写入该条 `failExplain` 并重渲验收 HTML。
4. 给出验收 HTML 与 `accept/_diagnostics/`。
5. **必须原样列出两个选择**（不要增删、不要替用户选）。未回复 → 停在报告，**不改代码、不进入 E、不打开 B**。
6. 用户选 **1 自修复** → 进入路径 E，只修 1 轮；仍失败则自动打开人工矫正页（路径 B，禁止整轮 `--no-open`；服务已在跑则 `--force-open` 打开失败 evtId），优先带失败 evtId。
7. 用户选 **2 直接重新进入人工矫正页面** → 跳过 E，立刻跑路径 B（`serve-impl` / `confirm-event --force-open` 或 `confirm-sweep`，禁止整轮 `--no-open`），打开失败项矫正向导。

D 失败结束时**必须原样列出**（可替换花括号内容，不得改选项含义）：

失败二选一只使用 `prompts.D_FAIL_CHOICE`（`format-fail-explain` / `run-accept` / `D_CHOOSE_REPAIR.prompt`）。

---
