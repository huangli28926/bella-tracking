#!/usr/bin/env node
const { isAcceptCli } = require('../cli')
/* eslint-disable no-console */
const { candidateSignature, pathIdForCandidate } = require('./path-id')
const { defaultAcceptPaths } = require('./accept-chain')
const { findRepoRoot, parseArgs, readJson, writeJson } = require('../../lib/lib')

const SCRIPT_DIR = __dirname

const UNRESOLVED = {
  none: 'no reachable path',
  ambiguous: 'multiple candidate paths cannot be uniquely resolved',
  stale: 'historical path decision is no longer valid',
  context: 'decision context no longer matches target / pageKey / seedUrl',
  locator: 'path exists but key locator is not reliable',
  conflict: 'source facts conflict with structured path facts'
}

function bool(value, fallback) {
  if (typeof value === 'boolean') return value
  return fallback
}

function hasAddedEdge(candidate) {
  return (candidate.edges || []).some(edge => edge && edge.changeStatus === 'added')
}

function isCurrentChange(candidate) {
  return bool(candidate.relatedToCurrentChange, false) || hasAddedEdge(candidate)
}

function prepareCandidates(rawList) {
  return (rawList || []).map(item => {
    const copy = Object.assign({}, item)
    copy.reachable = bool(copy.reachable, true)
    copy.factsComplete = bool(copy.factsComplete, true)
    copy.executable = bool(copy.executable, true)
    copy.missingLocator = bool(copy.missingLocator, false)
    copy.seedIsPage = bool(copy.seedIsPage, false)
    copy.relatedToCurrentChange = isCurrentChange(copy)
    copy.cost = Number.isFinite(copy.cost) ? copy.cost : (copy.steps || []).length
    copy.stableLocatorCount = Number(copy.stableLocatorCount || 0)
    copy.pathId = pathIdForCandidate(copy)
    return copy
  })
}

function normalizedLexical(candidate) {
  return [
    String(candidate.pageKey || ''),
    (candidate.steps || []).map(step => JSON.stringify(step)).join('>'),
    String(candidate.target || '')
  ].join('|')
}

function cmpNumDesc(a, b) {
  if (a > b) return -1
  if (a < b) return 1
  return 0
}

function compareRank(a, b) {
  const related = cmpNumDesc(a.relatedToCurrentChange ? 1 : 0, b.relatedToCurrentChange ? 1 : 0)
  if (related) return related
  const facts = cmpNumDesc(a.factsComplete ? 1 : 0, b.factsComplete ? 1 : 0)
  if (facts) return facts
  const exec = cmpNumDesc(a.executable ? 1 : 0, b.executable ? 1 : 0)
  if (exec) return exec
  const loc = cmpNumDesc(a.missingLocator ? 0 : 1, b.missingLocator ? 0 : 1)
  if (loc) return loc
  const cost = Number(a.cost || 0) - Number(b.cost || 0)
  if (cost) return cost
  const stable = cmpNumDesc(Number(a.stableLocatorCount || 0), Number(b.stableLocatorCount || 0))
  if (stable) return stable
  const lexA = normalizedLexical(a)
  const lexB = normalizedLexical(b)
  if (lexA < lexB) return -1
  if (lexA > lexB) return 1
  if (a.pathId < b.pathId) return -1
  if (a.pathId > b.pathId) return 1
  return 0
}

function sortStable(list) {
  return list.slice().sort(compareRank)
}

function contextOf(input, prepared) {
  const ctx = (input && input.context) || {}
  const first = prepared[0] || {}
  return {
    pageKey: String(ctx.pageKey || first.pageKey || ''),
    target: String(ctx.target || first.target || ''),
    seedUrlKey: String(ctx.seedUrlKey || first.seedUrlKey || first.seedUrl || '')
  }
}

function decisionPayload(source, reason, validity, context, extra) {
  return Object.assign({
    source: source || '',
    reason: reason || '',
    validity: validity || '',
    context: context || {}
  }, extra || {})
}

function resultBase(prepared, context) {
  return {
    candidateSignature: candidateSignature(prepared.map(item => item.pathId)),
    candidates: prepared.map(item => ({
      pathId: item.pathId,
      pageKey: item.pageKey || '',
      target: item.target || '',
      relatedToCurrentChange: !!item.relatedToCurrentChange,
      cost: item.cost,
      steps: item.steps || [],
      edges: item.edges || []
    })),
    context
  }
}

function selectResult(candidate, selectedBy, source, reason, prepared, context, validity) {
  return Object.assign(resultBase(prepared, context), {
    status: 'resolved',
    selectedPathId: candidate.pathId,
    selectedBy,
    decision: decisionPayload(source, reason, validity || 'valid', context),
    unresolved: []
  })
}

