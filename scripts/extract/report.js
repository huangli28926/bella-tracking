const fs = require('fs')
const path = require('path')
const { docSlug, ensureExcelInDocs, readJson, relFrom, writeJson, toPosix } = require('../lib/lib')
const { implUicodeDrift, lockImplPayload } = require('../lib/lock-doc-uicode')
const { inferValueKind } = require('../lib/value-kind')
const { templatePath } = require('../lib/skill-paths')

const TEMPLATE = templatePath('report.html')
const REVIEW_TEMPLATE = templatePath('review.html')

function resolveFromRepo(repoRoot, value) {
  if (!value) {
    return ''
  }
  if (path.isAbsolute(value)) {
    return value
  }
  return path.resolve(repoRoot, value)
}

function defaultPaths(repoRoot, args) {
  const rawExcel = resolveFromRepo(repoRoot, args.excel || '')
  const excel = rawExcel ? ensureExcelInDocs(repoRoot, rawExcel) : ''
  const slug = args.slug || (excel ? docSlug(excel) : '')
  const outDir = args.outdir
    ? path.resolve(repoRoot, args.outdir)
    : (slug
      ? path.resolve(repoRoot, 'docs/tracking/impl', slug)
      : path.resolve(repoRoot, 'docs/tracking/impl'))
  const eventsPath = resolveFromRepo(repoRoot, args.events)
    || (slug ? path.join(outDir, '_raw', `${slug}.events.json`) : '')
  const implPath = resolveFromRepo(repoRoot, args.impl)
    || (slug ? path.join(outDir, '_raw', `${slug}.impl.json`) : '')
  const htmlPath = resolveFromRepo(repoRoot, args.out)
    || (slug ? path.join(outDir, `${slug}-落库.html`) : '')
  const reviewHtmlPath = resolveFromRepo(repoRoot, args.reviewOut)
    || (slug ? path.join(outDir, `${slug}-矫正.html`) : '')
  const apisPath = path.join(outDir, '_raw', 'apis.json')
  const adaptorPath = path.join(outDir, '_raw', 'adaptor.json')
  const fieldMemoryPath = path.join(outDir, '_raw', 'field-memory.json')
  return { slug, outDir, eventsPath, implPath, htmlPath, reviewHtmlPath, apisPath, adaptorPath, fieldMemoryPath }
}

function normalizeHint(hint) {
  const src = hint && typeof hint === 'object' ? hint : {}
  const api = src.api && typeof src.api === 'object' ? src.api : {}
  const images = Array.isArray(src.images)
    ? src.images.map(item => String(item || '').trim()).filter(Boolean)
    : []
  return {
    images,
    note: src.note ? String(src.note) : '',
    api: {
      url: api.url ? String(api.url) : '',
      field: api.field ? String(api.field) : ''
    }
  }
}

function normalizeParam(param) {
  const src = param && typeof param === 'object' ? param : {}
  const expression = src.expression || ''
  return Object.assign({}, src, {
    key: src.key || '',
    docDesc: src.docDesc || '',
    expression,
    valueKind: inferValueKind(expression, src.valueKind),
    sourcePath: src.sourcePath || '',
    confidence: src.confidence || '',
    fromMemory: !!src.fromMemory,
    fromEvtId: src.fromEvtId ? String(src.fromEvtId) : '',
    hint: normalizeHint(src.hint)
  })
}

function hintSrcs(hint, htmlPath, outDir) {
  const htmlDir = path.dirname(htmlPath)
  return (hint.images || []).map(rel => {
    const abs = path.isAbsolute(rel) ? rel : path.resolve(outDir, rel)
    if (!fs.existsSync(abs)) {
      return ''
    }
    return relFrom(htmlPath, abs) || rel
  }).filter(Boolean).map(src => {
    try {
      const abs = path.resolve(htmlDir, src)
      const mtime = fs.statSync(abs).mtimeMs
      return src + (src.indexOf('?') === -1 ? '?t=' + Math.floor(mtime) : '')
    } catch (error) {
      return src
    }
  })
}

function lockImplFile(paths) {
  if (!paths || !paths.implPath || !fs.existsSync(paths.implPath) || !paths.eventsPath || !fs.existsSync(paths.eventsPath)) {
    return
  }
  const { applyToPayload, loadMergedMemory } = require('../lib/field-memory')
  const eventsPayload = readJson(paths.eventsPath, { events: [] })
  const implPayload = readJson(paths.implPath, { events: [] })
  const locked = lockImplPayload(implPayload, eventsPayload)
  const memory = loadMergedMemory(paths, locked)
  const applied = applyToPayload(locked, memory)
  if (implUicodeDrift(implPayload, applied.payload) || applied.changed) {
    writeJson(paths.implPath, applied.payload)
  }
}

