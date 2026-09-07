const path = require('path')
const { readDotEnv, readJson, toPosix } = require('../lib/lib')
const { getConfirmReasons } = require('../confirm/needs-confirm')
const { DEVICE_PROMPT, resolveAcceptDevice } = require('../accept/accept-device')
const {
  ASK_EXCEL,
  ASK_EXCEL_INVALID,
  ASK_HISTORY_EXCEL,
  D_FAIL_CHOICE,
  ENTRY_MENU,
  FULL_PAGE_PROMPT,
  formatConfirmEvent,
  formatDeleteOldTracking,
  hasEntryIntent
} = require('./prompts')

const TASK_IDS = [
  'CHOOSE_ENTRY',
  'ASK_EXCEL',
  'ASK_EXCEL_INVALID',
  'ASK_HISTORY_EXCEL',
  'A_DUMP',
  'A_RENDER',
  'A_PREPARE_IMAGES',
  'A_ANALYZE_EVENT',
  'A_NORMALIZE_IMPL',
  'A_VALIDATE_IMPL',
  'B_CONFIRM_EVENT',
  'B_CONFIRM_FULL_PAGE',
  'C_WRITE_IMPL',
  'C_CONFIRM_DELETE_OLD',
  'D_CHOOSE_DEVICE',
  'D_CHOOSE_REPAIR',
  'D_RUN_ACCEPT',
  'H_NEED_MISSING_LIST'
]

const NEED_A_NOT_DUMP_ONLY = '须完整执行路径 A（dump + 逐条分析 + validate），禁止只 dump。'

function excelRel(repoRoot, args) {
  const raw = args && args.excel ? String(args.excel) : ''
  if (!raw) return 'docs/{file}.xlsx'
  const abs = path.isAbsolute(raw) ? raw : path.resolve(repoRoot || process.cwd(), raw)
  if (repoRoot) {
    const rel = toPosix(path.relative(repoRoot, abs))
    if (rel && rel.indexOf('..') !== 0) return rel
  }
  return toPosix(raw).replace(/^.*\/(docs\/)/, 'docs/')
}

function relPath(repoRoot, abs) {
  if (!abs) return ''
  if (!repoRoot) return toPosix(abs)
  return toPosix(path.relative(repoRoot, abs)) || toPosix(abs)
}

function isUnanalyzed(item) {
  if (!item) return true
  const status = String(item.status || '').trim()
  return !status || status === 'pending'
}

function firstUnanalyzedEvent(paths) {
  const impl = readJson(paths.implPath, { events: [] })
  const fromImpl = Array.isArray(impl.events) ? impl.events.slice() : []
  const pending = fromImpl.filter(isUnanalyzed)
  pending.sort((a, b) => {
    const da = Number(a && a.docIndex) || 0
    const db = Number(b && b.docIndex) || 0
    if (da !== db) return da - db
    return String((a && a.evtId) || '').localeCompare(String((b && b.evtId) || ''))
  })
  if (pending[0]) return pending[0]
  const dumped = readJson(paths.eventsPath, { events: [] })
  const fromDump = Array.isArray(dumped.events) ? dumped.events.slice() : []
  fromDump.sort((a, b) => {
    const da = Number(a && a.docIndex) || 0
    const db = Number(b && b.docIndex) || 0
    if (da !== db) return da - db
    return String((a && a.evtId) || '').localeCompare(String((b && b.evtId) || ''))
  })
  return fromDump[0] || null
}

function firstPendingConfirm(queueInfo) {
  const list = (queueInfo && queueInfo.queue) || []
  return list.find(item => item && item.needsConfirm && !item.confirmed && !(item.event && item.event.deferred)) || null
}

function stageDone(state, id) {
  return !!(state && state.stages && state.stages[id] && state.stages[id].status === 'done')
}

function analysisComplete(landing) {
  return !!(landing && !landing.needA)
}

function stageADone(landing, validation, accept) {
  if (accept && accept.ok) return true
  return !!(analysisComplete(landing) && validation && validation.ok)
}

