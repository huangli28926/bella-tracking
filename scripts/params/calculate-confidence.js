const {
  PARAMETER_EVIDENCE_TYPES,
  STRONG_EVIDENCE_TYPES,
  SUPPORTING_EVIDENCE_TYPES
} = require('./evidence-types')
const { isValidatedAcquisition } = require('./validate-acquisition')

function confirmationStatus(parameter) {
  const status = parameter && parameter.confirmation && parameter.confirmation.status
  return status == null ? '' : String(status).trim()
}

function isAuthorizedManualConfirm(parameter) {
  const status = confirmationStatus(parameter)
  if (!status) return true
  return status === 'confirmed' || status === 'reused'
}

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

function unresolvedCodes(parameter) {
  return Array.isArray(parameter && parameter.unresolvedCodes) ? parameter.unresolvedCodes : []
}

function hasExpression(parameter) {
  return !!str(parameter && parameter.expression)
}

function sourcePathClosed(parameter) {
  const value = parameter && parameter.sourcePath
  const nodes = Array.isArray(value)
    ? value.map(item => str(item)).filter(Boolean)
    : str(value).split(/\s*(?:->|→|>)\s*/).map(item => str(item)).filter(Boolean)
  if (!nodes.length) return false
  const last = nodes[nodes.length - 1]
  const expr = str(parameter && parameter.expression)
  const binding = str(parameter && parameter.acquisition && parameter.acquisition.steps
    && parameter.acquisition.steps[parameter.acquisition.steps.length - 1]
    && parameter.acquisition.steps[parameter.acquisition.steps.length - 1].to
    && parameter.acquisition.steps[parameter.acquisition.steps.length - 1].to.binding)
  if (!expr) return false
  return last === expr || last.indexOf(expr) !== -1 || (binding && (last === binding || expr === binding))
}

function hasSourcePath(parameter) {
  const value = parameter && parameter.sourcePath
  if (Array.isArray(value)) return value.some(item => !!str(item))
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
  if (unresolvedCodes(parameter).length) return true
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

function parameterImplementable(parameter) {
  if (parameter && parameter.parameterImplementable === true) return true
  if (parameter && parameter.scopeReachable === true) return true
  return isValidatedAcquisition(parameter)
}

function uniquenessUnknown(parameter) {
  const s = str(parameter && parameter.sourceUniqueness)
  const p = str(parameter && parameter.pathUniqueness)
  if (!s && !p) return false
  return s === 'unknown' || p === 'unknown'
}

function uniquenessMultiple(parameter) {
  return str(parameter && parameter.sourceUniqueness) === 'multiple'
    || str(parameter && parameter.pathUniqueness) === 'multiple'
}

function codesInclude(parameter, code) {
  return unresolvedCodes(parameter).indexOf(code) !== -1
}

function onlySupportingEvidence(parameter) {
  if (!hasExpression(parameter)) return false
  if (hasStrongEvidence(parameter)) return false
  return evidenceList(parameter).some(item => SUPPORTING_EVIDENCE_TYPES.has(evidenceType(item)))
}

function isHardLow(parameter) {
  if (!hasExpression(parameter)) return true
  if (!hasValidEvidence(parameter)) return true
  if (hasConflicts(parameter) && !hasManualConfirm(parameter)) return true
  if (uniquenessMultiple(parameter)) return true
  if (parameter && parameter.acquisition && parameter.acquisition.status === 'CONFLICT') return true
  if (codesInclude(parameter, 'NEW_DATA_SOURCE_REQUIRED')) return true
  if (codesInclude(parameter, 'SOURCE_CONFLICT')) return true
  if (parameter && parameter.scopeReachable === false && !parameterImplementable(parameter)) return true
  return false
}

function isHighConfidence(parameter, eventContext) {
  const E = hasExpression(parameter)
  const S = sourcePathClosed(parameter) || (hasSourcePath(parameter) && parameter && parameter.scopeReachable === true)
  const G = hasStrongEvidence(parameter)
  const I = parameterImplementable(parameter)
  const U = str(parameter && parameter.sourceUniqueness) !== 'multiple'
  const P = str(parameter && parameter.pathUniqueness) !== 'multiple'
  const C = !hasConflicts(parameter)
  const R = !isParameterUnresolved(parameter, eventContext)
  const K = !codesInclude(parameter, 'NEW_DATA_SOURCE_REQUIRED')
  const M = !(parameter && parameter.acquisition && parameter.acquisition.status === 'CONFLICT') && !codesInclude(parameter, 'SOURCE_CONFLICT')
  const H = !codesInclude(parameter, 'SHARED_COMPONENT_IMPACT')
    && !(parameter && parameter.acquisition && parameter.acquisition.impact && parameter.acquisition.impact.scope === 'shared-component')
  const N = !uniquenessUnknown(parameter)
  const Q = !onlySupportingEvidence(parameter)
  return E && S && G && I && U && P && C && R && K && M && H && N && Q
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
  isParameterUnresolved,
  parameterImplementable,
  sourcePathClosed
}
