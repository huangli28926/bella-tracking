#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path')
const { spawnSync } = require('child_process')
const { defaultAcceptPaths } = require('../accept/accept-chain')
const { loadConfirmQueue } = require('../confirm/needs-confirm')
const { ensureExcelInDocs, findRepoRoot, parseArgs, readJson, resolveExcel, toPosix, writeJson } = require('../lib/lib')
const { fileOk, inspectLanding } = require('../lib/landing-ready')
const { validateFiles } = require('../accept/validate-impl')
const { scriptPath } = require('../lib/skill-paths')
const { resolveTrackingMode } = require('../lib/period-diff')

const SCRIPT_DIR = __dirname
const STAGES = ['A', 'B', 'C', 'D']

function printHelp() {
  console.log(`
tracking-workflow — A 落库 → B 矫正 → C 写码 → D 验收 的状态机入口

Usage:
  node tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --status
  node tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=A
  node tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=C --json
  node tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=H --json
  node tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=D --plan-only
  node tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --run=D --device=mobile
  node tracking-workflow.js --excel=docs/2.3埋点需求文档.xlsx --mark=B

Options:
  --status       只看 workflow 状态和下一步
  --run=A|B|C|D|H  A dump+render；D 验收；B/C 只做依赖门禁（不写业务源码）
                 C 缺落库 → exit 3（须完整路径 A）；待确认未清 → exit 4（须路径 B）
                 H 缺缺失表 → exit 5（须入口 7）；缺失为 0 则不写码
  --mark=A|B|C|D 标记阶段完成，写入 _raw/workflow.json
  --plan-only    传给 D 验收计划
  --device       传给 D：mobile | pc（真实验收必填）
  --json         输出机器可读 JSON
`)
}

function stageName(id) {
  return {
    A: '落库',
    B: '矫正',
    C: '写码',
    D: '验收',
    H: '补全历史缺失'
  }[id] || id
}

function workflowPath(paths) {
  return paths.outDir ? path.join(paths.outDir, '_raw', 'workflow.json') : ''
}

function loadState(paths) {
  return readJson(workflowPath(paths), {
    version: 1,
    stages: {},
    history: []
  })
}

function saveState(paths, state) {
  state.updatedAt = new Date().toISOString()
  writeJson(workflowPath(paths), state)
  return state
}

function completeStage(paths, state, id, note) {
  state.stages = state.stages || {}
  state.history = state.history || []
  state.stages[id] = {
    status: 'done',
    completedAt: new Date().toISOString(),
    note: note || ''
  }
  state.history.push({
    at: new Date().toISOString(),
    stage: id,
    action: 'mark',
    note: note || ''
  })
  return saveState(paths, state)
}

function runNode(script, args, repoRoot) {
  const argv = [scriptPath(script)].concat(args)
  const result = spawnSync(process.execPath, argv, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit'
  })
  if (result.status !== 0) {
    throw new Error(`${script} failed with exit ${result.status}`)
  }
}

function inspectMissingList(paths) {
  const jsonPath = paths.missingJson || ''
  if (!jsonPath || !fileOk(jsonPath)) {
    return {
      needMissingList: true,
      complete: false,
      missingCount: 0,
      missing: [],
      jsonPath
    }
  }
  const payload = readJson(jsonPath, null) || {}
  const missing = Array.isArray(payload.missing) ? payload.missing : []
  const missingCount = payload.missingCount != null ? Number(payload.missingCount) : missing.length
  return {
    needMissingList: false,
    complete: !!payload.complete || missingCount === 0,
    missingCount,
    missing,
    jsonPath
  }
}

function gateH(paths, repoRoot) {
  const miss = inspectMissingList(paths)
  const payload = {
    stage: 'H',
    missing: miss,
    trackingMode: resolveTrackingMode(repoRoot),
    landing: inspectLanding(paths),
    bootstrap: [],
    message: '',
    exitCode: 0
  }
  if (miss.needMissingList) {
    payload.bootstrap = ['7']
    payload.message = '缺失表未就绪：须先跑入口 7（diff-doc-vs-history），禁止只凭对话记忆写码'
    payload.exitCode = 5
    return payload
  }
  if (miss.missingCount === 0) {
    payload.message = '文档 evtId 均已在扫描结果中，无需补全写码'
    return payload
  }
  payload.message = payload.trackingMode === 'backfill'
    ? '有缺失 evtId：先假缺失分流，再对 literal_missing 走 A→B→C（trackingMode=backfill，旧页优先）'
    : '有缺失 evtId：先假缺失分流，再对 literal_missing 走 A→B→C；trackingMode 未配置，按全局查找（不默认 backfill）'
  return payload
}

