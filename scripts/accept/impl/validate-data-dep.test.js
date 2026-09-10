const assert = require('assert')
const fs = require('fs')
const path = require('path')
const test = require('node:test')
const { buildAcceptChain, buildTarget } = require('../chain/accept-chain')
const { collectImplGates, validateImpl } = require('./validate-impl')
const { normalizeImpl } = require('./normalize-impl')
const {
  DATADEP_UNRESOLVED_CODES,
  dataDepGate,
  validateDataDep
} = require('./validate-data-dep')
const { buildConfirmQueue, eventNeedsConfirm } = require('../../confirm/needs-confirm')
const { applyConfirmAction } = require('../../confirm/confirm-gate')

function highParam(overrides) {
  return Object.assign({
    key: 'housedel_id',
    expression: 'housedelCode || "-"',
    sourcePath: 'location.search -> housedelCode',
    evidence: [{ type: 'same-component-tracking' }],
    scopeReachable: true,
    confidence: 'high',
    unresolved: [],
    conflicts: []
  }, overrides)
}

function eventWith(dep, extra) {
  return Object.assign({
    evtId: '1001',
    status: 'located',
    targetFile: 'src/pages/house.js',
    pageKey: 'house-detail',
    parameters: [highParam(), highParam({ key: 'price' }), highParam({ key: 'ucid' }), highParam({ key: 'community_name' })],
    accept: {
      trigger: { kind: 'click', by: 'text', value: '估价' },
      dataDeps: dep ? [dep] : []
    }
  }, extra || {})
}

function readyUrlDep(overrides) {
  return Object.assign({
    paramKey: 'housedel_id',
    from: 'url',
    queryKey: 'housedelCode',
    expression: 'housedelCode || "-"',
    sourcePath: 'location.search -> housedelCode',
    status: 'resolved',
    unresolved: []
  }, overrides)
}

function readyApiDep(overrides) {
  return Object.assign({
    paramKey: 'price',
    from: 'api',
    api: { urlIncludes: '/api/detail', field: 'data.price' },
    status: 'resolved',
    unresolved: []
  }, overrides)
}

function codes(result) {
  return (result.issues || []).map(item => item.code)
}

test('case 1 legal URL → READY', () => {
  const result = validateDataDep(readyUrlDep(), eventWith(readyUrlDep()))
  assert.equal(result.status, 'READY')
})

test('case 2 URL missing queryKey + resolved → INVALID', () => {
  const dep = readyUrlDep({ queryKey: '' })
  delete dep.queryKey
  const result = validateDataDep(dep, eventWith(dep))
  assert.equal(result.status, 'INVALID')
  assert.ok(codes(result).includes('DATADEP_SELECTOR_INCOMPLETE'))
})

test('case 3 legal API → READY', () => {
  const result = validateDataDep(readyApiDep(), eventWith(readyApiDep()))
  assert.equal(result.status, 'READY')
})

test('case 4 API missing field + resolved → INVALID', () => {
  const dep = readyApiDep({ api: { urlIncludes: '/api/detail', field: '' } })
  const result = validateDataDep(dep, eventWith(dep))
  assert.equal(result.status, 'INVALID')
})

test('case 4b API missing field + needsConfirm → NEEDS_CONFIRM', () => {
  const dep = readyApiDep({
    api: { urlIncludes: '/api/detail', field: '' },
    status: 'needsConfirm',
    unresolved: ['MISSING_API_FIELD']
  })
  const result = validateDataDep(dep, eventWith(dep))
  assert.equal(result.status, 'NEEDS_CONFIRM')
})

test('case 5 unknown source does not fallback to page', () => {
  const event = eventWith(null)
  event.parameters = [highParam({
    key: 'mystery',
    expression: 'maybeFromSomewhere',
    sourcePath: 'unknown blob'
  })]
  event.accept.assertParams = ['mystery']
  const gate = dataDepGate(event)
  assert.equal(gate.status, 'READY')
  const target = buildTarget(event, { evtId: '1001', eventType: 'Module_Click' }, '/x')
  assert.ok(!target.error)
  assert.deepEqual(target.dataDeps, [])
  assert.ok(target.dataDeps.every(dep => dep.from !== 'page' || dep.status !== 'resolved'))
})

