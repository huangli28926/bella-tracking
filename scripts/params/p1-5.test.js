const assert = require('assert')
const test = require('node:test')
const { materializeParameter } = require('./normalize-parameter-facts')
const { scanExistingTracking } = require('./scan-existing-tracking')
const { validateParameter } = require('../accept/validate-parameter')
const { mapUnresolvedCodes } = require('./map-unresolved-ui')

function gate(parameter, event, context) {
  const next = materializeParameter(Object.assign({}, parameter), event || {}, context || {})
  const result = validateParameter(next, event || {})
  return { param: next, result }
}

const HOUSE_SRC = `
function HouseCard({ houseInfo }) {
  function handleClick() {
    track({ house_id: houseInfo.id })
  }
}
`

const PARENT_SRC = `
function HousePage() {
  const houseInfo = data.house
  return <HouseCard houseInfo={houseInfo} />
}
`

function baseParam(overrides) {
  return Object.assign({
    key: 'house_id',
    description: '房源ID',
    expression: 'houseInfo.id',
    sourcePath: ['API.response.house.id', 'HouseCard.houseInfo.id'],
    evidence: [{ type: 'same-component-tracking', file: 'HouseCard.tsx', parameterKey: 'house_id', expression: 'houseInfo.id' }],
    scopeReachable: null,
    unresolved: [],
    conflicts: []
  }, overrides)
}

test('case 1 same-component reachable → READY', () => {
  const scanned = scanExistingTracking({
    key: 'house_id',
    files: [{ file: 'HouseCard.tsx', band: 1, component: 'HouseCard' }],
    fileContents: { 'HouseCard.tsx': HOUSE_SRC }
  })
  const { param, result } = gate(baseParam(), {
    targetFile: 'HouseCard.tsx',
    functionName: 'handleClick'
  }, {
    scanned,
    computeReachability: true,
    fileContents: { 'HouseCard.tsx': HOUSE_SRC }
  })
  assert.equal(param.scopeReachable, true)
  assert.deepEqual(param.acquisition.steps, [])
  assert.equal(param.confidence, 'high')
  assert.equal(result.status, 'READY')
})

test('case 2 same-page reachable → READY', () => {
  const scanned = [{
    id: 'p2', band: 2, parameterKey: 'house_id', expression: 'houseInfo.id',
    file: 'Page.tsx', origin: 'scan', semanticCompatible: true
  }]
  const { result } = gate(baseParam({
    evidence: [{ type: 'same-page-tracking', file: 'Page.tsx', parameterKey: 'house_id', expression: 'houseInfo.id' }]
  }), { targetFile: 'HouseCard.tsx', functionName: 'handleClick', pageKey: 'house-detail' }, {
    scanned,
    computeReachability: true,
    fileContents: { 'HouseCard.tsx': HOUSE_SRC }
  })
  assert.equal(result.status, 'READY')
})

test('case 3 single-hop prop-pass referenceCount=1 → READY', () => {
  const { param, result } = gate(baseParam({
    expression: 'houseId',
    sourcePath: ['HousePage.houseInfo.id', 'HouseCard.props.houseId'],
    evidence: [
      { type: 'prop-chain', file: 'HousePage.tsx' },
      { type: 'component-reference', file: 'HousePage.tsx' }
    ],
    acquisition: {
      steps: [{
        kind: 'prop-pass',
        from: { file: 'HousePage.tsx', component: 'HousePage', expression: 'houseInfo.id' },
        to: { file: 'HouseCard.tsx', component: 'HouseCard', binding: 'houseId' }
      }]
    }
  }), { targetFile: 'HouseCard.tsx', functionName: 'handleClick' }, {
    computeReachability: true,
    fileContents: {
      'HouseCard.tsx': 'function HouseCard({ x }) { function handleClick() {} }',
      'HousePage.tsx': PARENT_SRC
    },
    componentReferences: { HouseCard: 1 }
  })
  assert.equal(param.scopeReachable, false)
  assert.equal(param.acquisition.status, 'RESOLVED')
  assert.equal(param.confidence, 'high')
  assert.equal(result.status, 'READY')
})

