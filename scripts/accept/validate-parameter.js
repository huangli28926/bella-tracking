const {
  PARAMETER_EVIDENCE_TYPES,
  calculateParameterConfidence,
  hasStrongEvidence,
  isLegacyParameter,
  isParameterUnresolved
} = require('./calculate-confidence')

const GATE_STATUS = ['READY', 'NEEDS_CONFIRM', 'INVALID']
const ISSUE_LEVEL = { error: 'error', confirm: 'confirm', info: 'info' }

const KNOWN_EVIDENCE_TYPES = new Set(PARAMETER_EVIDENCE_TYPES)

function str(value) {
  return value == null ? '' : String(value).trim()
}

function hasOwn(obj, key) {
  return !!(obj && Object.prototype.hasOwnProperty.call(obj, key))
}

function isRequiredParameter(parameter) {
  if (!parameter || typeof parameter !== 'object') return true
  if (parameter.required === false) return false
  return true
}

function hasExpression(parameter) {
  return !!str(parameter && parameter.expression)
}

function sourcePathText(parameter) {
  const value = parameter && parameter.sourcePath
  if (Array.isArray(value)) {
    return value.map(item => str(item)).filter(Boolean).join(' -> ')
  }
  return str(value)
}

function sourcePathNodes(parameter) {
  const value = parameter && parameter.sourcePath
  if (Array.isArray(value)) return value.map(item => str(item))
  const text = str(value)
  if (!text) return []
  return text.split(/\s*(?:->|→)\s*/)
}

function hasSourcePath(parameter) {
  if (Array.isArray(parameter && parameter.sourcePath)) {
    return parameter.sourcePath.some(item => !!str(item))
  }
  return !!sourcePathText(parameter)
}

function evidenceList(parameter) {
  return Array.isArray(parameter && parameter.evidence) ? parameter.evidence : []
}

function hasValidEvidence(parameter) {
  return evidenceList(parameter).some(item => item && KNOWN_EVIDENCE_TYPES.has(str(item.type)))
}

function issue(code, level, field, message) {
  return { code, level, field: field || '', message: message || '' }
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

function transformEvidenceList(parameter) {
  const transform = parameter && parameter.transform
  if (!transform || typeof transform !== 'object' || Array.isArray(transform)) return []
  return Array.isArray(transform.evidence) ? transform.evidence : []
}

function hasTransformEvidence(parameter) {
  return transformEvidenceList(parameter).some(item => item && KNOWN_EVIDENCE_TYPES.has(str(item.type)))
}

function hasInvalidTransformEvidence(parameter) {
  if (!parameter || !hasOwn(parameter, 'transform')) return false
  const transform = parameter.transform
  if (transform == null) return false
  if (typeof transform !== 'object' || Array.isArray(transform)) return true
  return transformEvidenceList(parameter).some(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return true
    return !KNOWN_EVIDENCE_TYPES.has(str(item.type))
  })
}

function rootIdentifier(expression) {
  const text = str(expression)
  const match = text.match(/^([A-Za-z_$][\w$]*)/)
  return match ? match[1] : ''
}

function knownSymbolSet(context) {
  if (!context || context.knownSymbols == null) return null
  if (context.knownSymbols instanceof Set) return context.knownSymbols
  if (Array.isArray(context.knownSymbols)) return new Set(context.knownSymbols.map(item => str(item)).filter(Boolean))
  return null
}

function isOptionalOmitted(parameter) {
  return !isRequiredParameter(parameter) && !hasExpression(parameter)
}

function isLegacyGateSkip(parameter) {
  return !!(parameter && (parameter.legacyUnverified === true || isLegacyParameter(parameter)))
}

function validateCompleteness(parameter, issues) {
  if (isOptionalOmitted(parameter)) {
    issues.push(issue('PARAM_OPTIONAL_OMITTED', ISSUE_LEVEL.info, 'expression', 'optional parameter omitted; do not invent an expression'))
    return
  }
  if (!isRequiredParameter(parameter)) return
  if (!hasExpression(parameter)) {
    if (str(parameter.confidence) === 'high') {
      issues.push(issue('PARAM_FACT_CONFLICT', ISSUE_LEVEL.error, 'expression', 'required expression missing but confidence is high'))
    } else {
      issues.push(issue('PARAM_EXPRESSION_MISSING', ISSUE_LEVEL.confirm, 'expression', 'required expression is not confirmed'))
    }
  }
  if (!hasSourcePath(parameter)) {
    issues.push(issue('PARAM_SOURCE_PATH_MISSING', ISSUE_LEVEL.confirm, 'sourcePath', 'sourcePath is empty'))
  }
  if (!hasValidEvidence(parameter)) {
    issues.push(issue('PARAM_EVIDENCE_MISSING', ISSUE_LEVEL.confirm, 'evidence', 'no valid evidence'))
  }
}

