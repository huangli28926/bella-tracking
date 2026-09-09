function str(value) {
  return value == null ? '' : String(value).trim()
}

const UNRESOLVED_CODE_LABELS = {
  PARAM_SOURCE_UNKNOWN: '未找到可用的参数来源',
  PARAM_SEMANTIC_AMBIGUOUS: '同档多个来源语义无法区分',
  ACQUISITION_PATH_UNKNOWN: '取值路径无法从源码追通',
  ACQUISITION_NOT_UNIQUE: '取值路径不唯一',
  SHARED_COMPONENT_IMPACT: '改公共组件可能影响多个调用方',
  SOURCE_CONFLICT: '同优先级存在多个合法来源',
  URL_SEMANTIC_UNKNOWN: 'URL 字段缺少业务语义闭环',
  NEW_DATA_SOURCE_REQUIRED: '需要新的数据来源',
  REACHABILITY_UNKNOWN: '当前作用域无法证明可达',
  SCAN_CANDIDATE_DROPPED: '扫描候选被丢弃，完整性无效',
  MULTIPLE_REUSABLE_COMPONENT_CALLERS: '组件被多个页面复用，落点范围未确认'
}

function unresolvedCodeLabel(code) {
  const c = str(code)
  return UNRESOLVED_CODE_LABELS[c] || c
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
  UNRESOLVED_CODE_LABELS,
  unresolvedCodeLabel,
  mapUnresolvedCode,
  mapUnresolvedCodes,
  confirmClass
}
