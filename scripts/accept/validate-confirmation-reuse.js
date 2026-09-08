const CONFIRMATION_STATUS = ['unconfirmed', 'confirmed', 'reused', 'stale']
const REUSE_SCOPES = ['exact-target', 'same-dataflow', 'none']
const CONFIRMATION_SOURCE = ['human', '']
const REUSE_CHECK_KEYS = [
  'parameterIdentity',
  'sourceIdentity',
  'scopeReachable',
  'targetCompatible',
  'componentBoundaryCompatible',
  'lifecycleCompatible',
  'transformationCompatible',
  'currentEvidencePresent'
]
const INVALID_REASONS = {
  parameter_identity_changed: 'parameter_identity_changed',
  source_changed: 'source_changed',
  source_unreachable: 'source_unreachable',
  target_changed: 'target_changed',
  component_boundary_changed: 'component_boundary_changed',
  lifecycle_changed: 'lifecycle_changed',
  transformation_changed: 'transformation_changed',
  evidence_missing: 'evidence_missing',
  reuse_scope_none: 'reuse_scope_none',
  not_provable: 'not_provable'
}

function str(value) {
  return value == null ? '' : String(value).trim()
}

function hasOwn(obj, key) {
  return !!(obj && Object.prototype.hasOwnProperty.call(obj, key))
}

