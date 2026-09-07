const path = require('path')
const { defaultPaths } = require('../extract/report')

const { viewportForDevice } = require('./accept-device')
const { pathIdForCandidate } = require('./path-id')

const CHAIN_VERSION = 1
const DEFAULT_VIEWPORT = viewportForDevice('mobile')

/**
 * 关键路径引擎（项目无关）。
 * 页面入口 / Tab 前置 / locator / 是否导航离开，一律读 impl.json 里模型填写的 accept，
 * 本文件不做任何业务 pageKey / evtId / 文案硬编码。
 */

function defaultAcceptPaths(repoRoot, args) {
  const base = defaultPaths(repoRoot, args)
  const slug = base.slug || ''
  const chainPath = slug ? path.join(base.outDir, '_raw', 'accept-chain.json') : ''
  const acceptDir = slug ? path.join(base.outDir, 'accept') : ''
  return Object.assign({}, base, {
    chainPath,
    acceptDir,
    acceptJson: slug ? path.join(acceptDir, `${slug}-验收.json`) : '',
    acceptHtml: slug ? path.join(acceptDir, `${slug}-验收.html`) : '',
    shotsDir: slug ? path.join(acceptDir, 'shots') : '',
    finalHtml: slug ? path.join(base.outDir, `${slug}-终稿.html`) : '',
    missingJson: slug ? path.join(base.outDir, `${slug}-缺失埋点.json`) : '',
    missingHtml: slug ? path.join(base.outDir, `${slug}-缺失埋点.html`) : ''
  })
}

function quotedTexts(hint) {
  const text = String(hint || '')
  const out = []
  const re = /[「『“"]([^」』”"]+)[」』”"]/g
  let match = re.exec(text)
  while (match) {
    out.push(match[1].trim())
    match = re.exec(text)
  }
  const paren = text.match(/[（(]([^）)]+)[）)]/)
  if (paren && paren[1] && /[\/、]/.test(paren[1])) {
    paren[1].split(/[\/、]/).forEach(part => {
      const value = part.replace(/时发送.*$/, '').trim()
      if (value && out.indexOf(value) === -1) {
        out.push(value)
      }
    })
  }
  return out.filter(Boolean)
}

function inferKind(lifecycle, eventKind) {
  const life = String(lifecycle || '')
  if (life === 'onClick' || eventKind === 'click') {
    return 'click'
  }
  if (life === 'IntersectionObserver') {
    return 'scrollIntoView'
  }
  if (life === 'useEffect') {
    return 'waitVisible'
  }
  if (eventKind === 'view') {
    return 'pageLoad'
  }
  return 'pageLoad'
}

/** 只规范化已有 accept.trigger；不按 evtId / 项目表猜 locator。 */
function resolveTrigger(impl, docEvent) {
  const accept = impl.accept || {}
  const raw = accept.trigger && typeof accept.trigger === 'object' ? accept.trigger : null
  if (!raw || !raw.kind) {
    return { ok: false, reason: 'missing accept.trigger.kind' }
  }
  const kind = String(raw.kind)
  const alternates = Array.isArray(raw.alternates) ? raw.alternates.slice() : []
  let by = raw.by || ''
  let value = raw.value || ''
  if (!value && kind !== 'pageLoad') {
    const quotes = quotedTexts(impl.insertHint)
    if (quotes.length) {
      by = by || 'text'
      value = quotes[0]
      quotes.slice(1).forEach(item => {
        if (alternates.indexOf(item) === -1) {
          alternates.push(item)
        }
      })
    }
  }
  if (kind !== 'pageLoad' && !value) {
    return { ok: false, reason: 'accept.trigger missing locator value' }
  }
  return {
    ok: true,
    trigger: {
      kind,
      by: by || '',
      value: value || '',
      alternates
    }
  }
}