function confirmResult(reason, prepared, context, extra) {
  return Object.assign(resultBase(prepared, context), extra || {}, {
    status: 'needsConfirm',
    selectedPathId: '',
    selectedBy: '',
    decision: decisionPayload('', reason, extra && extra.validity || '', context),
    unresolved: [reason]
  })
}

function readHistorical(input) {
  const hist = input && (input.historicalDecision || input.decision) || null
  if (!hist || typeof hist !== 'object') return null
  const selectedPathId = String(hist.selectedPathId || '')
  if (!selectedPathId) return null
  return {
    selectedPathId,
    candidateSignature: String(hist.candidateSignature || ''),
    context: hist.context || (hist.decision && hist.decision.context) || hist
  }
}

function contextMatches(decisionCtx, current) {
  const left = decisionCtx || {}
  if (left.pageKey && current.pageKey && left.pageKey !== current.pageKey) return false
  if (left.target && current.target && left.target !== current.target) return false
  if (left.seedUrlKey && current.seedUrlKey && left.seedUrlKey !== current.seedUrlKey) return false
  return true
}

function historicalValidity(hist, prepared, current, changeSet) {
  if (!hist) return { status: '' }
  if (!contextMatches(hist.context, current)) {
    return { status: 'invalid', reason: UNRESOLVED.context }
  }
  const still = prepared.find(item => item.pathId === hist.selectedPathId)
  if (!still) {
    return { status: 'invalid', reason: UNRESOLVED.stale }
  }
  if (changeSet.length) {
    return { status: 'superseded', reason: 'current-change path supersedes historical decision' }
  }
  const signature = candidateSignature(prepared.map(item => item.pathId))
  if (hist.candidateSignature && hist.candidateSignature !== signature) {
    return { status: 'stale', reason: UNRESOLVED.stale, still }
  }
  if (still.missingLocator) {
    return { status: 'invalid', reason: UNRESOLVED.locator }
  }
  if (!still.reachable) {
    return { status: 'invalid', reason: UNRESOLVED.stale }
  }
  return { status: 'valid', still }
}

function pickUniqueOrConfirm(pool, prepared, context, selectedBy, source, reason) {
  if (!pool.length) {
    return confirmResult(UNRESOLVED.none, prepared, context)
  }
  if (pool.every(item => item.missingLocator)) {
    return confirmResult(UNRESOLVED.locator, prepared, context)
  }
  const usable = pool.filter(item => !item.missingLocator && item.executable && item.factsComplete)
  const ranked = sortStable(usable.length ? usable : pool.filter(item => !item.missingLocator))
  if (!ranked.length) {
    return confirmResult(UNRESOLVED.locator, prepared, context)
  }
  if (ranked.length === 1) {
    return selectResult(ranked[0], selectedBy, source, reason, prepared, context)
  }
  const best = ranked[0]
  const tied = ranked.filter(item => compareRank(item, best) === 0)
  if (tied.length === 1) {
    return selectResult(best, selectedBy, source, reason, prepared, context)
  }
  return selectResult(sortStable(tied)[0], 'deterministic-tie-break', 'deterministic-rule', 'lexical pathId tie-break', prepared, context)
}

function resolveAcceptPath(input) {
  const prepared = prepareCandidates(input && input.candidates)
  const context = contextOf(input, prepared)
  const reachable = prepared.filter(item => item.reachable)
  if (!reachable.length) {
    return confirmResult(UNRESOLVED.none, prepared, context)
  }
  if (prepared.some(item => item.conflict)) {
    return confirmResult(UNRESOLVED.conflict, prepared, context)
  }

  const changeSet = reachable.filter(isCurrentChange)
  const hist = readHistorical(input)
  const histState = historicalValidity(hist, reachable, context, changeSet)

  if (changeSet.length) {
    const related = changeSet.filter(item => item.relatedToCurrentChange)
    const pool = related.length ? related : changeSet
    return pickUniqueOrConfirm(
      pool,
      prepared,
      context,
      pool.length === 1 ? 'current-change' : 'current-change',
      'deterministic-rule',
      'contains-current-change-edge'
    )
  }

  if (histState.status === 'valid') {
    return selectResult(
      histState.still,
      'historical-human-decision',
      'human',
      'confirmed acceptance entry',
      prepared,
      context,
      'valid'
    )
  }

  const seedPage = reachable.filter(item => item.seedIsPage)
  if (seedPage.length) {
    return pickUniqueOrConfirm(seedPage, prepared, context, 'unique-candidate', 'deterministic-rule', 'seed is target page')
  }

  if (reachable.length === 1) {
    if (reachable[0].missingLocator) {
      return confirmResult(UNRESOLVED.locator, prepared, context)
    }
    return selectResult(reachable[0], 'unique-candidate', 'deterministic-rule', 'single reachable candidate', prepared, context)
  }

  if (histState.status === 'invalid' || histState.status === 'stale' || histState.status === 'superseded') {
    return confirmResult(histState.reason, prepared, context, { validity: histState.status })
  }

  return confirmResult(UNRESOLVED.ambiguous, prepared, context)
}

