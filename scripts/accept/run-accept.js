#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { findRepoRoot, parseArgs, readJson, writeJson, envAcceptUrls, toPosix, readDotEnv } = require('../lib/lib')
const {
  ACCEPT_LOG_PERSIST_KEY,
  ACCEPT_GIF_PERSIST_KEY,
  attachAcceptLogSink,
  buildAcceptHook,
  createAcceptLogSink,
  defaultProfile,
  isReportUrl,
  loadSdkProfiles,
  parseEvtIdFromReportUrl,
  profileById
} = require('../lib/sdk')
const {
  buildAcceptChain,
  defaultAcceptPaths,
  describeSteps,
  filterChainByEvt
} = require('./accept-chain')
const { buildAcceptReport, collectEmptyParams, enrichReportMedia, renderAcceptReport } = require('./accept-report')
const { lockChainExpect, lockImplPayload } = require('../lib/lock-doc-uicode')
const { runtimeKeepLockedPath } = require('./resolve-accept-path')
const {
  defaultStoragePath,
  ensureLoggedIn,
  isLoginUrl,
  saveStorage,
  waitUntilLoggedIn
} = require('./accept-auth')
const { assertValidImpl } = require('./validate-impl')
const { deviceLabel, requireAcceptDevice, resolveAcceptDevice, viewportForDevice } = require('./accept-device')
const {
  DEFAULT_PORT,
  PORT_ATTEMPTS,
  findExistingServer,
  openBrowser,
  shouldOpenBrowser
} = require('../confirm/serve-impl')
const { SKILL_ROOT } = require('../lib/skill-paths')
const {
  isClickTarget,
  isDomMiss,
  mayBlockRest,
  pageLeftPath,
  setupSkipOutcome,
  skipReasonFor,
  toSkipOutcome
} = require('./path-blocker')
const {
  captureRuntimeExpectedSnapshot,
  resolveDataDeps
} = require('./runtime-data-dep')
const {
  compareDataDepResults,
  compareLegacyAssertParams,
  eventOutcomeFromDataDeps
} = require('./compare-data-dep')
const {
  attachApiRuntimeCollector,
  createApiRuntimeStore,
  resetApiRuntimeStore
} = require('./runtime-api-store')

const SCRIPT_DIR = __dirname

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function resolveAcceptProfile(adaptorPath) {
  const adaptor = readJson(adaptorPath, null)
  const profiles = loadSdkProfiles()
  return profileById(adaptor && adaptor.sdkId, profiles) || defaultProfile(profiles)
}

function resolveAcceptHook(adaptorPath) {
  return buildAcceptHook(resolveAcceptProfile(adaptorPath))
}

const REPORT_GIF_MISSED =
  '未捕获到埋点上报 GIF。引入 dig-log SDK 后 GIF 一定能捕获到，请确认页面是否已引入 lianjiaUlog.js，并排查脚本未加载、被拦截或未真正发出。'

function emptyHttp(error, reasonZh) {
  return {
    ok: false,
    status: 0,
    statusText: '',
    url: '',
    method: '',
    matched: false,
    error: error || '',
    source: '',
    reasonZh: reasonZh || '采集窗口内未听到匹配的上报 GIF 请求（网络监听、Image.src、sendBeacon 均无）'
  }
}

function httpRank(record) {
  const status = Number(record && record.status) || 0
  if (status >= 200 && status < 300) return 50
  if (status > 0) return 40
  const source = (record && record.source) || ''
  if (source === 'requestfailed') return 30
  if (source === 'request') return 20
  if (source === 'hook') return 10
  return 0
}

function explainHttp(record) {
  const status = Number(record && record.status) || 0
  const source = (record && record.source) || ''
  const err = String((record && record.error) || '')
  const statusText = String((record && record.statusText) || '')
  if (status >= 200 && status < 300) {
    return { kind: 'ok', reasonZh: '' }
  }
  if (status >= 400) {
    return {
      kind: 'http_error',
      reasonZh: '像素请求有响应但 HTTP ' + status + (statusText ? ' ' + statusText : '') + '，未拿到成功状态'
    }
  }
  if (
    source === 'requestfailed'
    || /ERR_ABORTED|NS_BINDING_ABORTED|net::ERR|requestfailed/i.test(err)
  ) {
    return {
      kind: 'aborted',
      reasonZh: '像素请求已发出，但被页面跳转或卸载中断，未采到 HTTP 响应'
        + (err ? '（' + err + '）' : '')
    }
  }
  if (source === 'hook' || statusText === 'hook') {
    return {
      kind: 'hook_only',
      reasonZh: '仅从 SDK 侧拦到 Image.src / sendBeacon，网络层未采到 HTTP 响应（常见于点击后立刻跳页）'
    }
  }
  if (source === 'request' || statusText === 'requested') {
    return {
      kind: 'no_response',
      reasonZh: '网络层已见到 GIF 请求发出，采集窗口内未等到 HTTP 响应（可能被跳页取消）'
    }
  }
  if (status === 0) {
    return {
      kind: 'no_response',
      reasonZh: '已匹配到 GIF，但未采到 HTTP 状态（status=0）'
    }
  }
  return {
    kind: 'http_error',
    reasonZh: 'HTTP ' + status + (statusText ? ' ' + statusText : '')
  }
}

function toHttpResult(record) {
  if (!record) {
    return emptyHttp('no matching report request')
  }
  const status = Number(record.status) || 0
  const explained = explainHttp(record)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: record.statusText || (status === 200 ? 'OK' : ''),
    url: record.url || '',
    method: record.method || 'GET',
    matched: true,
    error: record.error || '',
    source: record.source || '',
    reasonZh: explained.reasonZh
  }
}