function inferDataDep(param) {
  const src = param && typeof param === 'object' ? param : {}
  const hintApi = src.hint && src.hint.api ? src.hint.api : {}
  const blob = `${src.sourcePath || ''} ${src.expression || ''}`
  const key = String(src.key || '')
  const dep = {
    paramKey: key,
    sourcePath: src.sourcePath || '',
    expression: src.expression || ''
  }
  if (hintApi.url || hintApi.field) {
    return Object.assign(dep, {
      from: 'api',
      api: {
        urlIncludes: hintApi.url || '',
        field: hintApi.field || ''
      }
    })
  }
  if (/\burl\b|URL|query|searchParams|location\.search/i.test(blob)) {
    const fromExpr = String(src.expression || '').match(/\b([a-zA-Z_][\w]*)\b/)
    return Object.assign(dep, {
      from: 'url',
      queryKey: (fromExpr && fromExpr[1]) || key
    })
  }
  if (/window\.__user|__user/.test(blob)) {
    return Object.assign(dep, { from: 'user' })
  }
  if (/接口|api\//i.test(blob)) {
    return Object.assign(dep, {
      from: 'api',
      api: { urlIncludes: '', field: '' }
    })
  }
  return Object.assign(dep, { from: 'page' })
}

function resolveDataDeps(impl) {
  if (impl.accept && Array.isArray(impl.accept.dataDeps) && impl.accept.dataDeps.length) {
    return impl.accept.dataDeps.slice()
  }
  return (impl.parameters || []).map(inferDataDep)
}

function inferAssertParams(impl) {
  if (impl.accept && Array.isArray(impl.accept.assertParams) && impl.accept.assertParams.length) {
    return impl.accept.assertParams.slice()
  }
  return (impl.parameters || [])
    .filter(item => {
      const conf = item.confidence || 'high'
      return conf === 'high' || conf === 'medium'
    })
    .map(item => item.key)
    .filter(Boolean)
}

function resolveSharedSteps(impl) {
  const accept = impl.accept || {}
  if (accept.trigger && Array.isArray(accept.trigger.preconditions)) {
    return accept.trigger.preconditions.slice()
  }
  if (Array.isArray(accept.sharedSteps)) {
    return accept.sharedSteps.slice()
  }
  if (Array.isArray(accept.preconditions)) {
    return accept.preconditions.slice()
  }
  return []
}

function resolveNavigates(impl, trigger) {
  const accept = impl.accept || {}
  if (typeof accept.navigatesAway === 'boolean') {
    return accept.navigatesAway
  }
  if (typeof accept.navigates === 'boolean') {
    return accept.navigates
  }
  if (trigger && typeof trigger.navigatesAway === 'boolean') {
    return trigger.navigatesAway
  }
  return false
}

function docById(eventsPayload) {
  const map = {}
  ;((eventsPayload && eventsPayload.events) || []).forEach(item => {
    if (item && item.evtId) {
      map[String(item.evtId)] = item
    }
  })
  return map
}

function kindRank(kind) {
  if (kind === 'pageLoad') return 0
  if (kind === 'waitVisible') return 1
  if (kind === 'scrollIntoView') return 2
  return 3
}