function taskBase(partial) {
  return Object.assign({
    subject: {},
    inputs: [],
    outputs: [],
    completionCondition: [],
    blockingReason: null,
    command: null,
    prompt: null,
    nextAction: 'none'
  }, partial)
}

function statusCommand(excel) {
  return `node scripts/workflow/tracking-workflow.js --excel=${excel} --status --json`
}

function fillContract(task, ctx) {
  const excel = ctx.excel
  const evtId = task.subject && task.subject.evtId ? String(task.subject.evtId) : ''
  const device = ctx.deviceId || ''
  let command = null
  let prompt = null
  let nextAction = 'none'

  switch (task.id) {
    case 'A_DUMP':
      command = `node scripts/extract/dump-excel.js --excel=${excel}`
      break
    case 'A_RENDER':
      command = `node scripts/extract/render-html.js --excel=${excel}`
      break
    case 'A_PREPARE_IMAGES':
      command = `node scripts/extract/dump-excel.js --excel=${excel}`
      break
    case 'A_ANALYZE_EVENT':
      command = statusCommand(excel)
      break
    case 'A_NORMALIZE_IMPL':
      command = `node scripts/accept/normalize-impl.js --excel=${excel}`
      break
    case 'A_VALIDATE_IMPL':
      command = `node scripts/accept/normalize-impl.js --excel=${excel} && node scripts/accept/validate-impl.js --excel=${excel} --json`
      nextAction = 'fix_validation'
      break
    case 'CHOOSE_ENTRY':
      command = null
      prompt = ENTRY_MENU
      nextAction = 'choose_entry'
      break
    case 'ASK_EXCEL':
      command = null
      prompt = ASK_EXCEL
      nextAction = 'ask_excel'
      break
    case 'ASK_EXCEL_INVALID':
      command = null
      prompt = ASK_EXCEL_INVALID
      nextAction = 'ask_excel'
      break
    case 'ASK_HISTORY_EXCEL':
      command = null
      prompt = ASK_HISTORY_EXCEL
      nextAction = 'ask_excel'
      break
    case 'C_CONFIRM_DELETE_OLD':
      command = `node scripts/accept/check-old-tracking.js --json`
      prompt = formatDeleteOldTracking((ctx.deleteEvtIds || []).length ? ctx.deleteEvtIds : ['{evtId 列表}'])
      nextAction = 'confirm_delete_old'
      break
    case 'D_CHOOSE_REPAIR':
      command = null
      prompt = D_FAIL_CHOICE
      nextAction = 'choose_repair_mode'
      break
    case 'B_CONFIRM_EVENT': {
      command = `node scripts/confirm/confirm-event.js --excel=${excel} --evt=${evtId} --if-needed --wait`
      const event = ctx.pendingConfirm && ctx.pendingConfirm.event
      const reasons = (ctx.pendingConfirm && ctx.pendingConfirm.reasons) || getConfirmReasons(event)
      prompt = formatConfirmEvent(evtId, reasons)
      nextAction = 'confirm_event'
      break
    }
    case 'B_CONFIRM_FULL_PAGE':
      command = `node scripts/confirm/serve-impl.js --excel=${excel}`
      prompt = FULL_PAGE_PROMPT
      nextAction = 'confirm_full_page'
      break
    case 'C_WRITE_IMPL':
      command = statusCommand(excel)
      break
    case 'D_CHOOSE_DEVICE':
      command = null
      prompt = DEVICE_PROMPT
      nextAction = 'choose_device'
      break
    case 'D_RUN_ACCEPT':
      command = device
        ? `node scripts/accept/run-accept.js --excel=${excel} --device=${device}`
        : `node scripts/accept/run-accept.js --excel=${excel} --plan-only`
      break
    case 'H_NEED_MISSING_LIST':
      command = `node scripts/history/diff-doc-vs-history.js --excel=${excel}`
      break
    default:
      break
  }

  task.command = command
  task.prompt = prompt
  task.nextAction = nextAction
  return task
}

