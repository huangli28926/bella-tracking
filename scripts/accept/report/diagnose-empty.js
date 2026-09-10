#!/usr/bin/env node
const { isAcceptCli } = require('../cli')
/* eslint-disable no-console */
/**
 * 从验收 JSON + impl.json 抽出「未取到值 / 参数失败」清单，供模型做空值自修复。
 * 本脚本只诊断、写报告；不改正业务代码、不改 impl（除非 --write-hints 预留，当前不启用）。
 */
const fs = require('fs')
const path = require('path')
const { findRepoRoot, parseArgs, readJson, writeJson } = require('../../lib/lib')
const { defaultAcceptPaths } = require('../chain/accept-chain')

const SCRIPT_DIR = __dirname

const CATEGORIES = [
  'fix_expression',
  'fix_accept_timing',
  'needs_prop_plumb',
  'needs_product_decision',
  'data_genuinely_empty',
  'unknown'
]

function printHelp() {
  console.log(`
diagnose-empty — 验收空值 / 参数失败诊断（无模型），输出空值修复 JSON

Usage:
  node diagnose-empty.js --excel=docs/2.3埋点需求文档.xlsx

Options:
  --excel     推断 docs/tracking/impl/{文档名}/
  --accept    覆盖验收 JSON 路径
  --impl      覆盖 impl.json 路径
  --out       输出路径，默认 accept/{文档名}-空值修复.json
  --include-fail   一并收录 status=fail 且含 paramDiffs / not_fired 的项
`)
}

function eventsById(events) {
  const map = {}
  ;(events || []).forEach(event => {
    if (event && event.evtId) {
      map[String(event.evtId)] = event
    }
  })
  return map
}

function findParam(implEvent, key) {
  const list = (implEvent && implEvent.parameters) || []
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] && String(list[i].key) === String(key)) {
      return list[i]
    }
  }
  return null
}

function findDep(item, key) {
  const list = (item && item.dataDeps) || []
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] && String(list[i].paramKey) === String(key)) {
      return list[i]
    }
  }
  return null
}

function textBlob(parts) {
  return parts.filter(Boolean).join('\n')
}

/**
 * 启发式分类：给模型起点，最终以模型读代码后的结论为准。
 */
