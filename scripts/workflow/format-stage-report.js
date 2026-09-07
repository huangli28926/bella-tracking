#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path')
const { defaultAcceptPaths } = require('../accept/accept-chain')
const { ensureExcelInDocs, findRepoRoot, parseArgs, readJson, resolveExcel, toPosix } = require('../lib/lib')
const { DEVICE_PROMPT, FULL_PAGE_PROMPT } = require('./prompts')

const SCRIPT_DIR = __dirname
const PROTECTED = true

function cell(value) {
  const text = value == null ? '' : String(value)
  return text.replace(/\s+/g, ' ').trim() || '-'
}

function paramSummary(event) {
  const params = Array.isArray(event && event.parameters) ? event.parameters : []
  if (!params.length) return '-'
  return params.map(item => {
    const key = cell(item && item.key)
    const expr = cell(item && item.expression)
    return `${key}←${expr}`
  }).join('; ')
}

function landingOf(event) {
  const file = cell(event && event.targetFile)
  const fn = cell(event && event.functionName)
  const life = cell(event && event.lifecycle)
  if (file === '-' && fn === '-') return '-'
  return `${file} → ${fn} (${life})`
}

function sortedEvents(impl) {
  const list = Array.isArray(impl && impl.events) ? impl.events.slice() : []
  list.sort((a, b) => {
    const da = Number(a && a.docIndex) || 0
    const db = Number(b && b.docIndex) || 0
    if (da !== db) return da - db
    return String((a && a.evtId) || '').localeCompare(String((b && b.evtId) || ''))
  })
  return list
}

function table(headers, rows) {
  const lines = [headers.join('\t')]
  rows.forEach(row => lines.push(row.join('\t')))
  return lines.join('\n')
}

function formatStageReport(status, impl, options) {
  const opts = options || {}
  const nextTask = status && status.nextTask
  const events = sortedEvents(impl)
  const finished = opts.finishedId || ''
  const finishedEvt = opts.finishedEvtId ? String(opts.finishedEvtId) : ''
  const parts = []

  if (finished === 'A_ANALYZE_EVENT' && finishedEvt) {
    const event = events.find(item => String(item.evtId) === finishedEvt) || {}
    parts.push('== A_ANALYZE_EVENT ==')
    parts.push(table(
      ['evtId', 'status', 'targetFile', 'functionName', 'lifecycle'],
      [[cell(event.evtId), cell(event.status), cell(event.targetFile), cell(event.functionName), cell(event.lifecycle)]]
    ))
  } else if (finished === 'C_WRITE_EVENT' || finished === 'C_FILL_ACCEPT') {
    const event = events.find(item => String(item.evtId) === finishedEvt) || {}
    parts.push(`== ${finished} ==`)
    parts.push(table(
      ['evtId', '落点', '关键参数'],
      [[cell(event.evtId), landingOf(event), paramSummary(event)]]
    ))
  }

  if (nextTask && nextTask.id === 'B_CONFIRM_FULL_PAGE') {
    parts.push('== 路径 A ==')
    parts.push(table(
      ['evtId', 'status', '落点'],
      events.map(item => [cell(item.evtId), cell(item.status), landingOf(item)])
    ))
    parts.push(nextTask.prompt || FULL_PAGE_PROMPT)
  } else if (nextTask && nextTask.id === 'D_CHOOSE_DEVICE') {
    parts.push('== 路径 C ==')
    parts.push(table(
      ['evtId', '落点', '关键参数'],
      events.map(item => [cell(item.evtId), landingOf(item), paramSummary(item)])
    ))
    parts.push(nextTask.prompt || DEVICE_PROMPT)
  } else if (nextTask && nextTask.prompt) {
    parts.push(nextTask.prompt)
  } else if (!nextTask && status && status.accept && status.accept.ok) {
    parts.push('== 路径 D ==')
    parts.push(status.accept.message || 'accept complete')
  }

  if (nextTask && !parts.some(line => line === (nextTask.prompt || ''))) {
    if (nextTask.id === 'A_ANALYZE_EVENT' || nextTask.id === 'C_WRITE_EVENT' || nextTask.id === 'C_FILL_ACCEPT') {
      const evt = nextTask.subject && nextTask.subject.evtId ? ` evt=${nextTask.subject.evtId}` : ''
      parts.push(`nextTask: ${nextTask.id}${evt}`)
    }
  }

  return parts.filter(Boolean).join('\n')
}

function main() {
  const args = parseArgs(process.argv)
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const excel = args.excel
    ? toPosix(path.relative(repoRoot, ensureExcelInDocs(repoRoot, resolveExcel(repoRoot, args.excel)))) || args.excel
    : args.excel
  const nextArgs = Object.assign({}, args, { excel })
  const { buildStatus } = require('./tracking-workflow')
  const paths = defaultAcceptPaths(repoRoot, nextArgs)
  const status = buildStatus(paths, nextArgs, repoRoot)
  const impl = readJson(paths.implPath, { events: [] })
  const text = formatStageReport(status, impl, {
    finishedId: args.finished || '',
    finishedEvtId: args.evt || args.evtId || ''
  })
  if (PROTECTED && args.json) {
    console.log(JSON.stringify({ report: text, nextTask: status.nextTask }, null, 2))
    return
  }
  if (text) console.log(text)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message || error)
    process.exit(1)
  }
}

module.exports = { formatStageReport }
