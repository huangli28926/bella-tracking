const fs = require('fs')
const path = require('path')
const { describeSteps } = require('../chain/accept-chain')
const { relFrom, toPosix } = require('../../lib/lib')
const { templatePath } = require('../../lib/skill-paths')
const { enrichFailExplain } = require('./format-fail-explain')

const TEMPLATE = templatePath('accept-report.html')

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inject(template, report) {
  if (template.indexOf('__REPORT_JSON__') === -1) {
    throw new Error('templates/accept-report.html 缺少 __REPORT_JSON__ 占位符')
  }
  return template.replace('__REPORT_JSON__', JSON.stringify(report).replace(/</g, '\\u003c'))
}

function emptySummary() {
  return {
    total: 0,
    pass: 0,
    fail: 0,
    skip: 0,
    pathBlockerSkip: 0,
    unverifiable: 0,
    needConfirm: 0,
    missing: 0
  }
}

/** 实发值是否视为「未取到」：'-' / 空串 / null / undefined；false、0 不算 */
function isEmptyParamValue(value) {
  return value === '-' || value === '' || value === null || value === undefined
}

function paramKeysForEmptyCheck(item) {
  const keys = []
  const seen = {}
  function add(key) {
    if (!key || seen[key]) return
    seen[key] = true
    keys.push(key)
  }
  ;(item && item.assertParams ? item.assertParams : []).forEach(add)
  ;((item && item.dataDeps) || []).forEach(dep => {
    if (dep && dep.paramKey) add(dep.paramKey)
  })
  if (!keys.length && item && item.fired && item.fired.action) {
    Object.keys(item.fired.action).forEach(add)
  }
  return keys
}

/**
 * 从真实上报中收集未取到值的参数 key。
 * 未发出时返回 []（发不出发由 status/reason 表达）。
 */
function collectEmptyParams(fired, itemOrKeys) {
  if (!fired) return []
  const action = fired.action || {}
  const keys = Array.isArray(itemOrKeys)
    ? itemOrKeys
    : paramKeysForEmptyCheck(itemOrKeys || {})
  const empty = []
  keys.forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(action, key)) {
      empty.push(key)
      return
    }
    if (isEmptyParamValue(action[key])) {
      empty.push(key)
    }
  })
  return empty
}

function tally(results) {
  const summary = emptySummary()
  results.forEach(item => {
    summary.total += 1
    if (item.status === 'pass') summary.pass += 1
    else if (item.status === 'fail') summary.fail += 1
    else {
      summary.skip += 1
      if (item.reason === 'path_blocker' || item.skipKind === 'path_blocker' || item.skipKind === 'path_setup') {
        summary.pathBlockerSkip += 1
      } else if (item.reason !== 'plan-only') {
        summary.unverifiable += 1
      }
    }
    if (item.emptyParams && item.emptyParams.length) {
      summary.needConfirm += 1
    }
    if (item.implStatus !== 'existing') {
      summary.missing += 1
    }
  })
  return summary
}

/** 补全 emptyParams + 重算 summary.needConfirm（兼容旧验收 JSON） */
function enrichEmptyParams(report) {
  if (!report || !Array.isArray(report.results)) {
    return report
  }
  report.results.forEach(item => {
    item.emptyParams = collectEmptyParams(item.fired, item)
  })
  report.summary = tally(report.results)
  return report
}

function implStatusById(implEvents) {
  const map = {}
  ;(implEvents || []).forEach(item => {
    if (!item || !item.evtId) return
    const status = item.status
      || (item.impl && item.impl.status)
      || ''
    map[String(item.evtId)] = status
  })
  return map
}

function buildPlanResults(chain) {
  const results = []
  ;(chain.paths || []).forEach(pathItem => {
    ;(pathItem.targets || []).forEach(target => {
      results.push({
        evtId: target.evtId,
        eventName: target.eventName || '',
        pathId: pathItem.pathId,
        status: 'skip',
        reason: 'plan-only',
        skipReason: '仅计划未执行',
        skipKind: 'plan-only',
        code: target.code || {},
        steps: describeSteps(pathItem, target),
        dataDeps: target.dataDeps || [],
        dataDepResults: [],
        assertParams: target.assertParams || [],
        fired: null,
        http: null,
        paramDiffs: [],
        emptyParams: [],
        screenshot: '',
        pageScreenshot: '',
        pageUrl: '',
        diagramSrc: ''
      })
    })
  })
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
      pageUrl: '',
      diagramSrc: ''
    })
  })
  return results
}

function buildAcceptReport(chain, extra) {
  const src = extra || {}
  const results = Array.isArray(src.results) ? src.results : buildPlanResults(chain)
  const report = {
    generatedAt: new Date().toISOString(),
    slug: chain.slug || '',
    excelPath: chain.excelPath || '',
    baseUrl: src.baseUrl || '',
    seedUrl: src.seedUrl || (chain.defaults && chain.defaults.seedUrl) || '',
    device: src.device || (chain.defaults && chain.defaults.device) || '',
    planOnly: !!src.planOnly,
    summary: tally(results),
    paths: chain.paths || [],
    pending: chain.pending || [],
    results
  }
  return enrichEmptyParams(report)
}

function eventsById(events) {
  const map = {}
  ;(events || []).forEach(event => {
    if (event && event.evtId) {
      map[String(event.evtId)] = event
    }
  })
  return map
}