function countConfirmed(paths) {
  const impl = readJson(paths.implPath, { events: [] })
  const events = impl.events || []
  const confirmed = events.filter(item => item.confirmed).length
  let pendingConfirm = 0
  try {
    pendingConfirm = loadConfirmQueue(paths).pendingCount
  } catch (error) {
    pendingConfirm = Math.max(0, events.length - confirmed)
  }
  return {
    total: events.length,
    confirmed,
    leftover: pendingConfirm,
    existing: events.filter(item => item.status === 'existing').length,
    located: events.filter(item => item.status === 'located' || item.status === 'existing').length
  }
}

function validationSummary(paths, args, repoRoot) {
  if (!fileOk(paths.implPath) || !fileOk(paths.eventsPath)) {
    return { ok: false, errors: 0, warnings: 0, message: 'missing impl/events' }
  }
  try {
    const result = validateFiles(paths, args, repoRoot)
    const errors = result.issues.filter(item => item.severity === 'error').length
    const warnings = result.issues.filter(item => item.severity === 'warn').length
    return { ok: errors === 0, errors, warnings, message: `errors=${errors} warnings=${warnings}` }
  } catch (error) {
    return { ok: false, errors: 1, warnings: 0, message: String(error.message || error) }
  }
}

function acceptSummary(paths) {
  const report = readJson(paths.acceptJson, null)
  if (!report || !report.summary) {
    return { ok: false, message: 'missing accept report' }
  }
  const summary = report.summary
  return {
    ok: !report.planOnly && summary.total > 0,
    message: `pass=${summary.pass || 0} fail=${summary.fail || 0} skip=${summary.skip || 0} pathSkip=${summary.pathBlockerSkip || 0} total=${summary.total || 0}`,
    summary
  }
}

function buildStatus(paths, args, repoRoot) {
  const state = loadState(paths)
  const confirmed = countConfirmed(paths)
  const landing = inspectLanding(paths)
  const validation = validationSummary(paths, args, repoRoot)
  const accept = acceptSummary(paths)
  const stageStatus = {
    A: {
      name: stageName('A'),
      done: landing.artifactsReady,
      gate: landing.artifactsReady
        ? `events/adaptor/impl ready; events=${landing.eventCount}`
        : (landing.reasons.join('; ') || 'need path A')
    },
    B: {
      name: stageName('B'),
      done: landing.queueCleared,
      gate: landing.needA
        ? 'blocked: need A'
        : (confirmed.total ? `${confirmed.confirmed} confirmed, pending=${confirmed.leftover}` : 'need impl events')
    },
    C: {
      name: stageName('C'),
      done: !!(state.stages && state.stages.C && state.stages.C.status === 'done'),
      gate: landing.needA
        ? 'blocked: need A then B'
        : (landing.needB
          ? 'blocked: need B'
          : (validation.ok ? `impl valid; located=${confirmed.located}/${confirmed.total}; need 进入 C` : validation.message))
    },
    D: {
      name: stageName('D'),
      done: !!(state.stages && state.stages.D && state.stages.D.status === 'done') || accept.ok,
      gate: accept.message
    }
  }
  const next = STAGES.find(id => !stageStatus[id].done) || ''
  return { state, stageStatus, next, validation, accept, landing, paths }
}

function printStatus(status) {
  console.log('== tracking-workflow ==')
  STAGES.forEach(id => {
    const item = status.stageStatus[id]
    console.log(`${item.done ? 'DONE' : 'TODO'} ${id} ${item.name}: ${item.gate}`)
  })
  console.log(`Next: ${status.next ? `${status.next} ${stageName(status.next)}` : 'complete'}`)
}

function ensureExcelArg(args) {
  if (!args.excel) {
    throw new Error('tracking-workflow 需要 --excel=...')
  }
}