test('case 4 multi-hop all referenceCount=1 → READY', () => {
  const { result } = gate(baseParam({
    expression: 'houseId',
    sourcePath: ['Page.houseInfo.id', 'List.houseId', 'HouseCard.props.houseId'],
    evidence: [{ type: 'prop-chain', file: 'Page.tsx' }, { type: 'component-reference', file: 'Page.tsx' }],
    acquisition: {
      steps: [
        {
          kind: 'prop-pass',
          from: { file: 'Page.tsx', component: 'Page', expression: 'houseInfo.id' },
          to: { file: 'List.tsx', component: 'List', binding: 'houseId' }
        },
        {
          kind: 'prop-pass',
          from: { file: 'List.tsx', component: 'List', expression: 'houseId' },
          to: { file: 'HouseCard.tsx', component: 'HouseCard', binding: 'houseId' }
        }
      ]
    }
  }), { targetFile: 'HouseCard.tsx' }, {
    computeReachability: true,
    fileContents: {
      'HouseCard.tsx': 'function HouseCard(){ function handleClick(){} }',
      'Page.tsx': 'function Page(){ const houseInfo = data; return <List /> }',
      'List.tsx': 'function List({ houseId }){ return <HouseCard /> }'
    },
    componentReferences: { List: 1, HouseCard: 1 }
  })
  assert.equal(result.status, 'READY')
})

test('case 4b middle referenceCount>1 → NEEDS_CONFIRM', () => {
  const { param, result } = gate(baseParam({
    expression: 'houseId',
    sourcePath: ['Page.houseInfo.id', 'List.houseId', 'HouseCard.props.houseId'],
    evidence: [{ type: 'prop-chain', file: 'Page.tsx' }],
    acquisition: {
      steps: [
        {
          kind: 'prop-pass',
          from: { file: 'Page.tsx', component: 'Page', expression: 'houseInfo.id' },
          to: { file: 'List.tsx', component: 'List', binding: 'houseId' }
        },
        {
          kind: 'prop-pass',
          from: { file: 'List.tsx', component: 'List', expression: 'houseId' },
          to: { file: 'HouseCard.tsx', component: 'HouseCard', binding: 'houseId' }
        }
      ]
    }
  }), { targetFile: 'HouseCard.tsx' }, {
    computeReachability: true,
    fileContents: {
      'HouseCard.tsx': 'function HouseCard(){}',
      'Page.tsx': 'function Page(){ const houseInfo = data; return <List /> }',
      'List.tsx': 'function List({ houseId }){ return <HouseCard /> }'
    },
    componentReferences: { List: 8, HouseCard: 1 }
  })
  assert.ok(param.unresolvedCodes.includes('SHARED_COMPONENT_IMPACT'))
  assert.notEqual(result.status, 'READY')
})

test('case 5 hook provider closed → READY', () => {
  const { result } = gate(baseParam({
    expression: 'cityInfo.id',
    sourcePath: ['useCity().id', 'cityInfo.id'],
    evidence: [{ type: 'hook-chain', file: 'useCity.ts', expression: 'useCity' }],
    acquisition: {
      steps: [{
        kind: 'hook-call',
        from: { file: 'useCity.ts', expression: 'useCity' },
        to: { file: 'HouseCard.tsx', binding: 'cityInfo' },
        providerVerified: true
      }]
    }
  }), { targetFile: 'HouseCard.tsx' }, {
    computeReachability: true,
    fileContents: {
      'HouseCard.tsx': 'function HouseCard(){}',
      'useCity.ts': 'export function useCity() { return cityInfo }'
    },
    providerVerified: true
  })
  assert.equal(result.status, 'READY')
})

