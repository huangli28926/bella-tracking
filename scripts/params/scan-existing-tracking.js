const fs = require('fs')
const path = require('path')
const { CANDIDATE_BAND } = require('./evidence-types')

function str(value) {
  return value == null ? '' : String(value).trim()
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeExpr(expression) {
  return str(expression).replace(/\s+/g, ' ')
}

function candidateId(file, expression, band) {
  return [band, file, normalizeExpr(expression)].join('|')
}

function extractKeyBindings(text, key) {
  const out = []
  if (!text || !key) return out
  const re = new RegExp('\\b' + escapeRegExp(key) + '\\s*:\\s*([^,\\n}]+)', 'g')
  let match
  while ((match = re.exec(text))) {
    const expression = normalizeExpr(match[1])
    if (expression) out.push(expression)
  }
  return out
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch (err) {
    return ''
  }
}

function scanFileForKey(filePath, key, band, component) {
  const text = readFileSafe(filePath)
  return extractKeyBindings(text, key).map(expression => ({
    id: candidateId(filePath, expression, band),
    band: band,
    parameterKey: key,
    expression,
    file: filePath,
    component: str(component),
    description: '',
    semanticCompatible: true,
    rejectedReason: '',
    origin: 'scan'
  }))
}

function scanExistingTracking(options) {
  const opts = options || {}
  const key = str(opts.key)
  const files = Array.isArray(opts.files) ? opts.files : []
  const fileContents = opts.fileContents || {}
  const out = []
  const seen = new Set()

  function push(item) {
    const id = item.id || candidateId(item.file, item.expression, item.band)
    if (seen.has(id)) return
    seen.add(id)
    out.push(Object.assign({ id }, item))
  }

  if (Array.isArray(opts.hits)) {
    opts.hits.forEach(hit => push(Object.assign({
      band: hit.band || CANDIDATE_BAND['same-component-tracking'],
      parameterKey: key,
      semanticCompatible: true,
      rejectedReason: '',
      origin: 'scan'
    }, hit)))
    return out
  }

  files.forEach(entry => {
    const file = typeof entry === 'string' ? entry : str(entry && entry.file)
    const band = (typeof entry === 'object' && entry && entry.band) || CANDIDATE_BAND['same-component-tracking']
    const component = typeof entry === 'object' ? str(entry.component) : ''
    const text = Object.prototype.hasOwnProperty.call(fileContents, file)
      ? String(fileContents[file] || '')
      : (path.isAbsolute(file) || file ? readFileSafe(file) : '')
    extractKeyBindings(text, key).forEach(expression => {
      push({
        band,
        parameterKey: key,
        expression,
        file,
        component,
        description: '',
        semanticCompatible: true,
        rejectedReason: '',
        origin: 'scan'
      })
    })
  })
  return out
}

function mergeScanCandidates(parameter, scanned) {
  const existing = Array.isArray(parameter && parameter.candidates) ? parameter.candidates.slice() : []
  const byId = new Map()
  existing.forEach(item => {
    if (!item) return
    const id = str(item.id) || candidateId(item.file, item.expression, item.band)
    byId.set(id, Object.assign({}, item, { id }))
  })
  const dropped = []
  const scanList = Array.isArray(scanned) ? scanned : []
  scanList.forEach(hit => {
    const id = str(hit.id) || candidateId(hit.file, hit.expression, hit.band)
    const prev = byId.get(id)
    if (!prev) {
      if (existing.length) dropped.push(id)
      byId.set(id, Object.assign({}, hit, { id, origin: 'scan' }))
      return
    }
    byId.set(id, Object.assign({}, hit, prev, {
      id,
      origin: 'scan',
      expression: prev.expression || hit.expression,
      file: prev.file || hit.file,
      semanticCompatible: prev.semanticCompatible,
      rejectedReason: prev.rejectedReason,
      preferred: prev.preferred
    }))
  })
  return {
    candidates: [...byId.values()],
    droppedScanIds: dropped,
    scanComplete: dropped.length === 0
  }
}

module.exports = {
  scanExistingTracking,
  mergeScanCandidates,
  extractKeyBindings,
  normalizeExpr,
  candidateId,
  scanFileForKey
}
