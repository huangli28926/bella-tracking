const fs = require('fs')
const path = require('path')
const { readJson } = require('../lib/lib')
const { D_FAIL_CHOICE } = require('../workflow/prompts')

const REASON_ZH = {
  not_fired: '事件未触发',
  param_mismatch: '参数不一致',
  report_http_missed: '未捕获上报 GIF',
  eventType_mismatch: '事件类型不一致',
  uicode_mismatch: 'uicode 不一致',
  click_not_found: '找不到点击目标',
  step_not_found: '找不到前置步骤节点',
  plan_only: '仅计划未执行',
  path_blocker: '路径阻断已跳过',
  other: '验收失败'
}

function classifyReason(reason) {
  const r = String(reason || '')
  if (r === 'not_fired') return 'not_fired'
  if (r === 'param_mismatch') return 'param_mismatch'
  if (r === 'report_http_missed' || r.indexOf('未捕获到埋点上报 GIF') !== -1) {
    return 'report_http_missed'
  }
  if (r.indexOf('eventType 期望') === 0) return 'eventType_mismatch'
  if (r.indexOf('uicode 期望') === 0) return 'uicode_mismatch'
  if (r.indexOf('DOM 中找不到 click') === 0) return 'click_not_found'
  if (r.indexOf('DOM 中找不到') === 0) return 'step_not_found'
  if (r === 'plan-only') return 'plan_only'
  if (r === 'path_blocker') return 'path_blocker'
  return 'other'
}

function reasonZh(reason, item) {
  const kind = classifyReason(reason)
  if (kind === 'path_blocker') {
    return (item && item.skipReason) || REASON_ZH.path_blocker
  }
  if (kind === 'other' && rTrim(reason)) return String(reason)
  return REASON_ZH[kind] || REASON_ZH.other
}

function rTrim(value) {
  return String(value || '').trim()
}

function oneLine(kind, item) {
  const name = item && item.eventName ? `「${item.eventName}」` : ''
  switch (kind) {
    case 'not_fired':
      return '验收脚本在规定操作后，没有等到这次埋点被正确触发。'
    case 'click_not_found':
      return '页面上找不到要点击的节点，点击未执行。'
    case 'step_not_found':
      return '前置步骤找不到对应节点，关键路径中断。'
    case 'param_mismatch':
      return '埋点已发出，但参数与期望不一致。'
    case 'eventType_mismatch':
      return '埋点已发出，但事件类型与文档不一致。'
    case 'uicode_mismatch':
      return '埋点已发出，但 uicode 与文档不一致。'
    case 'report_http_missed':
      return '未捕获到埋点上报 GIF。'
    case 'plan_only':
      return '本次只生成计划，未真实跑验收。'
    case 'path_blocker':
      return (item && item.skipReason) || '本条会阻断同路径后续验收，已跳过。'
    default:
      return rTrim(item && item.reason) || '验收未通过。'
  }
}

function cleanStep(step) {
  return String(step || '')
    .replace(/^undefined\s+/g, '')
    .trim()
}

function joinSteps(steps) {
  return (steps || []).map(cleanStep).filter(Boolean).join(' → ')
}

function loadDiagnostic(item, acceptDir) {
  const rel = item && item.diagnostic && item.diagnostic.json
  if (!rel || !acceptDir) return null
  const abs = path.isAbsolute(rel) ? rel : path.resolve(acceptDir, rel)
  if (!fs.existsSync(abs)) return null
  return readJson(abs, null)
}

function visibleTexts(diag) {
  const list = (diag && diag.visibleCandidates) || []
  const texts = []
  const seen = {}
  list.forEach(row => {
    const text = rTrim(row && row.text)
    if (!text || seen[text]) return
    seen[text] = true
    texts.push(text)
  })
  return texts.slice(0, 8)
}

function triggerLabel(item, diag) {
  const trigger = (diag && diag.trigger) || (item && item.trigger) || {}
  const by = trigger.by || ''
  const value = trigger.value || ''
  if (by && value) return `${by}:${value}`
  if (value) return String(value)
  const alts = trigger.alternates || []
  if (alts.length) return alts.join(' / ')
  return ''
}

function httpNote(item) {
  const http = item && item.http
  if (!http) return ''
  if (http.reasonZh) {
    if (http.ok) {
      return `HTTP ${http.status || 200} ${http.statusText || 'OK'}，请求已落地；这只说明通道通了，不能代替本次关键路径触发。`
    }
    return http.reasonZh
  }
  if (http.matched && http.ok) {
    return `HTTP ${http.status || 200} ${http.statusText || 'OK'}，请求已落地；这只说明通道通了，不能代替本次关键路径触发。`
  }
  if (http.matched === false) {
    return '未捕获到匹配的上报 GIF。'
  }
  return ''
}

