# 历史埋点关系（静态扫描）

不读 `.env` seedUrl。只根据源码里的埋点写法和路由表建图。

## 扫描范围

- 源码根与落库/写码相同：优先 `.env` `sourceRoot`，未配置则自动探索；**不扫仓库根 `docs/`**
- 路由：优先 webpack 入口里**实际被页面加载**的包（在源码根内的模板里出现 `/js/{entry}.js`）。未接入的入口及其路由表不扫。探测不到加载关系时，回退扫各源码根下 `pages/*/index.jsx` 与 `configs/routeData.js`
- 排除：`/test/`、`/error/`
- 无 `routerData` 的入口页：用 `@router` 注释，否则 `/{目录名}`
- 每页组件树：从入口沿相对 import 与该源码根下的别名（`pages/`、`components/`…）走，最深 18 层
- 不跟随 npm 包、样式、图片
- 扫不到路由时：仍扫描各源码根内的埋点调用，记为 `/`
- 不写死某个项目的路由名；`/` 若属于未加载入口才会消失，真实 SPA 首页仍保留

## 埋点调用

先跑 `detectAdaptor`，用探测到的二次封装名（本仓常见 `sendLog`）+ `$ULOG.send`。

计入：

- `sendLog('Module_Click', '95180', …)`（含多行）
- `window.$ULOG.send('88507', { event: 'Module_Click', … })`

跳过：注释掉的调用；evtId / eventType 不是字符串字面量的调用；封装定义文件里的转调。

同一 evtId 在不同行各记一条。公共组件被多个路由 import 时，每个路由各列一次；汇总「埋点」按 `file:line:evtId` 去重。

## 跳转边

从该页组件树里扫：

- `history.push` / `history.replace`（字符串、模板字符串、`'…' + var` 拼接、`{ pathname }`）
- `to="…"` / `to={'…'}`（Link）

目标 path 去掉 query 后与已知路由最长前缀匹配。来源=当前路由。同一对来源→目标→方式合并，触发次数为代码处数。

路径 C 锁旧页新埋点的验收入口时，复用同一套入边扫描，再和 `.env` `trackingBaseline` 的 diff 对比（`scripts/accept/resolve-entry-path.js`）。该脚本不写 HTML 关系图、不改业务源码。

## 产物

```
docs/historyTracking/YYYY/MMDD_HHmmss.html
docs/historyTracking/YYYY/_raw/MMDD_HHmmss.json
```

HTML 版式对齐既有「埋点关系图」：汇总卡、页面与埋点、页面跳转。页头为「全仓静态扫描」，无种子 URL。

## 文档 vs 代码（入口 7）

`diff-doc-vs-history.js --excel=docs/{文档}.xlsx`：文档 `events.json` 的 evtId 减扫描 JSON 里 `pages[].events[].evtId`。无可用 xlsx 时打印 `prompts.ASK_HISTORY_EXCEL` 并以 exit 2 退出。不改业务源码。

缺失 JSON 是路径 H 的输入，不是写码许可。补全前由模型给每条 missing 分类：`literal_missing` / `dynamic_id` / `commented_out` / `feature_removed`。只有 `literal_missing` 才新增调用。补全完成后必须再跑一次本脚本。

`.env` `trackingMode` **无默认值**。未配置时路径 A/H 仍全局搜 `sourceRoots`（env 或探索结果，不含 `docs/`）。仅 `trackingMode=backfill` 时旧页优先、验收不锁 `new_jump`。
