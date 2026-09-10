const fs = require('fs')
const path = require('path')
const { readJson, safeEvtFileName } = require('./lib')
const { loadConfirmQueue } = require('../confirm/needs-confirm')
const { summarizeImplGates } = require('../accept/impl/validate-impl')

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
 * A/B/C 依赖门禁：needA = 缺产物/缺图/未分析；needInvalid = collectImplGates 存在 INVALID；
 * needB = 待确认队列未清或存在 NEEDS_CONFIRM。全部 READY 才允许进入 C 预检。
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

  const implGates = summarizeImplGates(impl)
  const needA = missing.length > 0 || emptyImpl || pendingEvents > 0
  const artifactsReady = missing.length === 0 && !emptyImpl && pendingEvents === 0
  const needInvalid = artifactsReady && implGates.invalidCount > 0
  const needB = artifactsReady && !needInvalid && (pendingConfirm > 0 || implGates.needsConfirmCount > 0)
  const queueCleared = artifactsReady && pendingConfirm === 0 && implGates.needsConfirmCount === 0 && !needInvalid

  const reasons = []
  if (missing.length) reasons.push('missing:' + missing.join(','))
  if (missingDiagrams.length) reasons.push('missingDiagrams=' + missingDiagrams.length)
  if (emptyImpl && fileOk(paths.implPath)) reasons.push('impl.events empty')
  if (pendingEvents > 0) reasons.push('pendingEvents=' + pendingEvents)
  if (needInvalid) reasons.push('invalidGates=' + implGates.invalidCount)
  if (needB) reasons.push('pendingConfirm=' + pendingConfirm + ';needsConfirmGates=' + implGates.needsConfirmCount)

  return {
    artifactsReady,
    queueCleared,
    needA,
    needB,
    needInvalid,
    needFullPageConfirm: true,
    missing,
    missingDiagrams,
    eventCount: events.length,
    pendingEvents,
    pendingConfirm,
    implGates,
    reasons,
    readyForCPreflight: queueCleared && implGates.allReady
  }
}

module.exports = { fileOk, inspectLanding, listMissingDiagrams }
