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
  'manual-confirm',
  'local-binding',
  'component-reference',
  'ui-object-match',
  'variable-name-similarity',
  'historical-pattern'
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
  'manual-confirm',
  'local-binding',
  'component-reference'
])

const SUPPORTING_EVIDENCE_TYPES = new Set([
  'same-module-tracking',
  'field-memory',
  'repository-convention',
  'ui-object-match',
  'variable-name-similarity',
  'historical-pattern'
])

const STRONG_REQUIRED_FIELDS = {
  'same-component-tracking': ['file', 'parameterKey', 'expression'],
  'same-page-tracking': ['file', 'parameterKey', 'expression'],
  'prop-chain': ['file'],
  'component-reference': ['file'],
  'hook-chain': ['file', 'expression'],
  'context-chain': ['file'],
  'url-field': ['expression'],
  'api-field': ['file'],
  'local-binding': ['file', 'expression'],
  'jsx-binding': ['file', 'expression']
}

const ACQUISITION_KINDS = [
  'prop-pass',
  'hook-call',
  'context-read',
  'url-read',
  'user-context-read'
]

const UNRESOLVED_CODES = [
  'PARAM_SOURCE_UNKNOWN',
  'PARAM_SEMANTIC_AMBIGUOUS',
  'ACQUISITION_PATH_UNKNOWN',
  'ACQUISITION_NOT_UNIQUE',
  'SHARED_COMPONENT_IMPACT',
  'SOURCE_CONFLICT',
  'URL_SEMANTIC_UNKNOWN',
  'NEW_DATA_SOURCE_REQUIRED',
  'REACHABILITY_UNKNOWN',
  'SCAN_CANDIDATE_DROPPED'
]

const CANDIDATE_BAND = {
  'same-component-tracking': 1,
  'same-page-tracking': 2,
  'local-binding': 3,
  'jsx-binding': 3,
  'api-field': 4,
  'url-field': 5,
  'user-context': 6,
  'acquisition-only': 7,
  'supporting-only': 8
}

module.exports = {
  PARAMETER_EVIDENCE_TYPES,
  STRONG_EVIDENCE_TYPES,
  SUPPORTING_EVIDENCE_TYPES,
  STRONG_REQUIRED_FIELDS,
  ACQUISITION_KINDS,
  UNRESOLVED_CODES,
  CANDIDATE_BAND
}