function validateEvidence(parameter, issues) {
  if (isOptionalOmitted(parameter)) return
  if (!hasOwn(parameter, 'evidence')) return
  if (!Array.isArray(parameter.evidence)) {
    issues.push(issue('PARAM_EVIDENCE_INVALID', ISSUE_LEVEL.error, 'evidence', 'evidence must be an array'))
    return
  }
  parameter.evidence.forEach((item, idx) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push(issue('PARAM_EVIDENCE_INVALID', ISSUE_LEVEL.error, `evidence[${idx}]`, 'evidence item must be object'))
      return
    }
    if (!KNOWN_EVIDENCE_TYPES.has(str(item.type))) {
      issues.push(issue('PARAM_EVIDENCE_INVALID', ISSUE_LEVEL.error, `evidence[${idx}].type`, `invalid evidence type: ${item.type || '(empty)'}`))
    }
  })
  if (hasExpression(parameter) && hasValidEvidence(parameter) && !hasStrongEvidence(parameter)) {
    issues.push(issue('PARAM_STRONG_EVIDENCE_MISSING', ISSUE_LEVEL.confirm, 'evidence', 'no strong evidence can prove the expression for automatic implementation'))
  }
}

function validateSourcePath(parameter, issues) {
  if (isOptionalOmitted(parameter) || !hasSourcePath(parameter)) return
  const nodes = sourcePathNodes(parameter)
  if (nodes.some(node => !node)) {
    issues.push(issue('PARAM_SOURCE_PATH_INVALID', ISSUE_LEVEL.error, 'sourcePath', 'sourcePath contains empty nodes'))
  }
}

function validateScopeReachability(parameter, issues) {
  if (isOptionalOmitted(parameter)) return
  if (!hasOwn(parameter, 'scopeReachable') || parameter.scopeReachable === null || parameter.scopeReachable === undefined) {
    issues.push(issue('PARAM_SCOPE_UNKNOWN', ISSUE_LEVEL.confirm, 'scopeReachable', 'scopeReachable is unknown'))
    return
  }
  if (parameter.scopeReachable === false) {
    issues.push(issue('PARAM_SCOPE_UNREACHABLE', ISSUE_LEVEL.error, 'scopeReachable', 'expression is not reachable at the insertion point'))
    return
  }
  if (parameter.scopeReachable !== true) {
    issues.push(issue('PARAM_SCOPE_UNKNOWN', ISSUE_LEVEL.confirm, 'scopeReachable', 'scopeReachable is unknown'))
  }
}

function validateExpression(parameter, context, issues) {
  if (isOptionalOmitted(parameter) || !hasExpression(parameter)) return
  const symbols = knownSymbolSet(context)
  if (!symbols) return
  const root = rootIdentifier(parameter.expression)
  if (!root || !symbols.has(root)) {
    issues.push(issue('PARAM_SYMBOL_NOT_FOUND', ISSUE_LEVEL.error, 'expression', `root symbol not found: ${root || '(empty)'}`))
  }
}

function validateTransform(parameter, issues) {
  if (isOptionalOmitted(parameter) || !hasExpression(parameter)) return
  if (hasInvalidTransformEvidence(parameter)) {
    issues.push(issue('PARAM_TRANSFORM_INVALID', ISSUE_LEVEL.error, 'transform', 'transform evidence is invalid'))
    return
  }
  if (looksLikeTransform(parameter.expression) && !hasTransformEvidence(parameter)) {
    issues.push(issue('PARAM_TRANSFORM_UNVERIFIED', ISSUE_LEVEL.confirm, 'transform', 'expression has a transform without transform evidence'))
  }
}

function validateConfidenceConsistency(parameter, eventContext, issues) {
  if (isLegacyGateSkip(parameter) || isOptionalOmitted(parameter)) return
  const calculated = calculateParameterConfidence(parameter, eventContext)
  const stored = str(parameter && parameter.confidence)
  if (stored !== calculated) {
    issues.push(issue(
      'PARAM_CONFIDENCE_INCONSISTENT',
      ISSUE_LEVEL.error,
      'confidence',
      `confidence must be derived (${calculated}), got ${stored || '(empty)'}`
    ))
  }
}