function resolveScreenshotRel(item, htmlPath, shotsDir) {
  const evtId = String(item.evtId || '')
  const candidates = []
  if (item.screenshot) {
    candidates.push(item.screenshot)
  }
  if (shotsDir && evtId) {
    candidates.push(path.join(shotsDir, `${evtId}.png`))
  }
  for (let i = 0; i < candidates.length; i += 1) {
    const raw = candidates[i]
    if (!raw) continue
    if (!path.isAbsolute(raw) && !raw.includes('://') && fs.existsSync(path.resolve(path.dirname(htmlPath), raw))) {
      return toPosix(raw)
    }
    if (path.isAbsolute(raw) && fs.existsSync(raw)) {
      return relFrom(htmlPath, raw)
    }
    if (shotsDir && evtId) {
      const abs = path.isAbsolute(raw) ? raw : path.join(shotsDir, path.basename(raw))
      if (fs.existsSync(abs)) {
        return relFrom(htmlPath, abs)
      }
    }
  }
  if (shotsDir && evtId) {
    const abs = path.join(shotsDir, `${evtId}.png`)
    if (fs.existsSync(abs)) {
      return relFrom(htmlPath, abs)
    }
  }
  return item.screenshot && !path.isAbsolute(item.screenshot) ? toPosix(item.screenshot) : ''
}

function resolveDiagramRel(event, htmlPath) {
  if (!event) return ''
  if (event.diagramPath && fs.existsSync(event.diagramPath)) {
    return relFrom(htmlPath, event.diagramPath)
  }
  if (event.diagramRelPath) {
    // events 里是相对文档根：_raw/images/xxx.png；验收 HTML 在 accept/ 下
    const fromDocRoot = path.resolve(path.dirname(htmlPath), '..', event.diagramRelPath)
    if (fs.existsSync(fromDocRoot)) {
      return relFrom(htmlPath, fromDocRoot)
    }
    return toPosix(path.join('..', event.diagramRelPath))
  }
  return ''
}

/**
 * 给报告结果补相对路径截图 + 文档示意图，便于 file:// 打开 HTML。
 * 原地修改 report.results。
 */
function enrichReportMedia(report, opts) {
  const options = opts || {}
  enrichEmptyParams(report)
  const htmlPath = options.htmlPath
  if (!htmlPath) {
    return report
  }
  const byId = eventsById(options.events)
  const implById = implStatusById(options.implEvents)
  const shotsDir = options.shotsDir || path.join(path.dirname(htmlPath), 'shots')
  ;(report.results || []).forEach(item => {
    const event = byId[String(item.evtId)] || null
    item.screenshot = resolveScreenshotRel(item, htmlPath, shotsDir)
    item.pageScreenshot = resolveScreenshotRel(
      { screenshot: item.pageScreenshot, evtId: item.evtId ? `${item.evtId}-page` : '' },
      htmlPath,
      shotsDir
    )
    item.pageUrl = item.pageUrl || ''
    item.diagramSrc = resolveDiagramRel(event, htmlPath) || item.diagramSrc || ''
    const kind = ((report.paths || []).reduce(function (found, p) {
      if (found) return found
      const hit = (p.targets || []).find(function (t) { return String(t.evtId) === String(item.evtId) })
      return hit || null
    }, null) || {}).trigger
    item.triggerKind = (kind && kind.kind) || item.triggerKind || ''
    const implEvent = (options.implEvents || []).find(ev => ev && String(ev.evtId) === String(item.evtId))
    if (implById[String(item.evtId)]) {
      item.implStatus = implById[String(item.evtId)]
    } else if (!item.implStatus) {
      item.implStatus = ''
    }
    if (implEvent && Array.isArray(implEvent.parameters)) {
      item.parameters = implEvent.parameters.map(param => {
        const doc = ((event && event.params) || []).find(p => p && p.key === param.key) || {}
        return {
          key: param.key,
          docDesc: param.docDesc || '',
          sourcePath: param.sourcePath || '',
          enumText: doc.enumText || param.enumText || ''
        }
      })
    }
    if (event && Array.isArray(event.params)) {
      item.docParams = event.params.map(param => ({
        key: param.key,
        desc: param.desc || '',
        enumText: param.enumText || '',
        valueType: param.valueType || ''
      }))
    }
    if (implEvent && implEvent.uicodeConflict) {
      item.uicodeConflict = item.uicodeConflict || implEvent.uicodeConflict
    }
    if (event) {
      item.pageName = item.pageName || event.pageName || ''
      item.eventType = item.eventType || event.eventType || ''
      item.eventTypeZh = item.eventTypeZh || event.eventTypeZh || ''
      item.uicode = item.uicode || event.uicode || ''
      item.pid = item.pid || event.pid || ''
      if (!item.eventDesc) {
        const page = event.pageName || ''
        const name = item.eventName || event.eventName || ''
        const typeZh = event.eventTypeZh || event.eventType || ''
        item.eventDesc = page && name
          ? `${page}「${name}」· ${typeZh}`
          : [page, typeZh].filter(Boolean).join(' · ')
      }
    }
  })
  enrichFailExplain(report, {
    htmlPath,
    acceptDir: path.dirname(htmlPath),
    implEvents: options.implEvents || []
  })
  report.summary = tally(report.results || [])
  return report
}

function renderAcceptReport(report, htmlPath) {
  if (!fs.existsSync(TEMPLATE)) {
    throw new Error(`缺少模板: ${TEMPLATE}`)
  }
  const html = inject(fs.readFileSync(TEMPLATE, 'utf8'), report)
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true })
  fs.writeFileSync(htmlPath, html, 'utf8')
  return htmlPath
}

module.exports = {
  TEMPLATE,
  buildAcceptReport,
  buildPlanResults,
  collectEmptyParams,
  enrichEmptyParams,
  enrichReportMedia,
  escapeHtml,
  inject,
  isEmptyParamValue,
  paramKeysForEmptyCheck,
  renderAcceptReport,
  tally
}
