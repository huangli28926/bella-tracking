#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { defaultAcceptPaths } = require('../accept/accept-chain')
const { validateFiles } = require('../accept/validate-impl')
const { normalizeImpl } = require('../accept/normalize-impl')
const { ensureExcelInDocs, findRepoRoot, parseArgs, readJson, resolveExcel, toPosix, writeJson } = require('../lib/lib')
const { assertCurrentTask, loadStatus, TASK_MISMATCH_EXIT } = require('./assert-task')
const { formatStageReport } = require('./format-stage-report')

const SCRIPT_DIR = __dirname
const EVENT_KEYS = [
  'status', 'accepted', 'targetFile', 'functionName', 'lifecycle', 'pageKey',
  'styleId', 'entryUrlTemplate', 'insertHint', 'evidence', 'uicodeConflict',
  'code', 'parameters', 'accept', 'unresolved'
]
const PARAM_KEYS = ['key', 'docDesc', 'expression', 'valueKind', 'sourcePath', 'confidence']
const DROP_EVENT = ['uicode', 'hint', 'confirmed', 'deferred', 'fromMemory', 'fromEvtId']
const DROP_PARAM = ['hint', 'confirmed', 'fromMemory']

function parsePatch(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '').trim()
  if (!text) throw new Error('empty patch')
  if (text.charAt(0) === '`') throw new Error('patch must be pure JSON, no markdown fence')
  return JSON.parse(text)
}

function isPosixRel(value) {
  const file = String(value || '')
  if (!file) return true
  if (path.isAbsolute(file)) return false
  if (file.indexOf('\\') !== -1) return false
  if (file.split('/').indexOf('..') !== -1) return false
  return true
}

function stripDropped(obj, drop) {
  const next = Object.assign({}, obj)
  drop.forEach(key => { delete next[key] })
  return next
}

function pick(obj, keys) {
  const next = {}
  keys.forEach(key => {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) next[key] = obj[key]
  })
  return next
}

function mergeParameters(existing, patchList) {
  const prev = Array.isArray(existing) ? existing.slice() : []
  if (!Array.isArray(patchList)) return prev
  const byKey = {}
  prev.forEach((item, idx) => {
    if (item && item.key) byKey[String(item.key)] = idx
  })
  patchList.forEach(item => {
    if (!item || !item.key) return
    const clean = stripDropped(pick(item, PARAM_KEYS), DROP_PARAM)
    const key = String(clean.key)
    if (byKey[key] == null) {
      const base = { key }
      prev.push(Object.assign(base, clean))
      byKey[key] = prev.length - 1
      return
    }
    const cur = prev[byKey[key]]
    const hint = cur.hint
    const confirmed = cur.confirmed
    const fromMemory = cur.fromMemory
    Object.assign(cur, clean)
    if (hint !== undefined) cur.hint = hint
    if (confirmed !== undefined) cur.confirmed = confirmed
    if (fromMemory !== undefined) cur.fromMemory = fromMemory
  })
  return prev
}

function mergeEvent(existing, patch) {
  const keep = {
    confirmed: existing.confirmed,
    deferred: existing.deferred,
    fromMemory: existing.fromMemory,
    fromEvtId: existing.fromEvtId,
    hint: existing.hint
  }
  const next = Object.assign({}, existing, pick(stripDropped(patch, DROP_EVENT), EVENT_KEYS))
  next.evtId = String(patch.evtId || existing.evtId)
  if (existing.docIndex != null && next.docIndex == null) next.docIndex = existing.docIndex
  next.parameters = mergeParameters(existing.parameters, patch.parameters)
  Object.keys(keep).forEach(key => {
    if (keep[key] !== undefined) next[key] = keep[key]
  })
  return next
}

