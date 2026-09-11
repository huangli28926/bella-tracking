const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  applyToEvent,
  buildDocDescIndex,
  loadMergedMemory,
  normalizeDesc,
  paramNeedsBackfill,
  upsertFromConfirmedEvent
} = require('./field-memory')

function memoryWith(evtId, key, expression, docDesc) {
  return upsertFromConfirmedEvent({ parameters: {}, docDescIndex: {} }, {
    evtId,
    confirmed: true,
    parameters: [{ key, docDesc, expression, valueKind: 'expression', sourcePath: 'api.houseCode' }]
  })
}

function locatedEvent(parameters, evtId) {
  return {
    evtId: evtId || '96793',
    status: 'located',
    targetFile: 'src/pages/detail/index.tsx',
    parameters
  }
}

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

test('normalizeDesc ignores width / case / punctuation differences', () => {
  assert.equal(normalizeDesc('经纪人 UCID'), normalizeDesc('经纪人ucid。'))
  assert.equal(normalizeDesc('小区ID（resblock_id）'), normalizeDesc('小区id(resblock_id)'))
  assert.notEqual(normalizeDesc('经纪人UCID'), normalizeDesc('店长UCID'))
})

test('same key and same description backfills an existing low candidate', () => {
  const memory = memoryWith('96793', 'broker_ucid', 'window.__user.id', '经纪人 UCID')
  const event = locatedEvent([{
    key: 'broker_ucid',
    docDesc: '经纪人 UCID',
    expression: 'brokerList[0].ucid',
    valueKind: 'expression',
    confidence: 'low'
  }])
  const result = applyToEvent(event, memory)
  assert.equal(result.changed, true)
  const param = result.event.parameters[0]
  assert.equal(param.expression, 'window.__user.id')
  assert.equal(param.fromMemory, true)
  assert.equal(param.fromEvtId, '96793')
  assert.equal(param.memoryDescMatched, true)
  assert.equal(param.confidence, 'medium')
  assert.equal(param.memoryReplaced.expression, 'brokerList[0].ucid')
  assert.equal(param.memoryReplaced.confidence, 'low')
})

test('same key but different description does not backfill', () => {
  const memory = memoryWith('96793', 'ucid', 'window.__user.id', '经纪人 UCID')
  const event = locatedEvent([{
    key: 'ucid',
    docDesc: '店长 UCID',
    expression: 'shop.leaderUcid',
    valueKind: 'expression',
    confidence: 'low'
  }])
  const result = applyToEvent(event, memory)
  assert.equal(result.changed, false)
  assert.equal(result.event.parameters[0].expression, 'shop.leaderUcid')
  assert.equal(result.event.parameters[0].fromMemory, undefined)
})

test('missing description on either side does not backfill', () => {
  const withDesc = memoryWith('96793', 'houseCode', 'api.houseCode', '小区 ID')
  const noDescEvent = locatedEvent([{ key: 'houseCode', docDesc: '', expression: '', valueKind: 'expression' }])
  assert.equal(applyToEvent(noDescEvent, withDesc).changed, false)

  const noDescMemory = memoryWith('96793', 'houseCode', 'api.houseCode', '')
  const withDescEvent = locatedEvent([{ key: 'houseCode', docDesc: '小区 ID', expression: '', valueKind: 'expression' }])
  assert.equal(applyToEvent(withDescEvent, noDescMemory).changed, false)
})

test('legacy memory without descKey only fills empty expression', () => {
  const legacy = { parameters: { houseCode: { expression: 'api.houseCode', sourcePath: 'api' } }, docDescIndex: {} }
  const emptyHint = locatedEvent([{ key: 'houseCode', expression: '', valueKind: 'expression' }])
  const filled = applyToEvent(emptyHint, legacy)
  assert.equal(filled.changed, true)
  assert.equal(filled.event.parameters[0].memoryDescMatched, false)

  const hasCandidate = locatedEvent([{
    key: 'houseCode',
    expression: 'props.houseCode',
    valueKind: 'expression',
    confidence: 'low'
  }])
  assert.equal(applyToEvent(hasCandidate, legacy).changed, false)
})

test('high confidence and human confirmed params are not overwritten', () => {
  const memory = memoryWith('96793', 'houseCode', 'api.houseCode', '小区 ID')
  const high = locatedEvent([{
    key: 'houseCode',
    docDesc: '小区 ID',
    expression: 'props.houseCode',
    valueKind: 'expression',
    confidence: 'high'
  }])
  assert.equal(applyToEvent(high, memory).changed, false)

  const confirmed = locatedEvent([{
    key: 'houseCode',
    docDesc: '小区 ID',
    expression: 'props.houseCode',
    valueKind: 'expression',
    confidence: 'low',
    confirmation: { status: 'confirmed', source: 'human' }
  }])
  assert.equal(applyToEvent(confirmed, memory).changed, false)
})

test('docDesc is resolved from events.json when impl.json omits it', () => {
  const docDescIndex = buildDocDescIndex({
    events: [
      { evtId: '96793', params: [{ key: 'houseCode', desc: '小区 ID' }] },
      { evtId: '96794', params: [{ key: 'houseCode', desc: '小区 ID' }] }
    ]
  })
  const memory = upsertFromConfirmedEvent({ parameters: {}, docDescIndex }, {
    evtId: '96794',
    confirmed: true,
    parameters: [{ key: 'houseCode', expression: 'api.houseCode', valueKind: 'expression' }]
  })
  const event = locatedEvent([{ key: 'houseCode', expression: '', valueKind: 'expression' }])
  const result = applyToEvent(event, Object.assign({}, memory, { docDescIndex }))
  assert.equal(result.changed, true)
  assert.equal(result.event.parameters[0].docDesc, '小区 ID')
  assert.equal(result.event.parameters[0].memoryDescMatched, true)
})

test('loadMergedMemory reads docDesc index from events path', () => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'field-memory-'))
  const eventsPath = path.join(dir, 'events.json')
  fs.writeFileSync(eventsPath, JSON.stringify({
    events: [{ evtId: '96793', params: [{ key: 'houseCode', desc: '小区 ID' }] }]
  }))
  const merged = loadMergedMemory({ eventsPath, fieldMemoryPath: path.join(dir, 'field-memory.json') }, {
    events: [{
      evtId: '96793',
      confirmed: true,
      parameters: [{ key: 'houseCode', expression: 'api.houseCode', valueKind: 'expression' }]
    }]
  })
  const stored = merged.parameters[Object.keys(merged.parameters)[0]]
  assert.equal(stored.docDesc, '小区 ID')
  assert.equal(stored.descKey, normalizeDesc('小区 ID'))
  fs.rmSync(dir, { recursive: true, force: true })
})
