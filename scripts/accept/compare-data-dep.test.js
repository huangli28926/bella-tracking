const assert = require('assert')
const test = require('node:test')
const {
  compareDataDepResult,
  compareDataDepResults,
  compareLegacyAssertParams,
  eventOutcomeFromDataDeps
} = require('./compare-data-dep')
const { resolveDataDeps } = require('./runtime-data-dep')

test('Expected === Actual → PASS', () => {
  const diff = compareDataDepResult({
    paramKey: 'housedel_id',
    status: 'resolved',
    value: '123456'
  }, { housedel_id: '123456' })
  assert.equal(diff.status, 'PASS')
  assert.equal(diff.code, '')
})

test('Expected !== Actual → FAIL', () => {
  const diff = compareDataDepResult({
    paramKey: 'housedel_id',
    status: 'resolved',
    value: '123'
  }, { housedel_id: '654' })
  assert.equal(diff.status, 'FAIL')
  assert.equal(diff.code, 'DATADEP_VALUE_MISMATCH')
})

test('Expected resolved, Actual "-" → FAIL', () => {
  const diff = compareDataDepResult({
    paramKey: 'housedel_id',
    status: 'resolved',
    value: '123'
  }, { housedel_id: '-' })
  assert.equal(diff.status, 'FAIL')
})

test('1 !== "1"', () => {
  const diff = compareDataDepResult({
    paramKey: 'n',
    status: 'resolved',
    value: 1
  }, { n: '1' })
  assert.equal(diff.status, 'FAIL')
})

test('Runtime source missing → PENDING / unverifiable', () => {
  const diff = compareDataDepResult({
    paramKey: 'ucid',
    status: 'missing',
    code: 'RUNTIME_WINDOW_PATH_MISSING'
  }, { ucid: '1001' })
  assert.equal(diff.status, 'PENDING')
  assert.equal(diff.code, 'RUNTIME_WINDOW_PATH_MISSING')
  const outcome = eventOutcomeFromDataDeps([diff], [])
  assert.equal(outcome.status, 'skip')
  assert.equal(outcome.reason, 'runtime_data_dep_unresolved')
  assert.equal(outcome.skipKind, 'unverifiable')
})

test('internal contract violation stays unverifiable', () => {
  const diff = compareDataDepResult({
    paramKey: 'x',
    status: 'error',
    code: 'DATADEP_NOT_RESOLVED'
  }, { x: '1' })
  const outcome = eventOutcomeFromDataDeps([diff], [])
  assert.equal(outcome.skipKind, 'unverifiable')
  assert.match(outcome.skipReason, /internal contract violation/)
})

test('assertParam without DataDep keeps missing-key validation', () => {
  const diffs = compareLegacyAssertParams({
    assertParams: ['evtId', 'housedel_id'],
    dataDeps: [{ paramKey: 'housedel_id', from: 'url' }]
  }, { housedel_id: '1' })
  assert.deepEqual(diffs, [{ key: 'evtId', reason: 'missing key' }])
})

test('legacy empty actual without dataDep is not a mismatch', () => {
  const diffs = compareLegacyAssertParams({
    assertParams: ['note'],
    dataDeps: []
  }, { note: '-' })
  assert.deepEqual(diffs, [])
})

test('FAIL wins over PENDING', () => {
  const outcome = eventOutcomeFromDataDeps([
    { paramKey: 'a', status: 'FAIL', code: 'DATADEP_VALUE_MISMATCH' },
    { paramKey: 'b', status: 'PENDING', code: 'RUNTIME_API_NOT_CAPTURED' }
  ], [])
  assert.equal(outcome.status, 'fail')
  assert.equal(outcome.reason, 'param_mismatch')
})

test('integration: DataDep → Expected → Actual → Compare', async () => {
  const deps = [
    {
      paramKey: 'housedel_id',
      from: 'url',
      queryKey: 'housedelCode',
      status: 'resolved',
      unresolved: [],
      expression: 'ignore-me'
    },
    {
      paramKey: 'ucid',
      from: 'user',
      status: 'resolved',
      unresolved: [],
      user: { runtime: { kind: 'windowPath', path: '__user.id' } }
    }
  ]
  const dataDepResults = await resolveDataDeps(deps, {
    urlSnapshot: { href: 'https://x.test/?housedelCode=123', query: { housedelCode: '123' } },
    windowSnapshot: { __user: { id: 1001 } }
  })
  const diffs = compareDataDepResults(dataDepResults, {
    housedel_id: '123',
    ucid: 1001
  })
  assert.equal(diffs[0].status, 'PASS')
  assert.equal(diffs[1].status, 'PASS')
  const mismatch = compareDataDepResults(dataDepResults, {
    housedel_id: '-',
    ucid: 1001
  })
  assert.equal(mismatch[0].status, 'FAIL')
  const outcome = eventOutcomeFromDataDeps(mismatch, [])
  assert.equal(outcome.status, 'fail')
})

test('integration: sharedSteps API before late trigger still PASS', async () => {
  const deps = [{
    paramKey: 'price',
    from: 'api',
    status: 'resolved',
    unresolved: [],
    api: {
      urlIncludes: '/api/detail',
      field: 'data.price'
    }
  }]
  const dataDepResults = await resolveDataDeps(deps, {
    apiRuntimeStart: 10,
    apiRuntimeEnd: 50,
    targetRuntimeStart: 40,
    api: {
      responses: [{
        t: 20,
        url: 'https://x.test/api/detail',
        status: 200,
        bodyParsed: true,
        body: { data: { price: 88 } }
      }]
    }
  })
  assert.equal(dataDepResults[0].status, 'resolved')
  assert.equal(dataDepResults[0].value, 88)
  const diffs = compareDataDepResults(dataDepResults, { price: 88 })
  assert.equal(diffs[0].status, 'PASS')
  const outcome = eventOutcomeFromDataDeps(diffs, [])
  assert.equal(outcome.status, 'pass')
})
