const GATE_STATUS = ['READY', 'NEEDS_CONFIRM', 'INVALID']
const ISSUE_LEVEL = { error: 'error', confirm: 'confirm', info: 'info' }

const DATADEP_FROM = ['api', 'url', 'user', 'page']
const DATADEP_STATUS = ['resolved', 'needsConfirm']
const DATADEP_UNRESOLVED_CODES = [
  'MISSING_QUERY_KEY',
  'MISSING_API_URL',
  'MISSING_API_FIELD',
  'MISSING_USER_PATH',
  'MISSING_PAGE_PATH',
  'SOURCE_UNRESOLVED',
  'PAGE_SOURCE_UNRESOLVED'
]

const DATADEP_UNRESOLVED_LABELS = {
  MISSING_QUERY_KEY: '请确认 URL queryKey',
  MISSING_API_URL: '请确认 API urlIncludes',
  MISSING_API_FIELD: '请确认 API field',
  MISSING_USER_PATH: '请确认 user.path',
  MISSING_PAGE_PATH: '请确认 page.path',
  SOURCE_UNRESOLVED: '请确认 DataDep 运行时来源',
  PAGE_SOURCE_UNRESOLVED: '请确认 page 运行时来源'
}

function str(value) {
  return value == null ? '' : String(value).trim()
}

function issue(code, level, field, message) {
  return { code, level, field: field || '', message }
}

function worseStatus(current, next) {
  const rank = { INVALID: 2, NEEDS_CONFIRM: 1, READY: 0 }
  return (rank[next] || 0) > (rank[current] || 0) ? next : current
}

function parameterKeys(event) {
  const keys = {}
  ;((event && event.parameters) || []).forEach(item => {
    const key = str(item && item.key)
    if (key) keys[key] = true
  })
  return keys
}

function selectorComplete(dep) {
  const from = dep && dep.from
  if (from === 'url') return !!str(dep.queryKey)
  if (from === 'api') {
    const api = dep.api || {}
    return !!str(api.urlIncludes) && !!str(api.field)
  }
  if (from === 'user') return !!(dep.user && str(dep.user.path))
  if (from === 'page') return !!(dep.page && str(dep.page.path))
  return false
}

function missingSelectorCodes(dep) {
  const from = dep && dep.from
  if (from === 'url' && !str(dep.queryKey)) return ['MISSING_QUERY_KEY']
  if (from === 'api') {
    const api = dep.api || {}
    const codes = []
    if (!str(api.urlIncludes)) codes.push('MISSING_API_URL')
    if (!str(api.field)) codes.push('MISSING_API_FIELD')
    return codes
  }
  if (from === 'user' && !(dep.user && str(dep.user.path))) return ['MISSING_USER_PATH']
  if (from === 'page' && !(dep.page && str(dep.page.path))) return ['MISSING_PAGE_PATH']
  return []
}

