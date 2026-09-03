# 调用适配（二次封装）

Skill 不写死 `sendLog` 或任何项目函数名。进仓后跑 `detect-adaptor.js`，读 `_raw/adaptor.json`。

## 分层

| 层 | 来源 | 用途 |
|---|---|---|
| SDK | `sdk/*.json` | 公司协议；验收 hook |
| 调用适配 | 探测产物 `_raw/adaptor.json` | 这个仓 / 这个文件怎么调 SDK |
| 落库 `code` | 按 adaptor 渲染 | 跟随落点文件，不跟随「全公司统一函数名」 |

## 探测顺序

1. 人工锁定 `docs/tracking/adaptor.json` 或 `.tracking/adaptor.json`（可无；只覆盖 `sdkId` / `defaultStyleId`）
2. HTML / ejs 脚本 URL → SDK 档案
3. 源码里谁转调 `$ULOG.send(变量, …)` 且被 export → 二次封装（记下函数名、import 路径、参数映射）
4. 每个业务文件统计：封装调用 vs SDK 直调 vs v3 便捷方法 vs DOM
5. `defaultStyleId` = 全仓出现最多的写法

## 写码规则（跟随落点文件）

1. `targetFile` 已有写法 → 用 `fileStyle[targetFile]`
2. 否则同目录最常见写法
3. 否则 `defaultStyleId`
4. 再否则 SDK 直调 `$ULOG.send`
5. **禁止**在没有该封装的仓里生成封装名
6. **禁止**为了统一把旧页直调改成封装
7. DOM 声明式（`CLICKDATA`）标 `styleId: dom-attr`，路径 C 须用户确认后再改 HTML
8. **禁止删除旧埋点**：路径 C / H 只新增本期或缺失的 evtId，或在**同一 evtId 原调用处**改参数。不要删仓内已有的 `$ULOG.send` / 封装调用 / DOM 埋点（含本期文档未列出的 evtId）。若 diff 出现净删除，跑 `check-old-tracking.js` 后停下来让用户确认；未回复「确认删除」则撤回删除。
9. **路径 H / `found[]`**：已扫描到的 evtId 标 `existing`，禁止整段删了重写到别处。
10. **`trackingMode=backfill`**：`targetFile` 跟历史 UI 所在文件的 `fileStyle`，不要因为文件不在本期 diff 就改用 `defaultStyleId` 或新文件。未配置 `trackingMode` 时不启用本条，按全局查找 + 落点文件已有写法。

用 `render-snippet.js` 的 `pickStyle` / `renderSnippet`；模型写 `impl.code` 时同样遵守。探测失败时 `code` 写成 SDK 直调。

`{{uicode}}` **只填 `events.json` 的文档值**。禁止按路由、现网调用或 impl 字段改写。保存 / 渲染 / 建链脚本会把 snippet 里的 uicode 强制改回文档值。

## 源码根目录

历史扫描与落库/写码共用 `scripts/lib/source-roots.js`。

1. **优先 `.env`**：`sourceRoot`（也认 `SOURCE_ROOT` / `TRACKING_SOURCE_ROOTS`），逗号分隔多根。配置了则只扫这些路径；任一路经不存在则报错，不回退探索。
2. **未配置**：自动探索仓库内名为 `src` / `app` / `pages` / `views` 且含源码的目录。
3. **永不扫描**仓库根下的 `docs/`（含 env 指向 `docs` 会报错）。

`adaptor.sourceRoots` 与 `sourceRootMode`（`env` | `explore`）写入探测产物。Grep evtId / 写业务代码用这些目录。
