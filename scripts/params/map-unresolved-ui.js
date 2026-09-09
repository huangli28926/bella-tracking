function str(value) {
  return value == null ? '' : String(value).trim()
}

function mapUnresolvedCode(code, key) {
  const k = str(key)
  if (str(code) === 'LOCATION_UNCONFIRMED') return '请确认埋点位置'
  if (!k) return '请确认埋点位置'
  return `请确认参数 ${k} 的取值`
}

function mapUnresolvedCodes(codes, key) {
  const list = Array.isArray(codes) ? codes : []
  const out = []
  const seen = new Set()
  list.forEach(item => {
    const code = typeof item === 'string' ? item : str(item && (item.code || item.reasonCode))
    if (!code) return
    const phrase = mapUnresolvedCode(code, key)
    if (seen.has(phrase)) return
    seen.add(phrase)
    out.push(phrase)
  })
  return out
}

function confirmClass(code) {
  const c = str(code)
  if (c === 'SHARED_COMPONENT_IMPACT') return 'IMPLEMENTATION_IMPACT_CONFIRM'
  if (c.indexOf('ACQUISITION_') === 0) return 'ACQUISITION_CONFIRM'
  return 'PARAMETER_VALUE_CONFIRM'
}

module.exports = {
  mapUnresolvedCode,
  mapUnresolvedCodes,
  confirmClass
}