function mergeReport(eventsPayload, implPayload, htmlPath, outDir) {
  const implById = {}
  const implEvents = (implPayload && implPayload.events) || []
  implEvents.forEach(item => {
    if (item && item.evtId) {
      implById[String(item.evtId)] = item
    }
  })
  const htmlDir = outDir || path.dirname(htmlPath)

  const events = (eventsPayload.events || []).map(event => {
    const impl = implById[String(event.evtId)] || {}
    const diagramSrc = event.diagramPath && fs.existsSync(event.diagramPath)
      ? relFrom(htmlPath, event.diagramPath)
      : (event.diagramRelPath || '')
    const parameters = (impl.parameters || []).map(param => {
      const normalized = normalizeParam(param)
      return Object.assign({}, normalized, {
        hintSrcs: hintSrcs(normalized.hint, htmlPath, htmlDir)
      })
    })
    return Object.assign({}, event, {
      diagramSrc,
      impl: {
        status: impl.status || 'pending',
        accepted: !!(impl.accepted && impl.status === 'existing'),
        confirmed: !!impl.confirmed,
        targetFile: impl.targetFile || '',
        functionName: impl.functionName || '',
        lifecycle: impl.lifecycle || '',
        insertHint: impl.insertHint || '',
        evidence: impl.evidence || [],
        uicodeConflict: impl.uicodeConflict || '',
        code: impl.code || '',
        parameters,
        unresolved: impl.unresolved || []
      }
    })
  })

  const implCount = events.filter(item => item.impl.status && item.impl.status !== 'pending').length
  const existingCount = events.filter(item => item.impl.status === 'existing').length
  const acceptedCount = events.filter(item => item.impl.accepted).length
  const confirmedCount = events.filter(item => item.impl.confirmed).length
  const unresolvedCount = events.filter(item => {
    return item.impl.status === 'unresolved'
      || (item.impl.unresolved && item.impl.unresolved.length)
      || item.impl.uicodeConflict
  }).length

  return {
    generatedAt: new Date().toISOString(),
    excelPath: eventsPayload.excelPath || '',
    sheetName: eventsPayload.sheetName || '',
    slug: eventsPayload.slug || '',
    eventCount: events.length,
    clickCount: events.filter(item => item.kind === 'click').length,
    viewCount: events.filter(item => item.kind === 'view').length,
    implCount,
    existingCount,
    acceptedCount,
    confirmedCount,
    unresolvedCount,
    events
  }
}

function inject(template, report) {
  const json = JSON.stringify(report).replace(/</g, '\\u003c')
  if (template.indexOf('__REPORT_JSON__') === -1) {
    throw new Error('templates/report.html 缺少 __REPORT_JSON__ 占位符')
  }
  return template.replace('__REPORT_JSON__', json)
}

function buildReport(paths) {
  if (!paths.eventsPath || !fs.existsSync(paths.eventsPath)) {
    throw new Error(`events.json 不存在: ${paths.eventsPath || '(未提供 --events / --excel)'}`)
  }
  if (!fs.existsSync(TEMPLATE)) {
    throw new Error(`缺少模板: ${TEMPLATE}`)
  }
  const eventsPayload = readJson(paths.eventsPath, null)
  const implPayload = readJson(paths.implPath, { events: [] })
  return mergeReport(eventsPayload, implPayload, paths.htmlPath, paths.outDir)
}

function renderToFile(paths) {
  lockImplFile(paths)
  const report = buildReport(paths)
  const html = inject(fs.readFileSync(TEMPLATE, 'utf8'), report)
  fs.mkdirSync(path.dirname(paths.htmlPath), { recursive: true })
  fs.writeFileSync(paths.htmlPath, html, 'utf8')
  return report
}

function buildReviewReport(paths) {
  const report = buildReport(paths)
  const { loadConfirmQueue } = require('../confirm/needs-confirm')
  const eventsPayload = readJson(paths.eventsPath, { events: [] })
  const queueInfo = loadConfirmQueue(paths)
  const implPath = paths.implPath
  const htmlPath = paths.htmlPath
  const reviewHtmlPath = paths.reviewHtmlPath
  return Object.assign({}, report, {
    reviewHtmlPath: reviewHtmlPath ? toPosix(reviewHtmlPath) : '',
    implPath: implPath ? toPosix(implPath) : '',
    htmlPath: htmlPath ? toPosix(htmlPath) : '',
    excelPath: eventsPayload.excelPath || report.excelPath || '',
    queue: queueInfo,
    summary: {
      total: queueInfo.total,
      needsConfirmCount: queueInfo.needsConfirmCount,
      confirmedCount: queueInfo.confirmedCount,
      pendingCount: queueInfo.pendingCount,
      done: queueInfo.done
    },
    events: (report.events || []).map(item => {
      const q = queueInfo.items.find(row => String(row.evtId) === String(item.evtId)) || {}
      return Object.assign({}, item, {
        review: {
          needsConfirm: !!q.needsConfirm,
          confirmed: !!q.confirmed,
          reasons: q.reasons || []
        }
      })
    })
  })
}

function injectReview(template, report) {
  const json = JSON.stringify(report).replace(/</g, '\\u003c')
  if (template.indexOf('__REVIEW_JSON__') === -1) {
    throw new Error('templates/review.html 缺少 __REVIEW_JSON__ 占位符')
  }
  return template.replace('__REVIEW_JSON__', json)
}

