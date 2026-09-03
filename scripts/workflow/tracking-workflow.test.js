const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const { defaultAcceptPaths } = require('../accept/accept-chain')
const { buildStatus } = require('./tracking-workflow')
const { writeJson } = require('../lib/lib')

function makeDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeFile(filePath, content) {
  makeDir(path.dirname(filePath))
  fs.writeFileSync(filePath, content)
}

function baseFixture(name, opts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bella-workflow-'))
  const docsDir = makeDir(path.join(root, 'docs'))
  const excelPath = path.join(docsDir, `${name}.xlsx`)
  writeFile(excelPath, 'excel')
  const paths = defaultAcceptPaths(root, { excel: excelPath })
  makeDir(path.dirname(paths.eventsPath))
  makeDir(path.dirname(paths.implPath))
  makeDir(path.join(paths.outDir, '_raw', 'images'))
  writeFile(paths.htmlPath, '<html></html>')
  writeJson(paths.eventsPath, {
    slug: name,
    excelPath,
    sheetName: 'Sheet1',
    events: (opts.events || []).map((item, idx) => Object.assign({
      evtId: String(item.evtId),
      docIndex: idx + 1,
      eventName: item.eventName || `event-${idx + 1}`,
      kind: item.kind || 'click',
      eventType: item.eventType || 'click',
      pid: item.pid || 'pid'
    }, item))
  })
  writeJson(paths.implPath, {
    events: (opts.implEvents || []).map((item, idx) => Object.assign({
      evtId: String(item.evtId),
      docIndex: idx + 1
    }, item))
  })
  writeJson(paths.adaptorPath, {
    sdkId: '$ULOG',
    styles: [],
    sourceRoots: []
  })
  ;((opts.events || [])).forEach(item => {
    writeFile(path.join(paths.outDir, '_raw', 'images', `${String(item.evtId)}.png`), 'png')
  })
  if (opts.workflow) {
    writeJson(path.join(paths.outDir, '_raw', 'workflow.json'), opts.workflow)
  }
  if (opts.acceptReport) {
    makeDir(path.dirname(paths.acceptJson))
    writeJson(paths.acceptJson, opts.acceptReport)
  }
  return { root, paths, excelPath }
}

function getNextTask(result) {
  return result.nextTask || result.taskResult && result.taskResult.nextTask || null
}

test('same disk facts resolve to the same nextTask', () => {
  const fixture = baseFixture('determinism', {
    events: [{ evtId: '1001', eventName: 'Pending event' }],
    implEvents: [{ evtId: '1001', status: 'pending', targetFile: '', parameters: [] }]
  })
  const first = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  const second = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  assert.deepStrictEqual(getNextTask(first), getNextTask(second))
  assert.strictEqual(getNextTask(first).id, 'A_ANALYZE_EVENT')
  assert.strictEqual(first.stageStatus.A.done, false)
})

test('dump/render done does not imply A complete when impl facts are missing', () => {
  const fixture = baseFixture('a-partial', {
    events: [{ evtId: '2001', eventName: 'Analyze me' }],
    implEvents: [{ evtId: '2001', status: 'pending', targetFile: '', parameters: [] }]
  })
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  assert.strictEqual(status.stageStatus.A.done, false)
  assert.strictEqual(getNextTask(status).stage, 'A')
  assert.strictEqual(getNextTask(status).id, 'A_ANALYZE_EVENT')
  assert.notStrictEqual(getNextTask(status).id, 'A_COMPLETE')
})

test('needsConfirm resolves to a user confirmation task', () => {
  const fixture = baseFixture('needs-confirm', {
    events: [{ evtId: '3001', eventName: 'Need confirm' }],
    implEvents: [{
      evtId: '3001',
      status: 'existing',
      targetFile: 'src/foo.js',
      parameters: [{ key: 'roomId', expression: '', confidence: 'medium' }]
    }]
  })
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  assert.strictEqual(getNextTask(status).stage, 'B')
  assert.strictEqual(getNextTask(status).executor, 'user')
  assert.strictEqual(getNextTask(status).id, 'B_CONFIRM_EVENT')
  assert.strictEqual(getNextTask(status).subject.evtId, '3001')
})

test('validation failure enters blocked fix-validation state', () => {
  const fixture = baseFixture('validation-fail', {
    events: [{ evtId: '4001', eventName: 'Bad impl' }],
    implEvents: [{
      evtId: '4001',
      status: 'existing',
      targetFile: 'src/foo.js',
      uicode: 'illegal',
      parameters: []
    }]
  })
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  assert.strictEqual(getNextTask(status).id, 'A_VALIDATE_IMPL')
  assert.strictEqual(getNextTask(status).status, 'blocked')
})

test('queue cleared but B not marked done requires full-page confirmation', () => {
  const fixture = baseFixture('b-gate', {
    events: [{ evtId: '5001', eventName: 'Ready for C' }],
    implEvents: [{
      evtId: '5001',
      status: 'existing',
      targetFile: 'src/foo.js',
      parameters: [{ key: 'roomId', expression: 'state.roomId', confidence: 'high' }]
    }]
  })
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  assert.strictEqual(status.stageStatus.A.done, true)
  assert.strictEqual(status.stageStatus.B.done, false)
  assert.strictEqual(getNextTask(status).id, 'B_CONFIRM_FULL_PAGE')
  assert.strictEqual(getNextTask(status).executor, 'user')
})

test('B done moves workflow to C, accept report completes it', () => {
  const fixture = baseFixture('completed', {
    events: [{ evtId: '6001', eventName: 'Complete' }],
    implEvents: [{
      evtId: '6001',
      status: 'existing',
      targetFile: 'src/foo.js',
      parameters: [{ key: 'roomId', expression: 'state.roomId', confidence: 'high' }]
    }],
    workflow: {
      version: 1,
      stages: {
        B: { status: 'done', completedAt: '2026-09-03T00:00:00.000Z' },
        C: { status: 'done', completedAt: '2026-09-03T00:01:00.000Z' }
      },
      history: []
    },
    acceptReport: {
      planOnly: false,
      summary: { total: 1, pass: 1, fail: 0, skip: 0, pathBlockerSkip: 0 }
    }
  })
  const status = buildStatus(fixture.paths, { excel: fixture.excelPath }, fixture.root)
  assert.strictEqual(status.stageStatus.D.done, true)
  assert.strictEqual(status.nextTask, null)
})
