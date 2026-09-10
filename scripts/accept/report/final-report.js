const fs = require('fs')
const path = require('path')
const { readJson, relFrom, toPosix } = require('../../lib/lib')
const { defaultPaths, mergeReport, normalizeParam } = require('../../extract/report')
const { defaultAcceptPaths } = require('../chain/accept-chain')
const { enrichReportMedia, isEmptyParamValue } = require('./accept-report')
const { templatePath } = require('../../lib/skill-paths')

const TEMPLATE = templatePath('final-report.html')

function defaultFinalPaths(repoRoot, args) {
  const accept = defaultAcceptPaths(repoRoot, args)
  const finalHtml = accept.slug
    ? path.join(accept.outDir, `${accept.slug}-终稿.html`)
    : ''
  return Object.assign({}, accept, { finalHtml })
}

function inject(template, report) {
  if (template.indexOf('__REPORT_JSON__') === -1) {
    throw new Error('templates/final-report.html 缺少 __REPORT_JSON__ 占位符')
  }
  return template.replace('__REPORT_JSON__', JSON.stringify(report).replace(/</g, '\\u003c'))
}

function acceptById(acceptReport) {
  const map = {}
  ;((acceptReport && acceptReport.results) || []).forEach(item => {
    if (item && item.evtId) {
      map[String(item.evtId)] = item
    }
  })
  return map
}

function classifyFinalItem(event, acceptView) {
  const implStatus = event && event.impl && event.impl.status
  if (implStatus === 'existing') {
    if (!acceptView) return 'unverifiable'
    if (acceptView.status === 'pass') return 'pass'
    if (acceptView.status === 'fail') return 'fail'
    if (acceptView.status === 'skip') {
      if (
        acceptView.reason === 'path_blocker'
        || acceptView.skipKind === 'path_blocker'
        || acceptView.skipKind === 'path_setup'
      ) {
        return 'pathSkip'
      }
      if (acceptView.reason === 'plan-only') return 'plan'
      return 'unverifiable'
    }
    return 'unverifiable'
  }
  if (implStatus === 'located') return 'unverifiable'
  return 'missing'
}

