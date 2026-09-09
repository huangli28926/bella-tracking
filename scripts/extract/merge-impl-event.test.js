const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mergeImplEvent } = require('./report')

test('save patch keeps candidates when UI only sends expression', () => {
  const existing = {
    evtId: '1',
    parameters: [{
      key: 'houseCode',
      expression: 'props.houseCode',
      candidates: [{ id: 'a', expression: 'props.houseCode' }, { id: 'b', expression: 'detail.id' }],
      preferredCandidateId: 'a',
      unresolvedCodes: ['SOURCE_CONFLICT']
    }]
  }
  const merged = mergeImplEvent(existing, {
    evtId: '1',
    parameters: [{
      key: 'houseCode',
      expression: 'detail.id',
      preferredCandidateId: 'b'
    }]
  })
  assert.equal(merged.parameters[0].expression, 'detail.id')
  assert.equal(merged.parameters[0].preferredCandidateId, 'b')
  assert.equal(merged.parameters[0].candidates.length, 2)
  assert.deepEqual(merged.parameters[0].unresolvedCodes, ['SOURCE_CONFLICT'])
})
