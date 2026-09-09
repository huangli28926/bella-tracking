const assert = require('assert')
const test = require('node:test')
const { buildConfirmQueue, isConfirmQueuePending } = require('./needs-confirm')

test('confirmed event stays in queue while parameter gate needs confirm', () => {
  const event = {
    evtId: '96791',
    confirmed: true,
    status: 'located',
    targetFile: 'src/pages/a.tsx',
    parameters: [{
      key: 'housedel_id',
      expression: 'house.id',
      sourcePath: 'api.house.id -> house.id',
      evidence: [{ type: 'field-memory' }],
      scopeReachable: true,
      confidence: 'medium',
      unresolved: [],
      conflicts: []
    }]
  }
  const queue = buildConfirmQueue(
    { events: [{ evtId: '96791', eventName: 'x', docIndex: 1 }] },
    { events: [event] }
  )
  assert.equal(queue.pendingCount, 1)
  assert.equal(isConfirmQueuePending(queue.queue[0]), true)
  assert.ok(queue.queue[0].reasons.some(item => item.indexOf('housedel_id') !== -1))
})

test('deferred needsConfirm is not pending', () => {
  const event = {
    evtId: '1',
    confirmed: false,
    deferred: true,
    status: 'pending',
    parameters: []
  }
  const queue = buildConfirmQueue(
    { events: [{ evtId: '1', eventName: 'x', docIndex: 1 }] },
    { events: [event] }
  )
  assert.equal(queue.pendingCount, 0)
})

test('unanalyzed pending stub is not confirmable', () => {
  const queue = buildConfirmQueue(
    {
      events: [
        { evtId: '96791', eventName: 'a', docIndex: 1 },
        { evtId: '96792', eventName: 'b', docIndex: 2 }
      ]
    },
    {
      events: [
        {
          evtId: '96791',
          confirmed: true,
          status: 'located',
          targetFile: 'src/a.jsx',
          parameters: []
        },
        {
          evtId: '96792',
          confirmed: false,
          status: 'pending',
          targetFile: '',
          parameters: [{ key: 'city_id', expression: 'from-memory' }]
        }
      ]
    }
  )
  assert.equal(queue.pendingCount, 0)
  assert.equal(queue.unanalyzedCount, 1)
  assert.equal(queue.waitingForAnalysis, true)
  assert.equal(queue.done, false)
  assert.equal(queue.queue.length, 0)
})

test('analyzed next event stays in confirm queue', () => {
  const queue = buildConfirmQueue(
    {
      events: [
        { evtId: '96791', eventName: 'a', docIndex: 1 },
        { evtId: '96792', eventName: 'b', docIndex: 2 }
      ]
    },
    {
      events: [
        {
          evtId: '96791',
          confirmed: true,
          status: 'located',
          targetFile: 'src/a.jsx',
          parameters: []
        },
        {
          evtId: '96792',
          confirmed: false,
          status: 'located',
          targetFile: 'src/b.jsx',
          unresolved: ['请确认参数 is_agent 的取值'],
          parameters: [{
            key: 'is_agent',
            expression: 'canEdit',
            confidence: 'medium',
            evidence: [{ type: 'local-binding' }],
            scopeReachable: true,
            unresolved: [],
            conflicts: []
          }]
        }
      ]
    }
  )
  assert.equal(queue.pendingCount, 1)
  assert.equal(queue.queue[0].evtId, '96792')
  assert.equal(queue.waitingForAnalysis, false)
})
