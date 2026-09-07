#!/usr/bin/env node
/* eslint-disable no-console */
const { buildGraph } = require('../history/history-tracking')
const {
  defaultAcceptPaths
} = require('./accept-chain')
const {
  envAcceptUrls,
  findRepoRoot,
  parseArgs,
  readJson,
  toPosix
} = require('../lib/lib')
const { jumpAddedThisPeriod, loadPeriodDiff } = require('../lib/period-diff')
const { pathIdForCandidate } = require('./path-id')
const { resolveAcceptPath } = require('./resolve-accept-path')

const SCRIPT_DIR = __dirname

function printHelp() {
  console.log(`
resolve-entry-path — 倒推到达落点页的跳转边，并与 trackingBaseline diff 对比，锁本期验收入口

Usage:
  node resolve-entry-path.js --excel=docs/2.3埋点需求文档.xlsx --json
  node resolve-entry-path.js --excel=... --evt=96793
  node resolve-entry-path.js --file=client/src/pages/priceV2/dealReport/index.jsx

说明:
  不写业务 locator，不改 impl.json。给路径 C 填 accept.preconditions 用。
  lockMode:
    new_jump           本期新增跳转到该页 → 主验收走这条新边
    existing_shortest  入边都是历史跳转且可唯一收敛
    seed_is_page       seed 已在该页 → preconditions 可为 []
    no_inbound         仓内扫不到入边（外链/原生）→ 以 seed 直达该页为准
    needs_confirm      多条历史/同级新路径无法唯一收敛 → 人工选一次并写入 pathResolution
`)
}

function seedPathname(repoRoot, args) {
  const urls = envAcceptUrls(repoRoot, {
    seedUrl: args['seed-url'] || '',
    housedelCode: args.housedel || ''
  })
  try {
    return new URL(urls.seedUrl, 'http://seed.invalid').pathname
  } catch (error) {
    return String(urls.seedUrl || '').split('?')[0] || ''
  }
}

function pageDir(entryFile) {
  return toPosix(entryFile || '').replace(/\/index\.\w+$/, '')
}

function seedRoot(seedPath) {
  const parts = String(seedPath || '').split('/').filter(Boolean)
  return parts[0] || ''
}

function pageMatchesSeedRoot(page, seedPath) {
  const root = seedRoot(seedPath)
  if (!root || !page || !page.path) {
    return false
  }
  return page.path === '/' + root || page.path.indexOf('/' + root + '/') === 0
}

function rankPages(pages, seedPath) {
  const list = pages.slice()
  list.sort((a, b) => {
    const aSeed = pageMatchesSeedRoot(a, seedPath) ? 1 : 0
    const bSeed = pageMatchesSeedRoot(b, seedPath) ? 1 : 0
    if (aSeed !== bSeed) {
      return bSeed - aSeed
    }
    return String(a.path || '').localeCompare(String(b.path || ''))
  })
  return list
}

function pagesForFile(graph, targetFile, seedPath) {
  const file = toPosix(targetFile)
  if (!file) {
    return []
  }
  const owned = []
  const eventHit = []
  ;(graph.pages || []).forEach(page => {
    const entry = toPosix(page.entryFile || '')
    const dir = pageDir(entry)
    if (entry && (file === entry || (dir && file.indexOf(dir + '/') === 0))) {
      owned.push(page)
      return
    }
    if ((page.events || []).some(evt => toPosix(evt.file) === file)) {
      eventHit.push(page)
    }
  })
  if (!owned.length) {
    return rankPages(eventHit, seedPath)
  }
  const entryFiles = {}
  owned.forEach(page => {
    entryFiles[toPosix(page.entryFile || '')] = true
  })
  const aliases = (graph.pages || []).filter(page => entryFiles[toPosix(page.entryFile || '')])
  return rankPages(aliases.length ? aliases : owned, seedPath)
}

function classifyEdge(period, edge) {
  const added = jumpAddedThisPeriod(period, edge.file, edge.line, edge.to)
  return {
    from: edge.from,
    to: edge.to,
    via: edge.via,
    file: edge.file,
    line: edge.line,
    inPeriodFile: period.isPeriodFile(edge.file),
    jumpAddedThisPeriod: added
  }
}

function preferEdges(page, edges) {
  const list = edges || []
  if (!page || !page.path) {
    return list
  }
  const sameTo = list.filter(edge => edge.to === page.path)
  return sameTo.length ? sameTo : list
}