function urlContainsEvtId(url, evtId) {
  const id = String(evtId || '')
  if (!id) {
    return false
  }
  const text = String(url || '')
  let decoded = text
  try {
    decoded = decodeURIComponent(text)
  } catch (error) {
    decoded = text
  }
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('(?:^|[?&]|[=,"\'])' + escaped + '(?:&|$|[,"\'])').test(decoded)
    || decoded.indexOf('evt=' + id) !== -1
}

function pickHttp(records, since, evtId) {
  const id = String(evtId)
  const windowed = (records || []).filter(item => item.t >= since - 50)
  const exact = windowed.filter(item => String(item.evtId) === id)
  const fuzzy = windowed.filter(item => urlContainsEvtId(item.url, id))
  const pool = exact.length ? exact : fuzzy
  if (!pool.length) {
    return null
  }
  let best = pool[0]
  for (let i = 1; i < pool.length; i += 1) {
    const item = pool[i]
    const rankDiff = httpRank(item) - httpRank(best)
    if (rankDiff > 0 || (rankDiff === 0 && item.t >= best.t)) {
      best = item
    }
  }
  return best
}

function normalizeGifRecord(item) {
  const url = (item && item.url) || ''
  return {
    t: (item && item.t) || Date.now(),
    url,
    method: (item && item.method) || 'GET',
    status: Number(item && item.status) || 0,
    statusText: (item && item.statusText) || '',
    error: (item && item.error) || '',
    evtId: (item && item.evtId) || parseEvtIdFromReportUrl(url),
    source: (item && item.source) || ''
  }
}

async function readPageGifs(page) {
  const persistKey = ACCEPT_GIF_PERSIST_KEY
  try {
    return await page.evaluate(function (key) {
      try {
        var prev = JSON.parse(sessionStorage.getItem(key) || '[]')
        return Array.isArray(prev) ? prev : []
      } catch (error) {
        return []
      }
    }, persistKey)
  } catch (error) {
    return []
  }
}

async function waitForReportHttp(records, since, evtId, timeoutMs, extra) {
  const deadline = Date.now() + (timeoutMs || 2000)
  while (Date.now() <= deadline) {
    let all = (records || []).slice()
    if (extra && extra.gifSink && extra.gifSink.logs) {
      all = all.concat(extra.gifSink.logs.map(normalizeGifRecord))
    }
    if (extra && extra.page) {
      const persist = await readPageGifs(extra.page)
      all = all.concat((persist || []).map(normalizeGifRecord))
    }
    const hit = pickHttp(all, since, evtId)
    if (hit) {
      return toHttpResult(hit)
    }
    await sleep(100)
  }
  return emptyHttp('no matching report request')
}

function attachReportListener(page, profile) {
  const records = []
  function pushRecord(entry) {
    records.push(Object.assign({
      t: Date.now(),
      url: '',
      method: 'GET',
      status: 0,
      statusText: '',
      error: '',
      evtId: '',
      source: ''
    }, entry, {
      evtId: parseEvtIdFromReportUrl(entry.url)
    }))
  }
  const bus = (page.context && page.context()) || page
  bus.on('request', request => {
    const url = request.url()
    if (!isReportUrl(url, profile)) {
      return
    }
    pushRecord({
      url,
      method: request.method(),
      status: 0,
      statusText: 'requested',
      error: '',
      source: 'request'
    })
  })
  bus.on('response', response => {
    const url = response.url()
    if (!isReportUrl(url, profile)) {
      return
    }
    pushRecord({
      url,
      method: response.request().method(),
      status: response.status(),
      statusText: response.statusText() || '',
      error: '',
      source: 'response'
    })
  })
  bus.on('requestfailed', request => {
    const url = request.url()
    if (!isReportUrl(url, profile)) {
      return
    }
    const failure = request.failure && request.failure()
    pushRecord({
      url,
      method: request.method(),
      status: 0,
      statusText: '',
      error: (failure && failure.errorText) || 'requestfailed',
      source: 'requestfailed'
    })
  })
  return records
}

function printHelp() {
  console.log(`
run-accept — 按 accept-chain 精点验收（只点目标埋点）

Usage:
  node run-accept.js --excel=docs/2.3埋点需求文档.xlsx --plan-only
  node run-accept.js --excel=... --device=mobile
  node run-accept.js --excel=... --device=pc --evt=95941,95942

Options:
  --excel            推断 impl / chain / 报告路径
  --evt              只验收这些 evtId
  --skip-evt         强制跳过这些 evtId（对话模型补跑挡路项时用；日常由脚本自行判断）
  --plan-only        只生成路径和报告，不启动浏览器
  --rebuild          忽略已有 accept-chain.json，从 impl 重建
  --write-impl       重建时把 accept 写回 impl.json
  --base-url         覆盖根目录 .env 的 baseUrl（origin）
  --seed-url         覆盖根目录 .env 的 seedUrl（完整 path+query，不删减）
  --storage-state    登录态 JSON，默认 docs/tracking/.auth/storage.json
  --headless         无头（若跳到登录页会自动改有头等你登录）
  --housedel         只替换种子 URL 里的 housedelCode，其它 query 原样保留
  --device           mobile | pc（真实验收必填；也可写仓库根 .env 的 acceptDevice）
  --no-open          不自动打开终稿 HTML
`)
}

