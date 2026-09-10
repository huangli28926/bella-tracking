const { createHash } = require('crypto')

function str(value) {
  return String(value == null ? '' : value).trim()
}

function normalizeToken(value) {
  return str(value).toLowerCase().replace(/\s+/g, '-')
}

function normalizeStep(step) {
  if (step == null) return ''
  if (typeof step === 'string') return normalizeToken(step)
  const node = normalizeToken(step.node || step.from || step.pageKey || '')
  const action = normalizeToken(step.action || step.via || '')
  const to = normalizeToken(step.to || '')
  const locator = normalizeToken(step.value || '')
  return [node, action, to, locator].filter(Boolean).join(':')
}

function normalizedPathKey(candidate) {
  const item = candidate || {}
  const seed = normalizeToken(item.seedUrlKey || item.seedUrl || '')
  const page = normalizeToken(item.pageKey || '')
  const target = normalizeToken(item.target || '')
  const steps = (item.steps || []).map(normalizeStep).join('>')
  return [seed, page, steps, target].join('|')
}

function hashText(text) {
  return createHash('sha256').update(String(text || '')).digest('hex')
}

function pathIdForCandidate(candidate) {
  return hashText(normalizedPathKey(candidate)).slice(0, 16)
}

function candidateSignature(pathIds) {
  const sorted = (pathIds || []).map(str).filter(Boolean).slice().sort()
  return hashText(sorted.join('|')).slice(0, 16)
}

module.exports = {
  candidateSignature,
  hashText,
  normalizeStep,
  normalizedPathKey,
  pathIdForCandidate
}
