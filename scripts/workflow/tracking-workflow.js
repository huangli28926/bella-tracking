#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { defaultAcceptPaths } = require('../accept/accept-chain')
const { loadConfirmQueue } = require('../confirm/needs-confirm')
const { ensureExcelInDocs, findRepoRoot, parseArgs, readJson, resolveExcel, toPosix, writeJson } = require('../lib/lib')
const { fileOk, inspectLanding } = require('../lib/landing-ready')
const { validateFiles } = require('../accept/validate-impl')
const { scriptPath } = require('../lib/skill-paths')
const { resolveTrackingMode } = require('../lib/period-diff')
const {
  excelRel,
  resolveDeviceId,
  resolveNextTask: resolveNextTaskCore,
  stageADone,
  workflowEnvelopeStatus
} = require('./next-task')
const { entryFromRun, hasEntryIntent, parseEntry } = require('./prompts')

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
  --run=A|B|C|D|H  --run=A 只执行 dump+render（路径 A 的脚本前置），不分析 impl、不标记 A 完成
                 D 验收；B/C 只做依赖门禁（不写业务源码）
                 C 缺落库 → exit 3（须完整路径 A）；待确认未清 → exit 4（须路径 B）
                 H 缺缺失表 → exit 5（须入口 7）；缺失为 0 则不写码
  --mark=B|C|D   标记阶段完成，写入 _raw/workflow.json（A.done 只由磁盘门禁计算，--mark=A 不使 A 完成）
  --entry=1..8   写入 workflow.json.entry；未带 --entry/--run 且无已存 entry 时 --status 停在菜单
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

function stageDone(state, id) {
  return !!(state && state.stages && state.stages[id] && state.stages[id].status === 'done')
}

function resolveNextTask(paths, state, landing, validation, accept, queueInfo, extras) {
  const extra = extras || {}
  return resolveNextTaskCore(paths, state, landing, validation, accept, queueInfo || loadConfirmQueue(paths), extra)
}

function runNode(script, args, repoRoot) {
  const argv = [scriptPath(script)].concat(args)
  const result = spawnSync(process.execPath, argv, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit'
  })
  const status = result.status == null ? 1 : result.status
  if (status !== 0) {
    const error = new Error(`${script} failed with exit ${status}`)
    error.exitCode = status
    throw error
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
    return { ok: false, errors: 0, warnings: 0, message: 'missing impl/events', issues: [] }
  }
  try {
    const result = validateFiles(paths, args, repoRoot)
    const errors = result.issues.filter(item => item.severity === 'error').length
    const warnings = result.issues.filter(item => item.severity === 'warn').length
    return {
      ok: errors === 0,
      errors,
      warnings,
      message: `errors=${errors} warnings=${warnings}`,
      issues: result.issues || []
    }
  } catch (error) {
    return { ok: false, errors: 1, warnings: 0, message: String(error.message || error), issues: [] }
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
  const queueInfo = loadConfirmQueue(paths)
  const extras = {
    repoRoot,
    args,
    excel: excelRel(repoRoot, args),
    deviceId: resolveDeviceId(args, repoRoot),
    planOnly: !!(args && (args['plan-only'] || args.plan)),
    needAskExcel: !!args.needAskExcel,
    askExcelStage: args.askExcelStage || ''
  }
  const nextTask = resolveNextTask(paths, state, landing, validation, accept, queueInfo, extras)
  const stageAComplete = stageADone(landing, validation, accept)
  const stageBComplete = !!(accept.ok || (stageAComplete && landing.pendingConfirm === 0 && stageDone(state, 'B')))
  const stageCComplete = !!(accept.ok || (stageBComplete && stageDone(state, 'C')))
  const stageStatus = {
    A: {
      name: stageName('A'),
      done: stageAComplete,
      gate: stageAComplete
        ? `analyzed+validated; events=${landing.eventCount}`
        : (landing.reasons.join('; ') || validation.message || 'need path A')
    },
    B: {
      name: stageName('B'),
      done: stageBComplete,
      gate: !stageAComplete
        ? 'blocked: need A'
        : (landing.needB
          ? `${confirmed.confirmed} confirmed, pending=${confirmed.leftover}`
          : (stageBComplete ? 'full-page confirmed; ready for C' : 'need full-page confirmation'))
    },
    C: {
      name: stageName('C'),
      done: stageCComplete,
      gate: !stageAComplete
        ? 'blocked: need A then B'
        : (landing.needB
          ? 'blocked: need B'
          : (!stageBComplete
            ? 'blocked: need full-page confirmation'
          : (validation.ok ? `impl valid; located=${confirmed.located}/${confirmed.total}; need 进入 C` : validation.message))
          )
    },
    D: {
      name: stageName('D'),
      done: !!accept.ok,
      gate: accept.message
    }
  }
  const next = nextTask ? nextTask.stage : ''
  return {
    state,
    stageStatus,
    next,
    nextTask,
    validation,
    accept,
    landing,
    paths,
    extras
  }
}

