const assert = require('assert')
const test = require('node:test')
const { calculateParameterConfidence } = require('./calculate-confidence')
const { collectImplGates, validateImpl } = require('./validate-impl')
const { validateParameter } = require('./validate-parameter')
const {
  applyConfirmationReuse,
  validateConfirmationReuse
} = require('./validate-confirmation-reuse')

function allPassChecks() {
  return {
    parameterIdentity: true,
    sourceIdentity: true,
    scopeReachable: true,
    targetCompatible: true,
    componentBoundaryCompatible: true,
    lifecycleCompatible: true,
    transformationCompatible: true,
    currentEvidencePresent: true
  }
}

function confirmedParam(overrides) {
  return Object.assign({
    key: 'house_id',
    expression: 'detail.houseCode',
    sourcePath: 'api.detail.houseCode -> detail.houseCode -> handleClick',
    evidence: [{ type: 'prop-chain' }],
    scopeReachable: true,
    confidence: 'high',
    unresolved: [],
    conflicts: [],
    confirmation: {
      status: 'confirmed',
      source: 'human',
      reuseScope: 'same-dataflow',
      confirmedAt: '2026-09-08T10:00:00+08:00',
      evidence: {
        parameterKey: 'house_id',
        sourceRoot: 'api.detail.houseCode',
        targetFile: 'src/pages/detail/index.tsx',
        targetSymbol: 'handleClick',
        componentBoundary: 'LocalCard'
      }
    }
  }, overrides)
}

function eventBase(overrides) {
  return Object.assign({
    evtId: '1001',
    targetFile: 'src/pages/detail/index.tsx',
    functionName: 'handleClick',
    lifecycle: 'onClick'
  }, overrides)
}

function fact(paramOverrides, eventOverrides) {
  return {
    event: eventBase(eventOverrides),
    parameter: confirmedParam(paramOverrides)
  }
}

function currentFrom(previous, paramOverrides, eventOverrides) {
  const prev = previous.parameter
  const confirmation = Object.assign({}, prev.confirmation, {
    evidence: Object.assign({}, prev.confirmation.evidence, (paramOverrides && paramOverrides.confirmation && paramOverrides.confirmation.evidence) || {})
  })
  delete confirmation.status
  const rest = Object.assign({}, paramOverrides)
  delete rest.confirmation
  return {
    event: eventBase(Object.assign({}, previous.event, eventOverrides)),
    parameter: Object.assign({}, prev, rest, {
      confirmation: Object.assign({ evidence: confirmation.evidence }, rest.confirmation || {})
    })
  }
}

test('case 1 exact unchanged → reused', () => {
  const previous = fact()
  const current = currentFrom(previous, { expression: 'detail.houseCode' })
  const result = validateConfirmationReuse(previous, current)
  assert.equal(result.status, 'reused')
  assert.equal(result.valid, true)
})

test('case 2 local variable rename → reused', () => {
  const previous = fact()
  const current = currentFrom(previous, {
    expression: 'houseCode',
    sourcePath: 'api.detail.houseCode -> houseCode -> handleClick'
  })
  const result = validateConfirmationReuse(previous, current)
  assert.equal(result.status, 'reused')
})

test('case 3 destructure refactor → reused', () => {
  const previous = fact()
  const current = currentFrom(previous, {
    expression: 'houseCode',
    sourcePath: 'api.detail.houseCode -> houseCode -> handleClick'
  })
  assert.equal(validateConfirmationReuse(previous, current).status, 'reused')
})

test('case 4 source changed → stale source_changed', () => {
  const previous = fact()
  const current = currentFrom(previous, {
    expression: 'router.query.houseCode',
    sourcePath: 'router.query.houseCode -> handleClick',
    confirmation: {
      evidence: { sourceRoot: 'router.query.houseCode' }
    }
  })
  const result = validateConfirmationReuse(previous, current)
  assert.equal(result.status, 'stale')
  assert.equal(result.invalidReason, 'source_changed')
})

test('case 5 source unreachable → stale source_unreachable', () => {
  const previous = fact()
  const current = currentFrom(previous, { scopeReachable: false })
  const result = validateConfirmationReuse(previous, current)
  assert.equal(result.status, 'stale')
  assert.equal(result.invalidReason, 'source_unreachable')
})

test('case 6 component boundary changed → stale', () => {
  const previous = fact()
  const current = currentFrom(previous, {
    confirmation: {
      evidence: { componentBoundary: 'SharedCard' }
    }
  })
  const result = validateConfirmationReuse(previous, current)
  assert.equal(result.status, 'stale')
  assert.equal(result.invalidReason, 'component_boundary_changed')
})

test('case 7 lifecycle changed → stale', () => {
  const previous = fact()
  const current = currentFrom(previous, {}, { lifecycle: 'IntersectionObserver' })
  const result = validateConfirmationReuse(previous, current)
  assert.equal(result.status, 'stale')
  assert.equal(result.invalidReason, 'lifecycle_changed')
})