function renderReviewToFile(paths) {
  if (!paths.reviewHtmlPath) {
    throw new Error('缺少 reviewHtmlPath')
  }
  if (!fs.existsSync(REVIEW_TEMPLATE)) {
    throw new Error(`缺少模板: ${REVIEW_TEMPLATE}`)
  }
  lockImplFile(paths)
  renderToFile(paths)
  const report = buildReviewReport(paths)
  const html = injectReview(fs.readFileSync(REVIEW_TEMPLATE, 'utf8'), report)
  fs.mkdirSync(path.dirname(paths.reviewHtmlPath), { recursive: true })
  fs.writeFileSync(paths.reviewHtmlPath, html, 'utf8')
  return report
}

function emptyHint() {
  return { images: [], note: '', api: { url: '', field: '' } }
}

function mergeImplEvent(existing, patch) {
  const prev = existing && typeof existing === 'object' ? existing : {}
  const next = Object.assign({}, prev)
  delete next.uicode
  if (patch && typeof patch === 'object') {
    delete patch.uicode
  }
  const scalarKeys = [
    'status',
    'targetFile',
    'functionName',
    'lifecycle',
    'insertHint',
    'uicodeConflict',
    'code',
    'pageKey',
    'entryUrlTemplate'
  ]
  scalarKeys.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) {
      next[key] = patch[key]
    }
  })
  if (Object.prototype.hasOwnProperty.call(patch, 'accepted') && patch.accepted !== undefined) {
    next.accepted = !!patch.accepted
  }
  if (next.status !== 'existing') {
    next.accepted = false
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'confirmed') && patch.confirmed !== undefined) {
    next.confirmed = !!patch.confirmed
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'deferred') && patch.deferred !== undefined) {
    next.deferred = !!patch.deferred
  }
  if (next.confirmed === undefined) {
    next.confirmed = false
  }
  if (Array.isArray(patch.unresolved)) {
    next.unresolved = patch.unresolved.map(item => String(item || '').trim()).filter(Boolean)
  }
  if (Array.isArray(patch.evidence)) {
    next.evidence = patch.evidence
  }
  const byKey = {}
  const order = []
  function remember(param) {
    const key = String(param.key || '')
    if (!key) {
      return
    }
    if (!byKey[key]) {
      order.push(key)
    }
    byKey[key] = param
  }
  ;(prev.parameters || []).forEach(item => remember(normalizeParam(item)))
  ;(patch.parameters || []).forEach(item => {
    const incoming = item && typeof item === 'object' ? item : {}
    const key = String(incoming.key || '')
    if (!key) {
      return
    }
    const before = byKey[key] || normalizeParam({ key })
    const hintPatch = incoming.hint && typeof incoming.hint === 'object' ? incoming.hint : {}
    const mergedHint = Object.assign({}, emptyHint(), before.hint || {}, {
      note: hintPatch.note !== undefined ? String(hintPatch.note) : (before.hint && before.hint.note) || '',
      api: Object.assign(
        {},
        emptyHint().api,
        (before.hint && before.hint.api) || {},
        hintPatch.api || {}
      )
    })
    if (Array.isArray(hintPatch.images)) {
      mergedHint.images = hintPatch.images.map(rel => String(rel || '').trim()).filter(Boolean)
    } else {
      mergedHint.images = (before.hint && before.hint.images) || []
    }
    const nextExpr = incoming.expression !== undefined ? incoming.expression : before.expression
    const nextKind = incoming.valueKind !== undefined ? incoming.valueKind : before.valueKind
    remember(Object.assign({}, before, {
      expression: nextExpr,
      valueKind: inferValueKind(nextExpr, nextKind),
      sourcePath: incoming.sourcePath !== undefined ? incoming.sourcePath : before.sourcePath,
      confidence: incoming.confidence !== undefined ? incoming.confidence : before.confidence,
      docDesc: incoming.docDesc !== undefined ? incoming.docDesc : before.docDesc,
      fromMemory: incoming.fromMemory !== undefined ? !!incoming.fromMemory : !!before.fromMemory,
      fromEvtId: incoming.fromEvtId !== undefined ? String(incoming.fromEvtId || '') : (before.fromEvtId || ''),
      hint: mergedHint
    }))
  })
  next.parameters = order.map(key => byKey[key])
  next.evtId = String(patch.evtId || prev.evtId || '')
  if (patch.accept && typeof patch.accept === 'object') {
    next.accept = Object.assign({}, prev.accept || {}, patch.accept)
    if (next.accept.expect && typeof next.accept.expect === 'object') {
      next.accept.expect = Object.assign({}, next.accept.expect)
      delete next.accept.expect.uicode
    }
  }
  delete next.uicode
  return next
}

module.exports = {
  TEMPLATE,
  REVIEW_TEMPLATE,
  buildReport,
  buildReviewReport,
  defaultPaths,
  emptyHint,
  inject,
  injectReview,
  lockImplFile,
  mergeImplEvent,
  mergeReport,
  normalizeHint,
  normalizeParam,
  renderReviewToFile,
  renderToFile,
  resolveFromRepo
}