function buildTarget(impl, docEvent, seedUrl) {
  const resolved = resolveTrigger(impl, docEvent)
  if (!resolved.ok) {
    return { error: resolved.reason }
  }
  const trigger = resolved.trigger
  const pageKey = String(impl.pageKey || '').trim()
  if (!pageKey) {
    return { error: 'missing pageKey (model must set from code)' }
  }
  const sharedSteps = resolveSharedSteps(impl)
  const accept = impl.accept || {}
  const pathRes = accept.pathResolution
  if (pathRes && pathRes.status === 'needsConfirm') {
    return { error: 'accept.pathResolution needsConfirm' }
  }
  const dataDeps = resolveDataDeps(impl)
  return {
    evtId: String(impl.evtId),
    eventName: (docEvent && docEvent.eventName) || '',
    lifecycle: impl.lifecycle || '',
    status: impl.status || 'pending',
    pageKey,
    seedUrl: seedUrl || '',
    sharedSteps,
    navigates: resolveNavigates(impl, impl.accept && impl.accept.trigger),
    trigger: {
      kind: trigger.kind,
      by: trigger.by || '',
      value: trigger.value || '',
      alternates: trigger.alternates || []
    },
    expect: {
      eventType: (docEvent && docEvent.eventType) || (trigger.kind === 'click' ? 'Module_Click' : 'Module_View'),
      pid: (docEvent && docEvent.pid) || 'a_app',
      // uicode 只从文档 events.json 读取，禁止 impl / 现网覆盖
      uicode: (docEvent && docEvent.uicode) || ''
    },
    assertParams: inferAssertParams(impl),
    dataDeps,
    code: {
      file: impl.targetFile || '',
      functionName: impl.functionName || '',
      lifecycle: impl.lifecycle || ''
    },
    selectedPathId: pathRes && pathRes.selectedPathId || '',
    pathDecisionSource: pathRes && pathRes.selectedBy || ''
  }
}

function clusterKey(target) {
  return [
    target.pageKey || 'unknown',
    JSON.stringify(target.sharedSteps || [])
  ].join('|')
}

function pathIdFor(pageKey, sharedSteps, navigates, evtId) {
  const suffix = navigates ? `nav-${evtId}` : 'shared'
  return pathIdForCandidate({
    pageKey: pageKey || 'page',
    steps: sharedSteps || [],
    target: suffix
  })
}

function clusterPaths(targets, seedUrl) {
  const groups = {}
  const order = []
  const entryUrl = seedUrl || ''
  targets.forEach(target => {
    const nav = !!target.navigates
    const key = clusterKey(target) + (nav ? `|nav:${target.evtId}` : '|shared')
    if (!groups[key]) {
      order.push(key)
      groups[key] = {
        pathId: pathIdFor(target.pageKey, target.sharedSteps, nav, target.evtId),
        pageKey: target.pageKey,
        pathDecisionSource: target.pathDecisionSource || '',
        selectedPathId: target.selectedPathId || '',
        entry: { url: entryUrl, waitApis: [] },
        sharedSteps: target.sharedSteps || [],
        targets: []
      }
    }
    groups[key].targets.push(target)
  })
  return order.map(key => {
    const pathItem = groups[key]
    pathItem.targets.sort((a, b) => kindRank(a.trigger.kind) - kindRank(b.trigger.kind))
    pathItem.targets = pathItem.targets.map(item => {
      const copy = Object.assign({}, item)
      delete copy.pageKey
      delete copy.seedUrl
      delete copy.sharedSteps
      delete copy.status
      delete copy.pathDecisionSource
      delete copy.selectedPathId
      return copy
    })
    return pathItem
  })
}

function toAcceptPatch(target) {
  return {
    trigger: Object.assign({}, target.trigger, {
      preconditions: target.sharedSteps || []
    }),
    navigatesAway: !!target.navigates,
    dataDeps: target.dataDeps || [],
    assertParams: target.assertParams || []
  }
}