test('case 6 hook without provider → NEEDS_CONFIRM', () => {
  const { result } = gate(baseParam({
    expression: 'cityInfo.id',
    sourcePath: ['useCity().id'],
    evidence: [{ type: 'hook-chain', file: 'useCity.ts', expression: 'useCity' }],
    acquisition: {
      steps: [{
        kind: 'hook-call',
        from: { file: 'useCity.ts', expression: 'useCity' },
        to: { file: 'HouseCard.tsx', binding: 'cityInfo' }
      }]
    }
  }), { targetFile: 'HouseCard.tsx' }, {
    computeReachability: true,
    fileContents: {
      'HouseCard.tsx': 'function HouseCard(){}',
      'useCity.ts': 'export function useCity() { return cityInfo }'
    }
  })
  assert.equal(result.status, 'NEEDS_CONFIRM')
})

test('case 7 url field with strong evidence → READY', () => {
  const { result } = gate(baseParam({
    expression: 'housedelCode',
    sourcePath: ['URL.query.housedelCode'],
    evidence: [{ type: 'url-field', expression: 'housedelCode' }],
    acquisition: {
      steps: [{
        kind: 'url-read',
        from: { queryKey: 'housedelCode', expression: 'housedelCode' },
        to: { binding: 'housedelCode' },
        urlFieldExists: true
      }]
    }
  }), { targetFile: 'HouseCard.tsx' }, {
    computeReachability: true,
    fileContents: { 'HouseCard.tsx': 'function HouseCard(){}' },
    urlFieldExists: true
  })
  assert.equal(result.status, 'READY')
})

test('case 8 url name similarity only → NEEDS_CONFIRM', () => {
  const { param, result } = gate(baseParam({
    expression: 'id',
    sourcePath: ['URL.query.hid'],
    evidence: [{ type: 'variable-name-similarity' }],
    unresolvedCodes: ['URL_SEMANTIC_UNKNOWN']
  }), {}, {})
  assert.notEqual(param.confidence, 'high')
  assert.equal(result.status, 'NEEDS_CONFIRM')
})

test('case 9 semantic incompatible stays in pool', () => {
  const scanned = [
    { id: 'a', band: 1, expression: 'agent.id', file: 'A.tsx', origin: 'scan' }
  ]
  const { param } = gate(baseParam({
    candidates: [{
      id: 'a', band: 1, expression: 'agent.id', file: 'A.tsx',
      semanticCompatible: false, rejectedReason: 'semantic-incompatible'
    }]
  }), {}, { scanned })
  assert.equal(param.candidates.length, 1)
  assert.equal(param.sourceUniqueness, 'unknown')
})

test('case 10 same-band two sources → CONFLICT', () => {
  const scanned = [
    { id: 'a', band: 2, expression: 'houseInfo.id', file: 'A.tsx', origin: 'scan', semanticCompatible: true },
    { id: 'b', band: 2, expression: 'detail.id', file: 'B.tsx', origin: 'scan', semanticCompatible: true }
  ]
  const { param, result } = gate(baseParam({
    preferredCandidateId: 'a',
    candidates: scanned
  }), {}, { scanned })
  assert.equal(param.sourceUniqueness, 'multiple')
  assert.ok(param.conflicts.includes('multiple-valid-parameter-sources'))
  assert.equal(result.status, 'NEEDS_CONFIRM')
})

test('case 10b higher band unique wins', () => {
  const scanned = [
    { id: 'z', band: 1, expression: 'houseInfo.id', file: 'HouseCard.tsx', origin: 'scan', semanticCompatible: true },
    { id: 'p', band: 2, expression: 'detail.id', file: 'Page.tsx', origin: 'scan', semanticCompatible: true }
  ]
  const { param, result } = gate(baseParam(), {
    targetFile: 'HouseCard.tsx',
    functionName: 'handleClick'
  }, {
    scanned,
    computeReachability: true,
    fileContents: { 'HouseCard.tsx': HOUSE_SRC }
  })
  assert.equal(param.selectedBand, 1)
  assert.equal(param.sourceUniqueness, 'unique')
  assert.equal(result.status, 'READY')
})