function loadPlaywright() {
  const candidates = [
    path.join(SKILL_ROOT, 'node_modules', 'playwright'),
    path.join(findRepoRoot(SCRIPT_DIR), 'node_modules', 'playwright'),
    'playwright'
  ]
  for (let i = 0; i < candidates.length; i += 1) {
    try {
      return require(candidates[i])
    } catch (error) {
      // continue
    }
  }
  return null
}

function resolveStorageState(repoRoot, value) {
  if (value) {
    return path.isAbsolute(value) ? value : path.resolve(repoRoot, value)
  }
  return defaultStoragePath(repoRoot)
}

function locatorFor(page, by, value, exact) {
  if (!value) {
    return null
  }
  if (by === 'testid') {
    return page.getByTestId(value)
  }
  if (by === 'css') {
    return page.locator(value)
  }
  if (by === 'role') {
    return page.getByRole('button', { name: value, exact: exact !== false })
  }
  return page.getByText(value, { exact: exact !== false })
}

async function scrollNodeIntoView(node) {
  try {
    await node.scrollIntoViewIfNeeded({ timeout: 5000 })
  } catch (error) {
    await node.evaluate(function (el) {
      if (!el || typeof el.scrollIntoView !== 'function') {
        return
      }
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
    }).catch(function () {})
  }
  await sleep(300)
}

async function resolveAttachedNode(page, step, timeoutMs) {
  const values = [step.value].concat(step.alternates || []).filter(Boolean)
  const by = step.by || 'text'
  const firstTimeout = typeof timeoutMs === 'number' ? timeoutMs : 8000
  const tries = []
  values.forEach(value => {
    tries.push({ by, value })
    if (by === 'text' || by === 'css') {
      tries.push({ by: 'role', value })
      tries.push({ by: 'text', value })
    }
    if (by === 'testid') {
      tries.push({ by: 'text', value })
    }
  })
  for (let i = 0; i < tries.length; i += 1) {
    const item = tries[i]
    const loc = locatorFor(page, item.by, item.value, true)
    if (!loc) {
      continue
    }
    const node = loc.first()
    try {
      await node.waitFor({
        state: 'attached',
        timeout: i === 0 ? firstTimeout : Math.min(1500, firstTimeout)
      })
      await scrollNodeIntoView(node)
      try {
        await node.waitFor({ state: 'visible', timeout: 3000 })
      } catch (visibleError) {
        // 已在 DOM 且已尝试滚入视口，交给后续 click / force
      }
      return node
    } catch (error) {
      // try next
    }
  }
  return null
}

async function clickNode(node) {
  await scrollNodeIntoView(node)
  const clickOpts = { timeout: 5000, noWaitAfter: true }
  try {
    await node.click(clickOpts)
  } catch (error) {
    await node.click(Object.assign({}, clickOpts, { force: true }))
  }
}

async function captureElementShot(page, node, shotPath, pad) {
  const padding = typeof pad === 'number' ? pad : 8
  const box = await node.boundingBox().catch(function () { return null })
  if (!box) {
    await node.screenshot({ path: shotPath }).catch(function () {})
    return
  }
  const viewport = page.viewportSize() || { width: 390, height: 844 }
  const x = Math.max(0, Math.floor(box.x - padding))
  const y = Math.max(0, Math.floor(box.y - padding))
  const right = Math.min(viewport.width, Math.ceil(box.x + box.width + padding))
  const bottom = Math.min(viewport.height, Math.ceil(box.y + box.height + padding))
  const width = Math.max(1, right - x)
  const height = Math.max(1, bottom - y)
  try {
    await page.screenshot({ path: shotPath, clip: { x, y, width, height } })
  } catch (error) {
    await node.screenshot({ path: shotPath }).catch(function () {})
  }
}

async function captureViewportShot(page, shotPath) {
  await page.screenshot({ path: shotPath, fullPage: false })
}

async function currentPageUrl(page) {
  try {
    return String(page.url() || '')
  } catch (error) {
    return ''
  }
}

function parseIdList(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map(function (id) { return String(id || '').trim() })
    .filter(Boolean)
}

function forcedSkipSet(opts) {
  const set = {}
  parseIdList(opts && opts.skipEvt).forEach(function (id) {
    set[id] = true
  })
  return set
}

async function probeTrigger(page, target) {
  const trigger = target && target.trigger
  if (!trigger || trigger.kind === 'pageLoad') {
    return true
  }
  const node = await resolveAttachedNode(
    page,
    Object.assign({ action: trigger.kind }, trigger),
    1200
  )
  return Boolean(node)
}

async function gotoSeed(page, context, opts, probeUrl) {
  try {
    await page.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  } catch (error) {
    if (!isLoginUrl(page.url())) {
      throw error
    }
  }
  await sleep(1200)
  if (isLoginUrl(page.url())) {
    console.log('[accept] 登录态失效，请在打开的验收窗口重新登录')
    await waitUntilLoggedIn(page)
    await saveStorage(context, opts.storageState)
    await page.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(1200)
  }
  try {
    await page.evaluate(opts.initScript || resolveAcceptHook(opts.adaptorPath))
  } catch (error) {
    // ignore
  }
}

async function openPath(page, context, pathItem, opts, probeUrl, apiStore) {
  resetApiRuntimeStore(apiStore)
  await gotoSeed(page, context, opts, probeUrl)
  for (let s = 0; s < (pathItem.sharedSteps || []).length; s += 1) {
    await runStep(page, pathItem.sharedSteps[s])
  }
  return {}
}