function validateUnresolved(parameter, eventContext, issues) {
  if (isOptionalOmitted(parameter)) return
  if (!isParameterUnresolved(parameter, eventContext)) return
  if (str(parameter.confidence) === 'high' && hasExpression(parameter)) {
    issues.push(issue('PARAM_FACT_CONFLICT', ISSUE_LEVEL.error, 'unresolved', 'unresolved remains while confidence is high'))
    return
  }
  issues.push(issue('PARAM_UNRESOLVED_REMAINING', ISSUE_LEVEL.confirm, 'unresolved', 'parameter still has unresolved confirmation'))
}

function hasError(issues) {
  return issues.some(item => item.level === ISSUE_LEVEL.error)
}

function hasConfirmIssue(issues) {
  return issues.some(item => item.level === ISSUE_LEVEL.confirm)
}

function isParameterReady(parameter, eventContext) {
  if (isOptionalOmitted(parameter)) return true
  if (isLegacyGateSkip(parameter)) {
    const expr = str(parameter && parameter.expression)
    const confidence = str(parameter && parameter.confidence)
    return !!expr && confidence !== 'low' && confidence !== 'medium'
  }
  return (
    hasExpression(parameter)
    && hasSourcePath(parameter)
    && hasValidEvidence(parameter)
    && hasStrongEvidence(parameter)
    && parameter
    && parameter.scopeReachable === true
    && str(parameter.confidence) === 'high'
    && !isParameterUnresolved(parameter, eventContext)
    && (!looksLikeTransform(parameter.expression) || hasTransformEvidence(parameter))
  )
}

function legacyParameterResult(parameter) {
  const expr = str(parameter && parameter.expression)
  const confidence = str(parameter && parameter.confidence)
  if (!expr || confidence === 'low' || confidence === 'medium') {
    return {
      status: 'NEEDS_CONFIRM',
      issues: [issue('PARAM_UNRESOLVED_REMAINING', ISSUE_LEVEL.confirm, 'legacy', 'legacy parameter still needs confirmation')]
    }
  }
  return { status: 'READY', issues: [] }
}

function validateParameter(parameter, eventContext) {
  if (!parameter || typeof parameter !== 'object') {
    return {
      status: 'INVALID',
      issues: [issue('PARAM_EVIDENCE_INVALID', ISSUE_LEVEL.error, '', 'parameter must be object')]
    }
  }
  if (isLegacyGateSkip(parameter)) {
    return legacyParameterResult(parameter)
  }

  const issues = []
  validateCompleteness(parameter, issues)
  validateEvidence(parameter, issues)
  validateSourcePath(parameter, issues)
  validateScopeReachability(parameter, issues)
  validateExpression(parameter, eventContext, issues)
  validateTransform(parameter, issues)
  validateConfidenceConsistency(parameter, eventContext, issues)
  validateUnresolved(parameter, eventContext, issues)

  if (hasError(issues)) {
    return { status: 'INVALID', issues }
  }
  if (hasConfirmIssue(issues)) {
    return { status: 'NEEDS_CONFIRM', issues }
  }
  if (!isParameterReady(parameter, eventContext)) {
    return {
      status: 'NEEDS_CONFIRM',
      issues: issues.concat([issue('PARAM_STRONG_EVIDENCE_MISSING', ISSUE_LEVEL.confirm, '', 'parameter facts are not sufficient for READY')])
    }
  }
  return { status: 'READY', issues }
}

function worseStatus(current, next) {
  const rank = { INVALID: 2, NEEDS_CONFIRM: 1, READY: 0 }
  return (rank[next] || 0) > (rank[current] || 0) ? next : current
}

function eventParameterGate(event) {
  const parameters = Array.isArray(event && event.parameters) ? event.parameters : []
  const results = parameters.map(parameter => validateParameter(parameter, event))
  let status = 'READY'
  results.forEach(result => {
    status = worseStatus(status, result.status)
  })
  return {
    status,
    needsConfirm: status === 'NEEDS_CONFIRM',
    parameters: results
  }
}

module.exports = {
  GATE_STATUS,
  validateParameter,
  eventParameterGate,
  isParameterReady,
  isRequiredParameter,
  looksLikeTransform,
  hasTransformEvidence
}
