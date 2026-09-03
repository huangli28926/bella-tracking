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
    existing_shortest  入边都是历史跳转 → 从 seed 走已有最短路径，禁止编新入口
    seed_is_page       seed 已在该页 → preconditions 可为 []
    no_inbound         仓内扫不到入边（外链/原生）→ 以 seed 直达该页为准
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

function lockForPage(page, inbound, seedPath, trackingMode) {
  const newJumps = preferEdges(page, inbound.filter(edge => edge.jumpAddedThisPeriod))
  const seedOnPage = !!(seedPath && page && (
    seedPath === page.path || seedPath.indexOf(page.path + '/') === 0
  ))
  const backfill = trackingMode === 'backfill'
  if (newJumps.length && !backfill) {
    const fromSeed = newJumps.filter(edge => edge.from === seedPath)
    return {
      lockMode: 'new_jump',
      lockEdges: fromSeed.length ? fromSeed : newJumps,
      hint: '主验收只走本期新增跳转；历史入边不当主 accept。从 seed 点到 lockEdges[0].from，再点该跳转进入落点页。'
    }
  }
  if (seedOnPage) {
    return {
      lockMode: 'seed_is_page',
      lockEdges: [],
      hint: 'seed 已在落点页。preconditions 用 []，只触发本期控件。不要编新跳转。'
    }
  }
  if (!inbound.length) {
    return {
      lockMode: 'no_inbound',
      lockEdges: [],
      hint: '仓内未扫到 history.push / Link 入边。以 seed 直达该页为准（外链/原生扫不到）。'
    }
  }
  const historical = preferEdges(page, inbound)
  const fromSeed = historical.filter(edge => edge.from === seedPath)
  return {
    lockMode: 'existing_shortest',
    lockEdges: (fromSeed.length ? fromSeed : historical).slice(0, 1),
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
  const lock = lockForPage(page, inbound, seedPath, period.trackingMode)
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
        route: args.route || ''
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
      '  lock=' + item.lockMode
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
  classifyEdge,
  lockForPage,
  pagesForFile,
  resolveOne,
  main
}
