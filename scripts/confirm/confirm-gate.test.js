const assert = require('assert')
const test = require('node:test')
const { applyConfirmAction } = require('./confirm-gate')
const { collectImplGates, summarizeImplGates } = require('../accept/validate-impl')
const { normalizeImpl } = require('../accept/normalize-impl')

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

test('confirm READY allows confirmed=true', () => {
  const event = { evtId: '1', parameters: [highParam()] }
  const result = applyConfirmAction(event)
  assert.equal(result.ok, true)
  assert.equal(result.confirmed, true)
  assert.equal(result.event.confirmed, true)
  assert.equal(result.gate.status, 'READY')
})

test('confirm NEEDS_CONFIRM keeps pending', () => {
  const event = {
    evtId: '1',
    parameters: [highParam({
      evidence: [{ type: 'field-memory' }],
      confidence: 'medium'
    })]
  }
  const result = applyConfirmAction(event)
  assert.equal(result.ok, true)
  assert.equal(result.pending, true)
  assert.equal(result.event.confirmed, false)
  assert.equal(result.gate.status, 'NEEDS_CONFIRM')
})

test('confirm INVALID rejects confirmed', () => {
  const event = {
    evtId: '1',
    parameters: [highParam({
      scopeReachable: false,
      confidence: 'low'
    })]
  }
  const result = applyConfirmAction(event)
  assert.equal(result.ok, false)
  assert.equal(result.event.confirmed, false)
  assert.equal(result.gate.status, 'INVALID')
})

test('save-impl confirm recalculates confidence before gate', () => {
  const event = {
    evtId: '1',
    parameters: [highParam({
      evidence: [{ type: 'field-memory' }],
      confidence: 'high'
    })]
  }
  const normalized = normalizeImpl({ events: [event] }).events[0]
  const result = applyConfirmAction(normalized)
  assert.equal(normalized.parameters[0].confidence, 'medium')
  assert.equal(result.gate.status, 'NEEDS_CONFIRM')
  assert.equal(result.event.confirmed, false)
})

test('summarizeImplGates distinguishes INVALID vs NEEDS_CONFIRM vs READY', () => {
  const ready = { evtId: 'r', parameters: [highParam()] }
  const confirm = {
    evtId: 'c',
    parameters: [highParam({ evidence: [{ type: 'field-memory' }], confidence: 'medium' })]
  }
  const invalid = {
    evtId: 'i',
    parameters: [highParam({ scopeReachable: false, confidence: 'low' })]
  }
  assert.equal(collectImplGates({ events: [ready] })[0].status, 'READY')
  assert.equal(summarizeImplGates({ events: [confirm] }).needsConfirmCount, 1)
  assert.equal(summarizeImplGates({ events: [invalid] }).invalidCount, 1)
  assert.equal(summarizeImplGates({ events: [ready] }).allReady, true)
})
