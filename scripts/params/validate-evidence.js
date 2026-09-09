const {
  PARAMETER_EVIDENCE_TYPES,
  STRONG_EVIDENCE_TYPES,
  SUPPORTING_EVIDENCE_TYPES,
  STRONG_REQUIRED_FIELDS
} = require('./evidence-types')

function str(value) {
  return value == null ? '' : String(value).trim()
}

function evidenceType(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
  return str(item.type)
}

function validateEvidenceList(parameter) {
  const issues = []
  const kept = []
  const list = Array.isArray(parameter && parameter.evidence) ? parameter.evidence : []
  list.forEach((item, idx) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push({ code: 'PARAM_EVIDENCE_INVALID', field: `evidence[${idx}]`, message: 'evidence item must be object' })
      return
    }
    const type = evidenceType(item)
    if (PARAMETER_EVIDENCE_TYPES.indexOf(type) === -1) {
      issues.push({ code: 'PARAM_EVIDENCE_INVALID', field: `evidence[${idx}].type`, message: `invalid evidence type: ${type || '(empty)'}` })
      return
    }
    const required = STRONG_REQUIRED_FIELDS[type]
    if (required && required.length) {
      const missing = required.filter(field => !str(item[field]) && !(field === 'parameterKey' && str(parameter && parameter.key)))
      if (missing.length) {
        issues.push({
          code: 'PARAM_EVIDENCE_INCOMPLETE',
          field: `evidence[${idx}]`,
          message: `missing fields: ${missing.join(',')}`
        })
        return
      }
    }
    kept.push(item)
  })
  const strong = kept.filter(item => STRONG_EVIDENCE_TYPES.has(evidenceType(item)))
  const supporting = kept.filter(item => SUPPORTING_EVIDENCE_TYPES.has(evidenceType(item)))
  return { issues, kept, strong, supporting }
}

function hasStrongEvidence(parameter) {
  return validateEvidenceList(parameter).strong.length > 0
}

module.exports = {
  validateEvidenceList,
  hasStrongEvidence,
  evidenceType
}