test('case 8 transformation changed → stale', () => {
  const previous = fact({
    expression: 'houseCode || "-"',
    transform: { kind: 'fallback', evidence: [{ type: 'prop-chain' }] }
  })
  const current = currentFrom(previous, {
    expression: 'Number(houseCode)',
    transform: { kind: 'coerce-number', evidence: [{ type: 'prop-chain' }] }
  })
  const result = validateConfirmationReuse(previous, current)
  assert.equal(result.status, 'stale')
  assert.equal(result.invalidReason, 'transformation_changed')
})

test('case 9 unrelated file modification still reused (not whole-file hash)', () => {
  const previous = fact()
  const current = currentFrom(previous, {
    fileHash: 'changed-css-only'
  })
  const result = validateConfirmationReuse(previous, current)
  assert.equal(result.status, 'reused')
  assert.equal(result.checks.parameterIdentity, true)
})

test('case 10 stale confirmation does not force needsConfirm when current facts READY', () => {
  const previous = fact()
  const current = currentFrom(previous, {}, { targetFile: 'src/pages/other.tsx', functionName: 'onShow' })
  current.parameter.confirmation = applyConfirmationReuse(previous, {
    event: current.event,
    parameter: Object.assign({}, current.parameter, {
      confirmation: {
        evidence: { componentBoundary: 'SharedCard', targetFile: 'src/pages/other.tsx', targetSymbol: 'onShow' }
      }
    })
  })
  current.parameter.evidence = [{ type: 'same-component-tracking' }]
  current.parameter.scopeReachable = true
  current.parameter.confidence = 'high'
  const reuse = validateConfirmationReuse(previous, current)
  assert.equal(reuse.status, 'stale')
  const gate = validateParameter(current.parameter, current.event)
  assert.equal(gate.status, 'READY')
})

test('reuseScope none never reused', () => {
  const previous = fact({
    confirmation: Object.assign({}, confirmedParam().confirmation, { reuseScope: 'none' })
  })
  const current = currentFrom(previous)
  const result = validateConfirmationReuse(previous, current)
  assert.equal(result.status, 'stale')
  assert.equal(result.invalidReason, 'reuse_scope_none')
})

test('missing current evidence cannot reuse', () => {
  const previous = fact()
  const current = currentFrom(previous, { evidence: [] })
  const result = validateConfirmationReuse(previous, current)
  assert.equal(result.status, 'stale')
  assert.equal(result.invalidReason, 'evidence_missing')
})

test('stale manual-confirm is not strong evidence', () => {
  const confidence = calculateParameterConfidence({
    key: 'house_id',
    expression: 'detail.houseCode',
    sourcePath: 'api.detail.houseCode -> detail.houseCode',
    evidence: [{ type: 'manual-confirm' }],
    scopeReachable: true,
    unresolved: [],
    conflicts: [],
    confirmation: { status: 'stale', invalidReason: 'source_changed' }
  })
  assert.equal(confidence, 'medium')
})

test('validate-impl rejects reused without reuseChecks', () => {
  const impl = {
    events: [{
      evtId: '1001',
      parameters: [confirmedParam({
        confirmation: {
          status: 'reused',
          source: 'human',
          reuseScope: 'same-dataflow',
          evidence: {
            parameterKey: 'house_id',
            sourceRoot: 'api.detail.houseCode'
          }
        }
      })]
    }]
  }
  const issues = validateImpl(impl, { events: [{ evtId: '1001' }] }, { styles: [], sourceRoots: [] })
  assert.ok(issues.some(item => /PARAM_CONFIRMATION_REUSED_WITHOUT_EVIDENCE/.test(item.message)))
})

test('validate-impl accepts reused with program checks', () => {
  const impl = {
    events: [{
      evtId: '1001',
      parameters: [confirmedParam({
        confirmation: {
          status: 'reused',
          source: 'human',
          reuseScope: 'same-dataflow',
          evidence: {
            parameterKey: 'house_id',
            sourceRoot: 'api.detail.houseCode'
          },
          reuseChecks: allPassChecks()
        }
      })]
    }]
  }
  const issues = validateImpl(impl, { events: [{ evtId: '1001' }] }, { styles: [], sourceRoots: [] })
  const errors = issues.filter(item => item.severity === 'error')
  assert.equal(errors.length, 0)
  assert.equal(collectImplGates(impl)[0].status, 'READY')
})

test('applyConfirmationReuse writes reused checks', () => {
  const previous = fact()
  const current = currentFrom(previous)
  const confirmation = applyConfirmationReuse(previous, current)
  assert.equal(confirmation.status, 'reused')
  assert.equal(confirmation.reuseChecks.parameterIdentity, true)
  assert.equal(confirmation.invalidReason, null)
})