function printStatus(status) {
  console.log('== tracking-workflow ==')
  STAGES.forEach(id => {
    const item = status.stageStatus[id]
    console.log(`${item.done ? 'DONE' : 'TODO'} ${id} ${item.name}: ${item.gate}`)
  })
  if (status.nextTask) {
    const subject = status.nextTask.subject && status.nextTask.subject.evtId
      ? ` evt=${status.nextTask.subject.evtId}`
      : ''
    console.log(`NextTask: ${status.nextTask.id} [${status.nextTask.stage}] ${status.nextTask.executor}${subject}`)
  }
  console.log(`Next: ${status.next ? `${status.next} ${stageName(status.next)}` : 'complete'}`)
  const prompt = status.nextTask && status.nextTask.prompt
  if (prompt) {
    console.log('')
    console.log(prompt)
  }
}

function ensureExcelArg(args) {
  if (!args.excel) {
    throw new Error('tracking-workflow 需要 --excel=...')
  }
}

function runStageA(args, repoRoot, execFn) {
  const excelArg = `--excel=${args.excel}`
  const run = execFn || runNode
  const did = []
  try {
    run('extract/dump-excel.js', [excelArg], repoRoot)
    did.push('dump-excel')
    run('extract/render-html.js', [excelArg], repoRoot)
    did.push('render-html')
    return {
      requested: 'A',
      did,
      didNot: ['analyze-events', 'complete-stage-A'],
      stageAComplete: false,
      exitCode: 0
    }
  } catch (error) {
    const didNot = ['analyze-events', 'complete-stage-A']
    if (did.indexOf('dump-excel') === -1) didNot.unshift('dump-excel', 'render-html')
    else if (did.indexOf('render-html') === -1) didNot.unshift('render-html')
    return {
      requested: 'A',
      did,
      didNot,
      stageAComplete: false,
      failed: true,
      message: error.message || String(error),
      exitCode: error.exitCode || 1
    }
  }
}