function runStage(paths, args, repoRoot, state, id) {
  ensureExcelArg(args)
  const excelArg = `--excel=${args.excel}`
  if (id === 'A') {
    runNode('extract/dump-excel.js', [excelArg], repoRoot)
    runNode('extract/render-html.js', [excelArg], repoRoot)
    completeStage(paths, state, 'A', 'dump + render complete')
    return
  }
  if (id === 'D') {
    runNode('accept/validate-impl.js', [excelArg], repoRoot)
    const chainArgs = [excelArg]
    if (args.device) chainArgs.push(`--device=${args.device}`)
    runNode('accept/build-accept-chain.js', chainArgs, repoRoot)
    const runArgs = [excelArg]
    if (args['plan-only'] || args.plan) runArgs.push('--plan-only')
    if (args.device) runArgs.push(`--device=${args.device}`)
    if (args['skip-evt'] || args.skipEvt) {
      runArgs.push(`--skip-evt=${args['skip-evt'] || args.skipEvt}`)
    }
    runNode('accept/run-accept.js', runArgs, repoRoot)
    if (!(args['plan-only'] || args.plan)) {
      completeStage(paths, state, 'D', 'accept complete')
    }
    return
  }
  if (id === 'B' || id === 'C') {
    return gateStage(paths, id)
  }
  if (id === 'H') {
    return gateH(paths, repoRoot)
  }
  throw new Error(`${id} ${stageName(id)} 是人工/模型门禁：完成后用 --mark=${id}`)
}

function gateStage(paths, id) {
  const landing = inspectLanding(paths)
  const payload = {
    stage: id,
    landing,
    bootstrap: [],
    readyForC: false,
    message: ''
  }
  if (landing.needA) {
    payload.bootstrap = id === 'C' ? ['A', 'B'] : ['A']
    payload.message = id === 'C'
      ? '落库未就绪：须先完整执行路径 A（dump + 逐条分析 + needsConfirm 打断），再路径 B，禁止直接写业务源码'
      : '落库未就绪：须先完整执行路径 A，禁止跳过分析只做矫正'
    payload.exitCode = 3
    return payload
  }
  if (id === 'B') {
    payload.message = landing.needB
      ? 'A 已就绪，待确认未清：跑 confirm-sweep.js --wait（禁止 --no-open），再整页 serve-impl'
      : '待确认队列已空：跑 serve-impl.js 打开整份落库页，等用户确认「进入 C」'
    payload.exitCode = 0
    return payload
  }
  if (landing.needB) {
    payload.bootstrap = ['B']
    payload.message = '落库已分析但仍有待确认：须先路径 B（confirm-sweep + 整页确认），禁止直接写业务源码'
    payload.exitCode = 4
    return payload
  }
  payload.needFullPageConfirm = true
  payload.message = '落库与待确认队列已就绪：须 serve-impl 打开整份落库页，用户回复「进入 C」后再写业务源码'
  payload.exitCode = 0
  return payload
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  if (args.excel) {
    const moved = ensureExcelInDocs(repoRoot, resolveExcel(repoRoot, args.excel))
    args.excel = toPosix(path.relative(repoRoot, moved)) || moved
  }
  const paths = defaultAcceptPaths(repoRoot, args)
  if (!paths.outDir) {
    printHelp()
    throw new Error('未提供 --excel / --slug')
  }
  const state = loadState(paths)

  if (args.mark) {
    const id = String(args.mark).toUpperCase()
    if (STAGES.indexOf(id) === -1) throw new Error(`unknown stage: ${args.mark}`)
    completeStage(paths, state, id, args.note || '')
  }

  let runResult = null
  if (args.run) {
    const id = String(args.run).toUpperCase()
    if (id !== 'H' && STAGES.indexOf(id) === -1) throw new Error(`unknown stage: ${args.run}`)
    runResult = runStage(paths, args, repoRoot, state, id) || null
  }

  const status = buildStatus(paths, args, repoRoot)
  if (args.json) {
    console.log(JSON.stringify({
      next: status.next,
      stages: status.stageStatus,
      validation: status.validation,
      accept: status.accept,
      landing: status.landing,
      missing: inspectMissingList(paths),
      trackingMode: resolveTrackingMode(repoRoot),
      run: runResult,
      workflowPath: workflowPath(paths)
    }, null, 2))
  } else {
    printStatus(status)
    if (runResult && runResult.message) {
      console.log(`Gate: ${runResult.message}`)
      if (runResult.bootstrap && runResult.bootstrap.length) {
        console.log(`Bootstrap: ${runResult.bootstrap.join(' → ')}`)
      }
    }
    console.log(`State: ${workflowPath(paths)}`)
  }
  if (runResult && runResult.exitCode) {
    process.exitCode = runResult.exitCode
  }
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message || error)
    process.exit(1)
  }
}

module.exports = { buildStatus, inspectLanding, inspectMissingList, gateStage, gateH }
