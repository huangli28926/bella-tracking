const assert = require('assert')
const test = require('node:test')
const { pathIdForCandidate, candidateSignature } = require('./path-id')
const {
  applyHumanDecision,
  resolveAcceptPath,
  runtimeKeepLockedPath
} = require('./resolve-accept-path')
const { validateAcceptPath } = require('./validate-accept-path')

function cand(id, extra) {
  const steps = extra && extra.steps || [
    { node: 'home', action: 'click', to: id },
    { node: id, action: 'target' }
  ]
  return Object.assign({
    pageKey: 'detail',
    target: 'DealRangeCard',
    seedUrlKey: 'default',
    steps,
    edges: extra && extra.edges || [{ from: 'home', to: 'detail', action: 'click', sourceFile: 'src/a.tsx', changeStatus: 'existing' }],
    reachable: true,
    factsComplete: true,
    executable: true,
    cost: steps.length,
    stableLocatorCount: 1
  }, extra || {}, extra && extra.steps ? {} : { steps })
}

test('case 1 single candidate auto select', () => {
  const a = cand('list')
  const result = resolveAcceptPath({ candidates: [a], context: { pageKey: 'detail', target: 'DealRangeCard', seedUrlKey: 'default' } })
  assert.equal(result.status, 'resolved')
  assert.equal(result.selectedBy, 'unique-candidate')
  assert.equal(result.selectedPathId, pathIdForCandidate(a))
})

test('case 2 multiple candidates + one current-change path', () => {
  const hist = cand('search', {
    edges: [{ from: 'search', to: 'detail', action: 'click', sourceFile: 'src/old.tsx', changeStatus: 'existing' }]
  })
  const added = cand('newtab', {
    relatedToCurrentChange: true,
    edges: [{ from: 'home', to: 'detail', action: 'click', sourceFile: 'src/new.tsx', changeStatus: 'added' }]
  })
  const result = resolveAcceptPath({ candidates: [hist, added] })
  assert.equal(result.status, 'resolved')
  assert.equal(result.selectedPathId, pathIdForCandidate(added))
  assert.equal(result.decision.reason, 'contains-current-change-edge')
})

test('case 3 multiple current-change candidates + deterministic priority', () => {
  const long = cand('long', {
    relatedToCurrentChange: true,
    cost: 5,
    stableLocatorCount: 1,
    edges: [{ from: 'home', to: 'detail', action: 'a', sourceFile: 'src/a.tsx', changeStatus: 'added' }]
  })
  const short = cand('short', {
    relatedToCurrentChange: true,
    cost: 2,
    stableLocatorCount: 1,
    edges: [{ from: 'home', to: 'detail', action: 'b', sourceFile: 'src/b.tsx', changeStatus: 'added' }]
  })
  const result = resolveAcceptPath({ candidates: [long, short] })
  assert.equal(result.status, 'resolved')
  assert.equal(result.selectedPathId, pathIdForCandidate(short))
})

test('case 4 historical multiple candidates + no decision → needsConfirm', () => {
  const a = cand('list')
  const b = cand('search', {
    steps: [{ node: 'search', action: 'click', to: 'detail' }, { node: 'detail', action: 'target' }]
  })
  const result = resolveAcceptPath({ candidates: [a, b] })
  assert.equal(result.status, 'needsConfirm')
  assert.ok(result.unresolved[0])
})

test('case 5 historical decision still valid → reuse', () => {
  const a = cand('list')
  const b = cand('search', {
    steps: [{ node: 'search', action: 'click', to: 'detail' }, { node: 'detail', action: 'target' }]
  })
  const preparedSig = candidateSignature([pathIdForCandidate(a), pathIdForCandidate(b)])
  const result = resolveAcceptPath({
    candidates: [a, b],
    historicalDecision: {
      selectedPathId: pathIdForCandidate(a),
      candidateSignature: preparedSig,
      context: { pageKey: 'detail', target: 'DealRangeCard', seedUrlKey: 'default' }
    },
    context: { pageKey: 'detail', target: 'DealRangeCard', seedUrlKey: 'default' }
  })
  assert.equal(result.status, 'resolved')
  assert.equal(result.selectedBy, 'historical-human-decision')
  assert.equal(result.selectedPathId, pathIdForCandidate(a))
})

test('case 6 historical decision path removed → invalidate', () => {
  const a = cand('list')
  const b = cand('search', {
    steps: [{ node: 'search', action: 'click', to: 'detail' }, { node: 'detail', action: 'target' }]
  })
  const goneId = pathIdForCandidate(cand('favorite', {
    steps: [{ node: 'fav', action: 'click', to: 'detail' }]
  }))
  const result = resolveAcceptPath({
    candidates: [a, b],
    historicalDecision: {
      selectedPathId: goneId,
      candidateSignature: 'old',
      context: { pageKey: 'detail', target: 'DealRangeCard', seedUrlKey: 'default' }
    },
    context: { pageKey: 'detail', target: 'DealRangeCard', seedUrlKey: 'default' }
  })
  assert.equal(result.status, 'needsConfirm')
  assert.equal(result.decision.validity, 'invalid')
})

