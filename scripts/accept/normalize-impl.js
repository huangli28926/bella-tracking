#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { findRepoRoot, parseArgs, readJson } = require('../lib/lib')
const { defaultPaths } = require('../extract/report')
const { calculateParameterConfidence, isLegacyParameter } = require('./calculate-confidence')
const { applyConfirmationReuseToEvent } = require('./validate-confirmation-reuse')
const { materializeParameter } = require('../params/normalize-parameter-facts')

const SCRIPT_DIR = __dirname
const STATUS = new Set(['pending', 'existing', 'located', 'unresolved'])
const CONFIDENCE = new Set(['high', 'medium', 'low', ''])
const LIFECYCLE_ALIAS = new Map([
  ['onclick', 'onClick'],
  ['click', 'onClick'],
  ['useeffect', 'useEffect'],
  ['effect', 'useEffect'],
  ['intersectionobserver', 'IntersectionObserver'],
  ['intersection_observer', 'IntersectionObserver'],
  ['observer', 'IntersectionObserver'],
  ['pageload', 'pageLoad'],
  ['page_load', 'pageLoad'],
  ['load', 'pageLoad'],
  ['', '']
])

function str(v) { return v == null ? '' : String(v).trim() }
function uniq(list) { return [...new Set(list.filter(Boolean))] }

function normalizeLifecycle(value) {
  const raw = str(value)
  const key = raw.replace(/[\s-]/g, '').toLowerCase()
  return LIFECYCLE_ALIAS.has(key) ? LIFECYCLE_ALIAS.get(key) : raw
}

function phrasesFromUnresolved(list) {
  const out = []
  ;(list || []).forEach(item => {
    if (item && typeof item === 'object') {
      const code = str(item.reasonCode || item.code)
      const field = str(item.field || (Array.isArray(item.fields) ? item.fields[0] : ''))
      if (code === 'LOCATION_UNCONFIRMED') out.push('请确认埋点位置')
      else if (code === 'PARAM_VALUE_UNCONFIRMED' && field) out.push(`请确认参数 ${field} 的取值`)
      return
    }
    const text = str(item)
    if (!text) return
    if (/^请确认埋点位置$/.test(text)) out.push(text)
    else {
      const m = text.match(/^请确认参数\s+(.+?)\s+的取值$/)
      if (m) out.push(`请确认参数 ${m[1]} 的取值`)
    }
  })
  return out
}

function normalizeUnresolved(event) {
  const out = phrasesFromUnresolved(event.unresolved)
  if (!event.targetFile && ['pending', 'unresolved'].includes(event.status)) out.push('请确认埋点位置')
  ;(event.parameters || []).forEach(p => {
    if (!str(p.expression) || ['low', 'medium'].includes(str(p.confidence))) {
      if (p.key) out.push(`请确认参数 ${p.key} 的取值`)
    }
  })
  return uniq(out)
}

function normalizeImpl(payload) {
  const next = JSON.parse(JSON.stringify(payload || {}))
  next.events = Array.isArray(next.events) ? next.events : []
  next.events.forEach(event => {
    event.evtId = str(event.evtId)
    event.status = STATUS.has(str(event.status)) ? str(event.status) : 'pending'
    if ('targetFile' in event) event.targetFile = str(event.targetFile)
    if ('functionName' in event) event.functionName = str(event.functionName)
    if ('pageKey' in event) event.pageKey = str(event.pageKey)
    if ('styleId' in event) event.styleId = str(event.styleId)
    if ('lifecycle' in event) event.lifecycle = normalizeLifecycle(event.lifecycle)
    event.parameters = Array.isArray(event.parameters) ? event.parameters : []
    event.parameters.forEach(p => {
      const legacy = isLegacyParameter(p)
      p.key = str(p.key)
      if ('expression' in p) p.expression = str(p.expression)
      if ('sourcePath' in p) p.sourcePath = str(p.sourcePath)
      p.confidence = CONFIDENCE.has(str(p.confidence)) ? str(p.confidence) : ''
      if ('valueKind' in p) p.valueKind = ['expression', 'prompt', ''].includes(str(p.valueKind)) ? str(p.valueKind) : ''
      if (!Object.prototype.hasOwnProperty.call(p, 'evidence')) p.evidence = []
      if (!Object.prototype.hasOwnProperty.call(p, 'scopeReachable')) p.scopeReachable = null
      if (!Object.prototype.hasOwnProperty.call(p, 'conflicts')) p.conflicts = []
      if (legacy) {
        p.legacyUnverified = true
      } else {
        delete p.legacyUnverified
      }
    })
    event.unresolved = phrasesFromUnresolved(event.unresolved)
    const withReuse = applyConfirmationReuseToEvent(event)
    event.parameters = withReuse.parameters
    event.parameters.forEach(p => {
      if (!p.legacyUnverified) {
        materializeParameter(p, event, { computeReachability: false })
        p.confidence = calculateParameterConfidence(p, event)
      }
    })
    event.unresolved = normalizeUnresolved(event)
    if (event.accept && event.accept.trigger) {
      const t = event.accept.trigger
      if ('kind' in t) t.kind = str(t.kind)
      if ('by' in t) t.by = str(t.by)
      if ('value' in t) t.value = str(t.value)
    }
    if (event.accept && Array.isArray(event.accept.dataDeps)) {
      event.accept.dataDeps.forEach(dep => {
        if (!dep || typeof dep !== 'object' || Array.isArray(dep)) return
        if (!Object.prototype.hasOwnProperty.call(dep, 'unresolved')) dep.unresolved = []
      })
    }
  })
  return next
}

function main() {
  const args = parseArgs(process.argv)
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const paths = defaultPaths(repoRoot, args)
  const implPath = args.impl ? path.resolve(repoRoot, args.impl) : paths.implPath
  if (!implPath || !fs.existsSync(implPath)) throw new Error(`impl.json 不存在: ${implPath || '(missing)'}`)
  const before = readJson(implPath, { events: [] })
  const after = normalizeImpl(before)
  const changed = JSON.stringify(before) !== JSON.stringify(after)
  if (args.check) {
    console.log(JSON.stringify({ ok: !changed, changed, implPath }, null, 2))
    if (changed) process.exitCode = 2
    return
  }
  fs.writeFileSync(implPath, JSON.stringify(after, null, 2) + '\n')
  console.log(JSON.stringify({ ok: true, changed, implPath }, null, 2))
}

if (require.main === module) {
  try { main() } catch (err) { console.error(err.message || err); process.exit(1) }
}
module.exports = { normalizeImpl, normalizeLifecycle }
