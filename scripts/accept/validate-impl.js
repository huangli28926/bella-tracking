#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { findRepoRoot, parseArgs, readJson, toPosix } = require('../lib/lib')
const { defaultPaths } = require('../extract/report')

const SCRIPT_DIR = __dirname
const STATUS = ['pending', 'existing', 'located', 'unresolved']
const CONFIDENCE = ['high', 'medium', 'low', '']
const LOCATOR_BY = ['text', 'testid', 'css', 'role', '']
const TRIGGER_KIND = ['click', 'scrollIntoView', 'waitVisible', 'pageLoad']
const STEP_ACTION = ['click', 'scrollIntoView', 'waitVisible', 'waitApi', 'waitUrl', 'pageLoad']
const DEP_FROM = ['api', 'url', 'user', 'page']
const PATH_STATUS = ['resolved', 'needsConfirm']
const PATH_SELECTED_BY = ['current-change', 'historical-human-decision', 'unique-candidate', 'deterministic-tie-break', 'human', '']
const PATH_SOURCE = ['deterministic-rule', 'human', '']

function printHelp() {
  console.log(`
validate-impl — 校验 impl.json 和 events/adaptor 契约

Usage:
  node validate-impl.js --excel=docs/2.3埋点需求文档.xlsx
  node validate-impl.js --impl=docs/tracking/impl/xxx/_raw/xxx.impl.json --events=... --adaptor=...

Options:
  --excel     推断 docs/tracking/impl/{文档名}/
  --impl      覆盖 impl.json 路径
  --events    覆盖 events.json 路径
  --adaptor   覆盖 adaptor.json 路径
  --strict    warning 也按失败退出
  --json      输出机器可读 JSON
`)
}

function add(list, severity, evtId, field, message) {
  list.push({ severity, evtId: evtId || '', field: field || '', message })
}

function byId(list) {
  const map = {}
  ;(list || []).forEach(item => {
    if (item && item.evtId) map[String(item.evtId)] = item
  })
  return map
}

function resolveMaybe(repoRoot, value, fallback) {
  if (!value) return fallback || ''
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value)
}

function isInsideAny(relPath, roots) {
  const file = toPosix(relPath || '').replace(/^\/+/, '')
  if (!file) return true
  return (roots || []).some(root => {
    const clean = toPosix(root || '').replace(/^\/+|\/+$/g, '')
    return clean && (file === clean || file.indexOf(clean + '/') === 0)
  })
}

function validateStep(issues, evtId, field, step) {
  if (!step || typeof step !== 'object') {
    add(issues, 'error', evtId, field, 'step must be object')
    return
  }
  const action = step.action || step.kind
  if (STEP_ACTION.indexOf(action) === -1) {
    add(issues, 'error', evtId, `${field}.action`, `invalid step action: ${action || '(empty)'}`)
  }
  if (['click', 'scrollIntoView', 'waitVisible'].indexOf(action) !== -1) {
    if (!step.value) add(issues, 'error', evtId, `${field}.value`, 'locator step requires value')
    if (!step.by || LOCATOR_BY.indexOf(step.by) === -1) {
      add(issues, 'error', evtId, `${field}.by`, `invalid locator by: ${step.by || '(empty)'}`)
    }
  }
  if (action === 'waitUrl' && !(step.urlIncludes || step.value)) {
    add(issues, 'error', evtId, `${field}.urlIncludes`, 'waitUrl requires urlIncludes or value')
  }
}

function validateTrigger(issues, evtId, trigger) {
  if (!trigger || typeof trigger !== 'object') {
    add(issues, 'error', evtId, 'accept.trigger', 'missing accept.trigger')
    return
  }
  if (TRIGGER_KIND.indexOf(trigger.kind) === -1) {
    add(issues, 'error', evtId, 'accept.trigger.kind', `invalid trigger kind: ${trigger.kind || '(empty)'}`)
  }
  if (trigger.kind !== 'pageLoad') {
    if (!trigger.value) add(issues, 'error', evtId, 'accept.trigger.value', 'non-pageLoad trigger requires locator value')
    if (!trigger.by || LOCATOR_BY.indexOf(trigger.by) === -1) {
      add(issues, 'error', evtId, 'accept.trigger.by', `invalid locator by: ${trigger.by || '(empty)'}`)
    }
  }
  ;(trigger.preconditions || []).forEach((step, idx) => {
    validateStep(issues, evtId, `accept.trigger.preconditions[${idx}]`, step)
  })
}

