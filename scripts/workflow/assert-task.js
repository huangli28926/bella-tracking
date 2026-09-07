#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path')
const { defaultAcceptPaths } = require('../accept/accept-chain')
const { ensureExcelInDocs, findRepoRoot, parseArgs, resolveExcel, toPosix } = require('../lib/lib')

const TASK_MISMATCH_EXIT = 20
const SCRIPT_DIR = __dirname

function mismatchPayload(expectedId, evtId, actual) {
  return {
    ok: false,
    expected: expectedId || null,
    expectedEvtId: evtId != null && String(evtId) !== '' ? String(evtId) : null,
    actual: actual && actual.id ? actual.id : null,
    actualEvtId: actual && actual.subject && actual.subject.evtId ? String(actual.subject.evtId) : null,
    blockingReason: actual && actual.blockingReason
      ? actual.blockingReason
      : `nextTask.id mismatch: expected ${expectedId || '(none)'} got ${(actual && actual.id) || '(null)'}`
  }
}

function assertCurrentTask(status, expectedId, evtId) {
  const actual = status && status.nextTask ? status.nextTask : null
  if (!expectedId || !actual || actual.id !== expectedId) {
    return Object.assign({ exitCode: TASK_MISMATCH_EXIT }, mismatchPayload(expectedId, evtId, actual))
  }
  if (evtId != null && String(evtId) !== '') {
    const actualEvt = actual.subject && actual.subject.evtId ? String(actual.subject.evtId) : ''
    if (actualEvt !== String(evtId)) {
      return Object.assign({ exitCode: TASK_MISMATCH_EXIT }, mismatchPayload(expectedId, evtId, actual))
    }
  }
  return { ok: true, exitCode: 0, nextTask: actual, expected: expectedId }
}

function assertOneOf(status, expectedIds, evtId) {
  const ids = Array.isArray(expectedIds) ? expectedIds : [expectedIds]
  const actual = status && status.nextTask ? status.nextTask : null
  const hit = actual && ids.indexOf(actual.id) !== -1
  if (!hit) {
    return Object.assign(
      { exitCode: TASK_MISMATCH_EXIT },
      mismatchPayload(ids.join('|'), evtId, actual)
    )
  }
  return assertCurrentTask(status, actual.id, evtId)
}

function loadStatus(args, repoRoot) {
  const { buildStatus } = require('./tracking-workflow')
  const excel = args && args.excel
    ? toPosix(path.relative(repoRoot, ensureExcelInDocs(repoRoot, resolveExcel(repoRoot, args.excel)))) || args.excel
    : args.excel
  const nextArgs = Object.assign({}, args, { excel })
  const paths = defaultAcceptPaths(repoRoot, nextArgs)
  return buildStatus(paths, nextArgs, repoRoot)
}

function assertOrExit(result, json) {
  if (result.ok) {
    if (json) console.log(JSON.stringify(result, null, 2))
    return result
  }
  console.error(JSON.stringify({
    expected: result.expected,
    actual: result.actual,
    blockingReason: result.blockingReason,
    expectedEvtId: result.expectedEvtId || null,
    actualEvtId: result.actualEvtId || null
  }, null, 2))
  process.exit(TASK_MISMATCH_EXIT)
}

function main() {
  const args = parseArgs(process.argv)
  const expected = String(args.task || args.expect || args._[0] || '').trim()
  const evtId = args.evt || args.evtId || ''
  if (!expected) {
    throw new Error('assert-task 需要 --task=TASK_ID')
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const status = loadStatus(args, repoRoot)
  const result = assertCurrentTask(status, expected, evtId)
  assertOrExit(result, true)
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
  TASK_MISMATCH_EXIT,
  assertCurrentTask,
  assertOneOf,
  assertOrExit,
  loadStatus
}
