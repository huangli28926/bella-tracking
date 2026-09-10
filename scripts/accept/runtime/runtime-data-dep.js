function isOwn(obj, key) {
  if (obj == null) return false
  if (typeof obj !== 'object' && typeof obj !== 'function') return false
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function isScalar(value) {
  if (value === null) return true
  const t = typeof value
  return t === 'string' || t === 'number' || t === 'boolean'
}

function hasOwnKey(obj, key) {
  return !!(obj && Object.prototype.hasOwnProperty.call(obj, key))
}

function apiMapConfigured(selector) {
  const map = selector && selector.map
  return !!((map && typeof map === 'object' && !Array.isArray(map)) || hasOwnKey(selector, 'default'))
}

/** 将接口叶子值按 api.map（键忽略大小写）转换；套不上且声明了 default 则用 default。无 map/default 时原样返回。 */
function applyApiValueMap(value, selector) {
  if (!apiMapConfigured(selector)) {
    return value
  }
  const hasDefault = hasOwnKey(selector, 'default')
  const fallback = hasDefault ? selector.default : value
  if (value == null || value === '') {
    return fallback
  }
  const map = selector.map && typeof selector.map === 'object' && !Array.isArray(selector.map)
    ? selector.map
    : null
  if (map) {
    const needle = String(value).toLowerCase()
    const keys = Object.keys(map)
    for (let i = 0; i < keys.length; i += 1) {
      if (String(keys[i]).toLowerCase() === needle) {
        return map[keys[i]]
      }
    }
  }
  return fallback
}

function pathHasListWildcard(path) {
  return String(path || '').split('.').some(function (part) {
    return part.endsWith('[]')
  })
}

/**
 * 按 '.' 取值；`list[]` 表示展开数组（如 data.list[].housedelCode）。
 * 返回 { found, values }，values 为走到叶子的全部节点。
 */
function collectByPath(obj, path, options) {
  const missingAsUndefined = !!(options && options.missingAsUndefined)
  const parts = String(path || '').split('.').filter(Boolean)
  if (!parts.length) {
    return { found: false, values: [] }
  }
  let nodes = [obj]
  for (let i = 0; i < parts.length; i += 1) {
    const raw = parts[i]
    const wildcard = raw.endsWith('[]')
    const key = wildcard ? raw.slice(0, -2) : raw
    const next = []
    nodes.forEach(function (node) {
      if (wildcard) {
        if (!key || node == null) {
          if (missingAsUndefined) {
            next.push(undefined)
          }
          return
        }
        if (!isOwn(node, key)) {
          if (missingAsUndefined) {
            next.push(undefined)
          }
          return
        }
        const arr = node[key]
        if (!Array.isArray(arr)) {
          if (missingAsUndefined) {
            next.push(undefined)
          }
          return
        }
        arr.forEach(function (item) {
          next.push(item)
        })
        return
      }
      if (!isOwn(node, key)) {
        if (missingAsUndefined) {
          next.push(undefined)
        }
        return
      }
      const value = node[key]
      if (value !== undefined || missingAsUndefined) {
        next.push(value)
      }
    })
    nodes = next
    if (!nodes.length) {
      return { found: false, values: [] }
    }
  }
  return { found: true, values: nodes }
}

function getByPath(obj, path) {
  const collected = collectByPath(obj, path)
  if (!collected.found) {
    return { found: false }
  }
  if (collected.values.length === 1) {
    return { found: true, value: collected.values[0] }
  }
  return { found: true, value: collected.values[0], values: collected.values }
}

function resultBase(dep, extra) {
  return Object.assign({
    paramKey: dep && dep.paramKey != null ? dep.paramKey : '',
    from: dep && dep.from ? dep.from : '',
    status: 'error',
    code: '',
    value: undefined,
    runtimeSource: undefined
  }, extra || {})
}

function runtimeError(dep, code, extra) {
  return resultBase(dep, Object.assign({
    status: 'error',
    code: code
  }, extra || {}))
}

function scalarOrUnsupported(dep, value, runtimeSource) {
  if (!isScalar(value)) {
    return resultBase(dep, {
      status: 'error',
      code: 'RUNTIME_VALUE_UNSUPPORTED',
      runtimeSource: runtimeSource
    })
  }
  return resultBase(dep, {
    status: 'resolved',
    code: '',
    value: value,
    runtimeSource: runtimeSource
  })
}

function queryValuesForKey(ctx, queryKey) {
  const href = ctx && ctx.urlSnapshot && ctx.urlSnapshot.href
  if (href) {
    try {
      const parsed = new URL(href, 'http://seed.invalid')
      const all = parsed.searchParams.getAll(String(queryKey || ''))
      if (all.length > 1) {
        return { kind: 'ambiguous', values: all }
      }
      if (all.length === 1) {
        return { kind: 'present', value: all[0] }
      }
      return { kind: 'absent' }
    } catch (error) {
      // fall through to snapshot.query
    }
  }
  const query = ctx && ctx.urlSnapshot && ctx.urlSnapshot.query || {}
  if (!Object.prototype.hasOwnProperty.call(query, queryKey)) {
    return { kind: 'absent' }
  }
  return { kind: 'present', value: query[queryKey] }
}

function resolveUrlDataDep(dep, ctx) {
  const queryKey = dep && dep.queryKey
  const source = {
    kind: 'urlQuery',
    queryKey: queryKey,
    href: ctx && ctx.urlSnapshot && ctx.urlSnapshot.href || ''
  }
  const found = queryValuesForKey(ctx, queryKey)
  if (found.kind === 'ambiguous') {
    return resultBase(dep, {
      status: 'missing',
      code: 'RUNTIME_URL_QUERY_AMBIGUOUS',
      runtimeSource: source
    })
  }
  if (found.kind !== 'present') {
    return resultBase(dep, {
      status: 'missing',
      code: 'RUNTIME_URL_QUERY_MISSING',
      runtimeSource: source
    })
  }
  return scalarOrUnsupported(dep, found.value, source)
}

function inApiRuntimeWindow(item, ctx) {
  const t = Number(item && item.t) || 0
  const start = Number(ctx && ctx.apiRuntimeStart)
  const end = Number(ctx && ctx.apiRuntimeEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return false
  }
  return t >= start && t <= end
}

function resolveApiDataDep(dep, ctx) {
  const selector = dep && dep.api || {}
  const urlIncludes = selector.urlIncludes
  const field = selector.field
  const responses = ctx && ctx.api && Array.isArray(ctx.api.responses)
    ? ctx.api.responses
    : []

  const urlMatched = responses.filter(item => {
    return inApiRuntimeWindow(item, ctx)
      && item
      && typeof item.url === 'string'
      && item.url.includes(urlIncludes)
  })

  const parsed = urlMatched.filter(item => {
    const status = Number(item.status)
    return item.bodyParsed === true
      && status >= 200
      && status < 300
  })

  if (!parsed.length) {
    return resultBase(dep, {
      status: 'missing',
      code: 'RUNTIME_API_NOT_CAPTURED',
      runtimeSource: {
        kind: 'api',
        urlIncludes: urlIncludes,
        field: field
      }
    })
  }

  const withField = []
  parsed.forEach(item => {
    const collected = collectByPath(item.body, field, {
      missingAsUndefined: apiMapConfigured(selector) && hasOwnKey(selector, 'default')
    })
    if (!collected.found) {
      return
    }
    collected.values.forEach(function (value) {
      withField.push({
        response: item,
        value: applyApiValueMap(value, selector)
      })
    })
  })

  if (!withField.length) {
    return resultBase(dep, {
      status: 'missing',
      code: 'RUNTIME_API_FIELD_MISSING',
      runtimeSource: {
        kind: 'api',
        urlIncludes: urlIncludes,
        field: field
      }
    })
  }

  const scalars = withField.filter(item => isScalar(item.value))
  if (!scalars.length) {
    return resultBase(dep, {
      status: 'error',
      code: 'RUNTIME_VALUE_UNSUPPORTED',
      runtimeSource: {
        kind: 'api',
        urlIncludes: urlIncludes,
        field: field
      }
    })
  }

  const unique = []
  scalars.forEach(item => {
    if (unique.indexOf(item.value) === -1) {
      unique.push(item.value)
    }
  })
  let latest = scalars[0]
  scalars.forEach(item => {
    if ((Number(item.response.t) || 0) >= (Number(latest.response.t) || 0)) {
      latest = item
    }
  })
  const source = {
    kind: 'api',
    urlIncludes: urlIncludes,
    field: field,
    url: latest.response.url
  }
  if (unique.length > 1 && pathHasListWildcard(field)) {
    return resultBase(dep, {
      status: 'resolved',
      code: '',
      value: unique[0],
      valueSet: unique,
      runtimeSource: source
    })
  }
  if (unique.length > 1) {
    return resultBase(dep, {
      status: 'missing',
      code: 'RUNTIME_API_AMBIGUOUS',
      runtimeSource: {
        kind: 'api',
        urlIncludes: urlIncludes,
        field: field
      }
    })
  }
  return scalarOrUnsupported(dep, latest.value, source)
}

function resolveRuntimeSelector(dep, runtime, ctx) {
  if (!runtime) {
    return runtimeError(dep, 'RUNTIME_SELECTOR_MISSING')
  }
  if (runtime.kind !== 'windowPath') {
    return runtimeError(dep, 'RUNTIME_SELECTOR_UNSUPPORTED', {
      runtimeSource: {
        kind: runtime.kind,
        path: runtime.path
      }
    })
  }
  if (!runtime.path) {
    return runtimeError(dep, 'RUNTIME_SELECTOR_MISSING', {
      runtimeSource: {
        kind: 'windowPath',
        path: runtime.path
      }
    })
  }
  if (!ctx || !ctx.windowSnapshot) {
    return runtimeError(dep, 'RUNTIME_READ_ERROR', {
      runtimeSource: {
        kind: 'windowPath',
        path: runtime.path
      }
    })
  }
  const found = getByPath(ctx.windowSnapshot, runtime.path)
  const source = {
    kind: 'windowPath',
    path: runtime.path
  }
  if (!found.found) {
    return resultBase(dep, {
      status: 'missing',
      code: 'RUNTIME_WINDOW_PATH_MISSING',
      runtimeSource: source
    })
  }
  return scalarOrUnsupported(dep, found.value, source)
}

function resolveUserDataDep(dep, ctx) {
  return resolveRuntimeSelector(dep, dep && dep.user && dep.user.runtime, ctx)
}

function resolvePageDataDep(dep, ctx) {
  return resolveRuntimeSelector(dep, dep && dep.page && dep.page.runtime, ctx)
}

const SOURCE_RESOLVERS = {
  url: resolveUrlDataDep,
  api: resolveApiDataDep,
  user: resolveUserDataDep,
  page: resolvePageDataDep
}

async function resolveDataDep(dep, runtimeContext) {
  if (!dep || dep.status !== 'resolved') {
    return runtimeError(dep, 'DATADEP_NOT_RESOLVED')
  }
  const resolver = SOURCE_RESOLVERS[dep.from]
  if (!resolver) {
    return runtimeError(dep, 'RUNTIME_RESOLVER_NOT_FOUND')
  }
  return resolver(dep, runtimeContext)
}

async function resolveDataDeps(deps, runtimeContext) {
  const list = Array.isArray(deps) ? deps : []
  const out = []
  for (let i = 0; i < list.length; i += 1) {
    out.push(await resolveDataDep(list[i], runtimeContext))
  }
  return out
}

function collectWindowPaths(deps) {
  const paths = []
  ;(Array.isArray(deps) ? deps : []).forEach(dep => {
    const runtime = dep && dep.from === 'user'
      ? dep.user && dep.user.runtime
      : dep && dep.from === 'page'
        ? dep.page && dep.page.runtime
        : null
    if (runtime && runtime.kind === 'windowPath' && runtime.path) {
      paths.push(runtime.path)
    }
  })
  return paths
}

function setOwnPath(root, path, value) {
  const parts = String(path || '').split('.').filter(Boolean)
  let current = root
  for (let i = 0; i < parts.length; i += 1) {
    const key = parts[i]
    if (i === parts.length - 1) {
      current[key] = value
      return
    }
    if (!isOwn(current, key) || current[key] == null || typeof current[key] !== 'object') {
      current[key] = {}
    }
    current = current[key]
  }
}

async function captureWindowSnapshot(page, deps) {
  const paths = collectWindowPaths(deps)
  if (!page || typeof page.evaluate !== 'function') {
    return {}
  }
  try {
    return await page.evaluate(function (paths) {
      function isOwn(obj, key) {
        if (obj == null) return false
        if (typeof obj !== 'object' && typeof obj !== 'function') return false
        return Object.prototype.hasOwnProperty.call(obj, key)
      }
      function getByPath(obj, path) {
        var parts = String(path || '').split('.').filter(Boolean)
        if (!parts.length) return { found: false }
        var current = obj
        for (var i = 0; i < parts.length; i += 1) {
          var key = parts[i]
          if (!isOwn(current, key)) return { found: false }
          current = current[key]
        }
        if (current === undefined) return { found: false }
        return { found: true, value: current }
      }
      function setOwnPath(root, path, value) {
        var parts = String(path || '').split('.').filter(Boolean)
        var current = root
        for (var i = 0; i < parts.length; i += 1) {
          var key = parts[i]
          if (i === parts.length - 1) {
            current[key] = value
            return
          }
          if (!isOwn(current, key) || current[key] == null || typeof current[key] !== 'object') {
            current[key] = {}
          }
          current = current[key]
        }
      }
      var snapshot = {}
      ;(paths || []).forEach(function (path) {
        var found = getByPath(window, path)
        if (!found.found) return
        try {
          JSON.stringify(found.value)
          setOwnPath(snapshot, path, found.value)
        } catch (error) {
          setOwnPath(snapshot, path, { __runtimeUnsupported: true })
        }
      })
      return snapshot
    }, paths)
  } catch (error) {
    return null
  }
}

async function captureRuntimeExpectedSnapshot(page, deps) {
  const href = page && typeof page.url === 'function' ? page.url() : ''
  let query = {}
  try {
    const parsed = new URL(href, 'http://seed.invalid')
    parsed.searchParams.forEach(function (value, key) {
      query[key] = value
    })
  } catch (error) {
    query = {}
  }
  return {
    urlSnapshot: {
      href: href,
      query: query
    },
    windowSnapshot: await captureWindowSnapshot(page, deps)
  }
}

module.exports = {
  SOURCE_RESOLVERS,
  getByPath,
  collectByPath,
  pathHasListWildcard,
  applyApiValueMap,
  isScalar,
  resolveDataDep,
  resolveDataDeps,
  resolveUrlDataDep,
  resolveApiDataDep,
  resolveUserDataDep,
  resolvePageDataDep,
  captureRuntimeExpectedSnapshot
}