function confirmationOf(parameter) {
  const value = parameter && parameter.confirmation
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

function confirmationStatus(parameter) {
  return str(confirmationOf(parameter) && confirmationOf(parameter).status)
}

function isAuthorizedManualConfirm(parameter) {
  const status = confirmationStatus(parameter)
  if (!status) return true
  return status === 'confirmed' || status === 'reused'
}

function sourcePathNodes(parameter) {
  const value = parameter && parameter.sourcePath
  if (Array.isArray(value)) return value.map(item => str(item)).filter(Boolean)
  const text = str(value)
  if (!text) return []
  return text.split(/\s*(?:->|→)\s*/).map(item => str(item)).filter(Boolean)
}

function sourceRootOf(parameter, confirmation) {
  const fromEvidence = str(confirmation && confirmation.evidence && confirmation.evidence.sourceRoot)
  if (fromEvidence) return fromEvidence
  const nodes = sourcePathNodes(parameter)
  return nodes[0] || ''
}

function parameterKeyOf(parameter, confirmation) {
  const fromEvidence = str(confirmation && confirmation.evidence && confirmation.evidence.parameterKey)
  if (fromEvidence) return fromEvidence
  return str(parameter && parameter.key)
}

function eventTargetFile(event, confirmation) {
  const fromEvidence = confirmation && confirmation.evidence ? confirmation.evidence.targetFile : undefined
  if (fromEvidence != null && str(fromEvidence)) return str(fromEvidence)
  return str(event && event.targetFile)
}

function eventTargetSymbol(event, confirmation) {
  const fromEvidence = confirmation && confirmation.evidence ? confirmation.evidence.targetSymbol : undefined
  if (fromEvidence != null && str(fromEvidence)) return str(fromEvidence)
  return str(event && event.functionName)
}

function componentBoundaryOf(event, confirmation) {
  const fromEvidence = str(confirmation && confirmation.evidence && confirmation.evidence.componentBoundary)
  if (fromEvidence) return fromEvidence
  return ''
}

function hasCurrentEvidence(parameter) {
  const list = parameter && Array.isArray(parameter.evidence) ? parameter.evidence : []
  return list.some(item => item && typeof item === 'object' && !Array.isArray(item) && str(item.type))
}

function looksLikeTransform(expression) {
  const text = str(expression)
  if (!text) return false
  if (/\|\||\?\?/.test(text)) return true
  if (/\?[^?]*:/.test(text)) return true
  if (/\b(Number|String|Boolean|parseInt|parseFloat)\s*\(/.test(text)) return true
  if (/\.join\s*\(/.test(text)) return true
  return false
}

function transformFingerprint(parameter) {
  const kind = str(parameter && parameter.transform && parameter.transform.kind)
  if (kind) return kind
  const expr = str(parameter && parameter.expression)
  if (!looksLikeTransform(expr)) return 'identity'
  if (/\|\||\?\?/.test(expr)) return 'fallback'
  if (/\b(Number|parseInt|parseFloat)\s*\(/.test(expr)) return 'coerce-number'
  if (/\b(String|Boolean)\s*\(/.test(expr)) return 'coerce'
  if (/\.join\s*\(/.test(expr)) return 'join'
  if (/\?[^?]*:/.test(expr)) return 'ternary'
  return 'other'
}

function emptyChecks() {
  const checks = {}
  REUSE_CHECK_KEYS.forEach(key => {
    checks[key] = false
  })
  return checks
}

function allChecksPass(checks) {
  return REUSE_CHECK_KEYS.every(key => checks && checks[key] === true)
}

function historicalReusable(parameter) {
  const status = confirmationStatus(parameter)
  return status === 'confirmed' || status === 'reused'
}

function reuseScopeOf(confirmation) {
  const scope = str(confirmation && confirmation.reuseScope)
  if (!scope) return 'same-dataflow'
  return scope
}

function failReason(checks) {
  if (!checks.parameterIdentity) return INVALID_REASONS.parameter_identity_changed
  if (!checks.currentEvidencePresent) return INVALID_REASONS.evidence_missing
  if (!checks.sourceIdentity) return INVALID_REASONS.source_changed
  if (!checks.scopeReachable) return INVALID_REASONS.source_unreachable
  if (!checks.targetCompatible) return INVALID_REASONS.target_changed
  if (!checks.componentBoundaryCompatible) return INVALID_REASONS.component_boundary_changed
  if (!checks.lifecycleCompatible) return INVALID_REASONS.lifecycle_changed
  if (!checks.transformationCompatible) return INVALID_REASONS.transformation_changed
  return INVALID_REASONS.not_provable
}

function validateConfirmationReuse(previousFact, currentFact) {
  const prevEvent = (previousFact && previousFact.event) || {}
  const prevParam = (previousFact && previousFact.parameter) || {}
  const currEvent = (currentFact && currentFact.event) || {}
  const currParam = (currentFact && currentFact.parameter) || {}
  const prevConf = confirmationOf(prevParam)
  const currConf = confirmationOf(currParam) || {}
  const checks = emptyChecks()

  if (!historicalReusable(prevParam)) {
    return {
      status: 'unconfirmed',
      valid: false,
      skip: true,
      checks,
      invalidReason: null
    }
  }

  const scope = reuseScopeOf(prevConf)
  if (scope === 'none' || !REUSE_SCOPES.includes(scope)) {
    return {
      status: 'stale',
      valid: false,
      skip: false,
      checks,
      invalidReason: scope === 'none' ? INVALID_REASONS.reuse_scope_none : INVALID_REASONS.not_provable
    }
  }

  const prevKey = parameterKeyOf(prevParam, prevConf)
  const currKey = parameterKeyOf(currParam, currConf)
  const prevEvt = str(prevEvent.evtId)
  const currEvt = str(currEvent.evtId)
  checks.parameterIdentity = !!(prevKey && currKey && prevKey === currKey && prevEvt && currEvt && prevEvt === currEvt)

  checks.currentEvidencePresent = hasCurrentEvidence(currParam)

  const prevRoot = sourceRootOf(prevParam, prevConf)
  const currRoot = sourceRootOf(currParam, currConf)
  checks.sourceIdentity = !!(prevRoot && currRoot && prevRoot === currRoot)

  checks.scopeReachable = currParam.scopeReachable === true

  const prevFile = eventTargetFile(prevEvent, prevConf)
  const currFile = eventTargetFile(currEvent, currConf)
  const prevSymbol = eventTargetSymbol(prevEvent, prevConf)
  const currSymbol = eventTargetSymbol(currEvent, currConf)
  if (scope === 'exact-target') {
    checks.targetCompatible = !!(prevFile && currFile && prevFile === currFile && prevSymbol === currSymbol)
  } else {
    checks.targetCompatible = true
  }

  const prevBoundary = componentBoundaryOf(prevEvent, prevConf)
  const currentBoundary = componentBoundaryOf(currEvent, currConf) || str(currEvent.componentBoundary)
  if (!prevBoundary) {
    checks.componentBoundaryCompatible = true
  } else {
    checks.componentBoundaryCompatible = prevBoundary === currentBoundary
  }

  const prevLife = str(prevEvent.lifecycle)
  const currLife = str(currEvent.lifecycle)
  if (!prevLife || !currLife) {
    checks.lifecycleCompatible = !!(prevLife || currLife)
    if (!prevLife && !currLife) checks.lifecycleCompatible = true
  } else {
    checks.lifecycleCompatible = prevLife === currLife
  }

  const prevTransform = transformFingerprint(prevParam)
  const currTransform = transformFingerprint(currParam)
  checks.transformationCompatible = prevTransform === currTransform

  const valid = allChecksPass(checks)
  return {
    status: valid ? 'reused' : 'stale',
    valid,
    skip: false,
    checks,
    invalidReason: valid ? null : failReason(checks)
  }
}

function applyConfirmationReuse(previousFact, currentFact) {
  const result = validateConfirmationReuse(previousFact, currentFact)
  const prevConf = confirmationOf(previousFact && previousFact.parameter) || {}
  const currParam = (currentFact && currentFact.parameter) || {}
  const currConf = confirmationOf(currParam) || {}
  if (result.skip) {
    return Object.assign({}, currConf, {
      status: currConf.status || 'unconfirmed'
    })
  }
  const next = {
    status: result.status,
    source: prevConf.source || 'human',
    reuseScope: reuseScopeOf(prevConf),
    confirmedAt: prevConf.confirmedAt || null,
    evidence: Object.assign({}, prevConf.evidence || {}, currConf.evidence || {}),
    reuseChecks: result.checks,
    invalidReason: result.invalidReason
  }
  if (result.status === 'reused') {
    next.invalidReason = null
  }
  return next
}

function reusedChecksComplete(confirmation) {
  const checks = confirmation && confirmation.reuseChecks
  return allChecksPass(checks)
}

function validateConfirmationRecord(parameter, event) {
  const issues = []
  if (!parameter || !hasOwn(parameter, 'confirmation')) return issues
  const confirmation = parameter.confirmation
  if (confirmation == null) return issues
  if (typeof confirmation !== 'object' || Array.isArray(confirmation)) {
    issues.push({ code: 'PARAM_CONFIRMATION_INVALID', field: 'confirmation', message: 'confirmation must be object' })
    return issues
  }
  const status = str(confirmation.status)
  if (status && CONFIRMATION_STATUS.indexOf(status) === -1) {
    issues.push({ code: 'PARAM_CONFIRMATION_INVALID', field: 'confirmation.status', message: `invalid status: ${status}` })
  }
  const source = str(confirmation.source)
  if (source && CONFIRMATION_SOURCE.indexOf(source) === -1) {
    issues.push({ code: 'PARAM_CONFIRMATION_INVALID', field: 'confirmation.source', message: `invalid source: ${source}` })
  }
  const scope = str(confirmation.reuseScope)
  if (scope && REUSE_SCOPES.indexOf(scope) === -1) {
    issues.push({ code: 'PARAM_CONFIRMATION_INVALID', field: 'confirmation.reuseScope', message: `invalid reuseScope: ${scope}` })
  }
  if (status === 'reused') {
    if (!reusedChecksComplete(confirmation)) {
      issues.push({
        code: 'PARAM_CONFIRMATION_REUSED_WITHOUT_EVIDENCE',
        field: 'confirmation.reuseChecks',
        message: 'reused status requires program reuseChecks that all pass'
      })
    }
    if (parameter.scopeReachable !== true) {
      issues.push({
        code: 'PARAM_CONFIRMATION_REUSED_UNREACHABLE',
        field: 'confirmation.status',
        message: 'reused is not allowed when scopeReachable is not true'
      })
    }
  }
  if (status === 'stale' && !str(confirmation.invalidReason)) {
    issues.push({
      code: 'PARAM_CONFIRMATION_STALE_REASON_MISSING',
      field: 'confirmation.invalidReason',
      message: 'stale status requires invalidReason'
    })
  }
  if (status === 'confirmed' || status === 'reused') {
    const evidence = confirmation.evidence || {}
    if (!str(confirmation.reuseScope)) {
      issues.push({
        code: 'PARAM_CONFIRMATION_PROVENANCE_MISSING',
        field: 'confirmation.reuseScope',
        message: 'confirmed/reused requires reuseScope'
      })
    }
    if (!str(evidence.parameterKey) && !str(parameter.key)) {
      issues.push({
        code: 'PARAM_CONFIRMATION_PROVENANCE_MISSING',
        field: 'confirmation.evidence.parameterKey',
        message: 'confirmed/reused requires parameterKey'
      })
    }
    if (!str(evidence.sourceRoot) && !sourceRootOf(parameter, confirmation)) {
      issues.push({
        code: 'PARAM_CONFIRMATION_PROVENANCE_MISSING',
        field: 'confirmation.evidence.sourceRoot',
        message: 'confirmed/reused requires sourceRoot'
      })
    }
    if (str(evidence.sourceRoot) && sourceRootOf(parameter, null) && str(evidence.sourceRoot) !== sourceRootOf(parameter, null) && status === 'reused') {
      issues.push({
        code: 'PARAM_CONFIRMATION_SOURCE_CHANGED',
        field: 'confirmation.evidence.sourceRoot',
        message: 'reused is not allowed when sourceRoot changed'
      })
    }
  }
  void event
  return issues
}

module.exports = {
  CONFIRMATION_STATUS,
  REUSE_SCOPES,
  REUSE_CHECK_KEYS,
  INVALID_REASONS,
  confirmationStatus,
  isAuthorizedManualConfirm,
  sourceRootOf,
  validateConfirmationReuse,
  applyConfirmationReuse,
  validateConfirmationRecord,
  reusedChecksComplete,
  transformFingerprint
}