function buildFailFacts(item, opts) {
  const options = opts || {}
  const kind = classifyReason(item && item.reason)
  const diag = loadDiagnostic(item, options.acceptDir)
  const impl = options.implEvent || null
  const zh = reasonZh(item && item.reason, item)
  return {
    kind,
    reasonZh: zh,
    evtId: String((item && item.evtId) || ''),
    eventName: (item && item.eventName) || '',
    eventDesc: (item && item.eventDesc) || '',
    steps: (item && item.steps) || [],
    failUrl: (diag && diag.url) || '',
    failTitle: (diag && diag.title) || '',
    trigger: triggerLabel(item, diag),
    visibleTexts: visibleTexts(diag),
    httpNote: httpNote(item),
    uicodeConflict: (impl && impl.uicodeConflict) || (item && item.uicodeConflict) || '',
    paramDiffs: (item && item.paramDiffs) || [],
    emptyParams: (item && item.emptyParams) || [],
    fired: !!(item && item.fired)
  }
}

function extrasLines(facts) {
  const lines = []
  if (facts.uicodeConflict) {
    lines.push(`uicode 冲突：${facts.uicodeConflict}。这是口径提示，不是这次红字失败的主因，除非判定码就是「uicode 不一致」。`)
  }
  if (facts.httpNote) {
    lines.push(facts.httpNote)
  }
  if (facts.paramDiffs && facts.paramDiffs.length && facts.kind !== 'param_mismatch') {
    lines.push('参数差异：' + facts.paramDiffs.map(function (d) {
      return d.key + '（' + (d.reason || '不一致') + '）'
    }).join('；'))
  }
  if (facts.emptyParams && facts.emptyParams.length) {
    lines.push('未取到值的参数：' + facts.emptyParams.join('、'))
  }
  return lines
}

function failFactsZh(facts, item) {
  const evtId = facts.evtId || ''
  const name = facts.eventName ? `「${facts.eventName}」` : ''
  const zh = facts.reasonZh || '验收失败'
  const summary = `${evtId}${name}验收失败，直接判定原因是「${zh}」：${oneLine(facts.kind, item)}`
  const blocks = []
  blocks.push(summary)
  blocks.push('')
  blocks.push('具体是这样：')
  blocks.push('')
  blocks.push(`1. 主因：「${zh}」`)
  const steps = joinSteps(facts.steps)
  if (steps) {
    blocks.push(`验收步骤：${steps}`)
  }
  if (facts.failUrl) {
    const title = facts.failTitle ? `（${facts.failTitle}）` : ''
    blocks.push(`失败时页面：${facts.failUrl}${title}`)
  }
  if (facts.visibleTexts && facts.visibleTexts.length) {
    blocks.push(`当时可见：${facts.visibleTexts.join(' / ')}`)
  }
  if (facts.trigger) {
    blocks.push(`要点击 / 触发：${facts.trigger}`)
  }
  if (facts.kind === 'param_mismatch' && facts.paramDiffs && facts.paramDiffs.length) {
    blocks.push('参数差异：' + facts.paramDiffs.map(function (d) {
      return d.key + '（' + (d.reason || '不一致') + '）'
    }).join('；'))
  }
  if (!facts.fired && (facts.kind === 'not_fired' || facts.kind === 'click_not_found' || facts.kind === 'step_not_found')) {
    blocks.push('结论：本次路径上没有采到对应 SDK 调用（fired 为空）。')
  }
  const extras = extrasLines(facts)
  if (extras.length) {
    blocks.push('')
    blocks.push('2. 附带提示')
    extras.forEach(function (line) {
      blocks.push(`- ${line}`)
    })
  }
  return blocks.join('\n')
}

function enrichFailExplain(report, opts) {
  const options = opts || {}
  if (!report || !Array.isArray(report.results)) {
    return report
  }
  const acceptDir = options.acceptDir
    || (options.htmlPath ? path.dirname(options.htmlPath) : '')
  const implById = {}
  ;(options.implEvents || []).forEach(function (ev) {
    if (ev && ev.evtId) implById[String(ev.evtId)] = ev
  })
  report.results.forEach(function (item) {
    if (!item) return
    if (rTrim(item.reason)) {
      item.reasonKind = classifyReason(item.reason)
      item.reasonZh = reasonZh(item.reason, item)
    } else {
      item.reasonKind = ''
      item.reasonZh = ''
    }
    if (item.status === 'skip' && !item.skipReason && item.reasonZh) {
      item.skipReason = item.reasonZh
    }
    if (item.status !== 'fail') {
      item.failFacts = null
      item.failFactsZh = ''
      return
    }
    const facts = buildFailFacts(item, {
      acceptDir,
      implEvent: implById[String(item.evtId)] || null
    })
    item.failFacts = facts
    item.failFactsZh = failFactsZh(facts, item)
    item.uicodeConflict = facts.uicodeConflict || item.uicodeConflict || ''
  })
  return report
}

module.exports = {
  D_FAIL_CHOICE,
  REASON_ZH,
  buildFailFacts,
  classifyReason,
  enrichFailExplain,
  failFactsZh,
  oneLine,
  reasonZh
}
