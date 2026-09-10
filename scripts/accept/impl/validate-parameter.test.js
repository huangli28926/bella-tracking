const assert = require('assert')
const fs = require('fs')
const path = require('path')
const test = require('node:test')
const { eventNeedsConfirm } = require('../../confirm/needs-confirm')
const { collectImplGates, validateImpl } = require('./validate-impl')
const { eventParameterGate, validateParameter } = require('./validate-parameter')
const { stampHumanConfirmation } = require('./validate-confirmation-reuse')

function highParam(overrides) {
  return Object.assign({
    key: 'house_id',
    expression: 'houseInfo.id',
    sourcePath: 'api.house.id -> props.houseInfo -> handleClick',
    evidence: [{ type: 'same-component-tracking' }],
    scopeReachable: true,
    confidence: 'high',
    unresolved: [],
    conflicts: []
  }, overrides)
}

function codes(result) {
  return result.issues.map(item => item.code)
}

const EVENTS = { events: [{ evtId: '1001' }] }
const FIXTURE_DIR = path.join(__dirname, '../fixtures/p1-3-parameter-gate')

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'))
}

test('case 1 complete strong evidence → READY', () => {
  const result = validateParameter(highParam())
  assert.equal(result.status, 'READY')
})

test('case 2 medium confidence → NEEDS_CONFIRM', () => {
  const result = validateParameter(highParam({
    evidence: [{ type: 'field-memory' }],
    confidence: 'medium'
  }))
  assert.equal(result.status, 'NEEDS_CONFIRM')
  assert.ok(codes(result).includes('PARAM_STRONG_EVIDENCE_MISSING'))
})

test('human confirmed medium candidate is READY', () => {
  const event = {
    evtId: '1',
    targetFile: 'src/pages/detail/index.tsx',
    functionName: 'handleClick',
    lifecycle: 'onClick',
    parameters: [highParam({
      evidence: [{ type: 'field-memory' }],
      confidence: 'medium'
    })]
  }
  const stamped = stampHumanConfirmation(event)
  const result = validateParameter(stamped.parameters[0], stamped)
  assert.equal(result.status, 'READY')
})

test('case 3 high + unresolved conflict → INVALID', () => {
  const result = validateParameter(highParam({
    unresolved: ['请确认参数 house_id 的取值'],
    confidence: 'high'
  }))
  assert.equal(result.status, 'INVALID')
  assert.ok(codes(result).includes('PARAM_FACT_CONFLICT') || codes(result).includes('PARAM_CONFIDENCE_INCONSISTENT'))
})

test('case 3b medium + unresolved → NEEDS_CONFIRM', () => {
  const result = validateParameter(highParam({
    evidence: [{ type: 'field-memory' }],
    confidence: 'medium',
    unresolved: ['请确认参数 house_id 的取值']
  }))
  assert.equal(result.status, 'NEEDS_CONFIRM')
  assert.ok(codes(result).includes('PARAM_UNRESOLVED_REMAINING'))
})

test('case 4 scopeReachable=false without acquisition → NEEDS_CONFIRM', () => {
  const result = validateParameter(highParam({
    scopeReachable: false,
    confidence: 'low'
  }))
  assert.equal(result.status, 'NEEDS_CONFIRM')
  assert.ok(codes(result).includes('PARAM_SCOPE_UNREACHABLE'))
})

test('case 5 scopeReachable unknown → NEEDS_CONFIRM', () => {
  const result = validateParameter(highParam({
    scopeReachable: null,
    confidence: 'medium'
  }))
  assert.equal(result.status, 'NEEDS_CONFIRM')
  assert.ok(codes(result).includes('PARAM_SCOPE_UNKNOWN'))
})

test('case 6 weak evidence only cannot READY', () => {
  const result = validateParameter(highParam({
    evidence: [{ type: 'repository-convention' }],
    confidence: 'medium'
  }))
  assert.equal(result.status, 'NEEDS_CONFIRM')
  assert.notEqual(result.status, 'READY')
})

test('case 7 missing symbol → INVALID PARAM_SYMBOL_NOT_FOUND', () => {
  const result = validateParameter(highParam(), { knownSymbols: ['other'] })
  assert.equal(result.status, 'INVALID')
  assert.ok(codes(result).includes('PARAM_SYMBOL_NOT_FOUND'))
})

