const { calculateParameterConfidence, isLegacyParameter } = require('./calculate-confidence')
const { mergeScanCandidates } = require('./scan-existing-tracking')
const { computeScopeReachable } = require('./compute-scope-reachable')
const { validateAcquisition } = require('./validate-acquisition')
const { computeSourceUniqueness } = require('./uniqueness')
const { mapUnresolvedCodes } = require('./map-unresolved-ui')

function str(value) {
  return value == null ? '' : String(value).trim()
}

function normalizeSourcePath(value) {
  if (Array.isArray(value)) return value.map(item => str(item)).filter(Boolean)
  const text = str(value)
  if (!text) return ''
  return text
}

function materializeParameter(parameter, eventContext, context) {
  const p = parameter && typeof parameter === 'object' ? parameter : {}
  const ctx = context || {}
  const codes = []

  if (Array.isArray(ctx.scanned) && ctx.scanned.length) {
    const merged = mergeScanCandidates(p, ctx.scanned)
    p.candidates = merged.candidates
    if (merged.droppedScanIds.length) {
      codes.push('SCAN_CANDIDATE_DROPPED')
      p.scanIntegrity = 'invalid'
    }
  }

  if (Array.isArray(p.candidates) && p.candidates.length) {
    const uniq = computeSourceUniqueness(p.candidates)
    p.sourceUniqueness = uniq.sourceUniqueness
    p.selectedBand = uniq.selectedBand
    if (uniq.sourceUniqueness === 'multiple') {
      codes.push('SOURCE_CONFLICT')
      if (!Array.isArray(p.conflicts)) p.conflicts = []
      if (p.conflicts.indexOf('multiple-valid-parameter-sources') === -1) {
        p.conflicts.push('multiple-valid-parameter-sources')
      }
    }
  }

  if (ctx.computeReachability) {
    const computed = computeScopeReachable(p, eventContext, ctx)
    p.scopeReachable = computed
  }

  if (p.scopeReachable === true) {
    p.acquisition = {
      status: 'RESOLVED',
      requiresCodeChange: false,
      steps: [],
      impact: { scope: 'local', referenceCount: 0 }
    }
    p.pathUniqueness = 'unique'
    p.parameterImplementable = true
  } else if (p.acquisition && typeof p.acquisition === 'object') {
    const validated = validateAcquisition(Object.assign({}, p, { scopeReachable: p.scopeReachable === true ? true : false }), ctx)
    p.acquisition = {
      status: validated.status,
      requiresCodeChange: validated.requiresCodeChange,
      steps: validated.steps,
      impact: validated.impact
    }
    p.pathUniqueness = validated.pathUniqueness
    validated.codes.forEach(code => {
      if (codes.indexOf(code) === -1) codes.push(code)
    })
    p.parameterImplementable = validated.status === 'RESOLVED'
      && p.scopeReachable === false
      && validated.pathUniqueness === 'unique'
      && validated.impact
      && validated.impact.scope !== 'shared-component'
  } else if (p.scopeReachable === false) {
    p.pathUniqueness = 'unknown'
    p.parameterImplementable = false
    codes.push('ACQUISITION_PATH_UNKNOWN')
  } else if (p.scopeReachable === null) {
    p.parameterImplementable = false
    codes.push('REACHABILITY_UNKNOWN')
  }

  if (p.scanIntegrity === 'invalid') {
    p.parameterImplementable = false
  }

  const extra = Array.isArray(p.unresolvedCodes) ? p.unresolvedCodes : []
  extra.forEach(code => {
    if (codes.indexOf(code) === -1) codes.push(code)
  })
  p.unresolvedCodes = codes
  if (codes.length) {
    const mapped = mapUnresolvedCodes(codes, p.key)
    if (!Array.isArray(p.unresolved)) p.unresolved = []
    mapped.forEach(phrase => {
      if (p.unresolved.indexOf(phrase) === -1) p.unresolved.push(phrase)
    })
  }

  if (!p.legacyUnverified) {
    p.confidence = calculateParameterConfidence(p, eventContext)
  }
  return p
}

function materializeEventParameters(event, context) {
  const next = event || {}
  const list = Array.isArray(next.parameters) ? next.parameters : []
  next.parameters = list.map(parameter => {
    if (isLegacyParameter(parameter) || parameter.legacyUnverified) return parameter
    return materializeParameter(parameter, next, context)
  })
  return next
}

module.exports = {
  materializeParameter,
  materializeEventParameters,
  normalizeSourcePath
}
