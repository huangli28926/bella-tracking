1. **选 C：先做 MVP，Schema 预留完整模型，但本期不强制启用。**

本期目标优先解决实际问题：

```text
AI 已经推断出候选
→ 不再清空
→ 确认页直接预填
→ 用户确认 / 修改
```

暂时不要一次性引入完整 `resolution / origin / previousInference` 模型，避免和现有 P1-5 confirmation Contract 同时大改。

---

2. **保持现有 `high | medium | low`，不改成 0–1。**

原因：

```text
confidence
=
确定性程序根据 evidence 推导的结果
```

当前 P1-5 已经对 confidence 做了确定性收敛，本次不要重新打开这个问题。

UI 可以显示：

```text
high   → 高可信
medium → 中可信
low    → 低可信
```

但底层 Contract 不改。

---

3. **沿用现网 autoReady 规则。**

即：

```text
定位明确
+
Parameter Gate = READY
+
uniqueness / scopeReachable 等确定性条件满足
→ autoReady
→ 不要求人工确认
```

只有：

```text
存在不确定候选
```

才进入人工 Review。

不要改成“所有 AI 推断都必须点确认”，否则会降低自动化率。

---

4. **同意 Cursor 的建议。**

不要新增一套和现有状态冲突的 `status`。

保持：

```text
event.status
=
pending / existing / located / unresolved
```

参数继续复用：

```text
confirmation.status
=
unconfirmed / confirmed / reused / stale
```

本期“AI 推断但待确认”可以表达为：

```text
已有候选值
+
confirmation.status = unconfirmed
+
needsConfirm = true
```

不要再额外引入参数级 `status=inferred`。

后续如果真的需要完整 resolution 模型，再统一升级。

---

5. **同意：事件级 `unresolved[]` 闭集不放开。**

继续保持现有稳定 Contract：

```text
请确认埋点位置
请确认参数 {key} 的取值
```

详细原因不要塞进去。

详细原因放到已有或新增的结构化 evidence / unresolved detail 中，例如：

```json
{
  "unresolvedCodes": [
    "MULTIPLE_REUSABLE_COMPONENT_CALLERS"
  ]
}
```

确认页再把它翻译成人可读说明。

这样不会破坏跨 Agent 稳定性。

---

6. **基本同意，但要加一个限制。**

必须保留：

```text
candidates[]
```

用户不应该重新输入。

推荐逻辑：

```text
存在唯一最佳候选
→ 写入 preferred candidate
→ 保留全部 candidates[]
→ needsConfirm = true

多个候选完全同档、无法确定 preferred
→ preferred/value 可以为空
→ candidates[] 必须完整保留
→ 用户从候选中选择
```

也就是说：

> 不能为了“预填”而强行制造一个实际上不存在的最佳候选。

如果证据已经能够排序出第一候选，可以预填；如果证据完全打平，就展示候选列表让用户选择。

---

7. **第一期不做 locator。**

这里需要明确：

```text
trigger ≠ lifecycle
```

不要直接做字段映射。

`lifecycle` 是：

```text
代码实现语义
```

例如：

```text
onClick
useEffect
IntersectionObserver
```

而验收里的 `trigger` 是：

```text
Runtime 最后触发动作
```

例如：

```text
click
scrollIntoView
waitVisible
pageEnter
```

两者可能有关，但不是同一个事实。

因此本期范围：

```text
代码定位 / 参数取值确认
```

继续处理：

```text
targetFile
functionName
lifecycle
parameter expression
sourcePath
```

`locator / accept trigger` 仍留在 `build-accept-chain` 阶段处理，不要混进 Fixbug1。

---

## 本期范围最终确认

可以按下面范围实施：

```text
1. AI 有候选时必须保留候选
2. medium / low confidence 不得直接清空 expression
3. candidates[] 必须保留
4. 确认页展示 AI 推断结果
5. 用户操作改成：
   确认 / 修改 / 从候选中选择
6. 只有 AI 真正无法产生候选时才允许空输入
7. 人工确认后写回现有 confirmation 状态
8. autoReady 继续沿用现有确定性 Gate
```

本期不要做：

```text
全面重构 impl.schema
0–1 confidence
新的 inferred/confirmed/unresolved 状态体系
locator Review
accept trigger Review
修改 accept-chain 主结构
```

一句话作为本次实现原则：

> **AI 有真实证据形成候选时必须先给出候选；人工只审核、纠正或在候选之间选择。只有没有可用候选时，才要求人工补充。**