function toResultRow(pathItem, target, outcome) {
  const locked = runtimeKeepLockedPath(pathItem.pathId, outcome && outcome.status === 'fail' ? outcome : null)
  return {
    evtId: target.evtId,
    eventName: target.eventName || '',
    pathId: locked.pathId,
    status: outcome.status,
    reason: outcome.reason,
    skipReason: outcome.skipReason || '',
    skipKind: outcome.skipKind || '',
    code: target.code || {},
    steps: describeSteps(pathItem, target),
    dataDeps: target.dataDeps || [],
    dataDepResults: outcome.dataDepResults || [],
    assertParams: target.assertParams || [],
    fired: outcome.fired,
    http: outcome.http || null,
    paramDiffs: outcome.paramDiffs || [],
    emptyParams: outcome.emptyParams || [],
    screenshot: outcome.screenshot || '',
    pageScreenshot: outcome.pageScreenshot || '',
    pageUrl: outcome.pageUrl || '',
    diagnostic: outcome.diagnostic || null
  }
}

/** 整页截图：文档可滚则 fullPage；H5 内部滚动容器则截该节点。 */
async function captureFullPageShot(page, shotPath) {
  const handle = await page.evaluateHandle(function () {
    function overflowScroll(el) {
      if (!el || !el.getBoundingClientRect) return false
      var s = window.getComputedStyle(el)
      var oy = s.overflowY || s.overflow
      return oy === 'auto' || oy === 'scroll' || oy === 'overlay'
    }
    var doc = document.scrollingElement || document.documentElement
    var maxDelta = doc ? (doc.scrollHeight - doc.clientHeight) : 0
    var best = null
    var nodes = document.querySelectorAll('body *')
    var limit = Math.min(nodes.length, 800)
    for (var i = 0; i < limit; i += 1) {
      var el = nodes[i]
      if (!overflowScroll(el)) continue
      var delta = el.scrollHeight - el.clientHeight
      if (delta > maxDelta + 40) {
        maxDelta = delta
        best = el
      }
    }
    return best || doc || document.documentElement
  }).catch(function () { return null })
  const el = handle && handle.asElement ? handle.asElement() : null
  if (el) {
    try {
      await el.screenshot({ path: shotPath })
      return
    } catch (error) {
      // fall through
    }
  }
  await page.screenshot({ path: shotPath, fullPage: true })
}

async function captureEvidenceShots(page, node, shotOpts, isClick) {
  const out = { screenshot: '', pageScreenshot: '', pageUrl: await currentPageUrl(page) }
  if (!shotOpts || !shotOpts.absPath) {
    return out
  }
  fs.mkdirSync(path.dirname(shotOpts.absPath), { recursive: true })
  try {
    if (isClick && node) {
      await captureElementShot(page, node, shotOpts.absPath, 8)
    } else {
      await captureViewportShot(page, shotOpts.absPath)
    }
    out.screenshot = shotOpts.relPath || ''
  } catch (error) {
    out.screenshot = ''
  }
  if (shotOpts.pageAbsPath) {
    fs.mkdirSync(path.dirname(shotOpts.pageAbsPath), { recursive: true })
    try {
      await captureFullPageShot(page, shotOpts.pageAbsPath)
      out.pageScreenshot = shotOpts.pageRelPath || ''
    } catch (error) {
      out.pageScreenshot = ''
    }
  }
  return out
}

async function visibleCandidates(page) {
  return page.evaluate(function () {
    function clean(text) {
      return String(text || '').replace(/\s+/g, ' ').trim()
    }
    var nodes = Array.prototype.slice.call(document.querySelectorAll('button,a,[role="button"],[data-testid],.CLICKDATA,.VIEWDATA'))
    var out = []
    var seen = {}
    nodes.slice(0, 300).forEach(function (node) {
      var rect = node.getBoundingClientRect()
      if (!rect || rect.width <= 0 || rect.height <= 0) return
      var style = window.getComputedStyle(node)
      if (!style || style.visibility === 'hidden' || style.display === 'none') return
      var text = clean(node.innerText || node.textContent || node.getAttribute('aria-label') || node.getAttribute('data-testid') || '')
      var key = [node.tagName, text, node.getAttribute('data-testid') || '', node.getAttribute('class') || ''].join('|')
      if (seen[key]) return
      seen[key] = true
      out.push({
        tag: node.tagName.toLowerCase(),
        text: text.slice(0, 80),
        testid: node.getAttribute('data-testid') || '',
        role: node.getAttribute('role') || '',
        className: String(node.getAttribute('class') || '').slice(0, 120),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })
    })
    return out.slice(0, 80)
  }).catch(function () { return [] })
}

async function writeFailureDiagnostic(page, target, reason, opts) {
  if (!opts || !opts.diagnosticsDir) return null
  const evtId = String((target && target.evtId) || 'unknown')
  const base = `${evtId}-${Date.now()}`
  const jsonAbs = path.join(opts.diagnosticsDir, `${base}.json`)
  const shotAbs = path.join(opts.diagnosticsDir, `${base}.png`)
  fs.mkdirSync(opts.diagnosticsDir, { recursive: true })
  await page.screenshot({ path: shotAbs, fullPage: false }).catch(function () {})
  writeJson(jsonAbs, {
    evtId,
    reason: String(reason || ''),
    url: page.url(),
    title: await page.title().catch(function () { return '' }),
    trigger: target && target.trigger ? target.trigger : {},
    visibleCandidates: await visibleCandidates(page),
    logs: await collectFiredLogs(page, opts && opts.logSink).catch(function () { return [] }),
    httpRecords: ((opts && opts.httpRecords) || []).slice(-30)
  })
  return {
    json: toPosix(path.relative(opts.acceptDir || path.dirname(opts.diagnosticsDir), jsonAbs)),
    screenshot: toPosix(path.relative(opts.acceptDir || path.dirname(opts.diagnosticsDir), shotAbs))
  }
}

