const assert = require('assert')
const test = require('node:test')
const { normalizeImpl } = require('./normalize-impl')
const { validateImpl } = require('./validate-impl')

const EVENTS = { events: [{ evtId: '1001' }] }

function implWithParam(param) {
  return {
    events: [{
      evtId: '1001',
      status: 'pending',
      parameters: [param]
    }]
  }
}

function errors(param) {
  return validateImpl(implWithParam(param), EVENTS, null).filter(item => item.severity === 'error')
}

test('case 1 full parameter schema is valid', () => {
  const issues = errors({
    key: 'house_id',
    expression: 'houseInfo.id',
    sourcePath: 'pageData.house → props.houseInfo',
    evidence: [
      {
        type: 'prop-chain',
        from: 'pageData.house',
        to: 'props.houseInfo'
      }
    ],
    scopeReachable: true,
    confidence: 'high',
    unresolved: [],
    conflicts: []
  })
  assert.equal(issues.length, 0)
})

test('case 2 legacy parameter without evidence fields is valid', () => {
  const issues = errors({
    key: 'house_id',
    expression: 'houseInfo.id',
    sourcePath: '',
    confidence: 'high',
    unresolved: []
  })
  assert.equal(issues.length, 0)
})

test('case 3 unknown evidence type fails', () => {
  const issues = errors({
    key: 'house_id',
    evidence: [{ type: 'agent-guess' }]
  })
  assert.ok(issues.some(item => /invalid evidence type/.test(item.message)))
})

test('case 4 invalid scopeReachable type fails', () => {
  const issues = errors({
    key: 'house_id',
    scopeReachable: 'yes'
  })
  assert.ok(issues.some(item => item.field.endsWith('scopeReachable')))
})

test('case 5 conflicts must be an array', () => {
  const issues = errors({
    key: 'house_id',
    conflicts: 'API conflict'
  })
  assert.ok(issues.some(item => item.field.endsWith('conflicts')))
})

test('normalize fills defaults without inferring evidence or reachability', () => {
  const after = normalizeImpl(implWithParam({
    key: 'house_id',
    expression: 'houseInfo.id',
    confidence: 'high'
  }))
  const param = after.events[0].parameters[0]
  assert.deepEqual(param.evidence, [])
  assert.strictEqual(param.scopeReachable, null)
  assert.deepEqual(param.conflicts, [])
})
