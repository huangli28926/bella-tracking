const assert = require('assert')
const fs = require('fs')
const path = require('path')
const test = require('node:test')
const {
  PARAMETER_EVIDENCE_TYPES,
  STRONG_EVIDENCE_TYPES,
  SUPPORTING_EVIDENCE_TYPES,
  calculateParameterConfidence,
  isLegacyParameter
} = require('./calculate-confidence')
const { normalizeImpl } = require('./normalize-impl')
const { validateImpl } = require('./validate-impl')

const EVENTS = { events: [{ evtId: '1001' }] }

function baseHighFacts() {
  return {
    key: 'house_id',
    expression: 'houseInfo.id',
    sourcePath: 'api.house.id -> props.houseInfo -> handleClick',
    evidence: [{ type: 'same-component-tracking' }],
    scopeReachable: true,
    unresolved: [],
    conflicts: []
  }
}

test('case 1 complete facts → high', () => {
  assert.equal(calculateParameterConfidence(baseHighFacts()), 'high')
})

test('case 2 agent-written high without evidence is not high', () => {
  const confidence = calculateParameterConfidence({
    key: 'house_id',
    expression: 'houseInfo.id',
    sourcePath: 'props.houseInfo',
    evidence: [],
    scopeReachable: true,
    confidence: 'high',
    unresolved: [],
    conflicts: []
  })
  assert.notEqual(confidence, 'high')
  assert.equal(confidence, 'low')
})

test('case 3 scopeReachable=false → low', () => {
  assert.equal(calculateParameterConfidence({
    ...baseHighFacts(),
    scopeReachable: false
  }), 'low')
})

test('case 4 scopeReachable=null is not high', () => {
  const confidence = calculateParameterConfidence({
    ...baseHighFacts(),
    scopeReachable: null
  })
  assert.notEqual(confidence, 'high')
  assert.equal(confidence, 'medium')
})

test('case 5 field-memory only → medium', () => {
  const confidence = calculateParameterConfidence({
    ...baseHighFacts(),
    evidence: [{ type: 'field-memory' }]
  })
  assert.equal(confidence, 'medium')
  assert.notEqual(confidence, 'high')
})

test('case 6 repository-convention only → medium', () => {
  const confidence = calculateParameterConfidence({
    ...baseHighFacts(),
    evidence: [{ type: 'repository-convention' }]
  })
  assert.equal(confidence, 'medium')
  assert.notEqual(confidence, 'high')
})

test('case 7 conflicts block high', () => {
  const confidence = calculateParameterConfidence({
    ...baseHighFacts(),
    conflicts: ['houseInfo.id vs property.id']
  })
  assert.notEqual(confidence, 'high')
  assert.equal(confidence, 'low')
})

test('case 8 unresolved blocks high via param.unresolved', () => {
  const confidence = calculateParameterConfidence({
    ...baseHighFacts(),
    unresolved: ['请确认参数 house_id 的取值']
  })
  assert.notEqual(confidence, 'high')
  assert.equal(confidence, 'medium')
})

test('case 8b unresolved blocks high via eventContext', () => {
  const param = { ...baseHighFacts() }
  delete param.unresolved
  const confidence = calculateParameterConfidence(param, {
    unresolved: ['请确认参数 house_id 的取值']
  })
  assert.notEqual(confidence, 'high')
  assert.equal(confidence, 'medium')
})

test('case 9 expression=null → low', () => {
  assert.equal(calculateParameterConfidence({
    ...baseHighFacts(),
    expression: null
  }), 'low')
})

test('case 10 manual-confirm + scopeReachable=true → high', () => {
  assert.equal(calculateParameterConfidence({
    ...baseHighFacts(),
    evidence: [{ type: 'manual-confirm' }]
  }), 'high')
})

test('case 11 manual-confirm cannot bypass scopeReachable=false', () => {
  assert.equal(calculateParameterConfidence({
    ...baseHighFacts(),
    evidence: [{ type: 'manual-confirm' }],
    scopeReachable: false
  }), 'low')
})

test('case 12 stored confidence does not affect result', () => {
  const facts = {
    expression: 'houseInfo.id',
    sourcePath: 'api.house.id -> props.houseInfo -> handleClick',
    evidence: [{ type: 'jsx-binding' }],
    scopeReachable: true,
    unresolved: [],
    conflicts: []
  }
  const results = ['high', 'medium', 'low', undefined].map(confidence => {
    return calculateParameterConfidence({ ...facts, confidence })
  })
  assert.deepEqual(results, ['high', 'high', 'high', 'high'])
})

