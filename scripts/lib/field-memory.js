const path = require('path')
const { readJson, writeJson } = require('./lib')
const { inferValueKind } = require('./value-kind')

function emptyMemory() {
  return { parameters: {} }
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
  return { parameters }
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
    parameters: Object.assign({}, (memory && memory.parameters) || {})
  }
  if (!event || !event.confirmed) {
    return next
  }
  const evtId = String(event.evtId || '')
  const now = new Date().toISOString()
  ;(event.parameters || []).forEach(param => {
    const key = String((param && param.key) || '').trim()
    const expression = String((param && param.expression) || '').trim()
    if (!key || !expression) {
      return
    }
    next.parameters[key] = {
      expression,
      valueKind: inferValueKind(expression, param && param.valueKind),
      sourcePath: String((param && param.sourcePath) || ''),
      fromEvtId: evtId,
      updatedAt: now
    }
  })
  return next
}

function seedFromConfirmed(implPayload) {
  let memory = emptyMemory()
  ;((implPayload && implPayload.events) || []).forEach(event => {
    if (event && event.confirmed) {
      memory = upsertFromConfirmedEvent(memory, event)
    }
  })
  return memory
}

function loadMergedMemory(paths, implPayload) {
  const seeded = seedFromConfirmed(implPayload)
  const file = loadFieldMemory(paths)
  return {
    parameters: Object.assign({}, seeded.parameters, file.parameters || {})
  }
}

function applyToEvent(event, memory) {
  if (!event || event.confirmed) {
    return { event, changed: false }
  }
  const { eventAnalysisReady } = require('../confirm/needs-confirm')
  if (!eventAnalysisReady(event)) {
    return { event, changed: false }
  }
  const memParams = (memory && memory.parameters) || {}
  let changed = false
  const parameters = (Array.isArray(event.parameters) ? event.parameters : []).map(param => {
    const key = String((param && param.key) || '').trim()
    const mem = key ? memParams[key] : null
    const memExpr = mem ? String(mem.expression || '').trim() : ''
    if (!key || !memExpr || !paramNeedsBackfill(param)) {
      return param
    }
    changed = true
    return Object.assign({}, param, {
      expression: memExpr,
      valueKind: inferValueKind(memExpr, mem.valueKind),
      sourcePath: mem.sourcePath !== undefined ? String(mem.sourcePath || '') : String(param.sourcePath || ''),
      confidence: 'medium',
      fromMemory: true,
      fromEvtId: String(mem.fromEvtId || '')
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
  paramNeedsBackfill,
  emptyMemory,
  fieldMemoryPath,
  loadFieldMemory,
  loadMergedMemory,
  upsertFromConfirmedEvent,
  writeFieldMemory
}
