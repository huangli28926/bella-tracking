const path = require('path')
const { readJson, writeJson } = require('./lib')
const { inferValueKind } = require('./value-kind')

// 记忆条目按「key + 文档说明指纹」寻址：只有 key 与文档说明都一致，才自动带入上次确认值。
const MEMORY_KEY_SEP = '\u0001'
const OVERRIDABLE_CONFIDENCE = ['', 'low', 'medium']
const DESC_PUNCTUATION = /[。．.,，、;；:：!！?？~～"'“”‘’`()（）\[\]【】{}｛｝<>《》]/g

function str(value) {
  return value == null ? '' : String(value).trim()
}

// 归一化文档说明：全角转半角，忽略大小写、空白与常见标点差异。
function normalizeDesc(text) {
  return String(text == null ? '' : text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(DESC_PUNCTUATION, '')
}

function paramDescKey(param) {
  return normalizeDesc(param && param.docDesc)
}

function memoryKeyOf(key, descKey) {
  return str(key) + MEMORY_KEY_SEP + String(descKey == null ? '' : descKey)
}

function emptyMemory() {
  return { parameters: {}, docDescIndex: {} }
}

function fieldMemoryPath(paths) {
  if (paths && paths.fieldMemoryPath) {
    return paths.fieldMemoryPath
  }
  if (paths && paths.outDir) {
    return path.join(paths.outDir, '_raw', 'field-memory.json')
  }
  return ''
}

function loadFieldMemory(paths) {
  const filePath = fieldMemoryPath(paths)
  if (!filePath) {
    return emptyMemory()
  }
  const raw = readJson(filePath, emptyMemory())
  const parameters = raw && raw.parameters && typeof raw.parameters === 'object' ? raw.parameters : {}
  return { parameters, docDescIndex: {} }
}

// events.json: events[].params[] = { key, desc }
function buildDocDescIndex(eventsPayload) {
  const index = {}
  ;((eventsPayload && eventsPayload.events) || []).forEach(event => {
    const evtId = str(event && event.evtId)
    if (!evtId) {
      return
    }
    const byKey = {}
    ;((event && event.params) || []).forEach(item => {
      const key = str(item && item.key)
      if (!key) {
        return
      }
      byKey[key] = str(item && (item.desc || item.docDesc))
    })
    index[evtId] = byKey
  })
  return index
}

function loadDocDescIndex(paths) {
  const eventsPath = paths && paths.eventsPath
  if (!eventsPath) {
    return {}
  }
  try {
    return buildDocDescIndex(readJson(eventsPath, { events: [] }))
  } catch (error) {
    return {}
  }
}

// impl.json 里的参数可能没写 docDesc，按 evtId + key 从 events.json 补齐后再匹配。
function enrichDocDesc(param, evtId, index) {
  if (str(param && param.docDesc)) {
    return param
  }
  const byKey = index && index[str(evtId)]
  const fromDoc = byKey ? str(byKey[str(param && param.key)]) : ''
  if (!fromDoc) {
    return param
  }
  return Object.assign({}, param, { docDesc: fromDoc })
}

function writeFieldMemory(paths, memory) {
  const filePath = fieldMemoryPath(paths)
  if (!filePath) {
    return
  }
  writeJson(filePath, {
    generatedAt: new Date().toISOString(),
    parameters: (memory && memory.parameters) || {}
  })
}

function paramNeedsBackfill(param) {
  return !String((param && param.expression) || '').trim()
}

function upsertFromConfirmedEvent(memory, event) {
  const next = {
    parameters: Object.assign({}, (memory && memory.parameters) || {}),
    docDescIndex: (memory && memory.docDescIndex) || {}
  }
  if (!event || !event.confirmed) {
    return next
  }
  const evtId = str(event.evtId)
  const now = new Date().toISOString()
  ;(event.parameters || []).forEach(raw => {
    const param = enrichDocDesc(raw, evtId, next.docDescIndex)
    const key = str(param && param.key)
    const expression = str(param && param.expression)
    if (!key || !expression) {
      return
    }
    const docDesc = str(param && param.docDesc)
    const descKey = normalizeDesc(docDesc)
    next.parameters[memoryKeyOf(key, descKey)] = {
      key,
      docDesc,
      descKey,
      expression,
      valueKind: inferValueKind(expression, param && param.valueKind),
      sourcePath: String((param && param.sourcePath) || ''),
      fromEvtId: evtId,
      updatedAt: now
    }
  })
  return next
}

function seedFromConfirmed(implPayload, docDescIndex) {
  let memory = { parameters: {}, docDescIndex: docDescIndex || {} }
  ;((implPayload && implPayload.events) || []).forEach(event => {
    if (event && event.confirmed) {
      memory = upsertFromConfirmedEvent(memory, event)
    }
  })
  return memory
}

function loadMergedMemory(paths, implPayload) {
  const docDescIndex = loadDocDescIndex(paths)
  const seeded = seedFromConfirmed(implPayload, docDescIndex)
  const file = loadFieldMemory(paths)
  return {
    parameters: Object.assign({}, seeded.parameters, file.parameters || {}),
    docDescIndex
  }
}

function findMemoryEntry(memory, param) {
  const key = str(param && param.key)
  if (!key) {
    return null
  }
  const params = (memory && memory.parameters) || {}
  const descKey = paramDescKey(param)
  const exact = params[memoryKeyOf(key, descKey)]
  if (exact && typeof exact === 'object') {
    return { entry: exact, descMatched: true }
  }
  // 兼容没有描述指纹的旧记忆文件：仅当当前参数也没有文档说明时才作为兜底。
  const legacy = params[key]
  if (legacy && typeof legacy === 'object' && legacy.descKey === undefined && !descKey) {
    return { entry: legacy, descMatched: false }
  }
  return null
}

function isHumanConfirmedParam(param) {
  const status = str(param && param.confirmation && param.confirmation.status)
  return status === 'confirmed' || status === 'reused'
}

/**
 * 空表达式：直接带入。
 * 已有候选：只有文档说明被证明一致（key + 描述都对上），才允许覆盖 low / medium 候选；
 * high 置信度与已人工确认的参数一律不覆盖。
 */
function canApplyMemoryValue(param, hit) {
  if (paramNeedsBackfill(param)) {
    return true
  }
  if (!hit || hit.descMatched !== true) {
    return false
  }
  if (isHumanConfirmedParam(param)) {
    return false
  }
  return OVERRIDABLE_CONFIDENCE.indexOf(str(param && param.confidence)) !== -1
}

function applyToEvent(event, memory) {
  if (!event || event.confirmed) {
    return { event, changed: false }
  }
  const { eventAnalysisReady } = require('../confirm/needs-confirm')
  if (!eventAnalysisReady(event)) {
    return { event, changed: false }
  }
  const evtId = str(event.evtId)
  const docDescIndex = (memory && memory.docDescIndex) || {}
  let changed = false
  const parameters = (Array.isArray(event.parameters) ? event.parameters : []).map(raw => {
    const param = enrichDocDesc(raw, evtId, docDescIndex)
    const hit = findMemoryEntry(memory, param)
    if (!hit) {
      return raw
    }
    const memExpr = str(hit.entry.expression)
    if (!memExpr || !canApplyMemoryValue(param, hit)) {
      return raw
    }
    const currentExpr = str(param.expression)
    const sameValue = currentExpr !== '' && currentExpr === memExpr
    if (sameValue && param.fromMemory === true && str(param.fromEvtId) === str(hit.entry.fromEvtId)) {
      return raw
    }
    const replaced = currentExpr !== '' && !sameValue
      ? {
          expression: currentExpr,
          valueKind: inferValueKind(currentExpr, param.valueKind),
          sourcePath: String(param.sourcePath || ''),
          confidence: str(param.confidence)
        }
      : null
    changed = true
    return Object.assign({}, param, {
      expression: memExpr,
      valueKind: inferValueKind(memExpr, hit.entry.valueKind),
      sourcePath: hit.entry.sourcePath !== undefined ? String(hit.entry.sourcePath || '') : String(param.sourcePath || ''),
      confidence: 'medium',
      fromMemory: true,
      fromEvtId: str(hit.entry.fromEvtId),
      memoryDescMatched: hit.descMatched === true,
      memoryReplaced: replaced
    })
  })
  if (!changed) {
    return { event, changed: false }
  }
  return { event: Object.assign({}, event, { parameters }), changed: true }
}

function applyToPayload(implPayload, memory) {
  const payload = implPayload && typeof implPayload === 'object' ? implPayload : { events: [] }
  let changed = false
  const events = (payload.events || []).map(event => {
    const result = applyToEvent(event, memory)
    if (result.changed) {
      changed = true
    }
    return result.event
  })
  return {
    payload: Object.assign({}, payload, { events }),
    changed
  }
}

function applyFieldMemoryToImplFile(paths) {
  if (!paths || !paths.implPath) {
    return { changed: false }
  }
  const implPayload = readJson(paths.implPath, { events: [] })
  const memory = loadMergedMemory(paths, implPayload)
  const applied = applyToPayload(implPayload, memory)
  if (applied.changed) {
    writeJson(paths.implPath, applied.payload)
  }
  return applied
}

module.exports = {
  applyFieldMemoryToImplFile,
  applyToEvent,
  applyToPayload,
  buildDocDescIndex,
  canApplyMemoryValue,
  findMemoryEntry,
  normalizeDesc,
  paramNeedsBackfill,
  emptyMemory,
  fieldMemoryPath,
  loadDocDescIndex,
  loadFieldMemory,
  loadMergedMemory,
  upsertFromConfirmedEvent,
  writeFieldMemory
}
