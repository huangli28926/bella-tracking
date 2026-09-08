# P1-1 补充指示：Test Integration

## 目标

当前 `parameter-schema.test.js` 已经覆盖 P1-1 的核心规则，但还需要保证：

> 这些测试可以通过仓库统一命令稳定执行，而不是依赖 Agent 手动记得运行某个单独测试文件。

本补充任务只解决测试接入问题。

不得修改 P1-1 的业务逻辑、Schema 设计或参数解析规则。

---

## 需要完成的工作

优先检查仓库当前是否已经存在统一测试入口。

例如：

```text
package.json scripts
已有 test runner
已有 scripts/test.js
已有 CI test command
```

如果已经存在统一入口：

```text
直接把 parameter-schema.test.js 接入现有入口
```

不要新建第二套测试体系。

如果当前没有统一入口，则增加最小测试命令，例如：

```json
{
  "scripts": {
    "test": "node --test scripts/**/*.test.js"
  }
}
```

具体 glob / command 必须以当前 Node 版本和仓库实际文件结构能够正确执行为准。

禁止为了本任务引入：

```text
Jest
Vitest
Mocha
新的 test framework
新的 build system
```

当前已有测试使用：

```js
require('node:test')
```

因此优先继续使用 Node 原生 test runner。

---

## 必须验证

完成后至少执行：

```text
npm test
```

并确认：

```text
parameter-schema.test.js
```

确实被执行。

不能只证明：

```text
node scripts/accept/parameter-schema.test.js
```

可以通过。

必须证明统一测试入口会包含它。

---

## 回归要求

统一测试命令不得只包含 P1-1。

如果仓库中已经存在其它：

```text
*.test.js
```

原则上应一起执行。

目标是逐步形成：

```text
npm test
↓
workflow determinism tests
path determinism tests
parameter schema tests
后续 confidence determinism tests
```

而不是：

```text
npm run test:p1-1
npm run test:p0-4
npm run test:p1-2
```

形成大量阶段专属命令。

可以保留专项测试命令作为调试入口，但：

```text
npm test
```

必须是完整统一入口。

---

## 不允许修改

本补充任务禁止修改：

```text
schemas/impl.schema.json 的 P1-1 语义

evidence enum

scopeReachable 规则

conflicts 规则

confidence 行为

parameter discovery

accept-chain

Runtime Resolver
```

除非为了修复“测试无法运行”的纯工程错误，且必须说明原因。

---

## CI 边界

本次补充优先完成：

```text
统一 test command
```

暂时不要求新增 GitHub Actions / Jenkins / GitLab CI。

也就是说：

```text
P1-1 Closure 必需：
npm test 能稳定执行全部测试

后续工程增强：
CI 自动调用 npm test
```

不要为了本补充任务扩大到 CI 平台建设。

---

## 验收标准

只有以下全部满足才算完成：

```text
[ ] package.json 或现有测试入口提供统一 test command

[ ] npm test 能成功执行

[ ] parameter-schema.test.js 被 npm test 实际执行

[ ] 仓库已有其它 test 文件未被遗漏

[ ] 没有引入新的 test framework

[ ] 没有修改 P1-1 参数业务逻辑

[ ] 没有修改 confidence 行为

[ ] 没有修改 accept-chain / Runtime
```

---

## Codex 最终输出

完成后只需要汇报：

```text
Modified Files

Unified Test Command

Executed Tests

Result

Not Changed
```

其中必须明确写出实际执行命令，例如：

```text
npm test
```

以及：

```text
passed: X
failed: 0
```

同时说明：

```text
parameter-schema.test.js confirmed executed
```

---

## 本补充任务的定位

这一步不是增强参数解析能力。

它解决的是：

```text
P1-1 规则已经正确
↓
以后任何 Agent 修改代码
↓
统一测试自动证明这些规则没有被破坏
```

因此它属于：

> **Determinism Regression Protection**

而不是新的参数事实层或新的业务能力。