function prepareKind(landing) {
  const missing = Array.isArray(landing && landing.missing) ? landing.missing : []
  const missingDiagrams = Array.isArray(landing && landing.missingDiagrams) ? landing.missingDiagrams : []
  const missEvents = missing.indexOf('events.json') !== -1
  const missAdaptor = missing.indexOf('adaptor.json') !== -1
  const missImpl = missing.indexOf('impl.json') !== -1
  const missHtml = missing.indexOf('落库.html') !== -1
  if (missEvents || missAdaptor || missImpl) return 'dump'
  if (missingDiagrams.length) return 'images'
  if (missHtml) return 'render'
  return ''
}

/**
 * resolveNextTask(diskFacts, workflow.json) → nextTask | null
 * 不读取对话、不因 --run 改写 task id。
 */
function resolveNextTask(paths, state, landing, validation, accept, queueInfo, extras) {
  const extra = extras || {}
  const queue = queueInfo || { queue: [], pendingCount: 0 }
  const pendingConfirm = firstPendingConfirm(queue)
  const acceptDone = !!(accept && accept.ok)
  const validationOk = !!(validation && validation.ok)
  const analyzed = analysisComplete(landing)
  const aDone = stageADone(landing, validation, accept)
  const bDone = acceptDone || (aDone && (queue.pendingCount || 0) === 0 && stageDone(state, 'B'))
  const pending = firstUnanalyzedEvent(paths)
  const subject = pending && pending.evtId ? { evtId: String(pending.evtId) } : {}
  const ctx = {
    excel: extra.excel || excelRel(extra.repoRoot, extra.args),
    repoRoot: extra.repoRoot,
    deviceId: extra.deviceId || '',
    pendingConfirm
  }

  if (!hasEntryIntent(extra.args, state)) {
    return fillContract(taskBase({
      id: 'CHOOSE_ENTRY',
      stage: 'menu',
      executor: 'user',
      status: 'ready',
      subject: {},
      inputs: [],
      outputs: ['_raw/workflow.json'],
      completionCondition: ['--entry=1..8 or --run=A|B|C|D|H']
    }), ctx)
  }

  if (extra.needAskExcel) {
    return fillContract(taskBase({
      id: 'ASK_HISTORY_EXCEL',
      stage: extra.askExcelStage || '7',
      executor: 'user',
      status: 'ready',
      subject: {},
      inputs: [],
      outputs: [],
      completionCondition: ['valid xlsx under docs/']
    }), ctx)
  }

  if (acceptDone) {
    const fail = accept && accept.summary ? Number(accept.summary.fail) || 0 : 0
    if (fail > 0 && !extra.planOnly && !(state && state.repairMode)) {
      return fillContract(taskBase({
        id: 'D_CHOOSE_REPAIR',
        stage: 'D',
        executor: 'user',
        status: 'ready',
        subject: {},
        inputs: ['accept/*.json'],
        outputs: ['_raw/workflow.json'],
        completionCondition: ['user chose 1 or 2']
      }), ctx)
    }
    return null
  }

  const kind = prepareKind(landing)
  if (kind === 'dump') {
    return fillContract(taskBase({
      id: 'A_DUMP',
      stage: 'A',
      executor: 'script',
      status: 'ready',
      subject,
      inputs: ['events.json', 'adaptor.json', 'impl.json'],
      outputs: ['events.json', 'adaptor.json', 'impl.json', '_raw/images'],
      completionCondition: ['events.json/adaptor.json/impl.json exist', 'dump-excel exit 0']
    }), ctx)
  }
  if (kind === 'images') {
    return fillContract(taskBase({
      id: 'A_PREPARE_IMAGES',
      stage: 'A',
      executor: 'script',
      status: 'ready',
      subject,
      inputs: ['_raw/images'],
      outputs: ['_raw/images'],
      completionCondition: ['every event has a non-empty _raw/images/{evtId}.png']
    }), ctx)
  }
  if (kind === 'render') {
    return fillContract(taskBase({
      id: 'A_RENDER',
      stage: 'A',
      executor: 'script',
      status: 'ready',
      subject,
      inputs: ['events.json', 'impl.json'],
      outputs: ['落库.html'],
      completionCondition: ['落库.html exists']
    }), ctx)
  }

  if (!analyzed) {
    return fillContract(taskBase({
      id: 'A_ANALYZE_EVENT',
      stage: 'A',
      executor: 'agent',
      status: 'ready',
      subject,
      inputs: ['events.json', 'adaptor.json', 'impl.json', '_raw/images'],
      outputs: ['impl.json'],
      completionCondition: [
        'impl.json contains analyzed events in docIndex order',
        'pendingEvents = 0'
      ]
    }), ctx)
  }

  if (!validationOk) {
    return fillContract(taskBase({
      id: 'A_VALIDATE_IMPL',
      stage: 'A',
      executor: 'script',
      status: 'blocked',
      subject: {},
      inputs: ['impl.json', 'events.json', 'adaptor.json'],
      outputs: ['impl.json'],
      completionCondition: ['validate-impl errors = 0'],
      blockingReason: validation && validation.message ? validation.message : 'validate-impl has errors'
    }), ctx)
  }

  if (queue.pendingCount > 0 && pendingConfirm) {
    return fillContract(taskBase({
      id: 'B_CONFIRM_EVENT',
      stage: 'B',
      executor: 'user',
      status: 'ready',
      subject: { evtId: String(pendingConfirm.evtId || '') },
      inputs: [relPath(extra.repoRoot, paths.implPath) || 'impl.json'],
      outputs: ['impl.json', '_raw/field-memory.json'],
      completionCondition: ['confirmed=true or deferred=true']
    }), ctx)
  }

  if (!bDone) {
    return fillContract(taskBase({
      id: 'B_CONFIRM_FULL_PAGE',
      stage: 'B',
      executor: 'user',
      status: 'ready',
      subject: {},
      inputs: ['落库.html', '_raw/workflow.json'],
      outputs: ['_raw/workflow.json'],
      completionCondition: ['用户确认进入 C']
    }), ctx)
  }

  if (!stageDone(state, 'C')) {
    return fillContract(taskBase({
      id: 'C_WRITE_IMPL',
      stage: 'C',
      executor: 'agent',
      status: 'ready',
      subject: {},
      inputs: ['events.json', 'adaptor.json', 'impl.json', 'accept-chain.json'],
      outputs: ['业务源码', 'impl.json.accept', 'accept-chain.json'],
      completionCondition: ['impl.accept complete', 'accept-chain has no pending blockers']
    }), ctx)
  }

  const planOnly = !!(extra.args && (extra.args['plan-only'] || extra.args.plan))
  if (!planOnly && !ctx.deviceId) {
    return fillContract(taskBase({
      id: 'D_CHOOSE_DEVICE',
      stage: 'D',
      executor: 'user',
      status: 'ready',
      subject: {},
      inputs: ['impl.json.accept', 'accept-chain.json'],
      outputs: [],
      completionCondition: ['--device=mobile|pc or .env acceptDevice']
    }), ctx)
  }

  return fillContract(taskBase({
    id: 'D_RUN_ACCEPT',
    stage: 'D',
    executor: 'script',
    status: 'ready',
    subject: {},
    inputs: ['impl.json.accept', 'accept-chain.json'],
    outputs: ['accept/*.json', 'accept/*.html', '终稿.html'],
    completionCondition: ['run-accept generated a non-plan report']
  }), ctx)
}

function workflowEnvelopeStatus(nextTask, runFailed) {
  if (runFailed) return 'failed'
  if (!nextTask) return 'completed'
  if (nextTask.status === 'blocked') return 'blocked'
  if (nextTask.executor === 'user') return 'needs_user_input'
  return 'needs_user_input'
}

function resolveDeviceId(args, repoRoot) {
  try {
    return resolveAcceptDevice(args || {}, readDotEnv(repoRoot))
  } catch (error) {
    return ''
  }
}

module.exports = {
  TASK_IDS,
  DEVICE_PROMPT,
  ENTRY_MENU,
  FULL_PAGE_PROMPT,
  analysisComplete,
  excelRel,
  firstUnanalyzedEvent,
  resolveDeviceId,
  resolveNextTask,
  stageADone,
  NEED_A_NOT_DUMP_ONLY,
  workflowEnvelopeStatus
}