async function runStep(page, step) {
  const action = step.action || step.kind
  if (action === 'waitApi') {
    return
  }
  if (action === 'pageLoad') {
    return
  }
  if (action === 'waitUrl') {
    const needle = step.urlIncludes || step.value
    if (!needle) {
      return
    }
    await page.waitForURL(function (url) {
      return String(url.href || '').indexOf(needle) !== -1
    }, { timeout: 15000 })
    await sleep(800)
    return
  }
  const node = await resolveAttachedNode(page, step)
  if (!node) {
    throw new Error(`DOM 中找不到 ${action} ${step.by}:${step.value}`)
  }
  if (action === 'click') {
    await clickNode(node)
    return
  }
  if (action === 'scrollIntoView' || action === 'waitVisible') {
    await scrollNodeIntoView(node)
  }
}

async function readPageLogs(page) {
  const persistKey = ACCEPT_LOG_PERSIST_KEY
  return page.evaluate(function (key) {
    var mem = Array.isArray(window.__trackAcceptLogs) ? window.__trackAcceptLogs.slice() : []
    var persist = []
    try {
      persist = JSON.parse(sessionStorage.getItem(key) || '[]')
    } catch (error) {
      persist = []
    }
    if (!Array.isArray(persist)) {
      persist = []
    }
    return mem.concat(persist)
  }, persistKey)
}

function mergeFiredLogs(sinkLogs, pageLogs) {
  const merged = []
  const seen = {}
  ;(sinkLogs || []).concat(pageLogs || []).forEach(function (item) {
    if (!item) {
      return
    }
    const key = [
      String(item.evtId || ''),
      String(item.t || ''),
      String(item.eventType || ''),
      String(item.uicode || '')
    ].join('|')
    if (seen[key]) {
      return
    }
    seen[key] = true
    merged.push(item)
  })
  return merged
}

async function collectFiredLogs(page, sink) {
  const fromSink = sink && sink.logs ? sink.logs : []
  const fromPage = await readPageLogs(page).catch(function () { return [] })
  return mergeFiredLogs(fromSink, fromPage)
}

function pickFired(logs, since, evtId) {
  return logs.filter(item => item.t >= since && String(item.evtId) === String(evtId)).pop() || null
}

async function acceptDataDepOutcome(target, apiStore, targetRuntimeStart, snapshot, action) {
  const targetRuntimeEnd = Date.now()
  const dataDepResults = await resolveDataDeps(target.dataDeps || [], {
    targetRuntimeStart: targetRuntimeStart,
    targetRuntimeEnd: targetRuntimeEnd,
    urlSnapshot: snapshot && snapshot.urlSnapshot,
    windowSnapshot: snapshot && snapshot.windowSnapshot,
    api: apiStore
  })
  const dataDepDiffs = compareDataDepResults(dataDepResults, action)
  const legacyDiffs = compareLegacyAssertParams(target, action)
  const verdict = eventOutcomeFromDataDeps(dataDepDiffs, legacyDiffs)
  return {
    dataDepResults: dataDepResults,
    verdict: verdict
  }
}

