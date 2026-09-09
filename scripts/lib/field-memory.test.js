const { test } = require('node:test')
const assert = require('node:assert/strict')
const { applyToEvent, paramNeedsBackfill } = require('./field-memory')

test('medium/low existing expression is not backfilled', () => {
  const memory = {
    parameters: {
      houseCode: { expression: 'memory.houseCode', sourcePath: 'mem' }
    }
  }
  const event = {
    parameters: [{
      key: 'houseCode',
      expression: 'props.houseCode',
      confidence: 'low'
    }]
  }
  assert.equal(paramNeedsBackfill(event.parameters[0]), false)
  const result = applyToEvent(event, memory)
  assert.equal(result.changed, false)
  assert.equal(result.event.parameters[0].expression, 'props.houseCode')
})

test('empty expression still backfills last confirmed value', () => {
  const memory = {
    parameters: {
      houseCode: { expression: 'memory.houseCode', sourcePath: 'mem', valueKind: 'expression' }
    }
  }
  const event = {
    status: 'located',
    targetFile: 'src/a.jsx',
    parameters: [{ key: 'houseCode', expression: '', confidence: 'low' }]
  }
  const result = applyToEvent(event, memory)
  assert.equal(result.changed, true)
  assert.equal(result.event.parameters[0].expression, 'memory.houseCode')
})

test('unanalyzed pending event is not backfilled from memory', () => {
  const memory = {
    parameters: {
      houseCode: { expression: 'memory.houseCode', sourcePath: 'mem' }
    }
  }
  const event = {
    status: 'pending',
    parameters: [{ key: 'houseCode', expression: '' }]
  }
  const result = applyToEvent(event, memory)
  assert.equal(result.changed, false)
  assert.equal(result.event.parameters[0].expression, '')
})