function validateDataDeps(issues, evtId, deps) {
  ;(deps || []).forEach((dep, idx) => {
    const field = `accept.dataDeps[${idx}]`
    if (!dep || typeof dep !== 'object') {
      add(issues, 'error', evtId, field, 'dataDep must be object')
      return
    }
    if (!dep.paramKey) add(issues, 'error', evtId, `${field}.paramKey`, 'missing paramKey')
    if (DEP_FROM.indexOf(dep.from) === -1) add(issues, 'error', evtId, `${field}.from`, `invalid source: ${dep.from || '(empty)'}`)
    if (dep.from === 'url' && !dep.queryKey) add(issues, 'warn', evtId, `${field}.queryKey`, 'url dataDep should declare queryKey')
    if (dep.from === 'api') {
      const api = dep.api || {}
      if (!(api.urlIncludes || api.field || dep.urlIncludes || dep.field)) {
        add(issues, 'warn', evtId, field, 'api dataDep should declare api.urlIncludes or api.field')
      }
    }
  })
}

function validateImpl(implPayload, eventsPayload, adaptor) {
  const issues = []
  const docs = byId((eventsPayload && eventsPayload.events) || [])
  const implEvents = (implPayload && implPayload.events) || []
  const seen = {}
  const styleIds = {}
  ;((adaptor && adaptor.styles) || []).forEach(style => {
    if (style && style.id) styleIds[style.id] = true
  })
  const sourceRoots = (adaptor && adaptor.sourceRoots) || []

  implEvents.forEach((event, idx) => {
    if (!event || typeof event !== 'object') {
      add(issues, 'error', '', `events[${idx}]`, 'event must be object')
      return
    }
    const evtId = String(event.evtId || '')
    if (!evtId) {
      add(issues, 'error', '', `events[${idx}].evtId`, 'missing evtId')
      return
    }
    if (seen[evtId]) add(issues, 'error', evtId, 'evtId', 'duplicate evtId in impl')
    seen[evtId] = true
    if (!docs[evtId]) add(issues, 'warn', evtId, 'evtId', 'evtId is not present in events.json')
    if (Object.prototype.hasOwnProperty.call(event, 'uicode')) {
      add(issues, 'error', evtId, 'uicode', 'impl.json must not contain uicode; use events.json as source')
    }
    const expect = event.accept && event.accept.expect
    if (expect && Object.prototype.hasOwnProperty.call(expect, 'uicode')) {
      add(issues, 'error', evtId, 'accept.expect.uicode', 'impl accept.expect must not contain uicode')
    }
    if (event.status && STATUS.indexOf(event.status) === -1) {
      add(issues, 'error', evtId, 'status', `invalid status: ${event.status}`)
    }
    if (event.lifecycle !== undefined && LIFECYCLE.indexOf(event.lifecycle || '') === -1) {
      add(issues, 'error', evtId, 'lifecycle', `invalid lifecycle: ${event.lifecycle || '(empty)'}`)
    }
    ;(event.unresolved || []).forEach((item, uIdx) => {
      const text = String(item || '').trim()
      if (text !== '请确认埋点位置' && !/^请确认参数 .+ 的取值$/.test(text)) {
        add(issues, 'error', evtId, `unresolved[${uIdx}]`, 'unresolved must use closed confirmation phrases')
      }
    })
    if (event.accepted && event.status !== 'existing') {
      add(issues, 'error', evtId, 'accepted', 'accepted can only be true when status is existing')
    }
    if (event.targetFile && sourceRoots.length && !isInsideAny(event.targetFile, sourceRoots)) {
      add(issues, 'warn', evtId, 'targetFile', `targetFile is outside adaptor.sourceRoots: ${event.targetFile}`)
    }
    if (event.styleId && Object.keys(styleIds).length && !styleIds[event.styleId]) {
      add(issues, 'error', evtId, 'styleId', `styleId not found in adaptor.styles: ${event.styleId}`)
    }
    ;(event.parameters || []).forEach((param, pIdx) => {
      const field = `parameters[${pIdx}]`
      if (!param || typeof param !== 'object') {
        add(issues, 'error', evtId, field, 'parameter must be object')
        return
      }
      if (!param.key) add(issues, 'error', evtId, `${field}.key`, 'missing parameter key')
      if (CONFIDENCE.indexOf(param.confidence || '') === -1) {
        add(issues, 'warn', evtId, `${field}.confidence`, `unexpected confidence: ${param.confidence}`)
      }
    })
    if (event.accept && typeof event.accept === 'object') {
      validateTrigger(issues, evtId, event.accept.trigger)
      validateDataDeps(issues, evtId, event.accept.dataDeps || [])
      const pathRes = event.accept.pathResolution
      if (pathRes && typeof pathRes === 'object') {
        if (pathRes.status && PATH_STATUS.indexOf(pathRes.status) === -1) {
          add(issues, 'error', evtId, 'accept.pathResolution.status', `invalid status: ${pathRes.status}`)
        }
        if (pathRes.selectedBy && PATH_SELECTED_BY.indexOf(pathRes.selectedBy) === -1) {
          add(issues, 'error', evtId, 'accept.pathResolution.selectedBy', `invalid selectedBy: ${pathRes.selectedBy}`)
        }
        const src = pathRes.decision && pathRes.decision.source
        if (src && PATH_SOURCE.indexOf(src) === -1) {
          add(issues, 'error', evtId, 'accept.pathResolution.decision.source', `invalid source: ${src}`)
        }
        if (pathRes.status === 'resolved' && !pathRes.selectedPathId) {
          add(issues, 'error', evtId, 'accept.pathResolution.selectedPathId', 'resolved path requires selectedPathId')
        }
      }
    }
  })

  Object.keys(docs).forEach(evtId => {
    if (!seen[evtId]) add(issues, 'warn', evtId, 'events', 'excel event missing in impl.json')
  })
  return issues
}