test('cross-agent determinism: same facts, different stored confidence', () => {
  const facts = baseHighFacts()
  const a = calculateParameterConfidence({ ...facts, confidence: 'high' })
  const b = calculateParameterConfidence({ ...facts, confidence: 'medium' })
  const c = calculateParameterConfidence({ ...facts, confidence: 'low' })
  const d = calculateParameterConfidence({ ...facts })
  assert.equal(a, b)
  assert.equal(b, c)
  assert.equal(c, d)
})

test('conflicts + manual-confirm stay medium, not high', () => {
  assert.equal(calculateParameterConfidence({
    ...baseHighFacts(),
    evidence: [{ type: 'manual-confirm' }],
    conflicts: ['still conflicting']
  }), 'medium')
})

test('legacy params keep stored confidence after normalize', () => {
  const raw = {
    key: 'house_id',
    expression: 'houseInfo.id',
    sourcePath: '',
    confidence: 'high'
  }
  assert.equal(isLegacyParameter(raw), true)
  const after = normalizeImpl({
    events: [{
      evtId: '1001',
      status: 'pending',
      parameters: [raw]
    }]
  })
  const param = after.events[0].parameters[0]
  assert.equal(param.confidence, 'high')
  assert.equal(param.legacyUnverified, true)
  assert.equal(isLegacyParameter(param), false)
})

test('legacyUnverified does not make a structured parameter legacy', () => {
  assert.equal(isLegacyParameter({
    key: 'house_id',
    evidence: [],
    scopeReachable: null,
    conflicts: [],
    legacyUnverified: true
  }), false)
})

test('city_id unresolved does not block house_id high', () => {
  const after = normalizeImpl({
    events: [{
      evtId: '1001',
      status: 'located',
      targetFile: 'src/pages/house.js',
      unresolved: ['请确认参数 city_id 的取值'],
      parameters: [
        baseHighFacts(),
        {
          key: 'city_id',
          expression: '',
          sourcePath: '',
          evidence: [],
          scopeReachable: null,
          conflicts: []
        }
      ]
    }]
  })
  const house = after.events[0].parameters.find(p => p.key === 'house_id')
  assert.equal(house.confidence, 'high')
})

test('object-form PARAM_VALUE_UNCONFIRMED affects matching param in same normalize', () => {
  const paramFacts = { ...baseHighFacts() }
  delete paramFacts.unresolved
  const after = normalizeImpl({
    events: [{
      evtId: '1001',
      status: 'located',
      targetFile: 'src/pages/house.js',
      unresolved: [{ reasonCode: 'PARAM_VALUE_UNCONFIRMED', field: 'house_id' }],
      parameters: [paramFacts]
    }]
  })
  const param = after.events[0].parameters[0]
  assert.equal(param.confidence, 'medium')
  assert.ok(after.events[0].unresolved.includes('请确认参数 house_id 的取值'))
})

test('structured empty facts overwrite agent high', () => {
  const after = normalizeImpl({
    events: [{
      evtId: '1001',
      status: 'pending',
      parameters: [{
        key: 'house_id',
        expression: 'houseInfo.id',
        sourcePath: '',
        evidence: [],
        scopeReachable: null,
        confidence: 'high',
        unresolved: [],
        conflicts: []
      }]
    }]
  })
  const param = after.events[0].parameters[0]
  assert.equal(param.confidence, 'low')
  assert.equal(param.legacyUnverified, undefined)
})

test('validate errors when structured stored confidence mismatches derived', () => {
  const issues = validateImpl({
    events: [{
      evtId: '1001',
      status: 'pending',
      parameters: [{
        key: 'house_id',
        expression: 'houseInfo.id',
        sourcePath: 'props.houseInfo',
        evidence: [{ type: 'same-component-tracking' }],
        scopeReachable: true,
        confidence: 'medium',
        conflicts: []
      }]
    }]
  }, EVENTS, null).filter(item => item.severity === 'error')
  assert.ok(issues.some(item => /confidence must be derived/.test(item.message)))
})

test('schema evidence enum matches JS constants', () => {
  const schemaPath = path.join(__dirname, '../../schemas/impl.schema.json')
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
  const schemaTypes = schema.$defs.parameterEvidence.properties.type.enum
  assert.deepEqual(schemaTypes, PARAMETER_EVIDENCE_TYPES)
  const classified = [...STRONG_EVIDENCE_TYPES, ...SUPPORTING_EVIDENCE_TYPES].sort()
  assert.deepEqual([...classified].sort(), [...PARAMETER_EVIDENCE_TYPES].sort())
})
