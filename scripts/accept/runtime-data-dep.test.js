const assert = require('assert')
const test = require('node:test')
const {
  getByPath,
  resolveDataDep,
  resolveDataDeps
} = require('./runtime-data-dep')

function urlDep(overrides) {
  return Object.assign({
    paramKey: 'housedel_id',
    from: 'url',
    queryKey: 'housedelCode',
    status: 'resolved',
    unresolved: [],
    expression: 'window.foo',
    sourcePath: 'should-not-be-read'
  }, overrides || {})
}

function userDep(path, overrides) {
  return Object.assign({
    paramKey: 'ucid',
    from: 'user',
    status: 'resolved',
    unresolved: [],
    user: {
      runtime: {
        kind: 'windowPath',
        path: path || '__user.id'
      }
    }
  }, overrides || {})
}

function pageDep(path, overrides) {
  return Object.assign({
    paramKey: 'community_name',
    from: 'page',
    status: 'resolved',
    unresolved: [],
    page: {
      runtime: {
        kind: 'windowPath',
        path: path || '__PAGE_DATA__.community.name'
      }
    }
  }, overrides || {})
}

function apiDep(overrides) {
  return Object.assign({
    paramKey: 'price',
    from: 'api',
    status: 'resolved',
    unresolved: [],
    api: {
      urlIncludes: '/api/detail',
      field: 'data.price'
    }
  }, overrides || {})
}

test('getByPath own properties and array index', () => {
  const obj = { items: [{ id: 9 }] }
  assert.deepEqual(getByPath(obj, 'items.0.id'), { found: true, value: 9 })
  assert.equal(getByPath(obj, 'toString').found, false)
  assert.equal(getByPath({ a: undefined }, 'a').found, false)
  assert.deepEqual(getByPath({ a: null }, 'a'), { found: true, value: null })
})

test('case 1 URL resolved', async () => {
  const result = await resolveDataDep(urlDep(), {
    urlSnapshot: {
      href: 'https://x.test/p?housedelCode=123',
      query: { housedelCode: '123' }
    }
  })
  assert.equal(result.status, 'resolved')
  assert.equal(result.value, '123')
  assert.equal(result.runtimeSource.queryKey, 'housedelCode')
})

test('case 2 URL missing', async () => {
  const result = await resolveDataDep(urlDep(), {
    urlSnapshot: { href: 'https://x.test/p', query: {} }
  })
  assert.equal(result.status, 'missing')
  assert.equal(result.code, 'RUNTIME_URL_QUERY_MISSING')
})

test('case 3 URL empty value', async () => {
  const result = await resolveDataDep(urlDep({ queryKey: 'id' }), {
    urlSnapshot: { href: 'https://x.test/p?id=', query: { id: '' } }
  })
  assert.equal(result.status, 'resolved')
  assert.equal(result.value, '')
})

test('URL duplicate query is ambiguous', async () => {
  const result = await resolveDataDep(urlDep({ queryKey: 'id' }), {
    urlSnapshot: { href: 'https://x.test/p?id=1&id=2', query: { id: '2' } }
  })
  assert.equal(result.status, 'missing')
  assert.equal(result.code, 'RUNTIME_URL_QUERY_AMBIGUOUS')
})

test('case 4 User windowPath', async () => {
  const result = await resolveDataDep(userDep(), {
    windowSnapshot: { __user: { id: 1001 } }
  })
  assert.equal(result.status, 'resolved')
  assert.equal(result.value, 1001)
})

test('case 5 Page windowPath', async () => {
  const result = await resolveDataDep(pageDep(), {
    windowSnapshot: { __PAGE_DATA__: { community: { name: 'A' } } }
  })
  assert.equal(result.status, 'resolved')
  assert.equal(result.value, 'A')
})

test('case 6 windowPath missing has no fallback', async () => {
  const result = await resolveDataDep(userDep('__user.id'), {
    windowSnapshot: { __user: {} },
    urlSnapshot: { href: 'https://x.test/?housedelCode=1', query: { housedelCode: '1' } }
  })
  assert.equal(result.status, 'missing')
  assert.equal(result.code, 'RUNTIME_WINDOW_PATH_MISSING')
})

test('case 7 unsupported runtime kind', async () => {
  const result = await resolveDataDep(userDep('', {
    user: { runtime: { kind: 'redux', path: 'user.id' } }
  }), { windowSnapshot: {} })
  assert.equal(result.status, 'error')
  assert.equal(result.code, 'RUNTIME_SELECTOR_UNSUPPORTED')
})

test('case 8 API single candidate', async () => {
  const result = await resolveDataDep(apiDep(), {
    targetRuntimeStart: 10,
    targetRuntimeEnd: 30,
    api: {
      responses: [{
        t: 20,
        url: 'https://x.test/api/detail?id=1',
        status: 200,
        bodyParsed: true,
        body: { data: { price: 88 } }
      }]
    }
  })
  assert.equal(result.status, 'resolved')
  assert.equal(result.value, 88)
})

