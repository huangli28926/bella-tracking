const { isAuthorizedManualConfirm } = require('./validate-confirmation-reuse')

const PARAMETER_EVIDENCE_TYPES = [
  'same-component-tracking',
  'same-page-tracking',
  'same-module-tracking',
  'jsx-binding',
  'api-field',
  'prop-chain',
  'state-chain',
  'hook-chain',
  'context-chain',
  'url-field',
  'user-context',
  'field-memory',
  'repository-convention',
  'manual-confirm'
]

const STRONG_EVIDENCE_TYPES = new Set([
  'same-component-tracking',
  'same-page-tracking',
  'jsx-binding',
  'api-field',
  'prop-chain',
  'state-chain',
  'hook-chain',
  'context-chain',
  'url-field',
  'user-context',
  'manual-confirm'
])

const SUPPORTING_EVIDENCE_TYPES = new Set([
  'same-module-tracking',
  'field-memory',
  'repository-convention'
])

const KNOWN_EVIDENCE_TYPES = new Set(PARAMETER_EVIDENCE_TYPES)

function str(value) {
  return value == null ? '' : String(value).trim()
}

function hasOwn(obj, key) {
  return !!(obj && Object.prototype.hasOwnProperty.call(obj, key))
}

function evidenceList(parameter) {
  return Array.isArray(parameter && parameter.evidence) ? parameter.evidence : []
}

function conflictList(parameter) {
  return Array.isArray(parameter && parameter.conflicts) ? parameter.conflicts : []
}

function hasExpression(parameter) {
  return !!str(parameter && parameter.expression)
}

function hasSourcePath(parameter) {
  const value = parameter && parameter.sourcePath
  if (Array.isArray(value)) {
    return value.some(item => !!str(item))
  }
  return !!str(value)
}

function evidenceType(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
  return str(item.type)
}

function hasValidEvidence(parameter) {
  return evidenceList(parameter).some(item => KNOWN_EVIDENCE_TYPES.has(evidenceType(item)))
}

function hasStrongEvidence(parameter) {
  return evidenceList(parameter).some(item => {
    const type = evidenceType(item)
    if (type === 'manual-confirm') return isAuthorizedManualConfirm(parameter)
    return STRONG_EVIDENCE_TYPES.has(type)
  })
}

function hasManualConfirm(parameter) {
  return evidenceList(parameter).some(item => evidenceType(item) === 'manual-confirm')
    && isAuthorizedManualConfirm(parameter)
}

function hasConflicts(parameter) {
  return conflictList(parameter).length > 0
}

function paramUnresolvedPhrase(key) {
  return key ? `请确认参数 ${key} 的取值` : ''
}

function isParameterUnresolved(parameter, eventContext) {
  if (parameter && Array.isArray(parameter.unresolved)) {
    return parameter.unresolved.length > 0
  }
  const key = str(parameter && parameter.key)
  const phrase = paramUnresolvedPhrase(key)
  const list = (eventContext && Array.isArray(eventContext.unresolved))
    ? eventContext.unresolved
    : []
  if (!phrase) return false
  return list.some(item => str(item) === phrase)
}

function isLegacyParameter(parameter) {
  if (!parameter || typeof parameter !== 'object') return true
  const hasStructuredKey = hasOwn(parameter, 'evidence')
    || hasOwn(parameter, 'scopeReachable')
    || hasOwn(parameter, 'conflicts')
  return !hasStructuredKey
}

function isHardLow(parameter) {
  return (
    !hasExpression(parameter)
    || (parameter && parameter.scopeReachable === false)
    || !hasValidEvidence(parameter)
    || (hasConflicts(parameter) && !hasManualConfirm(parameter))
  )
}

function isHighConfidence(parameter, eventContext) {
  return (
    hasExpression(parameter)
    && hasSourcePath(parameter)
    && parameter
    && parameter.scopeReachable === true
    && hasStrongEvidence(parameter)
    && !isParameterUnresolved(parameter, eventContext)
    && !hasConflicts(parameter)
  )
}

function calculateParameterConfidence(parameter, eventContext) {
  if (isHardLow(parameter)) return 'low'
  if (isHighConfidence(parameter, eventContext)) return 'high'
  return 'medium'
}

module.exports = {
  PARAMETER_EVIDENCE_TYPES,
  STRONG_EVIDENCE_TYPES,
  SUPPORTING_EVIDENCE_TYPES,
  calculateParameterConfidence,
  hasStrongEvidence,
  isHardLow,
  isHighConfidence,
  isLegacyParameter,
  isParameterUnresolved
}