function validateDataDep(dep, event) {
  if (!dep || typeof dep !== 'object' || Array.isArray(dep)) {
    return {
      status: 'INVALID',
      issues: [issue('DATADEP_INVALID', ISSUE_LEVEL.error, '', 'dataDep must be object')]
    }
  }

  const issues = []
  const paramKey = str(dep.paramKey)
  if (!paramKey) {
    issues.push(issue('DATADEP_PARAM_KEY_MISSING', ISSUE_LEVEL.error, 'paramKey', 'missing paramKey'))
  } else if (!parameterKeys(event)[paramKey]) {
    issues.push(issue('DATADEP_PARAM_IDENTITY', ISSUE_LEVEL.error, 'paramKey', `paramKey is not in parameters: ${paramKey}`))
  }

  if (DATADEP_FROM.indexOf(dep.from) === -1) {
    issues.push(issue('DATADEP_FROM_INVALID', ISSUE_LEVEL.error, 'from', `invalid from: ${dep.from || '(empty)'}`))
  }

  if (DATADEP_STATUS.indexOf(dep.status) === -1) {
    issues.push(issue('DATADEP_STATUS_MISSING', ISSUE_LEVEL.error, 'status', 'status is required'))
  }

  if (!Array.isArray(dep.unresolved)) {
    issues.push(issue('DATADEP_UNRESOLVED_INVALID', ISSUE_LEVEL.error, 'unresolved', 'unresolved must be an array'))
  } else {
    dep.unresolved.forEach((code, idx) => {
      if (DATADEP_UNRESOLVED_CODES.indexOf(code) === -1) {
        issues.push(issue(
          'DATADEP_UNRESOLVED_CODE',
          ISSUE_LEVEL.error,
          `unresolved[${idx}]`,
          `invalid unresolved code: ${code || '(empty)'}`
        ))
      }
    })
  }

  const unresolved = Array.isArray(dep.unresolved) ? dep.unresolved : []
  const knownFrom = DATADEP_FROM.indexOf(dep.from) !== -1
  const knownStatus = DATADEP_STATUS.indexOf(dep.status) !== -1

  if (dep.status === 'resolved') {
    if (unresolved.length) {
      issues.push(issue('DATADEP_STATUS_INCONSISTENT', ISSUE_LEVEL.error, 'unresolved', 'resolved dataDep cannot have unresolved'))
    }
    if (knownFrom && !selectorComplete(dep)) {
      missingSelectorCodes(dep).forEach(code => {
        issues.push(issue('DATADEP_SELECTOR_INCOMPLETE', ISSUE_LEVEL.error, code, `resolved dataDep missing selector: ${code}`))
      })
    }
  }

  if (dep.status === 'needsConfirm') {
    if (!unresolved.length) {
      issues.push(issue('DATADEP_STATUS_INCONSISTENT', ISSUE_LEVEL.error, 'unresolved', 'needsConfirm requires unresolved codes'))
    }
  }

  if (issues.some(item => item.level === 'error')) {
    return { status: 'INVALID', issues }
  }
  if (knownStatus && dep.status === 'needsConfirm') {
    return {
      status: 'NEEDS_CONFIRM',
      issues: [issue('DATADEP_NEEDS_CONFIRM', ISSUE_LEVEL.confirm, 'status', 'dataDep is not resolved')]
    }
  }
  return { status: 'READY', issues: [] }
}

function validateEventDataDeps(event) {
  const deps = event && event.accept && Array.isArray(event.accept.dataDeps)
    ? event.accept.dataDeps
    : []
  const results = deps.map((dep, idx) => {
    const result = validateDataDep(dep, event)
    return {
      index: idx,
      status: result.status,
      issues: result.issues.map(item => Object.assign({}, item, {
        field: item.field ? `accept.dataDeps[${idx}].${item.field}` : `accept.dataDeps[${idx}]`
      }))
    }
  })
  let status = 'READY'
  const issues = []
  results.forEach(result => {
    status = worseStatus(status, result.status)
    result.issues.forEach(item => issues.push(item))
  })
  return { status, issues, dataDeps: results }
}

function dataDepGate(event) {
  const result = validateEventDataDeps(event)
  return {
    status: result.status,
    needsConfirm: result.status === 'NEEDS_CONFIRM',
    issues: result.issues,
    dataDeps: result.dataDeps
  }
}

function eventDataDepNeedsConfirm(event) {
  return dataDepGate(event).status === 'NEEDS_CONFIRM'
}

function dataDepConfirmReasons(event) {
  const reasons = []
  const seen = {}
  const deps = event && event.accept && Array.isArray(event.accept.dataDeps)
    ? event.accept.dataDeps
    : []
  deps.forEach(dep => {
    if (!dep || dep.status !== 'needsConfirm') return
    const codes = Array.isArray(dep.unresolved) ? dep.unresolved : []
    codes.forEach(code => {
      const label = DATADEP_UNRESOLVED_LABELS[code]
      if (!label || seen[label]) return
      seen[label] = true
      reasons.push(label)
    })
  })
  return reasons
}

module.exports = {
  GATE_STATUS,
  DATADEP_FROM,
  DATADEP_STATUS,
  DATADEP_UNRESOLVED_CODES,
  DATADEP_UNRESOLVED_LABELS,
  validateDataDep,
  validateEventDataDeps,
  dataDepGate,
  eventDataDepNeedsConfirm,
  dataDepConfirmReasons,
  worseStatus
}