test('case 9 API no response', async () => {
  const result = await resolveDataDep(apiDep(), {
    targetRuntimeStart: 10,
    targetRuntimeEnd: 30,
    api: { responses: [] }
  })
  assert.equal(result.code, 'RUNTIME_API_NOT_CAPTURED')
})

test('API outside window is not captured', async () => {
  const result = await resolveDataDep(apiDep(), {
    targetRuntimeStart: 50,
    targetRuntimeEnd: 60,
    api: {
      responses: [{
        t: 20,
        url: 'https://x.test/api/detail',
        status: 200,
        bodyParsed: true,
        body: { data: { price: 88 } }
      }]
    }
  })
  assert.equal(result.code, 'RUNTIME_API_NOT_CAPTURED')
})

test('case 10 API field missing', async () => {
  const result = await resolveDataDep(apiDep(), {
    targetRuntimeStart: 10,
    targetRuntimeEnd: 30,
    api: {
      responses: [{
        t: 20,
        url: 'https://x.test/api/detail',
        status: 200,
        bodyParsed: true,
        body: { data: {} }
      }]
    }
  })
  assert.equal(result.code, 'RUNTIME_API_FIELD_MISSING')
})

test('case 11 API multiple same values uses latest', async () => {
  const result = await resolveDataDep(apiDep(), {
    targetRuntimeStart: 10,
    targetRuntimeEnd: 40,
    api: {
      responses: [
        {
          t: 20,
          url: 'https://x.test/api/detail?a=1',
          status: 200,
          bodyParsed: true,
          body: { data: { price: 88 } }
        },
        {
          t: 35,
          url: 'https://x.test/api/detail?a=2',
          status: 200,
          bodyParsed: true,
          body: { data: { price: 88 } }
        }
      ]
    }
  })
  assert.equal(result.status, 'resolved')
  assert.equal(result.value, 88)
  assert.equal(result.runtimeSource.url, 'https://x.test/api/detail?a=2')
})

test('case 12 API ambiguous values', async () => {
  const result = await resolveDataDep(apiDep(), {
    targetRuntimeStart: 10,
    targetRuntimeEnd: 40,
    api: {
      responses: [
        {
          t: 20,
          url: 'https://x.test/api/detail?a=1',
          status: 200,
          bodyParsed: true,
          body: { data: { price: 1 } }
        },
        {
          t: 35,
          url: 'https://x.test/api/detail?a=2',
          status: 200,
          bodyParsed: true,
          body: { data: { price: 2 } }
        }
      ]
    }
  })
  assert.equal(result.code, 'RUNTIME_API_AMBIGUOUS')
})

test('case 13 unsupported runtime value', async () => {
  const result = await resolveDataDep(userDep('__user.profile'), {
    windowSnapshot: { __user: { profile: { id: 1 } } }
  })
  assert.equal(result.status, 'error')
  assert.equal(result.code, 'RUNTIME_VALUE_UNSUPPORTED')
})

test('case 14 unresolved DataDep', async () => {
  const result = await resolveDataDep({
    paramKey: 'x',
    from: 'url',
    queryKey: 'x',
    status: 'needsConfirm'
  }, {
    urlSnapshot: { href: 'https://x.test/?x=1', query: { x: '1' } }
  })
  assert.equal(result.status, 'error')
  assert.equal(result.code, 'DATADEP_NOT_RESOLVED')
})

test('case 15 no expression fallback', async () => {
  const result = await resolveDataDep(urlDep({ queryKey: 'missing' }), {
    urlSnapshot: { href: 'https://x.test/p', query: {} },
    windowSnapshot: { foo: 1 },
    page: { evaluate: async function () { return { found: true, value: 'from-expression' } } }
  })
  assert.equal(result.code, 'RUNTIME_URL_QUERY_MISSING')
  assert.notEqual(result.value, 'from-expression')
})

test('no fallback resolver for unknown from', async () => {
  const result = await resolveDataDep({
    paramKey: 'x',
    from: 'cookie',
    status: 'resolved'
  }, {})
  assert.equal(result.code, 'RUNTIME_RESOLVER_NOT_FOUND')
})

test('resolveDataDeps runs all deps', async () => {
  const results = await resolveDataDeps([
    urlDep(),
    userDep()
  ], {
    urlSnapshot: { href: 'https://x.test/?housedelCode=9', query: { housedelCode: '9' } },
    windowSnapshot: { __user: { id: 2 } }
  })
  assert.equal(results.length, 2)
  assert.equal(results[0].value, '9')
  assert.equal(results[1].value, 2)
})