function classifyEmpty(ctx) {
  const blob = textBlob([
    ctx.sourcePath,
    ctx.expression,
    ctx.docDesc,
    ctx.hintNote,
    ctx.hintField,
    ctx.acceptReason
  ])
  const lower = blob.toLowerCase()

  if (/口径|不符|不一致|代理|文档为|与文档/.test(blob)) {
    return {
      category: 'needs_product_decision',
      confidence: 'medium',
      why: '落库备注提示文档口径与现网取值不一致，需产品确认后才能改'
    }
  }
  if (/未透传|未传入|无挂牌|无.*字段|组件无|未带到|缺少 prop|未下发/.test(blob)) {
    return {
      category: 'needs_prop_plumb',
      confidence: 'medium',
      why: '落库备注提示页面有数据但组件未透传，需改业务源码（须用户确认）'
    }
  }
  if (!ctx.expression || !String(ctx.expression).trim()) {
    return {
      category: 'fix_expression',
      confidence: 'medium',
      why: 'impl 中 expression 为空，需补全参数来源'
    }
  }
  if (ctx.from === 'api') {
    const hasWait = !!(ctx.urlIncludes || (ctx.waitApis && ctx.waitApis.length))
    if (!hasWait) {
      return {
        category: 'fix_accept_timing',
        confidence: 'low',
        why: '参数来自 api 且未见 waitApis/urlIncludes，可能验收过早；也可能字段名错误'
      }
    }
    return {
      category: 'fix_expression',
      confidence: 'low',
      why: '已声明 api 依赖仍为空，优先核对接口字段名与 expression'
    }
  }
  if (ctx.firedValue === '-' && /\|\|\s*['"]-['"]/.test(String(ctx.expression || ''))) {
    if (/本房|该房|无数据|可为空|允许空/.test(blob) || /optional|empty ok/i.test(lower)) {
      return {
        category: 'data_genuinely_empty',
        confidence: 'low',
        why: '表达式含兜底且备注暗示可空；需对照页面确认是否真无数据'
      }
    }
  }
  return {
    category: 'unknown',
    confidence: 'low',
    why: '启发式无法判定，需模型对照 targetFile + 接口/页面状态'
  }
}

function autoApplyFor(category) {
  if (category === 'fix_expression' || category === 'fix_accept_timing') {
    return { impl: true, accept: true, clientSrc: false }
  }
  if (category === 'needs_prop_plumb') {
    return { impl: false, accept: false, clientSrc: false }
  }
  return { impl: false, accept: false, clientSrc: false }
}

function buildEmptyIssue(item, key, implEvent, extra) {
  const param = findParam(implEvent, key)
  const dep = findDep(item, key)
  const firedAction = (item.fired && item.fired.action) || {}
  const hasKey = Object.prototype.hasOwnProperty.call(firedAction, key)
  const firedValue = hasKey ? firedAction[key] : undefined
  const ctx = {
    sourcePath: (param && param.sourcePath) || (dep && dep.sourcePath) || '',
    expression: (param && param.expression) || (dep && dep.expression) || '',
    docDesc: (param && param.docDesc) || '',
    hintNote: param && param.hint && param.hint.note ? param.hint.note : '',
    hintField: param && param.hint && param.hint.api ? param.hint.api.field : '',
    from: (dep && dep.from) || '',
    urlIncludes: dep && dep.urlIncludes ? dep.urlIncludes : '',
    waitApis: (extra && extra.waitApis) || [],
    acceptReason: item.reason || '',
    firedValue: hasKey ? firedValue : null
  }
  const classified = classifyEmpty(ctx)
  return {
    kind: 'empty_param',
    evtId: String(item.evtId),
    eventName: item.eventName || (implEvent && implEvent.eventName) || '',
    paramKey: key,
    status: item.status || '',
    firedValue: hasKey ? firedValue : null,
    missingKey: !hasKey,
    expression: ctx.expression,
    sourcePath: ctx.sourcePath,
    docDesc: ctx.docDesc,
    confidence: (param && param.confidence) || '',
    hint: param && param.hint
      ? {
          note: param.hint.note || '',
          api: {
            url: (param.hint.api && param.hint.api.url) || '',
            field: (param.hint.api && param.hint.api.field) || ''
          }
        }
      : { note: '', api: { url: '', field: '' } },
    dataDep: dep
      ? {
          from: dep.from || '',
          queryKey: dep.queryKey || '',
          urlIncludes: dep.urlIncludes || '',
          field: dep.field || ''
        }
      : null,
    targetFile: (implEvent && implEvent.targetFile)
      || (item.code && item.code.file)
      || '',
    functionName: (implEvent && implEvent.functionName)
      || (item.code && item.code.functionName)
      || '',
    category: classified.category,
    categoryConfidence: classified.confidence,
    why: classified.why,
    autoApplyAllowed: autoApplyFor(classified.category),
    proposedFix: {
      expression: '',
      sourcePath: '',
      acceptPatch: null,
      clientSrcNote: '',
      applied: false
    },
    modelNotes: []
  }
}

function buildFailIssue(item, implEvent) {
  const diffs = item.paramDiffs || []
  return {
    kind: item.reason === 'not_fired' ? 'not_fired' : 'param_fail',
    evtId: String(item.evtId),
    eventName: item.eventName || (implEvent && implEvent.eventName) || '',
    status: item.status || 'fail',
    reason: item.reason || '',
    paramDiffs: diffs,
    emptyParams: item.emptyParams || [],
    targetFile: (implEvent && implEvent.targetFile)
      || (item.code && item.code.file)
      || '',
    functionName: (implEvent && implEvent.functionName)
      || (item.code && item.code.functionName)
      || '',
    category: item.reason === 'not_fired' ? 'fix_accept_timing' : 'unknown',
    categoryConfidence: 'low',
    why: item.reason === 'not_fired'
      ? '未采集到埋点，优先查 trigger / sharedSteps / 页面状态'
      : '参数断言失败，对照 paramDiffs 与 expression',
    autoApplyAllowed: autoApplyFor(
      item.reason === 'not_fired' ? 'fix_accept_timing' : 'unknown'
    ),
    proposedFix: {
      expression: '',
      sourcePath: '',
      acceptPatch: null,
      clientSrcNote: '',
      applied: false
    },
    modelNotes: []
  }
}

function pathWaitApis(report, pathId) {
  const paths = (report && report.paths) || []
  for (let i = 0; i < paths.length; i += 1) {
    if (paths[i] && paths[i].pathId === pathId) {
      const entry = paths[i].entry || {}
      return entry.waitApis || []
    }
  }
  return []
}

function diagnose(report, implPayload, opts) {
  const options = opts || {}
  const includeFail = !!options.includeFail
  const byId = eventsById((implPayload && implPayload.events) || [])
  const issues = []
  const seen = {}

  function addKey(evtId, key) {
    return `${evtId}::${key}`
  }

  ;(report.results || []).forEach(item => {
    if (!item) return
    const evtId = String(item.evtId || '')
    const implEvent = byId[evtId] || null
    const waitApis = pathWaitApis(report, item.pathId)
    const empties = item.emptyParams || []
    empties.forEach(key => {
      const id = addKey(evtId, key)
      if (seen[id]) return
      seen[id] = true
      issues.push(buildEmptyIssue(item, key, implEvent, { waitApis }))
    })
    if (includeFail && item.status === 'fail') {
      const failId = `fail::${evtId}`
      if (!seen[failId]) {
        seen[failId] = true
        issues.push(buildFailIssue(item, implEvent))
      }
    }
  })

  const byCategory = {}
  CATEGORIES.forEach(c => { byCategory[c] = 0 })
  issues.forEach(issue => {
    const c = CATEGORIES.indexOf(issue.category) >= 0 ? issue.category : 'unknown'
    byCategory[c] += 1
  })

  const autoCandidates = issues.filter(issue => {
    const a = issue.autoApplyAllowed || {}
    return a.impl || a.accept
  })

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    slug: report.slug || '',
    excelPath: report.excelPath || '',
    sourceAccept: options.acceptJsonRel || '',
    planOnly: !!report.planOnly,
    summary: {
      needConfirmEvents: (report.summary && report.summary.needConfirm) || 0,
      issueCount: issues.length,
      autoApplyCandidateCount: autoCandidates.length,
      byCategory
    },
    rules: {
      maxRounds: 2,
      autoApply: {
        impl: true,
        accept: true,
        clientSrc: 'requires_user_confirm'
      },
      categories: CATEGORIES.slice(),
      stopWhen: '第二轮后仍 empty 则停止，剩余标为人工项'
    },
    issues,
    nextActions: [
      '模型逐条核对 targetFile 中埋点调用与页面/接口真实字段',
      '可自动改的类别：更新 impl.json expression / accept.dataDeps 或 waitApis',
      'needs_prop_plumb / needs_product_decision：只写 proposedFix 说明，等用户确认后再改业务源码',
      '应用后对受影响 evtId 跑 run-accept.js --evt=... 并重渲终稿'
    ]
  }
}

