const CONTRACT_VIOLATION_CODES = {
  DATADEP_NOT_RESOLVED: true,
  RUNTIME_RESOLVER_NOT_FOUND: true,
  RUNTIME_SELECTOR_MISSING: true,
  RUNTIME_SELECTOR_UNSUPPORTED: true
}

function actualForKey(action, paramKey) {
  if (!action || !Object.prototype.hasOwnProperty.call(action, paramKey)) {
    return undefined
  }
  return action[paramKey]
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNumericString(value) {
  if (typeof value !== 'string' || value === '') {
    return false
  }
  return String(Number(value)) === value || (
    /^-?\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value))
  )
}

/** 标量宽松相等：number 与其十进制字符串视为同一值；boolean 仍严格比较。 */
function valuesLooselyEqual(expected, actual) {
  if (expected === actual) {
    return true
  }
  if (expected == null || actual == null) {
    return false
  }
  if (typeof expected === 'boolean' || typeof actual === 'boolean') {
    return expected === actual
  }
  const expectedNum = isFiniteNumber(expected)
  const actualNum = isFiniteNumber(actual)
  const expectedStr = typeof expected === 'string'
  const actualStr = typeof actual === 'string'
  if ((expectedNum && actualStr) || (actualNum && expectedStr) || (expectedStr && actualStr && isNumericString(expected) && isNumericString(actual))) {
    return String(expected) === String(actual)
  }
  if (expectedNum && actualNum) {
    return expected === actual
  }
  return false
}

function compareDataDepResult(resolved, action) {
  const paramKey = resolved && resolved.paramKey != null ? resolved.paramKey : ''
  const actualValue = actualForKey(action, paramKey)
  const internalContractViolation = !!(resolved && CONTRACT_VIOLATION_CODES[resolved.code])
  if (!resolved || resolved.status !== 'resolved') {
    return {
      paramKey: paramKey,
      expectedValue: null,
      actualValue: actualValue === undefined ? null : actualValue,
      status: 'PENDING',
      code: (resolved && resolved.code) || 'RUNTIME_READ_ERROR',
      internalContractViolation: internalContractViolation
    }
  }
  const expectedValue = resolved.value
  const valueSet = Array.isArray(resolved.valueSet) && resolved.valueSet.length
    ? resolved.valueSet
    : [expectedValue]
  const matched = valueSet.some(function (item) {
    return valuesLooselyEqual(item, actualValue)
  })
  if (matched) {
    return {
      paramKey: paramKey,
      expectedValue: valueSet.length > 1 ? valueSet : expectedValue,
      actualValue: actualValue,
      status: 'PASS',
      code: ''
    }
  }
  return {
    paramKey: paramKey,
    expectedValue: valueSet.length > 1 ? valueSet : expectedValue,
    actualValue: actualValue === undefined ? null : actualValue,
    status: 'FAIL',
    code: 'DATADEP_VALUE_MISMATCH'
  }
}

function compareDataDepResults(dataDepResults, action) {
  return (Array.isArray(dataDepResults) ? dataDepResults : []).map(function (item) {
    return compareDataDepResult(item, action)
  })
}

function compareLegacyAssertParams(target, action) {
  const diffs = []
  const depKeys = {}
  ;((target && target.dataDeps) || []).forEach(function (dep) {
    if (dep && dep.paramKey) {
      depKeys[dep.paramKey] = true
    }
  })
  ;((target && target.assertParams) || []).forEach(function (key) {
    if (depKeys[key]) {
      return
    }
    if (!action || !Object.prototype.hasOwnProperty.call(action, key)) {
      diffs.push({ key: key, reason: 'missing key' })
    }
  })
  return diffs
}

function eventOutcomeFromDataDeps(dataDepDiffs, legacyDiffs) {
  const depDiffs = Array.isArray(dataDepDiffs) ? dataDepDiffs : []
  const extra = Array.isArray(legacyDiffs) ? legacyDiffs : []
  const paramDiffs = depDiffs.concat(extra)
  const hasFail = depDiffs.some(function (item) { return item.status === 'FAIL' })
  const pending = depDiffs.filter(function (item) { return item.status === 'PENDING' })
  if (hasFail) {
    return {
      status: 'fail',
      reason: 'param_mismatch',
      skipKind: '',
      skipReason: '',
      paramDiffs: paramDiffs
    }
  }
  if (pending.length) {
    const codes = pending.map(function (item) { return item.code }).filter(Boolean)
    const internal = pending.some(function (item) { return item.internalContractViolation })
    return {
      status: 'skip',
      reason: 'runtime_data_dep_unresolved',
      skipKind: 'unverifiable',
      skipReason: (internal ? 'internal contract violation: ' : '') + codes.join(', '),
      paramDiffs: paramDiffs
    }
  }
  if (extra.length) {
    return {
      status: 'fail',
      reason: 'param_mismatch',
      skipKind: '',
      skipReason: '',
      paramDiffs: paramDiffs
    }
  }
  return {
    status: 'pass',
    reason: '',
    skipKind: '',
    skipReason: '',
    paramDiffs: paramDiffs
  }
}

module.exports = {
  CONTRACT_VIOLATION_CODES,
  valuesLooselyEqual,
  compareDataDepResult,
  compareDataDepResults,
  compareLegacyAssertParams,
  eventOutcomeFromDataDeps
}