function buildAcceptChain(implPayload, eventsPayload, options) {
  const opts = options || {}
  const seedUrl = String(opts.seedUrl || '').trim()
  const docs = docById(eventsPayload)
  const implEvents = (implPayload && implPayload.events) || []
  const implIds = {}
  const ready = []
  const pending = []

  implEvents.forEach(impl => {
    const evtId = String((impl && impl.evtId) || '')
    if (!evtId) {
      return
    }
    implIds[evtId] = true
    const docEvent = docs[evtId] || {}
    if (impl.status && impl.status !== 'existing' && impl.status !== 'located') {
      pending.push({ evtId, reason: `status=${impl.status}` })
      return
    }
    if (!impl.targetFile) {
      pending.push({ evtId, reason: 'missing targetFile' })
      return
    }
    const target = buildTarget(impl, docEvent, seedUrl)
    if (target.error) {
      pending.push({ evtId, reason: target.error })
      return
    }
    ready.push(target)
  })

  ;((eventsPayload && eventsPayload.events) || []).forEach(item => {
    const evtId = String((item && item.evtId) || '')
    if (!evtId || implIds[evtId]) {
      return
    }
    pending.push({ evtId, reason: 'excel event missing in impl.json' })
  })

  const evtFilter = opts.evtIds
    ? String(opts.evtIds).split(/[,\s]+/).map(id => id.trim()).filter(Boolean)
    : null
  const filtered = evtFilter
    ? ready.filter(item => evtFilter.indexOf(item.evtId) !== -1)
    : ready
  if (evtFilter) {
    ready.forEach(item => {
      if (evtFilter.indexOf(item.evtId) === -1) {
        pending.push({ evtId: item.evtId, reason: 'filtered by --evt' })
      }
    })
    evtFilter.forEach(id => {
      if (!ready.some(item => item.evtId === id) && !pending.some(item => item.evtId === id)) {
        pending.push({ evtId: id, reason: 'evtId not found' })
      }
    })
  }

  return {
    version: CHAIN_VERSION,
    generatedAt: new Date().toISOString(),
    slug: (implPayload && implPayload.slug) || (eventsPayload && eventsPayload.slug) || '',
    excelPath: (implPayload && implPayload.excelPath) || (eventsPayload && eventsPayload.excelPath) || '',
    baseUrlEnv: 'baseUrl',
    seedUrlEnv: 'seedUrl',
    defaults: {
      seedUrl,
      housedelCode: opts.housedelCode || '',
      device: opts.deviceId || 'unset',
      viewport: viewportForDevice(opts.deviceId)
    },
    pending,
    paths: clusterPaths(filtered, seedUrl)
  }
}

function filterChainByEvt(chain, evtIds) {
  const ids = (evtIds || []).map(id => String(id)).filter(Boolean)
  if (!ids.length) {
    return chain
  }
  const idSet = {}
  ids.forEach(id => { idSet[id] = true })
  const paths = (chain.paths || []).map(item => {
    const targets = (item.targets || []).filter(target => idSet[target.evtId])
    return Object.assign({}, item, { targets })
  }).filter(item => item.targets.length)
  const pending = (chain.pending || []).filter(item => idSet[item.evtId])
  ids.forEach(id => {
    const inPaths = paths.some(item => item.targets.some(target => target.evtId === id))
    const inPending = pending.some(item => item.evtId === id)
    if (!inPaths && !inPending) {
      pending.push({ evtId: id, reason: 'evtId not found' })
    }
  })
  return Object.assign({}, chain, { paths, pending })
}

function listChainEvtIds(chain) {
  const ids = []
  ;(chain.paths || []).forEach(item => {
    ;(item.targets || []).forEach(target => {
      ids.push(target.evtId)
    })
  })
  return ids
}

function describeSteps(pathItem, target) {
  const steps = []
  steps.push(`打开种子入口 ${pathItem.entry.url}`)
  ;(pathItem.sharedSteps || []).forEach(step => {
    const loc = step.by && step.value ? ` ${step.by}:${step.value}` : (step.urlIncludes ? ` ${step.urlIncludes}` : '')
    steps.push(`${step.action}${loc}${step.why ? `（${step.why}）` : ''}`)
  })
  const trigger = target.trigger || {}
  if (trigger.kind === 'pageLoad') {
    steps.push('等待页面发出埋点')
  } else {
    steps.push(`${trigger.kind} ${trigger.by}:${trigger.value}`)
  }
  return steps
}

module.exports = {
  CHAIN_VERSION,
  DEFAULT_VIEWPORT,
  buildAcceptChain,
  buildTarget,
  clusterPaths,
  defaultAcceptPaths,
  describeSteps,
  filterChainByEvt,
  inferDataDep,
  inferKind,
  listChainEvtIds,
  quotedTexts,
  resolveTrigger,
  toAcceptPatch
}