function candidateFromEdge(edge, page, seedPath, backfill) {
  const added = !backfill && !!edge.jumpAddedThisPeriod
  return {
    pageKey: page && page.path || '',
    seedUrlKey: seedPath || '',
    target: page && page.path || '',
    steps: [
      { node: edge.from, action: edge.via || 'navigate', to: edge.to },
      { node: edge.to, action: 'target' }
    ],
    edges: [{
      from: edge.from,
      to: edge.to,
      action: edge.via || '',
      sourceFile: edge.file,
      evidence: ['router'],
      changeStatus: added ? 'added' : 'existing'
    }],
    reachable: true,
    relatedToCurrentChange: added,
    factsComplete: !!(edge.from && edge.to && edge.file),
    executable: true,
    cost: edge.from === seedPath ? 1 : 2,
    stableLocatorCount: edge.via ? 1 : 0,
    lockEdge: edge
  }
}

function lockForPage(page, inbound, seedPath, trackingMode, historicalDecision) {
  const backfill = trackingMode === 'backfill'
  const seedOnPage = !!(seedPath && page && (
    seedPath === page.path || seedPath.indexOf(page.path + '/') === 0
  ))
  const candidates = preferEdges(page, inbound).map(edge => candidateFromEdge(edge, page, seedPath, backfill))
  if (seedOnPage) {
    candidates.push({
      pageKey: page.path,
      seedUrlKey: seedPath || '',
      target: page.path,
      steps: [{ node: page.path, action: 'target' }],
      edges: [],
      reachable: true,
      seedIsPage: true,
      relatedToCurrentChange: false,
      factsComplete: true,
      executable: true,
      cost: 0,
      stableLocatorCount: 1,
      lockEdge: null
    })
  }
  if (!candidates.length) {
    candidates.push({
      pageKey: page && page.path || '',
      seedUrlKey: seedPath || '',
      target: page && page.path || '',
      steps: [{ node: page && page.path || 'seed', action: 'target' }],
      edges: [],
      reachable: true,
      relatedToCurrentChange: false,
      factsComplete: true,
      executable: true,
      cost: 0,
      stableLocatorCount: 0,
      lockEdge: null
    })
  }
  const resolution = resolveAcceptPath({
    candidates,
    historicalDecision: historicalDecision || null,
    context: {
      pageKey: page && page.path || '',
      target: page && page.path || '',
      seedUrlKey: seedPath || ''
    }
  })
  const selected = candidates.find(item => pathIdForCandidate(item) === resolution.selectedPathId)
  if (resolution.status === 'needsConfirm') {
    return {
      lockMode: 'needs_confirm',
      lockEdges: [],
      needsConfirm: true,
      pathResolution: resolution,
      hint: '多条可达路径无法从代码事实唯一确定。列出 candidate 请用户选一次，写入 accept.pathResolution 后复用。'
    }
  }
  if (selected && selected.relatedToCurrentChange) {
    return {
      lockMode: 'new_jump',
      lockEdges: selected.lockEdge ? [selected.lockEdge] : [],
      needsConfirm: false,
      pathResolution: resolution,
      hint: '主验收只走本期新增跳转；历史入边不当主 accept。从 seed 点到 lockEdges[0].from，再点该跳转进入落点页。'
    }
  }
  if (selected && selected.seedIsPage) {
    return {
      lockMode: 'seed_is_page',
      lockEdges: [],
      needsConfirm: false,
      pathResolution: resolution,
      hint: 'seed 已在落点页。preconditions 用 []，只触发本期控件。不要编新跳转。'
    }
  }
  if (!inbound.length) {
    return {
      lockMode: 'no_inbound',
      lockEdges: [],
      needsConfirm: false,
      pathResolution: resolution,
      hint: '仓内未扫到 history.push / Link 入边。以 seed 直达该页为准（外链/原生扫不到）。'
    }
  }
  return {
    lockMode: 'existing_shortest',
    lockEdges: selected && selected.lockEdge ? [selected.lockEdge] : [],
    needsConfirm: false,
    pathResolution: resolution,
    hint: backfill
      ? 'trackingMode=backfill：旧页补点。从 seed 走已有最短入边，不把本期新跳转当主 accept。禁止编新入口。'
      : '本期没有新跳转边。从 seed 走已有最短入边进旧页，再触发本期埋点。禁止把全部历史入边都写成验收 path。'
  }
}

