const assert = require('assert')
const path = require('path')
const test = require('node:test')
const { nodeAndCommand, nodeCommand, scriptPath, SKILL_ROOT } = require('./skill-paths')

test('nodeCommand uses skill scripts directory not cwd-relative scripts/', () => {
  const cmd = nodeCommand('extract/dump-excel.js', '--excel=docs/a.xlsx')
  const expected = scriptPath('extract', 'dump-excel.js')
  assert.strictEqual(cmd, 'node ' + JSON.stringify(expected) + ' --excel=docs/a.xlsx')
  assert.ok(expected.indexOf(path.join(SKILL_ROOT, 'scripts')) === 0)
  assert.ok(cmd.indexOf('node scripts/') === -1)
})

test('nodeAndCommand joins skill-local scripts', () => {
  const cmd = nodeAndCommand([
    { script: 'accept/normalize-impl.js', args: '--excel=docs/a.xlsx' },
    { script: 'accept/validate-impl.js', args: '--excel=docs/a.xlsx --json' }
  ])
  assert.ok(cmd.indexOf(' && ') !== -1)
  assert.ok(cmd.indexOf(JSON.stringify(scriptPath('accept', 'validate-impl.js'))) !== -1)
})