function upsertEvent(payload, event, dumped) {
  const events = Array.isArray(payload.events) ? payload.events.slice() : []
  const idx = events.findIndex(item => String(item.evtId) === String(event.evtId))
  if (idx === -1) {
    const src = (dumped.events || []).find(item => String(item.evtId) === String(event.evtId))
    if (src && src.docIndex != null && event.docIndex == null) event.docIndex = src.docIndex
    events.push(event)
  } else {
    events[idx] = event
  }
  events.sort((a, b) => {
    const da = Number(a && a.docIndex) || 0
    const db = Number(b && b.docIndex) || 0
    if (da !== db) return da - db
    return String((a && a.evtId) || '').localeCompare(String((b && b.evtId) || ''))
  })
  return Object.assign({}, payload, { events })
}

function applyPatch(paths, args, repoRoot, patch) {
  const evtId = String(args.evt || args.evtId || patch.evtId || '')
  const taskId = String(args.task || 'A_ANALYZE_EVENT')
  if (!evtId) {
    return { ok: false, exitCode: 1, message: 'missing evtId' }
  }
  if (String(patch.evtId) !== evtId) {
    return { ok: false, exitCode: TASK_MISMATCH_EXIT, message: 'patch.evtId !== --evt' }
  }
  if (patch.uicode != null) {
    return { ok: false, exitCode: 1, message: 'uicode is forbidden in patch' }
  }
  if (!isPosixRel(patch.targetFile)) {
    return { ok: false, exitCode: 1, message: 'targetFile must be repo-relative POSIX' }
  }
  const status = loadStatus(args, repoRoot)
  const gate = assertCurrentTask(status, taskId, evtId)
  if (!gate.ok) return gate

  const before = fs.existsSync(paths.implPath) ? fs.readFileSync(paths.implPath, 'utf8') : ''
  const payload = before ? JSON.parse(before) : { events: [] }
  const dumped = readJson(paths.eventsPath, { events: [] })
  const existing = (payload.events || []).find(item => String(item.evtId) === evtId) || { evtId }
  const merged = upsertEvent(payload, mergeEvent(existing, patch), dumped)
  const normalized = normalizeImpl(merged)
  writeJson(paths.implPath, normalized)
  const validation = validateFiles(paths, args, repoRoot)
  const errors = validation.issues.filter(item => item.severity === 'error')
  if (errors.length) {
    if (before) fs.writeFileSync(paths.implPath, before)
    else if (fs.existsSync(paths.implPath)) fs.unlinkSync(paths.implPath)
    return {
      ok: false,
      exitCode: 1,
      message: 'validate-impl errors',
      issues: errors
    }
  }
  const nextStatus = loadStatus(args, repoRoot)
  const report = formatStageReport(nextStatus, normalized, {
    finishedId: taskId,
    finishedEvtId: evtId
  })
  return {
    ok: true,
    exitCode: 0,
    evtId,
    nextTask: nextStatus.nextTask,
    report
  }
}

function main() {
  const args = parseArgs(process.argv)
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  if (args.excel) {
    args.excel = toPosix(path.relative(repoRoot, ensureExcelInDocs(repoRoot, resolveExcel(repoRoot, args.excel)))) || args.excel
  }
  const paths = defaultAcceptPaths(repoRoot, args)
  let raw = ''
  if (args.patch && args.patch !== '-' ) {
    raw = fs.readFileSync(path.resolve(repoRoot, args.patch), 'utf8')
  } else {
    raw = fs.readFileSync(0, 'utf8')
  }
  const patch = parsePatch(raw)
  const result = applyPatch(paths, args, repoRoot, patch)
  if (args.json || true) {
    console.log(JSON.stringify({
      ok: result.ok,
      evtId: result.evtId || patch.evtId,
      nextTask: result.nextTask || null,
      report: result.report || '',
      message: result.message || '',
      issues: result.issues || [],
      expected: result.expected,
      actual: result.actual,
      blockingReason: result.blockingReason
    }, null, 2))
  }
  if (result.report && !args.json) {
    console.log(result.report)
  }
  if (!result.ok) process.exit(result.exitCode || 1)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message || error)
    process.exit(1)
  }
}

module.exports = { applyPatch, mergeEvent, isPosixRel }