function runStage(paths, args, repoRoot, state, id, execFn) {
  ensureExcelArg(args)
  const excelArg = `--excel=${args.excel}`
  if (id === 'A') {
    return runStageA(args, repoRoot, execFn)
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
      ? '落库未就绪：须先完整执行路径 A（dump + 逐条分析 + validate），再路径 B，禁止只 dump、禁止直接写业务源码'
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

function persistEntry(paths, state, args) {
  const parsed = parseEntry(args && args.entry)
  const fromRun = entryFromRun(args && args.run)
  const entry = parsed ? parsed.entry : fromRun
  if (!entry) return state
  if (state.entry === entry) return state
  state.entry = entry
  state.history = state.history || []
  state.history.push({
    at: new Date().toISOString(),
    stage: 'menu',
    action: 'entry',
    note: String(entry)
  })
  return saveState(paths, state)
}

function emitChooseEntry(args) {
  const { ENTRY_MENU } = require('./prompts')
  const nextTask = {
    id: 'CHOOSE_ENTRY',
    stage: 'menu',
    executor: 'user',
    status: 'ready',
    subject: {},
    inputs: [],
    outputs: ['_raw/workflow.json'],
    completionCondition: ['--entry=1..8 or --run=A|B|C|D|H'],
    blockingReason: null,
    command: null,
    prompt: ENTRY_MENU,
    nextAction: 'choose_entry'
  }
  if (args && args.json) {
    console.log(JSON.stringify({
      version: '1.0',
      stage: 'menu',
      status: 'needs_user_input',
      next: 'menu',
      nextAction: 'choose_entry',
      prompt: ENTRY_MENU,
      command: null,
      nextTask
    }, null, 2))
  } else {
    console.log('== tracking-workflow ==')
    console.log('NextTask: CHOOSE_ENTRY [menu] user')
    console.log('')
    console.log(ENTRY_MENU)
  }
  process.exitCode = 10
}

function emitAskPrompt(args, spec) {
  const nextTask = {
    id: spec.id,
    stage: spec.stage,
    executor: 'user',
    status: 'ready',
    subject: {},
    inputs: [],
    outputs: [],
    completionCondition: ['valid xlsx under docs/'],
    blockingReason: null,
    command: null,
    prompt: spec.prompt,
    nextAction: 'ask_excel'
  }
  if (args && args.json) {
    console.log(JSON.stringify({
      version: '1.0',
      stage: nextTask.stage,
      status: 'needs_user_input',
      next: nextTask.stage,
      nextAction: 'ask_excel',
      prompt: spec.prompt,
      command: null,
      nextTask
    }, null, 2))
  } else {
    console.log(spec.prompt)
  }
  process.exitCode = spec.exitCode == null ? 2 : spec.exitCode
}

function emitAskExcel(args) {
  const { ASK_EXCEL } = require('./prompts')
  emitAskPrompt(args, {
    id: 'ASK_EXCEL',
    stage: 'excel',
    prompt: ASK_EXCEL
  })
}

function emitAskExcelInvalid(args) {
  const { ASK_EXCEL_INVALID } = require('./prompts')
  emitAskPrompt(args, {
    id: 'ASK_EXCEL_INVALID',
    stage: 'excel',
    prompt: ASK_EXCEL_INVALID
  })
}

function emitAskHistoryExcel(args, stage) {
  const { ASK_HISTORY_EXCEL } = require('./prompts')
  emitAskPrompt(args, {
    id: 'ASK_HISTORY_EXCEL',
    stage: stage || '7',
    prompt: ASK_HISTORY_EXCEL
  })
}

function isValidExcelFile(abs) {
  if (!abs || !fs.existsSync(abs)) return false
  try {
    if (!fs.statSync(abs).isFile()) return false
  } catch (error) {
    return false
  }
  return /\.xlsx?$/i.test(abs)
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const parsedEntry = parseEntry(args.entry)
  const entryHint = parsedEntry ? parsedEntry.entry : entryFromRun(args.run)
  if (!args.excel) {
    if (entryHint === 7 || entryHint === 8) {
      emitAskHistoryExcel(args, String(entryHint))
      return
    }
    emitAskExcel(args)
    return
  }
  const resolvedExcel = resolveExcel(repoRoot, args.excel)
  if (!isValidExcelFile(resolvedExcel) && !isValidExcelFile(path.join(repoRoot, 'docs', path.basename(resolvedExcel)))) {
    emitAskExcelInvalid(args)
    return
  }
  const moved = ensureExcelInDocs(repoRoot, resolvedExcel)
  if (!isValidExcelFile(moved)) {
    emitAskExcelInvalid(args)
    return
  }
  args.excel = toPosix(path.relative(repoRoot, moved)) || moved
  const paths = defaultAcceptPaths(repoRoot, args)
  if (!paths.outDir) {
    printHelp()
    throw new Error('未提供 --excel / --slug')
  }
  const state = persistEntry(paths, loadState(paths), args)

  if (args.mark) {
    const id = String(args.mark).toUpperCase()
    if (STAGES.indexOf(id) === -1) throw new Error(`unknown stage: ${args.mark}`)
    if (id !== 'A') {
      completeStage(paths, state, id, args.note || '')
    }
  }

  let runResult = null
  if (args.run) {
    const id = String(args.run).toUpperCase()
    if (id !== 'H' && STAGES.indexOf(id) === -1) throw new Error(`unknown stage: ${args.run}`)
    runResult = runStage(paths, args, repoRoot, state, id) || null
  }

  const status = buildStatus(paths, args, repoRoot)
  if (runResult && runResult.requested === 'A') {
    runResult.stageAComplete = !!status.stageStatus.A.done
  }
  const runFailed = !!(runResult && runResult.failed)
  const envelopeStatus = workflowEnvelopeStatus(status.nextTask, runFailed)
  if (args.json) {
    console.log(JSON.stringify({
      version: '1.0',
      stage: status.nextTask ? status.nextTask.stage : 'D',
      status: envelopeStatus,
      next: status.next,
      nextAction: (status.nextTask && status.nextTask.nextAction) || 'none',
      prompt: status.nextTask ? status.nextTask.prompt : null,
      command: status.nextTask ? status.nextTask.command : null,
      nextTask: status.nextTask,
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
  } else if (status.nextTask && status.nextTask.id === 'CHOOSE_ENTRY') {
    process.exitCode = 10
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

module.exports = {
  buildStatus,
  inspectLanding,
  inspectMissingList,
  gateStage,
  gateH,
  loadState,
  persistEntry,
  resolveNextTask,
  runStage,
  runStageA,
  workflowPath
}