test('case 6 paramKey not in parameters → INVALID', () => {
  const dep = readyUrlDep({ paramKey: 'price_missing' })
  const result = validateDataDep(dep, eventWith(dep))
  assert.equal(result.status, 'INVALID')
  assert.ok(codes(result).includes('DATADEP_PARAM_IDENTITY'))
})

test('case 7 resolved + unresolved → INVALID', () => {
  const dep = readyUrlDep({ unresolved: ['MISSING_API_FIELD'] })
  const result = validateDataDep(dep, eventWith(dep))
  assert.equal(result.status, 'INVALID')
  assert.ok(codes(result).includes('DATADEP_STATUS_INCONSISTENT'))
})

test('case 8 needsConfirm without unresolved → INVALID', () => {
  const dep = readyUrlDep({ status: 'needsConfirm', unresolved: [] })
  const result = validateDataDep(dep, eventWith(dep))
  assert.equal(result.status, 'INVALID')
})

test('case 9 build-accept-chain does not infer from expression', () => {
  const impl = eventWith(null)
  impl.parameters = [highParam({
    expression: 'query.housedelCode',
    sourcePath: 'URL query'
  })]
  delete impl.accept.dataDeps
  const target = buildTarget(impl, { evtId: '1001', eventType: 'Module_Click' }, '/detail')
  assert.ok(!target.error)
  assert.deepEqual(target.dataDeps, [])
})

test('case 10 resolved DataDep is copied verbatim', () => {
  const dep = readyUrlDep()
  const impl = eventWith(dep)
  const target = buildTarget(impl, { evtId: '1001', eventType: 'Module_Click' }, '/detail')
  assert.ok(!target.error)
  assert.deepEqual(target.dataDeps[0], dep)
})

test('p2-1.1 case 1 user windowPath → READY', () => {
  const dep = {
    paramKey: 'ucid',
    from: 'user',
    user: { runtime: { kind: 'windowPath', path: '__user.id' } },
    status: 'resolved',
    unresolved: []
  }
  assert.equal(validateDataDep(dep, eventWith(dep)).status, 'READY')
  const target = buildTarget(eventWith(dep), { evtId: '1001', eventType: 'Module_Click' }, '/detail')
  assert.ok(!target.error)
  assert.deepEqual(target.dataDeps[0], dep)
})

test('user missing runtime + resolved → INVALID', () => {
  const dep = {
    paramKey: 'ucid',
    from: 'user',
    status: 'resolved',
    unresolved: []
  }
  const result = validateDataDep(dep, eventWith(dep))
  assert.equal(result.status, 'INVALID')
  assert.ok(codes(result).includes('DATADEP_SELECTOR_INCOMPLETE'))
})

test('p2-1.1 case 2 user legacy path only + resolved → INVALID', () => {
  const dep = {
    paramKey: 'ucid',
    from: 'user',
    user: { path: 'user.id' },
    status: 'resolved',
    unresolved: []
  }
  const result = validateDataDep(dep, eventWith(dep))
  assert.equal(result.status, 'INVALID')
  assert.ok(codes(result).includes('DATADEP_LEGACY_PATH'))
})

test('p2-1.1 legacy path + runtime together → INVALID', () => {
  const dep = {
    paramKey: 'ucid',
    from: 'user',
    user: {
      path: 'user.id',
      runtime: { kind: 'windowPath', path: '__user.id' }
    },
    status: 'resolved',
    unresolved: []
  }
  const result = validateDataDep(dep, eventWith(dep))
  assert.equal(result.status, 'INVALID')
  assert.ok(codes(result).includes('DATADEP_LEGACY_PATH'))
})

test('p2-1.1 case 3 page runtime selector missing → NEEDS_CONFIRM', () => {
  const dep = {
    paramKey: 'community_name',
    from: 'page',
    status: 'needsConfirm',
    unresolved: ['MISSING_PAGE_RUNTIME_SELECTOR']
  }
  assert.equal(validateDataDep(dep, eventWith(dep)).status, 'NEEDS_CONFIRM')
})