test('case 8 transform without evidence → NEEDS_CONFIRM', () => {
  const result = validateParameter(highParam({
    expression: "houseCode || '-'"
  }))
  assert.equal(result.status, 'NEEDS_CONFIRM')
  assert.ok(codes(result).includes('PARAM_TRANSFORM_UNVERIFIED'))
})

test('case 9 confidence inconsistent → INVALID', () => {
  const result = validateParameter(highParam({
    evidence: [{ type: 'field-memory' }],
    confidence: 'high'
  }))
  assert.equal(result.status, 'INVALID')
  assert.ok(codes(result).includes('PARAM_CONFIDENCE_INCONSISTENT'))
})

test('case 10 optional omitted does not INVALID the event', () => {
  const event = {
    evtId: '1001',
    status: 'located',
    targetFile: 'src/pages/house.js',
    unresolved: [],
    parameters: [
      highParam(),
      {
        key: 'extra_tag',
        required: false,
        expression: '',
        sourcePath: '',
        evidence: [],
        scopeReachable: null,
        confidence: '',
        unresolved: [],
        conflicts: []
      }
    ]
  }
  const optional = validateParameter(event.parameters[1], event)
  assert.equal(optional.status, 'READY')
  assert.ok(codes(optional).includes('PARAM_OPTIONAL_OMITTED'))
  const gate = eventParameterGate(event)
  assert.equal(gate.status, 'READY')
})

test('case 11 required expression missing → NEEDS_CONFIRM', () => {
  const result = validateParameter(highParam({
    expression: '',
    confidence: 'low'
  }))
  assert.equal(result.status, 'NEEDS_CONFIRM')
  assert.ok(codes(result).includes('PARAM_EXPRESSION_MISSING'))
})

test('case 11b missing expression + high → INVALID', () => {
  const result = validateParameter(highParam({
    expression: '',
    confidence: 'high'
  }))
  assert.equal(result.status, 'INVALID')
})

test('case 12 parameter aggregation → event NEEDS_CONFIRM', () => {
  const event = {
    evtId: '1001',
    status: 'located',
    targetFile: 'src/pages/house.js',
    unresolved: ['请确认参数 city_id 的取值'],
    parameters: [
      highParam({ key: 'a' }),
      highParam({ key: 'b' }),
      highParam({
        key: 'city_id',
        evidence: [{ type: 'field-memory' }],
        confidence: 'medium'
      })
    ]
  }
  const gate = eventParameterGate(event)
  assert.equal(gate.status, 'NEEDS_CONFIRM')
  assert.equal(gate.needsConfirm, true)
  assert.equal(eventNeedsConfirm(event), true)
})

test('validate-impl fixture READY has zero errors and READY gate', () => {
  const impl = loadFixture('impl-ready.json')
  const issues = validateImpl(impl, loadFixture('events.json'), loadFixture('adaptor.json'))
  const errors = issues.filter(item => item.severity === 'error')
  assert.equal(errors.length, 0)
  assert.equal(collectImplGates(impl)[0].status, 'READY')
})

test('validate-impl fixture NEEDS_CONFIRM does not fail validate', () => {
  const impl = loadFixture('impl-needs-confirm.json')
  const issues = validateImpl(impl, loadFixture('events.json'), loadFixture('adaptor.json'))
  const errors = issues.filter(item => item.severity === 'error')
  assert.equal(errors.length, 0)
  const gate = collectImplGates(impl)[0]
  assert.equal(gate.status, 'NEEDS_CONFIRM')
  assert.equal(gate.needsConfirm, true)
  assert.equal(eventNeedsConfirm(impl.events[0]), true)
})

test('validate-impl fixture INVALID fails and is not human-confirmable', () => {
  const impl = loadFixture('impl-invalid.json')
  const issues = validateImpl(impl, loadFixture('events.json'), loadFixture('adaptor.json'))
  const errors = issues.filter(item => item.severity === 'error')
  assert.ok(errors.some(item => /invalid evidence type/.test(item.message)))
  const gate = collectImplGates(impl)[0]
  assert.equal(gate.status, 'INVALID')
  assert.equal(gate.needsConfirm, false)
  assert.equal(eventNeedsConfirm(impl.events[0]), false)
})
