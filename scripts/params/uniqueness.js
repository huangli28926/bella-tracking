const { CANDIDATE_BAND } = require('./evidence-types')
const { normalizeExpr } = require('./scan-existing-tracking')

function str(value) {
  return value == null ? '' : String(value).trim()
}

function isCompatible(candidate) {
  if (!candidate) return false
  if (str(candidate.rejectedReason) === 'semantic-incompatible') return false
  if (candidate.semanticCompatible === false) return false
  return true
}

function bandOf(candidate) {
  if (typeof candidate.band === 'number') return candidate.band
  return CANDIDATE_BAND[str(candidate.type)] || CANDIDATE_BAND['acquisition-only']
}

function computeSourceUniqueness(candidates) {
  const list = Array.isArray(candidates) ? candidates : []
  const compatible = list.filter(isCompatible)
  if (!list.length) {
    return { sourceUniqueness: 'unknown', selectedBand: null, selected: [] }
  }
  if (!compatible.length) {
    return { sourceUniqueness: 'unknown', selectedBand: null, selected: [] }
  }
  let selectedBand = Infinity
  compatible.forEach(item => {
    const band = bandOf(item)
    if (band < selectedBand) selectedBand = band
  })
  const selected = compatible.filter(item => bandOf(item) === selectedBand)
  const exprs = new Set(selected.map(item => normalizeExpr(item.expression)))
  let sourceUniqueness = 'unique'
  if (exprs.size > 1) sourceUniqueness = 'multiple'
  else if (exprs.size === 0) sourceUniqueness = 'unknown'
  return { sourceUniqueness, selectedBand, selected }
}

function applyPreferredCandidate(parameter) {
  const p = parameter && typeof parameter === 'object' ? parameter : {}
  const uniq = computeSourceUniqueness(p.candidates)
  if (uniq.sourceUniqueness === 'unique' && uniq.selected[0]) {
    const best = uniq.selected[0]
    if (!str(p.preferredCandidateId) && best.id) {
      p.preferredCandidateId = best.id
    }
    if (!str(p.expression) && str(best.expression)) {
      p.expression = best.expression
    }
  }
  return p
}

module.exports = {
  computeSourceUniqueness,
  applyPreferredCandidate,
  isCompatible,
  bandOf
}