test('p2-1.1 case 4 unknown runtime kind → INVALID', () => {
  const dep = {
    paramKey: 'community_name',
    from: 'page',
    page: { runtime: { kind: 'reactState', path: 'community.name' } },
    status: 'needsConfirm',
    unresolved: ['UNSUPPORTED_RUNTIME_SELECTOR']
  }
  const result = validateDataDep(dep, eventWith(dep))
  assert.equal(result.status, 'INVALID')
  assert.ok(codes(result).includes('DATADEP_RUNTIME_SELECTOR_INVALID'))
})

test('p2-1.1 unsupported selector without illegal kind → NEEDS_CONFIRM', () => {
  const dep = {
    paramKey: 'ucid',
    from: 'user',
    status: 'needsConfirm',
    unresolved: ['UNSUPPORTED_RUNTIME_SELECTOR']
  }
  assert.equal(validateDataDep(dep, eventWith(dep)).status, 'NEEDS_CONFIRM')
})

test('p2-1.1 page windowPath resolved → READY', () => {
  const dep = {
    paramKey: 'community_name',
    from: 'page',
    page: { runtime: { kind: 'windowPath', path: '__PAGE_DATA__.community.name' } },
    status: 'resolved',
    unresolved: []
  }
  assert.equal(validateDataDep(dep, eventWith(dep)).status, 'READY')
})

test('p2-1.1 case 5 build-accept-chain does not infer runtime from expression', () => {
  const impl = eventWith(null)
  impl.parameters = [highParam({
    key: 'ucid',
    expression: 'window.__user.id',
    sourcePath: 'window.__user -> id'
  })]
  impl.accept.dataDeps = [{
    paramKey: 'ucid',
    from: 'user',
    status: 'needsConfirm',
    unresolved: ['MISSING_USER_RUNTIME_SELECTOR']
  }]
  const target = buildTarget(impl, { evtId: '1001', eventType: 'Module_Click' }, '/detail')
  assert.ok(target.error)
  assert.equal(target.error, 'accept.dataDeps needsConfirm')
  const pendingDep = impl.accept.dataDeps[0]
  assert.ok(!pendingDep.user || !pendingDep.user.runtime)
})

test('unknown unresolved code → INVALID', () => {
  const dep = readyUrlDep({
    status: 'needsConfirm',
    unresolved: ['missing queryKey']
  })
  assert.equal(validateDataDep(dep, eventWith(dep)).status, 'INVALID')
  assert.ok(codes(validateDataDep(dep, eventWith(dep))).includes('DATADEP_UNRESOLVED_CODE'))
})

test('missing status → INVALID', () => {
  const dep = readyUrlDep()
  delete dep.status
  assert.equal(validateDataDep(dep, eventWith(dep)).status, 'INVALID')
})

test('assertParams without dataDep is not NEEDS_CONFIRM', () => {
  const event = eventWith(null)
  event.accept.assertParams = ['housedel_id']
  assert.equal(dataDepGate(event).status, 'READY')
  const gates = collectImplGates({ events: [event] })
  assert.equal(gates[0].dataDepStatus, 'READY')
})

test('needsConfirm dataDep does not fail validate-impl errors', () => {
  const dep = {
    paramKey: 'housedel_id',
    from: 'url',
    status: 'needsConfirm',
    unresolved: ['MISSING_QUERY_KEY']
  }
  const event = eventWith(dep)
  const issues = validateImpl({ events: [event] }, { events: [{ evtId: '1001' }] }, null)
  assert.equal(issues.filter(item => item.severity === 'error').length, 0)
  assert.equal(collectImplGates({ events: [event] })[0].status, 'NEEDS_CONFIRM')
})

test('invalid dataDep fails validate-impl', () => {
  const dep = readyUrlDep()
  delete dep.queryKey
  const event = eventWith(dep)
  const issues = validateImpl({ events: [event] }, { events: [{ evtId: '1001' }] }, null)
  assert.ok(issues.some(item => item.severity === 'error' && /DATADEP_SELECTOR_INCOMPLETE/.test(item.message)))
})