async function acceptOne(page, pathItem, target, runtime, openedAt, shotOpts) {
  const isClick = target.trigger.kind === 'click'
  const trigger = Object.assign({ action: target.trigger.kind }, target.trigger)
  let screenshot = ''
  let pageScreenshot = ''
  let pageUrl = await currentPageUrl(page)
  const wantShot = shotOpts && shotOpts.absPath
  const targetRuntimeStart = Date.now()
  const snapshot = await captureRuntimeExpectedSnapshot(page, target.dataDeps || []).catch(function () {
    return { urlSnapshot: { href: '', query: {} }, windowSnapshot: null }
  })
  const before = isClick ? Date.now() : openedAt

  try {
    if (isClick) {
      const node = await resolveAttachedNode(page, trigger)
      if (!node) {
        if (wantShot) {
          const ev = await captureEvidenceShots(page, null, shotOpts, false)
          screenshot = ev.screenshot
          pageScreenshot = ev.pageScreenshot
          pageUrl = ev.pageUrl || pageUrl
        }
        const reason = `DOM 中找不到 click ${trigger.by}:${trigger.value}`
        const diagnostic = await writeFailureDiagnostic(page, target, reason, shotOpts)
        const err = new Error(reason)
        err.diagnostic = diagnostic
        throw err
      }
      if (wantShot) {
        const ev = await captureEvidenceShots(page, node, shotOpts, true)
        screenshot = ev.screenshot
        pageScreenshot = ev.pageScreenshot
        pageUrl = ev.pageUrl || pageUrl
      }
      await clickNode(node)
    } else {
      await runStep(page, trigger)
      if (wantShot) {
        const ev = await captureEvidenceShots(page, null, shotOpts, false)
        screenshot = ev.screenshot
        pageScreenshot = ev.pageScreenshot
        pageUrl = ev.pageUrl || pageUrl
      }
    }
  } catch (error) {
    return {
      status: 'fail',
      reason: String(error.message || error),
      fired: null,
      http: null,
      dataDepResults: [],
      paramDiffs: [],
      emptyParams: [],
      screenshot,
      pageScreenshot,
      pageUrl,
      diagnostic: error.diagnostic || await writeFailureDiagnostic(page, target, String(error.message || error), shotOpts)
    }
  }

  await sleep(600)
  const logs = await collectFiredLogs(page, shotOpts && shotOpts.logSink)
  const fired = pickFired(logs, before - 50, target.evtId)
  const http = await waitForReportHttp(
    shotOpts && shotOpts.httpRecords,
    (fired && fired.t) || before,
    target.evtId,
    (shotOpts && shotOpts.reportTimeout) || 2000,
    {
      page,
      gifSink: shotOpts && shotOpts.gifSink
    }
  )
  if (!http.matched) {
    const diagnostic = await writeFailureDiagnostic(page, target, 'report_http_missed', shotOpts)
    return {
      status: 'fail',
      reason: REPORT_GIF_MISSED,
      fired,
      http,
      dataDepResults: [],
      paramDiffs: [],
      emptyParams: fired
        ? collectEmptyParams(fired, {
          assertParams: target.assertParams || [],
          dataDeps: target.dataDeps || []
        })
        : [],
      screenshot,
      pageScreenshot,
      pageUrl,
      diagnostic
    }
  }
  if (!fired) {
    const diagnostic = await writeFailureDiagnostic(page, target, 'not_fired', shotOpts)
    return {
      status: 'fail',
      reason: 'not_fired',
      fired: null,
      http,
      dataDepResults: [],
      paramDiffs: [],
      emptyParams: [],
      screenshot,
      pageScreenshot,
      pageUrl,
      diagnostic
    }
  }
  const emptyParams = collectEmptyParams(fired, {
    assertParams: target.assertParams || [],
    dataDeps: target.dataDeps || []
  })
  if (target.expect && target.expect.eventType && fired.eventType !== target.expect.eventType) {
    return {
      status: 'fail',
      reason: `eventType 期望 ${target.expect.eventType} 实际 ${fired.eventType}`,
      fired,
      http,
      dataDepResults: [],
      paramDiffs: [],
      emptyParams,
      screenshot,
      pageScreenshot,
      pageUrl,
      diagnostic: await writeFailureDiagnostic(page, target, 'eventType mismatch', shotOpts)
    }
  }
  if (target.expect && target.expect.uicode) {
    if (!fired.uicode || fired.uicode !== target.expect.uicode) {
      return {
        status: 'fail',
        reason: `uicode 期望 ${target.expect.uicode} 实际 ${fired.uicode || '(空)'}`,
        fired,
        http,
        dataDepResults: [],
        paramDiffs: [],
        emptyParams,
        screenshot,
        pageScreenshot,
        pageUrl,
        diagnostic: await writeFailureDiagnostic(page, target, 'uicode mismatch', shotOpts)
      }
    }
  }
  const compared = await acceptDataDepOutcome(
    target,
    runtime && runtime.apiStore,
    targetRuntimeStart,
    snapshot,
    fired.action
  )
  const verdict = compared.verdict
  const outcome = {
    status: verdict.status,
    reason: verdict.reason,
    skipReason: verdict.skipReason || '',
    skipKind: verdict.skipKind || '',
    fired,
    http,
    dataDepResults: compared.dataDepResults,
    paramDiffs: verdict.paramDiffs,
    emptyParams,
    screenshot,
    pageScreenshot,
    pageUrl,
    diagnostic: null
  }
  if (verdict.status === 'fail') {
    outcome.diagnostic = await writeFailureDiagnostic(page, target, verdict.reason, shotOpts)
  }
  return outcome
}