function defaultOutPath(paths) {
  if (!paths.slug || !paths.acceptDir) return ''
  return path.join(paths.acceptDir, `${paths.slug}-空值修复.json`)
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const paths = defaultAcceptPaths(repoRoot, args)
  const acceptJson = args.accept
    ? (path.isAbsolute(args.accept) ? args.accept : path.resolve(repoRoot, args.accept))
    : paths.acceptJson
  const implPath = args.impl
    ? (path.isAbsolute(args.impl) ? args.impl : path.resolve(repoRoot, args.impl))
    : paths.implPath
  const outPath = args.out
    ? (path.isAbsolute(args.out) ? args.out : path.resolve(repoRoot, args.out))
    : defaultOutPath(paths)

  if (!acceptJson || !fs.existsSync(acceptJson)) {
    printHelp()
    throw new Error(`验收 JSON 不存在: ${acceptJson || '(请先跑 run-accept)'}`)
  }
  if (!implPath || !fs.existsSync(implPath)) {
    throw new Error(`impl.json 不存在: ${implPath || ''}`)
  }
  if (!outPath) {
    throw new Error('无法推断输出路径，请传 --excel 或 --out')
  }

  const report = readJson(acceptJson, null)
  if (!report) {
    throw new Error(`无法读取验收 JSON: ${acceptJson}`)
  }
  if (report.planOnly) {
    console.warn('警告: 当前为 plan-only 结果，通常无 emptyParams；仍会写出诊断文件')
  }

  const implPayload = readJson(implPath, { events: [] })
  const diag = diagnose(report, implPayload, {
    includeFail: !!(args['include-fail'] || args.includeFail),
    acceptJsonRel: path.relative(repoRoot, acceptJson).split(path.sep).join('/')
  })

  writeJson(outPath, diag)
  console.log('== diagnose-empty ==')
  console.log(`out: ${outPath}`)
  console.log(
    `issues ${diag.summary.issueCount} / autoApply候选 ${diag.summary.autoApplyCandidateCount} / needConfirm事件 ${diag.summary.needConfirmEvents}`
  )
  Object.keys(diag.summary.byCategory).forEach(key => {
    const n = diag.summary.byCategory[key]
    if (n) console.log(`  ${key}: ${n}`)
  })
}

if (isAcceptCli(module)) {
  try {
    main()
  } catch (error) {
    console.error(error.message || error)
    process.exit(1)
  }
}

module.exports = {
  CATEGORIES,
  classifyEmpty,
  diagnose,
  defaultOutPath,
  main
}