test('normalize fills unresolved [] but does not invent status or from', () => {
  const after = normalizeImpl({
    events: [{
      evtId: '1001',
      parameters: [highParam()],
      accept: {
        dataDeps: [{
          paramKey: 'housedel_id',
          from: 'url',
          queryKey: 'housedelCode'
        }]
      }
    }]
  })
  const dep = after.events[0].accept.dataDeps[0]
  assert.deepEqual(dep.unresolved, [])
  assert.equal(dep.status, undefined)
  assert.equal(dep.from, 'url')
})

test('build-accept-chain gates INVALID and NEEDS_CONFIRM', () => {
  const invalid = eventWith(readyUrlDep({ queryKey: undefined }))
  delete invalid.accept.dataDeps[0].queryKey
  const confirm = eventWith({
    paramKey: 'housedel_id',
    from: 'url',
    status: 'needsConfirm',
    unresolved: ['MISSING_QUERY_KEY']
  })
  const eventsPayload = { events: [{ evtId: '1001', eventType: 'Module_Click' }] }
  const invalidChain = buildAcceptChain({ events: [invalid] }, eventsPayload, { seedUrl: '/x' })
  assert.equal(invalidChain.paths.length, 0)
  assert.ok(invalidChain.pending.some(item => item.reason === 'invalid accept.dataDeps'))
  const confirmChain = buildAcceptChain({ events: [confirm] }, eventsPayload, { seedUrl: '/x' })
  assert.equal(confirmChain.paths.length, 0)
  assert.ok(confirmChain.pending.some(item => item.reason === 'accept.dataDeps needsConfirm'))
})

test('event.confirmed does not bypass dataDep needsConfirm queue', () => {
  const event = eventWith({
    paramKey: 'housedel_id',
    from: 'url',
    status: 'needsConfirm',
    unresolved: ['MISSING_QUERY_KEY']
  })
  event.confirmed = true
  event.status = 'located'
  assert.equal(eventNeedsConfirm(event), true)
  const queue = buildConfirmQueue(
    { events: [{ evtId: '1001', eventName: 'x', docIndex: 1 }] },
    { events: [event] }
  )
  assert.equal(queue.pendingCount, 1)
  assert.equal(queue.queue[0].evtId, '1001')
})

test('confirm-gate does not auto-resolve dataDep', () => {
  const event = {
    evtId: '1001',
    targetFile: 'src/pages/detail/index.tsx',
    functionName: 'handleClick',
    lifecycle: 'onClick',
    componentBoundary: 'LocalCard',
    parameters: [highParam({
      key: 'housedel_id',
      expression: 'houseInfo.id',
      sourcePath: 'api.house.id -> props.houseInfo -> handleClick'
    })],
    accept: {
      dataDeps: [{
        paramKey: 'housedel_id',
        from: 'url',
        status: 'needsConfirm',
        unresolved: ['MISSING_QUERY_KEY']
      }]
    }
  }
  const result = applyConfirmAction(event)
  assert.equal(result.confirmed, true)
  assert.equal(result.event.accept.dataDeps[0].status, 'needsConfirm')
  assert.equal(dataDepGate(result.event).status, 'NEEDS_CONFIRM')
  assert.equal(eventNeedsConfirm(result.event), true)
})

test('impl and accept-chain dataDep schemas stay aligned', () => {
  const impl = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../schemas/impl.schema.json'), 'utf8'))
  const chain = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../schemas/accept-chain.schema.json'), 'utf8'))
  const implDep = impl.$defs.dataDep
  const chainDep = chain.$defs.target.properties.dataDeps.items
  assert.deepEqual(implDep.required, chainDep.required)
  assert.deepEqual(implDep.properties.from, chainDep.properties.from)
  assert.deepEqual(implDep.properties.status, chainDep.properties.status)
  assert.deepEqual(implDep.properties.unresolved, chainDep.properties.unresolved)
  assert.deepEqual(implDep.properties.api, chainDep.properties.api)
  assert.deepEqual(implDep.properties.user, chainDep.properties.user)
  assert.deepEqual(implDep.properties.page, chainDep.properties.page)
  assert.deepEqual(impl.$defs.runtimeSelector, chain.$defs.runtimeSelector)
  assert.deepEqual(DATADEP_UNRESOLVED_CODES, implDep.properties.unresolved.items.enum)
  assert.ok(!implDep.properties.user.properties.path)
  assert.ok(!implDep.properties.page.properties.path)
})