async function runBrowser(chain, opts) {
  const playwright = loadPlaywright()
  if (!playwright) {
    throw new Error(
      '未安装 playwright。请执行: npm i -D playwright --prefix ' + SKILL_ROOT
    )
  }
  const urls = opts.urls || {}
  const baseUrl = String(urls.origin || opts.baseUrl || '').replace(/\/$/, '')
  const seedUrl = String(urls.seedUrl || (chain.defaults && chain.defaults.seedUrl) || '').trim()
  if (!baseUrl || !seedUrl) {
    throw new Error('未配置种子入口：请在仓库根目录 .env 写入 baseUrl=http://... 和 seedUrl=/path?完整query')
  }
  const probeUrl = String(urls.absoluteUrl || '').trim()
    || (baseUrl + (seedUrl.charAt(0) === '/' ? seedUrl : '/' + seedUrl))
  const logSink = createAcceptLogSink()
  const gifSink = createAcceptLogSink()
  const session = await ensureLoggedIn(playwright, {
    baseUrl,
    probeUrl,
    deviceId: opts.deviceId,
    storageState: opts.storageState,
    headed: !opts.headless,
    initScript: opts.initScript || resolveAcceptHook(opts.adaptorPath),
    onContext: async function (context) {
      await attachAcceptLogSink(context, logSink, gifSink)
    }
  })
  const { browser, context, page } = session
  const profile = resolveAcceptProfile(opts.adaptorPath)
  const httpRecords = attachReportListener(page, profile)
  const apiStore = createApiRuntimeStore()
  attachApiRuntimeCollector(context, apiStore, {
    skipUrl: function (url) {
      return isReportUrl(url, profile)
    }
  })
  const results = []

  const skipForced = forcedSkipSet(opts)
  try {
    for (let p = 0; p < chain.paths.length; p += 1) {
      const pathItem = chain.paths[p]
      const openedAt = Date.now()
      let ctx
      try {
        ctx = await openPath(page, context, pathItem, opts, probeUrl, apiStore)
      } catch (error) {
        const setupReason = String(error.message || error)
        ;(pathItem.targets || []).forEach(function (target) {
          results.push(toResultRow(pathItem, target, setupSkipOutcome(setupReason)))
        })
        continue
      }
      let needReseed = false
      for (let t = 0; t < pathItem.targets.length; t += 1) {
        const target = pathItem.targets[t]
        const hasRest = t < pathItem.targets.length - 1
        const nextTarget = hasRest ? pathItem.targets[t + 1] : null
        if (skipForced[String(target.evtId)]) {
          results.push(toResultRow(
            pathItem,
            target,
            toSkipOutcome({}, '对话模型指定跳过本条，以免阻断同路径后续验收')
          ))
          needReseed = false
          continue
        }
        if (needReseed) {
          try {
            ctx = await openPath(page, context, pathItem, opts, probeUrl, apiStore)
            needReseed = false
          } catch (error) {
            const setupReason = String(error.message || error)
            results.push(toResultRow(pathItem, target, setupSkipOutcome(setupReason)))
            for (let k = t + 1; k < pathItem.targets.length; k += 1) {
              results.push(toResultRow(pathItem, pathItem.targets[k], setupSkipOutcome(setupReason)))
            }
            break
          }
        }
        const shotAbs = opts.shotsDir
          ? path.join(opts.shotsDir, `${target.evtId}.png`)
          : ''
        const pageAbs = opts.shotsDir
          ? path.join(opts.shotsDir, `${target.evtId}-page.png`)
          : ''
        const shotRel = shotAbs ? toPosix(path.join('shots', `${target.evtId}.png`)) : ''
        const pageRel = pageAbs ? toPosix(path.join('shots', `${target.evtId}-page.png`)) : ''
        const urlBefore = await currentPageUrl(page)
        let outcome
        try {
          outcome = await acceptOne(page, pathItem, target, { apiStore: apiStore }, openedAt, {
            absPath: shotAbs,
            relPath: shotRel,
            pageAbsPath: pageAbs,
            pageRelPath: pageRel,
            diagnosticsDir: opts.diagnosticsDir,
            acceptDir: opts.acceptDir,
            httpRecords,
            reportTimeout: 2000,
            logSink,
            gifSink
          })
        } catch (error) {
          const diagnostic = await writeFailureDiagnostic(page, target, String(error.message || error), {
            diagnosticsDir: opts.diagnosticsDir,
            acceptDir: opts.acceptDir,
            logSink
          })
          outcome = {
            status: 'fail',
            reason: String(error.message || error),
            fired: null,
            http: null,
            dataDepResults: [],
            paramDiffs: [],
            emptyParams: [],
            screenshot: '',
            pageScreenshot: '',
            pageUrl: await currentPageUrl(page),
            diagnostic
          }
        }
        const urlAfter = await currentPageUrl(page)
        const leftPage = pageLeftPath(urlBefore, urlAfter)
        const executedClick = outcome.status === 'fail'
          || outcome.status === 'pass'
          || outcome.skipKind === 'unverifiable'
        if (hasRest && isClickTarget(target) && executedClick) {
          const nextMissingNow = nextTarget ? !(await probeTrigger(page, nextTarget)) : false
          const polluteFail = mayBlockRest(target, outcome, hasRest)
          if (leftPage || nextMissingNow) {
            try {
              ctx = await openPath(page, context, pathItem, opts, probeUrl, apiStore)
              needReseed = false
            } catch (error) {
              if (polluteFail) {
                outcome = toSkipOutcome(outcome, leftPage
                  ? skipReasonFor('navigated')
                  : skipReasonFor('overlay'))
              }
              results.push(toResultRow(pathItem, target, outcome))
              for (let k = t + 1; k < pathItem.targets.length; k += 1) {
                results.push(toResultRow(
                  pathItem,
                  pathItem.targets[k],
                  setupSkipOutcome(String(error.message || error))
                ))
              }
              break
            }
            const nextOkAfter = nextTarget ? await probeTrigger(page, nextTarget) : true
            if (polluteFail && nextOkAfter) {
              outcome = toSkipOutcome(outcome, leftPage
                ? skipReasonFor('navigated')
                : skipReasonFor('overlay'))
            }
          } else if (outcome.status === 'fail' && !isDomMiss(outcome.reason)) {
            needReseed = true
          }
        } else if (outcome.status === 'fail' && hasRest && !isDomMiss(outcome.reason)) {
          needReseed = true
        }
        results.push(toResultRow(pathItem, target, outcome))
      }
    }
    await saveStorage(context, opts.storageState)
  } finally {
    await browser.close()
  }

  ;(chain.pending || []).forEach(item => {
    results.push({
      evtId: item.evtId,
      eventName: '',
      pathId: '',
      status: 'skip',
      reason: item.reason,
      skipReason: item.reason || '',
      skipKind: 'pending',
      code: {},
      steps: [],
      dataDeps: [],
      dataDepResults: [],
      assertParams: [],
      fired: null,
      http: null,
      paramDiffs: [],
      emptyParams: [],
      screenshot: '',
      pageScreenshot: '',
      pageUrl: ''
    })
  })
  return results
}