function resolveMediaRel(htmlPath, absOrRel, outDir) {
  if (!absOrRel) return ''
  if (/^https?:\/\//i.test(absOrRel)) return absOrRel
  const candidates = []
  if (path.isAbsolute(absOrRel)) {
    candidates.push(absOrRel)
  } else {
    candidates.push(path.resolve(path.dirname(htmlPath), absOrRel))
    if (outDir) {
      candidates.push(path.resolve(outDir, absOrRel))
      candidates.push(path.resolve(outDir, 'accept', absOrRel))
    }
  }
  for (let i = 0; i < candidates.length; i += 1) {
    if (fs.existsSync(candidates[i])) {
      return relFrom(htmlPath, candidates[i])
    }
  }
  return toPosix(absOrRel)
}

function buildFinalReport(paths) {
  if (!paths.eventsPath || !fs.existsSync(paths.eventsPath)) {
    throw new Error(`events.json 不存在: ${paths.eventsPath || '(未提供 --events / --excel)'}`)
  }
  if (!paths.acceptJson || !fs.existsSync(paths.acceptJson)) {
    throw new Error(`验收 JSON 不存在: ${paths.acceptJson || '(请先跑完 run-accept)'}`)
  }
  if (!fs.existsSync(TEMPLATE)) {
    throw new Error(`缺少模板: ${TEMPLATE}`)
  }

  const eventsPayload = readJson(paths.eventsPath, null)
  const implPayload = readJson(paths.implPath, { events: [] })
  const acceptReport = readJson(paths.acceptJson, null)
  if (!acceptReport) {
    throw new Error(`验收 JSON 无法读取: ${paths.acceptJson}`)
  }
  if (acceptReport.planOnly) {
    throw new Error('当前验收结果为 plan-only，终稿仅在真实验收完成后生成')
  }

  // 先按验收 HTML 位置补媒体，再改写成相对终稿的路径
  enrichReportMedia(acceptReport, {
    htmlPath: paths.acceptHtml || path.join(paths.acceptDir, 'report.html'),
    shotsDir: paths.shotsDir,
    events: eventsPayload.events || [],
    implEvents: (implPayload && implPayload.events) || []
  })

  const implMerged = mergeReport(eventsPayload, implPayload, paths.finalHtml, paths.outDir)
  const byAccept = acceptById(acceptReport)

  const events = (implMerged.events || []).map(event => {
    const accept = byAccept[String(event.evtId)] || null
    const acceptView = accept
      ? {
          status: accept.status || 'skip',
          reason: accept.reason || '',
          reasonZh: accept.reasonZh || '',
          skipReason: accept.skipReason || '',
          skipKind: accept.skipKind || '',
          outcomeCategory: '',
          failFactsZh: accept.failFactsZh || '',
          failExplain: accept.failExplain || '',
          pathId: accept.pathId || '',
          steps: accept.steps || [],
          dataDeps: accept.dataDeps || [],
          fired: accept.fired || null,
          http: accept.http || null,
          paramDiffs: accept.paramDiffs || [],
          emptyParams: accept.emptyParams || [],
          screenshot: resolveMediaRel(
            paths.finalHtml,
            accept.screenshot
              ? (path.isAbsolute(accept.screenshot)
                ? accept.screenshot
                : path.resolve(paths.acceptDir, accept.screenshot))
              : path.join(paths.shotsDir, `${event.evtId}.png`),
            paths.outDir
          ),
          pageScreenshot: resolveMediaRel(
            paths.finalHtml,
            accept.pageScreenshot
              ? (path.isAbsolute(accept.pageScreenshot)
                ? accept.pageScreenshot
                : path.resolve(paths.acceptDir, accept.pageScreenshot))
              : path.join(paths.shotsDir, `${event.evtId}-page.png`),
            paths.outDir
          ),
          pageUrl: accept.pageUrl || '',
          diagramSrc: resolveMediaRel(
            paths.finalHtml,
            accept.diagramSrc
              ? path.resolve(paths.acceptDir, accept.diagramSrc)
              : (event.diagramPath || ''),
            paths.outDir
          ) || event.diagramSrc || '',
          triggerKind: accept.triggerKind || '',
          eventDesc: accept.eventDesc || '',
          code: accept.code || {}
        }
      : null

    const emptySet = {}
    ;((acceptView && acceptView.emptyParams) || []).forEach(key => {
      emptySet[key] = true
    })

    const parameters = (event.impl.parameters || []).map(param => {
      const normalized = normalizeParam(param)
      const action = acceptView && acceptView.fired && acceptView.fired.action
        ? acceptView.fired.action
        : null
      const hasKey = !!(action && Object.prototype.hasOwnProperty.call(action, normalized.key))
      const firedVal = hasKey ? action[normalized.key] : undefined
      const diff = acceptView
        ? (acceptView.paramDiffs || []).find(d => d && d.key === normalized.key)
        : null
      const empty = !!(acceptView && acceptView.fired && (
        emptySet[normalized.key] || (hasKey && isEmptyParamValue(firedVal))
      ))
      return Object.assign({}, normalized, {
        firedValue: hasKey ? firedVal : undefined,
        diff: diff || null,
        empty
      })
    })

    if (acceptView && acceptView.fired) {
      const derived = parameters.filter(p => p.empty).map(p => p.key)
      const seen = {}
      const merged = []
      ;(acceptView.emptyParams || []).concat(derived).forEach(key => {
        if (!key || seen[key]) return
        seen[key] = true
        merged.push(key)
      })
      acceptView.emptyParams = merged
    }

    if (acceptView) {
      acceptView.outcomeCategory = classifyFinalItem(event, acceptView)
    }

    return Object.assign({}, event, {
      diagramSrc: (acceptView && acceptView.diagramSrc) || event.diagramSrc || '',
      impl: Object.assign({}, event.impl, { parameters }),
      accept: acceptView,
      outcomeCategory: (acceptView && acceptView.outcomeCategory) || classifyFinalItem(event, acceptView)
    })
  })

  // 缺失 / 待确认优先，其余按文档顺序
  events.sort((a, b) => {
    const rank = item => {
      const cat = item.outcomeCategory || classifyFinalItem(item, item.accept)
      if (cat === 'missing') return 0
      if (cat === 'unverifiable') return 1
      if (cat === 'pathSkip') return 2
      if (cat === 'fail') return 3
      if (item.accept && item.accept.emptyParams && item.accept.emptyParams.length) return 4
      if (cat === 'pass') return 6
      return 5
    }
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    return (a.docIndex || 0) - (b.docIndex || 0)
  })

  const acceptSummary = acceptReport.summary || { total: 0, pass: 0, fail: 0, skip: 0, needConfirm: 0 }
  const needConfirm = events.filter(item =>
    item.accept && item.accept.emptyParams && item.accept.emptyParams.length
  ).length
  const missing = events.filter(item => item.outcomeCategory === 'missing').length
  const pathSkip = events.filter(item => item.outcomeCategory === 'pathSkip').length
  const unverifiable = events.filter(item => item.outcomeCategory === 'unverifiable').length
  const failCount = events.filter(item => item.outcomeCategory === 'fail').length
  const passCount = events.filter(item => item.outcomeCategory === 'pass').length
  return {
    generatedAt: new Date().toISOString(),
    slug: implMerged.slug || acceptReport.slug || paths.slug || '',
    excelPath: implMerged.excelPath || acceptReport.excelPath || '',
    sheetName: implMerged.sheetName || '',
    baseUrl: acceptReport.baseUrl || '',
    seedUrl: acceptReport.seedUrl || '',
    acceptGeneratedAt: acceptReport.generatedAt || '',
    eventCount: events.length,
    clickCount: implMerged.clickCount,
    viewCount: implMerged.viewCount,
    existingCount: implMerged.existingCount,
    acceptedCount: implMerged.acceptedCount,
    unresolvedCount: implMerged.unresolvedCount,
    summary: {
      total: events.length || acceptSummary.total || 0,
      pass: passCount || acceptSummary.pass || 0,
      fail: failCount || acceptSummary.fail || 0,
      skip: acceptSummary.skip || 0,
      pathBlockerSkip: pathSkip || acceptSummary.pathBlockerSkip || 0,
      unverifiable: unverifiable || acceptSummary.unverifiable || 0,
      needConfirm: acceptSummary.needConfirm || needConfirm,
      missing,
      existing: implMerged.existingCount || 0,
      unresolved: implMerged.unresolvedCount || 0
    },
    events
  }
}

function renderFinalToFile(paths) {
  const report = buildFinalReport(paths)
  const html = inject(fs.readFileSync(TEMPLATE, 'utf8'), report)
  fs.mkdirSync(path.dirname(paths.finalHtml), { recursive: true })
  fs.writeFileSync(paths.finalHtml, html, 'utf8')
  return report
}

module.exports = {
  TEMPLATE,
  buildFinalReport,
  classifyFinalItem,
  defaultFinalPaths,
  defaultPaths,
  inject,
  renderFinalToFile
}
