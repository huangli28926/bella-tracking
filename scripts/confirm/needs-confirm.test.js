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
