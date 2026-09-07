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
resolve-entry-path — 从种子页沿跳转图走到落点页，并与 trackingBaseline diff 对比，锁本期验收路径

Usage:
  node resolve-entry-path.js --excel=docs/2.3埋点需求文档.xlsx --json
  node resolve-entry-path.js --excel=... --evt=96793
  node resolve-entry-path.js --file=client/src/pages/priceV2/dealReport/index.jsx

说明:
  不写业务 locator，不改 impl.json。给路径 C 填 accept.preconditions 用。
  从种子页沿仓内跳转图走到落点页，列出完整页路径；多条时仍由 resolve-accept-path 按确定性规则选。
  lockMode:
    new_jump           选中路径含本期新增跳转 → 主验收走这条路
    existing_shortest  历史路径且可唯一收敛
    seed_is_page       seed 已在该页 → preconditions 可为 []
    no_inbound         仓内扫不到从种子走到落点的路径（外链/原生）→ 以 seed 直达该页为准
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

const MAX_PATH_HOPS = 8

function preferEdges(page, edges) {
  const list = edges || []
  if (!page || !page.path) {
    return list
  }
  const sameTo = list.filter(edge => edge.to === page.path)
  return sameTo.length ? sameTo : list
}

function collectGraphNodes(edges, extra) {
  const nodes = {}
  ;(edges || []).forEach(edge => {
    if (edge && edge.from) nodes[edge.from] = true
    if (edge && edge.to) nodes[edge.to] = true
  })
  ;(extra || []).forEach(item => {
    if (item) nodes[item] = true
  })
  return Object.keys(nodes)
}

function matchSeedNode(seedPath, nodes) {
  const seed = String(seedPath || '')
  if (!seed) return ''
  let best = ''
  ;(nodes || []).forEach(item => {
    const node = String(item || '')
    if (!node) return
    if (seed === node || seed.indexOf(node + '/') === 0) {
      if (node.length > best.length) best = node
    }
  })
  return best
}

function targetPathSet(page, inbound) {
  const set = {}
  if (page && page.path) set[page.path] = true
  ;(page && page.aliases || []).forEach(item => {
    if (item) set[item] = true
  })
  ;(inbound || []).forEach(edge => {
    if (edge && edge.to) set[edge.to] = true
  })
  return Object.keys(set)
}

function enumerateSimplePaths(edges, start, goals, maxHops) {
  const hopLimit = Number.isFinite(maxHops) ? maxHops : MAX_PATH_HOPS
  const byFrom = {}
  ;(edges || []).forEach(edge => {
    if (!edge || !edge.from || !edge.to || edge.from === edge.to) return
    if (!byFrom[edge.from]) byFrom[edge.from] = []
    byFrom[edge.from].push(edge)
  })
  const goalSet = {}
  ;(goals || []).forEach(item => {
    if (item) goalSet[item] = true
  })
  if (!start || goalSet[start]) return []
  const found = []
  function walk(node, used, chain) {
    if (chain.length >= hopLimit) return
    const list = byFrom[node] || []
    for (let i = 0; i < list.length; i += 1) {
      const edge = list[i]
      if (used[edge.to]) continue
      const next = chain.concat(edge)
      if (goalSet[edge.to]) {
        found.push(next)
        continue
      }
      used[edge.to] = true
      walk(edge.to, used, next)
      delete used[edge.to]
    }
  }
  const used = {}
  used[start] = true
  walk(start, used, [])
  return found
}

function candidateFromChain(chain, page, seedPath, backfill) {
  const hops = chain || []
  const added = !backfill && hops.some(edge => !!edge.jumpAddedThisPeriod)
  const last = hops[hops.length - 1]
  const target = page && page.path || (last && last.to) || ''
  return {
    pageKey: target,
    seedUrlKey: seedPath || '',
    target,
    steps: hops.map(edge => ({
      node: edge.from,
      action: edge.via || 'navigate',
      to: edge.to
    })).concat([{ node: target, action: 'target' }]),
    edges: hops.map(edge => ({
      from: edge.from,
      to: edge.to,
      action: edge.via || '',
      sourceFile: edge.file,
      evidence: ['router'],
      changeStatus: (!backfill && edge.jumpAddedThisPeriod) ? 'added' : 'existing'
    })),
    reachable: true,
    relatedToCurrentChange: added,
    factsComplete: hops.every(edge => !!(edge.from && edge.to && edge.file)),
    executable: true,
    cost: hops.length,
    stableLocatorCount: hops.filter(edge => edge.via).length,
    lockEdge: last || null,
    lockEdges: hops
  }
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

function lockForPage(page, inbound, seedPath, trackingMode, historicalDecision, allEdges) {
  const backfill = trackingMode === 'backfill'
  const seedOnPage = !!(seedPath && page && (
    seedPath === page.path || seedPath.indexOf(page.path + '/') === 0
  ))
  const graphEdges = (allEdges && allEdges.length) ? allEdges : (inbound || [])
  const goals = targetPathSet(page, inbound)
  const nodes = collectGraphNodes(graphEdges, goals.concat([seedPath, page && page.path]))
  const start = matchSeedNode(seedPath, nodes)
  let candidates = []
  if (start && !seedOnPage) {
    candidates = enumerateSimplePaths(graphEdges, start, goals, MAX_PATH_HOPS)
      .map(chain => candidateFromChain(chain, page, seedPath, backfill))
  }
  if (!candidates.length && !seedOnPage) {
    candidates = preferEdges(page, inbound).map(edge => candidateFromEdge(edge, page, seedPath, backfill))
  }
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
      hint: '从种子页到落点页有多条完整路径，无法从代码事实唯一确定。列出候选请用户选一次，写入 accept.pathResolution 后复用。'
    }
  }
  if (selected && selected.relatedToCurrentChange) {
    return {
      lockMode: 'new_jump',
      lockEdges: selected.lockEdges && selected.lockEdges.length
        ? selected.lockEdges
        : (selected.lockEdge ? [selected.lockEdge] : []),
      needsConfirm: false,
      pathResolution: resolution,
      hint: '主验收只走含本期新增跳转的完整页路径；不要改选其它历史入口。按 lockEdges 从种子页依次点到落点页。'
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
      hint: '仓内未扫到从种子页走到落点页的跳转。以 seed 直达该页为准（外链/原生扫不到）。'
    }
  }
  return {
    lockMode: 'existing_shortest',
    lockEdges: selected && selected.lockEdges && selected.lockEdges.length
      ? selected.lockEdges
      : (selected && selected.lockEdge ? [selected.lockEdge] : []),
    needsConfirm: false,
    pathResolution: resolution,
    hint: backfill
      ? 'trackingMode=backfill：旧页补点。从种子页走已有完整页路径，不把本期新跳转当主 accept。禁止编新入口。'
      : '本期没有新跳转边。从种子页走已锁定的完整页路径进落点页，再触发本期埋点。禁止另选历史入口。'
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
  const allEdges = (graph.edgeDetails || []).map(edge => classifyEdge(period, edge))
  const inbound = allEdges.filter(edge => aliasPaths[edge.to])
  const pageWithAliases = page
    ? Object.assign({}, page, { aliases: Object.keys(aliasPaths) })
    : page
  const lock = lockForPage(
    pageWithAliases,
    inbound,
    seedPath,
    period.trackingMode,
    spec.historicalDecision || null,
    allEdges
  )
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
  candidateFromChain,
  candidateFromEdge,
  classifyEdge,
  enumerateSimplePaths,
  lockForPage,
  matchSeedNode,
  pagesForFile,
  resolveOne,
  main
}