function validateFiles(paths, args, repoRoot) {
  const implPath = resolveMaybe(repoRoot, args.impl, paths.implPath)
  const eventsPath = resolveMaybe(repoRoot, args.events, paths.eventsPath)
  const adaptorPath = resolveMaybe(repoRoot, args.adaptor, paths.adaptorPath)
  if (!implPath || !fs.existsSync(implPath)) throw new Error(`impl.json 不存在: ${implPath || '(missing --impl / --excel)'}`)
  if (!eventsPath || !fs.existsSync(eventsPath)) throw new Error(`events.json 不存在: ${eventsPath || '(missing --events / --excel)'}`)
  const issues = validateImpl(
    readJson(implPath, { events: [] }),
    readJson(eventsPath, { events: [] }),
    readJson(adaptorPath, null)
  )
  return { implPath, eventsPath, adaptorPath, issues }
}

function assertValidImpl(paths, args, repoRoot) {
  const result = validateFiles(paths, args || {}, repoRoot || findRepoRoot(SCRIPT_DIR))
  const errors = result.issues.filter(item => item.severity === 'error')
  if (errors.length) {
    const lines = errors.slice(0, 12).map(item => `${item.evtId || '-'} ${item.field}: ${item.message}`)
    throw new Error(`impl.json 校验失败 (${errors.length} errors):\n${lines.join('\n')}`)
  }
  return result
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const paths = defaultPaths(repoRoot, args)
  const result = validateFiles(paths, args, repoRoot)
  const errors = result.issues.filter(item => item.severity === 'error').length
  const warnings = result.issues.filter(item => item.severity === 'warn').length
  if (args.json) {
    console.log(JSON.stringify({ ok: !errors && !(args.strict && warnings), errors, warnings, issues: result.issues }, null, 2))
  } else {
    console.log('== validate-impl ==')
    console.log(`Impl: ${result.implPath}`)
    console.log(`issues: errors=${errors} warnings=${warnings}`)
    result.issues.forEach(item => {
      const id = item.evtId ? ` ${item.evtId}` : ''
      console.log(`  [${item.severity}]${id} ${item.field}: ${item.message}`)
    })
  }
  if (errors || (args.strict && warnings)) process.exitCode = 1
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message || error)
    process.exit(1)
  }
}

module.exports = { assertValidImpl, validateFiles, validateImpl }