function applyHumanDecision(input, selectedPathId) {
  const prepared = prepareCandidates(input && input.candidates)
  const context = contextOf(input, prepared)
  const found = prepared.find(item => item.pathId === String(selectedPathId || ''))
  if (!found || !found.reachable) {
    return confirmResult(UNRESOLVED.stale, prepared, context, { validity: 'invalid' })
  }
  return selectResult(found, 'human', 'human', 'confirmed acceptance entry', prepared, context, 'valid')
}

function runtimeKeepLockedPath(lockedPathId, failure) {
  return {
    pathId: String(lockedPathId || ''),
    fallback: false,
    reason: failure ? 'accept path execution mismatch' : ''
  }
}

function formatAcceptPathGate(eventLabel, resolution) {
  const lines = [
    '事件：',
    String(eventLabel || ''),
    '',
    '候选路径：',
    ''
  ]
  ;(resolution.candidates || []).forEach((item, idx) => {
    const label = String.fromCharCode(65 + (idx % 26))
    const steps = (item.steps || []).map(step => {
      if (typeof step === 'string') return step
      return [step.node || step.from || '', step.action || '', step.to || ''].filter(Boolean).join(' ')
    }).filter(Boolean)
    lines.push('[' + label + '] ' + (item.pathId || ''))
    lines.push(steps.join('\n→ ') || '(no steps)')
    lines.push('')
  })
  lines.push('请回复序号字母或 pathId。')
  return lines.join('\n')
}

function pathResolutionFromResult(result) {
  return {
    status: result.status,
    selectedPathId: result.selectedPathId || '',
    selectedBy: result.selectedBy || '',
    candidateSignature: result.candidateSignature || '',
    decision: result.decision || {},
    unresolved: result.unresolved || []
  }
}

function applyToEvent(event, result) {
  const accept = Object.assign({}, event && event.accept || {}, {
    pathResolution: pathResolutionFromResult(result)
  })
  return Object.assign({}, event || {}, { accept })
}

function printHelp() {
  console.log(`
resolve-accept-path — 对 impl.accept.candidatePaths 做确定性路径收敛

Usage:
  node resolve-accept-path.js --excel=docs/foo.xlsx [--write]
  node resolve-accept-path.js --excel=... --evt=95941 --select=<pathId> --write
`)
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const paths = defaultAcceptPaths(repoRoot, args)
  if (!paths.implPath) {
    printHelp()
    throw new Error('未提供 --excel / --impl')
  }
  const implPayload = readJson(paths.implPath, { events: [] })
  const want = {}
  String(args.evt || '').split(',').forEach(id => {
    const key = String(id || '').trim()
    if (key) want[key] = true
  })
  const hasFilter = Object.keys(want).length > 0
  const events = (implPayload.events || []).map(event => {
    if (hasFilter && !want[String(event.evtId || '')]) return event
    const candidates = event.accept && event.accept.candidatePaths
    if (!Array.isArray(candidates) || !candidates.length) return event
    const hist = event.accept && event.accept.pathResolution
    const input = {
      candidates,
      historicalDecision: hist,
      context: {
        pageKey: event.pageKey || '',
        target: event.evtId || '',
        seedUrlKey: event.accept && event.accept.seedUrlKey || ''
      }
    }
    const result = args.select
      ? applyHumanDecision(input, args.select)
      : resolveAcceptPath(input)
    return applyToEvent(event, result)
  })
  const next = Object.assign({}, implPayload, { events })
  if (args.write) {
    writeJson(paths.implPath, next)
  }
  const summary = events.map(event => {
    const res = event.accept && event.accept.pathResolution || {}
    return {
      evtId: event.evtId,
      status: res.status || '',
      selectedPathId: res.selectedPathId || '',
      unresolved: res.unresolved || []
    }
  })
  if (args.json) {
    console.log(JSON.stringify({ implPath: paths.implPath, events: summary }, null, 2))
    return
  }
  console.log('== resolve-accept-path ==')
  summary.forEach(item => {
    console.log('  ' + item.evtId + '  ' + (item.status || '-') + '  ' + (item.selectedPathId || (item.unresolved[0] || '')))
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
  UNRESOLVED,
  applyHumanDecision,
  applyToEvent,
  formatAcceptPathGate,
  pathResolutionFromResult,
  prepareCandidates,
  resolveAcceptPath,
  runtimeKeepLockedPath,
  main
}
