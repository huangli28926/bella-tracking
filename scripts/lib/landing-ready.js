const fs = require('fs')
const path = require('path')
const { readJson, safeEvtFileName } = require('./lib')
const { loadConfirmQueue } = require('../confirm/needs-confirm')

function fileOk(filePath) {
  try {
    return !!filePath && fs.existsSync(filePath) && fs.statSync(filePath).size > 0
  } catch (error) {
    return false
  }
}

function listMissingDiagrams(paths) {
  if (!fileOk(paths.eventsPath)) {
    return []
  }
  const payload = readJson(paths.eventsPath, { events: [] })
  const events = Array.isArray(payload.events) ? payload.events : []
  const imagesDir = path.join(path.dirname(paths.eventsPath), 'images')
  return events
    .filter(item => !fileOk(path.join(imagesDir, `${safeEvtFileName(item && item.evtId)}.png`)))
    .map(item => String((item && item.evtId) || ''))
}

/**
 * A/B/C 依赖门禁：needA = 缺产物/缺图/未分析（pending）；needB = 已分析且待确认队列未清。
 * A.done（含 validate）由 tracking-workflow.stageADone 计算，不把 needsConfirm 算进 A。
 * 整页「进入 C」无法从磁盘判定，调用方须另开 serve-impl。
 */
function inspectLanding(paths) {
  const missing = []
  if (!fileOk(paths.eventsPath)) missing.push('events.json')
  if (!fileOk(paths.adaptorPath)) missing.push('adaptor.json')
  if (!fileOk(paths.implPath)) missing.push('impl.json')
  if (!fileOk(paths.htmlPath)) missing.push('落库.html')
  const missingDiagrams = listMissingDiagrams(paths)
  if (missingDiagrams.length) missing.push('示意图')

  const impl = readJson(paths.implPath, { events: [] })
  const events = Array.isArray(impl.events) ? impl.events : []
  const pendingEvents = events.filter(item => !item || !item.status || item.status === 'pending').length
  const emptyImpl = events.length === 0

  let pendingConfirm = 0
  try {
    pendingConfirm = loadConfirmQueue(paths).pendingCount
  } catch (error) {
    pendingConfirm = events.length
  }

  const needA = missing.length > 0 || emptyImpl || pendingEvents > 0
  const artifactsReady = missing.length === 0 && !emptyImpl && pendingEvents === 0
  const needB = artifactsReady && pendingConfirm > 0
  const queueCleared = artifactsReady && pendingConfirm === 0

  const reasons = []
  if (missing.length) reasons.push('missing:' + missing.join(','))
  if (missingDiagrams.length) reasons.push('missingDiagrams=' + missingDiagrams.length)
  if (emptyImpl && fileOk(paths.implPath)) reasons.push('impl.events empty')
  if (pendingEvents > 0) reasons.push('pendingEvents=' + pendingEvents)
  if (needB) reasons.push('pendingConfirm=' + pendingConfirm)

  return {
    artifactsReady,
    queueCleared,
    needA,
    needB,
    needFullPageConfirm: true,
    missing,
    missingDiagrams,
    eventCount: events.length,
    pendingEvents,
    pendingConfirm,
    reasons,
    readyForCPreflight: queueCleared
  }
}

module.exports = { fileOk, inspectLanding, listMissingDiagrams }