function resolveOne(graph, period, seedPath, spec) {
  const targetFile = toPosix(spec.targetFile || spec.file || '')
  const pages = spec.route
    ? (graph.pages || []).filter(page => page.path === spec.route)
    : pagesForFile(graph, targetFile, seedPath)
  const page = pages[0] || null
  const aliasPaths = {}
  pages.forEach(item => {
    if (item.path) {
      aliasPaths[item.path] = true
    }
  })
  if (page && page.path) {
    aliasPaths[page.path] = true
  }
  const inboundRaw = (graph.edgeDetails || []).filter(edge => aliasPaths[edge.to])
  const inbound = inboundRaw.map(edge => classifyEdge(period, edge))
  const lock = lockForPage(page, inbound, seedPath, period.trackingMode, spec.historicalDecision || null)
  return {
    evtId: spec.evtId || '',
    targetFile,
    pageKeyHint: page ? String(page.path || '').replace(/^\//, '').replace(/\//g, '_') : '',
    pagePath: page ? page.path : '',
    pageAliases: pages.map(item => item.path).filter(Boolean),
    pageEntryFile: page ? page.entryFile : '',
    inboundCount: inbound.length,
    inbound,
    newJumpCount: inbound.filter(edge => edge.jumpAddedThisPeriod).length,
    lockMode: lock.lockMode,
    lockEdges: lock.lockEdges,
    needsConfirm: !!lock.needsConfirm,
    pathResolution: lock.pathResolution || null,
    hint: lock.hint
  }
}

function pickEvents(implPayload, args) {
  const want = {}
  String(args.evt || '').split(',').forEach(id => {
    const key = String(id || '').trim()
    if (key) {
      want[key] = true
    }
  })
  const hasFilter = Object.keys(want).length > 0
  return (implPayload.events || []).filter(item => {
    if (hasFilter) {
      return want[String(item.evtId || '')]
    }
    return true
  })
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const period = loadPeriodDiff(repoRoot)
  const graph = buildGraph(repoRoot)
  const seedPath = seedPathname(repoRoot, args)
  const specs = []

  if (args.file) {
    specs.push({
      evtId: args.evt || '',
      targetFile: args.file,
      route: args.route || ''
    })
  } else {
    const paths = defaultAcceptPaths(repoRoot, args)
    if (!paths.implPath) {
      printHelp()
      throw new Error('未提供 --excel / --impl / --file')
    }
    const implPayload = readJson(paths.implPath, { events: [] })
    pickEvents(implPayload, args).forEach(item => {
      specs.push({
        evtId: String(item.evtId || ''),
        targetFile: item.targetFile || '',
        route: args.route || '',
        historicalDecision: item.accept && item.accept.pathResolution || null
      })
    })
  }

  const events = specs.map(spec => resolveOne(graph, period, seedPath, spec))
  const payload = {
    generatedAt: new Date().toISOString(),
    baseline: period.baseline,
    trackingMode: period.trackingMode || '',
    seedPathname: seedPath,
    periodFileCount: Object.keys(period.files).length,
    events
  }

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  console.log('== resolve-entry-path ==')
  console.log('baseline: ' + period.baseline)
  console.log('trackingMode: ' + (period.trackingMode || '(unset)'))
  console.log('seed: ' + (seedPath || '(missing)'))
  console.log('period files: ' + payload.periodFileCount)
  events.forEach(item => {
    const label = item.evtId || item.targetFile || '-'
    console.log(
      '  ' + label +
      '  page=' + (item.pagePath || '-') +
      '  inbound=' + item.inboundCount +
      '  newJump=' + item.newJumpCount +
      '  lock=' + item.lockMode +
      (item.needsConfirm ? '  needsConfirm' : '')
    )
    item.lockEdges.forEach(edge => {
      console.log('    ' + edge.from + ' -[' + edge.via + ']-> ' + edge.to + '  ' + edge.file + ':' + edge.line)
    })
    console.log('    ' + item.hint)
  })
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message || error)
    process.exit(error.code === 'BASELINE_MISSING' ? 2 : 1)
  }
}

module.exports = {
  candidateFromEdge,
  classifyEdge,
  lockForPage,
  pagesForFile,
  resolveOne,
  main
}