test('case 7 historical decision + new current-change path supersedes', () => {
  const a = cand('list')
  const added = cand('newtab', {
    relatedToCurrentChange: true,
    edges: [{ from: 'home', to: 'detail', action: 'click', sourceFile: 'src/new.tsx', changeStatus: 'added' }]
  })
  const result = resolveAcceptPath({
    candidates: [a, added],
    historicalDecision: {
      selectedPathId: pathIdForCandidate(a),
      candidateSignature: 'old',
      context: { pageKey: 'detail', target: 'DealRangeCard', seedUrlKey: 'default' }
    },
    context: { pageKey: 'detail', target: 'DealRangeCard', seedUrlKey: 'default' }
  })
  assert.equal(result.status, 'resolved')
  assert.equal(result.selectedPathId, pathIdForCandidate(added))
  assert.equal(result.selectedBy, 'current-change')
})

test('case 8 same candidate set different ordering → same selectedPathId', () => {
  const a = cand('list')
  const b = cand('search', {
    steps: [{ node: 'search', action: 'click', to: 'detail' }, { node: 'detail', action: 'target' }]
  })
  const addedA = Object.assign({}, a, {
    relatedToCurrentChange: true,
    edges: [{ from: 'home', to: 'detail', action: 'x', sourceFile: 'src/x.tsx', changeStatus: 'added' }],
    cost: 2,
    stableLocatorCount: 2
  })
  const addedB = Object.assign({}, b, {
    relatedToCurrentChange: true,
    edges: [{ from: 'home', to: 'detail', action: 'y', sourceFile: 'src/y.tsx', changeStatus: 'added' }],
    cost: 2,
    stableLocatorCount: 2
  })
  const r1 = resolveAcceptPath({ candidates: [addedA, addedB] })
  const r2 = resolveAcceptPath({ candidates: [addedB, addedA] })
  const r3 = resolveAcceptPath({ candidates: [addedA, addedB] })
  assert.equal(r1.status, 'resolved')
  assert.equal(r1.selectedPathId, r2.selectedPathId)
  assert.equal(r2.selectedPathId, r3.selectedPathId)
})

test('case 9 run-accept fails → no automatic path fallback', () => {
  const locked = 'abc123'
  const kept = runtimeKeepLockedPath(locked, { status: 'fail' })
  assert.equal(kept.pathId, locked)
  assert.equal(kept.fallback, false)
  assert.equal(kept.reason, 'accept path execution mismatch')
})

test('human decision persists selectedPathId', () => {
  const a = cand('list')
  const b = cand('search', {
    steps: [{ node: 'search', action: 'click', to: 'detail' }, { node: 'detail', action: 'target' }]
  })
  const result = applyHumanDecision({ candidates: [a, b] }, pathIdForCandidate(b))
  assert.equal(result.status, 'resolved')
  assert.equal(result.selectedBy, 'human')
  assert.equal(result.selectedPathId, pathIdForCandidate(b))
  const issues = validateAcceptPath({
    evtId: '1',
    accept: {
      candidatePaths: [a, b],
      pathResolution: {
        status: result.status,
        selectedPathId: result.selectedPathId,
        decision: result.decision
      }
    }
  })
  assert.deepEqual(issues, [])
})

test('zero candidates needsConfirm', () => {
  const result = resolveAcceptPath({ candidates: [] })
  assert.equal(result.status, 'needsConfirm')
})

const { lockForPage } = require('./resolve-entry-path')

function edge(from, to, added) {
  return {
    from,
    to,
    via: 'push',
    file: 'src/' + from + '.tsx',
    line: 1,
    jumpAddedThisPeriod: !!added
  }
}

test('lockForPage seed one-hop unique when other inbound is not from seed', () => {
  const page = { path: '/detail' }
  const lock = lockForPage(page, [edge('/home', '/detail'), edge('/search', '/detail')], '/home', '')
  assert.equal(lock.lockMode, 'existing_shortest')
  assert.equal(lock.lockEdges[0].from, '/home')
})

test('lockForPage current-change inbound wins over historical', () => {
  const page = { path: '/detail' }
  const lock = lockForPage(page, [
    edge('/search', '/detail', false),
    edge('/home', '/detail', true)
  ], '/home', '')
  assert.equal(lock.lockMode, 'new_jump')
  assert.equal(lock.lockEdges[0].from, '/home')
})

test('lockForPage enumerates seed to landing multi-hop path', () => {
  const page = { path: '/detail' }
  const all = [
    edge('/home', '/list'),
    edge('/list', '/detail')
  ]
  const lock = lockForPage(page, [all[1]], '/home', '', null, all)
  assert.equal(lock.lockMode, 'existing_shortest')
  assert.equal(lock.lockEdges.length, 2)
  assert.equal(lock.lockEdges[0].from, '/home')
  assert.equal(lock.lockEdges[0].to, '/list')
  assert.equal(lock.lockEdges[1].to, '/detail')
})

test('lockForPage two historical deep paths needs_confirm', () => {
  const page = { path: '/detail' }
  const all = [
    edge('/home', '/list'),
    edge('/list', '/detail'),
    edge('/home', '/search'),
    edge('/search', '/detail')
  ]
  const lock = lockForPage(page, [all[1], all[3]], '/home', '', null, all)
  assert.equal(lock.lockMode, 'needs_confirm')
  assert.equal(lock.needsConfirm, true)
})

test('lockForPage longer current-change path wins over shorter historical', () => {
  const page = { path: '/detail' }
  const all = [
    edge('/home', '/detail'),
    edge('/home', '/list'),
    edge('/list', '/detail', true)
  ]
  const lock = lockForPage(page, [all[0], all[2]], '/home', '', null, all)
  assert.equal(lock.lockMode, 'new_jump')
  assert.equal(lock.lockEdges.length, 2)
  assert.equal(lock.lockEdges[1].from, '/list')
})

