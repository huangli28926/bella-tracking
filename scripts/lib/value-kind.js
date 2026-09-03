function inferValueKind(text, explicit) {
  const kind = String(explicit || '').trim()
  if (kind === 'expression' || kind === 'prompt') {
    return kind
  }
  const s = String(text || '').trim()
  if (!s) {
    return ''
  }
  if (/[\u4e00-\u9fff]/.test(s)) {
    return 'prompt'
  }
  if (/\s/.test(s) && !/[.?:=]|[|]{2}|&&|\?/.test(s)) {
    return 'prompt'
  }
  return 'expression'
}

function normalizeValueKind(param) {
  return inferValueKind(
    (param && param.expression) || '',
    param && param.valueKind
  )
}

module.exports = {
  inferValueKind,
  normalizeValueKind
}