test('case 11 local transform reachable → READY', () => {
  const { param, result } = gate(baseParam({
    expression: 'house.status === 1 ? 1 : 0',
    sourcePath: ['house.status'],
    evidence: [{ type: 'local-binding', file: 'HouseCard.tsx', expression: 'house.status' }],
    transform: { kind: 'enum', evidence: [{ type: 'local-binding', file: 'HouseCard.tsx', expression: 'house.status' }] }
  }), { targetFile: 'HouseCard.tsx', functionName: 'handleClick' }, {
    computeReachability: true,
    fileContents: {
      'HouseCard.tsx': 'function HouseCard({ house }) { function handleClick() { return house.status } }'
    }
  })
  assert.equal(param.scopeReachable, true)
  assert.deepEqual(param.acquisition.steps, [])
  assert.equal(result.status, 'READY')
})

test('case 12 shared component → NEEDS_CONFIRM', () => {
  const { param, result } = gate(baseParam({
    expression: 'houseId',
    sourcePath: ['Page.houseInfo.id', 'HouseCard.props.houseId'],
    evidence: [{ type: 'prop-chain', file: 'Page.tsx' }],
    acquisition: {
      steps: [{
        kind: 'prop-pass',
        from: { file: 'Page.tsx', component: 'Page', expression: 'houseInfo.id' },
        to: { file: 'HouseCard.tsx', component: 'HouseCard', binding: 'houseId' }
      }]
    }
  }), { targetFile: 'HouseCard.tsx' }, {
    computeReachability: true,
    fileContents: {
      'HouseCard.tsx': 'function HouseCard(){}',
      'Page.tsx': 'function Page(){ const houseInfo = data; return <HouseCard /> }'
    },
    componentReferences: { HouseCard: 10 }
  })
  assert.equal(param.acquisition.impact.scope, 'shared-component')
  assert.equal(result.status, 'NEEDS_CONFIRM')
})

test('case 13 variable-name-similarity cannot high', () => {
  const { param } = gate(baseParam({
    evidence: [{ type: 'variable-name-similarity' }]
  }), { targetFile: 'HouseCard.tsx' }, {
    computeReachability: true,
    fileContents: { 'HouseCard.tsx': HOUSE_SRC }
  })
  assert.notEqual(param.confidence, 'high')
})

test('case 14 new API → NEEDS_CONFIRM', () => {
  const { param, result } = gate(baseParam({
    unresolvedCodes: ['NEW_DATA_SOURCE_REQUIRED']
  }), {}, {})
  assert.equal(param.confidence, 'low')
  assert.equal(result.status, 'NEEDS_CONFIRM')
})

test('case 15 missing static reference → NEEDS_CONFIRM', () => {
  const { param, result } = gate(baseParam({
    expression: 'houseId',
    sourcePath: ['Page.houseInfo.id', 'HouseCard.props.houseId'],
    evidence: [{ type: 'prop-chain', file: 'Page.tsx' }],
    acquisition: {
      steps: [{
        kind: 'prop-pass',
        from: { file: 'Page.tsx', component: 'Page', expression: 'houseInfo.id' },
        to: { file: 'HouseCard.tsx', component: 'HouseCard', binding: 'houseId' }
      }]
    }
  }), { targetFile: 'HouseCard.tsx' }, {
    computeReachability: true,
    fileContents: {
      'HouseCard.tsx': 'function HouseCard(){}',
      'Page.tsx': 'function Page(){ return <div /> }'
    }
  })
  assert.notEqual(param.acquisition.status, 'RESOLVED')
  assert.equal(result.status, 'NEEDS_CONFIRM')
})

test('case 16 unreachable without acquisition → NEEDS_CONFIRM', () => {
  const { result } = gate(baseParam({
    expression: 'missing.id'
  }), { targetFile: 'HouseCard.tsx', functionName: 'handleClick' }, {
    computeReachability: true,
    fileContents: { 'HouseCard.tsx': HOUSE_SRC }
  })
  assert.equal(result.status, 'NEEDS_CONFIRM')
})

