#!/usr/bin/env node
const { isAcceptCli } = require('../cli')
/* eslint-disable no-console */
const { defaultAcceptPaths } = require('./accept-chain')
const { findRepoRoot, parseArgs, readJson } = require('../../lib/lib')
const { prepareCandidates, resolveAcceptPath } = require('./resolve-accept-path')

const SCRIPT_DIR = __dirname

function issuesOf(evtId, resolution, candidates) {
  const issues = []
  const add = (field, message) => issues.push({ evtId, field, message })
  if (!resolution) {
    add('accept.pathResolution', 'missing pathResolution')
    return issues
  }
  if (resolution.status === 'needsConfirm') {
    if (!resolution.unresolved || !resolution.unresolved.length) {
      add('accept.pathResolution.unresolved', 'needsConfirm requires unresolved reason')
    }
    return issues
  }
  if (resolution.status !== 'resolved') {
    add('accept.pathResolution.status', 'status must be resolved or needsConfirm')
    return issues
  }
  const selected = String(resolution.selectedPathId || '')
  if (!selected) {
    add('accept.pathResolution.selectedPathId', 'resolved path missing selectedPathId')
    return issues
  }
  const prepared = prepareCandidates(candidates)
  const found = prepared.find(item => item.pathId === selected)
  if (!found) {
    add('accept.pathResolution.selectedPathId', 'selectedPathId is not in candidate set')
    return issues
  }
  if (!found.reachable) {
    add('accept.pathResolution.selectedPathId', 'selected path is not reachable')
  }
  ;(found.edges || []).forEach((edge, idx) => {
    if (!edge || !edge.from || !edge.to) {
      add('accept.candidatePaths.edges[' + idx + ']', 'edge requires from and to')
    }
  })
  const ctx = resolution.decision && resolution.decision.context || {}
  if (ctx.pageKey && found.pageKey && ctx.pageKey !== found.pageKey) {
    add('accept.pathResolution.decision.context', 'decision pageKey no longer matches selected path')
  }
  if ((found.steps || []).length === 0 && !found.seedIsPage) {
    add('accept.candidatePaths.steps', 'selected path has no expandable sharedSteps')
  }
  return issues
}

function validateAcceptPath(event) {
  const accept = event && event.accept || {}
  return issuesOf(String(event && event.evtId || ''), accept.pathResolution, accept.candidatePaths || [])
}

function validateAcceptPathSet(implPayload) {
  const issues = []
  ;((implPayload && implPayload.events) || []).forEach(event => {
    if (!event || !event.accept) return
    if (!event.accept.pathResolution && !event.accept.candidatePaths) return
    issues.push.apply(issues, validateAcceptPath(event))
  })
  return issues
}

function printHelp() {
  console.log(`
validate-accept-path — 校验 impl.pathResolution 与 candidate set 一致性

Usage:
  node validate-accept-path.js --excel=docs/foo.xlsx [--json]
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
  const issues = validateAcceptPathSet(readJson(paths.implPath, { events: [] }))
  if (args.json) {
    console.log(JSON.stringify({ ok: issues.length === 0, issues }, null, 2))
  } else {
    console.log('== validate-accept-path ==')
    console.log(issues.length ? issues.map(item => item.evtId + ' ' + item.message).join('\n') : 'ok')
  }
  if (issues.length) process.exitCode = 1
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
  validateAcceptPath,
  validateAcceptPathSet,
  main
}
