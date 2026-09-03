# 公司 SDK 档案

Skill **只认识贝壳 dig-log SDK**。业务二次封装不写在这里，进仓后由 `detect-adaptor.js` 探测。

验收永远 hook SDK 主方法 `$ULOG.send(evtId, payload)`。v3 便捷方法 / `LIANJIA_TRACK.send` / 项目封装最终都会进这里。

上报像素（验收额外监听 HTTP 状态）：

- 测试：`http://dig.lianjia.com/check.gif`
- 线上：`https://dig.lianjia.com/alliance.gif`

档案字段 `reportUrlIncludes`。新域名只改 `sdk/*.json`。

## 1.3.0

脚本：`//s1.ljcdn.com/dig-log/static/1.3.0/lianjiaUlog.js`

```js
window.$ULOG.send(evtId, payload, callback?)
// payload 典型字段：event / pid / uicode / action
```

无便捷方法、无 DOM 声明式、无必填校验。档案：`sdk/lianjia-ulog-1.3.json`。

## v3（3.9.0）

脚本：`//s1.ljcdn.com/dig-log/static/v3/lianjiaUlog.js`

底层仍是 `$ULOG.send(evtId, payload)`。额外：

```js
$ULOG.sendModuleClick(evtId, payload)  // event = Module_Click
$ULOG.sendModuleView(evtId, payload)   // event = Module_View
$ULOG.sendPageView(payload)            // evt = 1,3 ；event = Page_View
new LIANJIA_TRACK(cfg).send(evtId, event, action)
```

DOM：`CLICKDATA` / `VIEWDATA` + `data-click-evtid` / `data-view-evtid`。缺 `pid` / `event` / `evt` / `uicode` 会 `console.error`。档案：`sdk/lianjia-ulog-v3.json`。

## 探测

看 HTML / ejs 的 `<script src>` 是否包含 `scriptIncludes`。对不上则默认 1.3.0（hook 仍兼容，因为 v3 也走 `$ULOG.send`）。新版本只加 `sdk/*.json`，不改主流程。