test('case 17 AI scopeReachable/confidence overwritten', () => {
  const { param, result } = gate(baseParam({
    expression: 'missing.id',
    scopeReachable: true,
    confidence: 'high'
  }), { targetFile: 'HouseCard.tsx', functionName: 'handleClick' }, {
    computeReachability: true,
    fileContents: { 'HouseCard.tsx': HOUSE_SRC }
  })
  assert.equal(param.scopeReachable, false)
  assert.notEqual(result.status, 'READY')
})

test('case 18 dropped scan candidates → INVALID', () => {
  const scanned = [
    { id: '1', band: 1, expression: 'a.id', file: 'A.tsx', origin: 'scan' },
    { id: '2', band: 1, expression: 'b.id', file: 'B.tsx', origin: 'scan' },
    { id: '3', band: 1, expression: 'c.id', file: 'C.tsx', origin: 'scan' }
  ]
  const { result } = gate(baseParam({
    candidates: [{ id: '1', band: 1, expression: 'a.id', file: 'A.tsx' }]
  }), {}, { scanned })
  assert.equal(result.status, 'INVALID')
})

test('case 19 preferred cannot change selected unique band-1 source', () => {
  const scanned = [
    { id: 'z', band: 1, expression: 'houseInfo.id', file: 'HouseCard.tsx', origin: 'scan', semanticCompatible: true },
    { id: 'y', band: 2, expression: 'detail.id', file: 'Page.tsx', origin: 'scan', semanticCompatible: true }
  ]
  const a = gate(baseParam({ preferredCandidateId: 'y' }), {
    targetFile: 'HouseCard.tsx', functionName: 'handleClick'
  }, { scanned, computeReachability: true, fileContents: { 'HouseCard.tsx': HOUSE_SRC } })
  const b = gate(baseParam({ preferredCandidateId: 'z' }), {
    targetFile: 'HouseCard.tsx', functionName: 'handleClick'
  }, { scanned, computeReachability: true, fileContents: { 'HouseCard.tsx': HOUSE_SRC } })
  assert.equal(a.param.selectedBand, 1)
  assert.equal(b.param.selectedBand, 1)
  assert.equal(a.result.status, b.result.status)
  assert.equal(a.result.status, 'READY')
})

test('case 20 ui-object-match alone cannot high', () => {
  const { param } = gate(baseParam({
    evidence: [{ type: 'ui-object-match' }]
  }), { targetFile: 'HouseCard.tsx' }, {
    computeReachability: true,
    fileContents: { 'HouseCard.tsx': HOUSE_SRC }
  })
  assert.notEqual(param.confidence, 'high')
})

test('case 21 unresolved code maps to legacy phrase', () => {
  const phrases = mapUnresolvedCodes(['SHARED_COMPONENT_IMPACT'], 'house_id')
  assert.deepEqual(phrases, ['请确认参数 house_id 的取值'])
})

test('unique candidate prefills empty expression and keeps candidates', () => {
  const scanned = [
    { id: 'z', band: 1, expression: 'houseInfo.id', file: 'HouseCard.tsx', origin: 'scan', semanticCompatible: true }
  ]
  const { param } = gate(baseParam({
    expression: '',
    candidates: scanned
  }), {}, { scanned })
  assert.equal(param.expression, 'houseInfo.id')
  assert.equal(param.preferredCandidateId, 'z')
  assert.equal(param.candidates.length, 1)
})

test('tied same-band candidates do not invent preferred expression', () => {
  const scanned = [
    { id: 'a', band: 2, expression: 'houseInfo.id', file: 'A.tsx', origin: 'scan', semanticCompatible: true },
    { id: 'b', band: 2, expression: 'detail.id', file: 'B.tsx', origin: 'scan', semanticCompatible: true }
  ]
  const { param } = gate(baseParam({
    expression: '',
    candidates: scanned
  }), {}, { scanned })
  assert.equal(param.expression, '')
  assert.equal(param.candidates.length, 2)
  assert.equal(param.sourceUniqueness, 'multiple')
})
