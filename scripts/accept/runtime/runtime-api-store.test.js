const assert = require('assert')
const test = require('node:test')
const { shouldSkipApiBody, createApiRuntimeStore, resetApiRuntimeStore } = require('./runtime-api-store')

test('skips tracking gif and images', () => {
  assert.equal(shouldSkipApiBody('https://dig.lianjia.com/check.gif?evt=1', 'image/gif', function (url) {
    return url.indexOf('check.gif') !== -1
  }), true)
  assert.equal(shouldSkipApiBody('https://x.test/a.png', 'image/png'), true)
  assert.equal(shouldSkipApiBody('https://x.test/api/detail', 'application/json'), false)
})

test('reset clears path store without replacing object', () => {
  const store = createApiRuntimeStore()
  store.responses.push({ url: 'x' })
  resetApiRuntimeStore(store)
  assert.equal(store.responses.length, 0)
})

test('path reopen resets store; acceptOne does not', () => {
  const store = createApiRuntimeStore()
  store.responses.push({ t: 5, url: 'seed' })
  resetApiRuntimeStore(store)
  store.responses.push({ t: 20, url: 'sharedSteps' })
  store.responses.push({ t: 40, url: 'targetA' })
  assert.equal(store.responses.length, 2)
  assert.equal(store.responses[0].url, 'sharedSteps')
  resetApiRuntimeStore(store)
  assert.equal(store.responses.length, 0)
})