function loadOrBuildChain(paths, args, urls) {
  const implPayload = readJson(paths.implPath, null)
  if (!implPayload) {
    throw new Error(`impl.json 不存在: ${paths.implPath}`)
  }
  const eventsPayload = readJson(paths.eventsPath, { events: [] })
  const chainOpts = {
    seedUrl: (urls && urls.seedUrl) || '',
    housedelCode: (urls && urls.housedelCode) || args.housedel || '',
    deviceId: args.deviceId || ''
  }
  const needRebuild = args.rebuild || !fs.existsSync(paths.chainPath)
  let chain = needRebuild
    ? buildAcceptChain(implPayload, eventsPayload, chainOpts)
    : readJson(paths.chainPath, null)
  if (!chain) {
    chain = buildAcceptChain(implPayload, eventsPayload, chainOpts)
  }
  chain = lockChainExpect(chain, eventsPayload)
  if (needRebuild) {
    writeJson(paths.chainPath, chain)
    if (args['write-impl']) {
      const { patchImplAccept } = require('./build-accept-chain')
      writeJson(paths.implPath, lockImplPayload(patchImplAccept(implPayload, chain), eventsPayload))
    }
  }
  if (args.evt) {
    chain = filterChainByEvt(chain, String(args.evt).split(/[,\s]+/))
  }
  return chain
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const paths = defaultAcceptPaths(repoRoot, args)
  if (!paths.implPath) {
    printHelp()
    throw new Error('未提供 --excel / --impl')
  }
  assertValidImpl(paths, args, repoRoot)
  const urls = envAcceptUrls(repoRoot, {
    baseUrl: args['base-url'] || '',
    seedUrl: args['seed-url'] || '',
    housedelCode: args.housedel || ''
  })
  const env = readDotEnv(repoRoot)
  const planOnly = Boolean(args['plan-only'] || args.plan)
  const deviceId = planOnly
    ? resolveAcceptDevice(args, env)
    : requireAcceptDevice(args, env)
  args.deviceId = deviceId
  const chain = loadOrBuildChain(paths, args, urls)
  if (chain.defaults) {
    chain.defaults.device = deviceId || 'unset'
    chain.defaults.viewport = viewportForDevice(deviceId)
  }
  if (!planOnly && (!urls.origin || !urls.seedUrl)) {
    throw new Error('未配置种子入口：请在仓库根目录 .env 写入 baseUrl=http://... 和 seedUrl=/path?完整query')
  }
  let results
  if (planOnly) {
    results = require('./accept-report').buildPlanResults(chain)
  } else {
    const initScript = resolveAcceptHook(paths.adaptorPath)
    results = await runBrowser(chain, {
      urls,
      baseUrl: urls.origin,
      deviceId,
      headless: Boolean(args.headless),
      storageState: resolveStorageState(repoRoot, args['storage-state']),
      shotsDir: paths.shotsDir,
      diagnosticsDir: path.join(paths.acceptDir, '_diagnostics'),
      acceptDir: paths.acceptDir,
      adaptorPath: paths.adaptorPath,
      initScript,
      skipEvt: args['skip-evt'] || args.skipEvt || ''
    })
  }
  const report = buildAcceptReport(chain, {
    results,
    baseUrl: urls.origin,
    seedUrl: urls.seedUrl,
    device: deviceId ? deviceId + ' ' + deviceLabel(deviceId) : 'unset',
    planOnly
  })
  const eventsPayload = readJson(paths.eventsPath, { events: [] })
  const implPayload = readJson(paths.implPath, { events: [] })
  enrichReportMedia(report, {
    htmlPath: paths.acceptHtml,
    shotsDir: paths.shotsDir,
    events: eventsPayload.events || [],
    implEvents: implPayload.events || []
  })
  fs.mkdirSync(paths.acceptDir, { recursive: true })
  writeJson(paths.acceptJson, report)
  renderAcceptReport(report, paths.acceptHtml)
  console.log('== run-accept ==')
  console.log(`Chain: ${paths.chainPath}`)
  console.log(`Report: ${paths.acceptHtml}`)
  console.log(`pass ${report.summary.pass} / fail ${report.summary.fail} / skip ${report.summary.skip} / total ${report.summary.total}`)
  if (!planOnly && report.summary.fail) {
    console.log('== 验收失败（中文事实稿，模型须据此归因）==')
    report.results.forEach(function (item) {
      if (!item || item.status !== 'fail') return
      console.log(item.failFactsZh || ((item.evtId || '') + ' 「' + (item.reasonZh || item.reason || '') + '」'))
      console.log('---')
    })
    const { D_FAIL_CHOICE } = require('../workflow/prompts')
    console.log(D_FAIL_CHOICE)
  }
  if (!planOnly) {
    try {
      const { defaultFinalPaths, renderFinalToFile } = require('./final-report')
      const finalPaths = defaultFinalPaths(repoRoot, args)
      const finalReport = renderFinalToFile(finalPaths)
      console.log(`Final: ${finalPaths.finalHtml}`)
      console.log(
        `终稿事件 ${finalReport.eventCount} / 通过 ${finalReport.summary.pass} / 失败 ${finalReport.summary.fail}` +
        ` / 跳过 ${finalReport.summary.skip || 0} / 未落地 ${finalReport.summary.missing || 0}`
      )
      if (shouldOpenBrowser(args)) {
        const htmlName = path.basename(finalPaths.finalHtml)
        const existing = await findExistingServer(paths, DEFAULT_PORT, PORT_ATTEMPTS)
        const openUrl = existing
          ? `http://127.0.0.1:${existing.port}/${encodeURI(htmlName)}`
          : 'file://' + finalPaths.finalHtml
        openBrowser(openUrl)
        console.log(`Open: ${openUrl}`)
      }
    } catch (finalError) {
      console.warn(`终稿生成跳过: ${finalError.message || finalError}`)
    }
  }
  if (!planOnly && report.summary.fail) {
    process.exitCode = 1
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message || error)
    process.exit(1)
  })
}

module.exports = { main }
