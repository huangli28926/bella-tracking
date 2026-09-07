#!/usr/bin/env node
/* eslint-disable no-console */
const { readJson } = require('../lib/lib')

function paramNeedsConfirm(item) {
  const expr = String((item && item.expression) || '').trim()
  const confidence = String((item && item.confidence) || '').trim()
  return !expr || confidence === 'low' || confidence === 'medium'
}

function eventNeedsConfirm(event) {
  if (!event || typeof event !== 'object') {
    return true
  }
  const status = event.status || 'pending'
  if (status === 'unresolved' || status === 'pending') {
    return true
  }
  if (Array.isArray(event.unresolved) && event.unresolved.length) {
    return true
  }
  const pathRes = event.accept && event.accept.pathResolution
  if (pathRes && pathRes.status === 'needsConfirm') {
    return true
  }
  if (!String(event.targetFile || '').trim()) {
    return true
  }
  if (String(event.uicodeConflict || '').trim()) {
    return true
  }
  const params = Array.isArray(event.parameters) ? event.parameters : []
  return params.some(paramNeedsConfirm)
}

function locationNeedsConfirm(event) {
  if (!event || typeof event !== 'object') {
    return true
  }
  const status = event.status || 'pending'
  if (status === 'unresolved' || status === 'pending') {
    return true
  }
  return !String(event.targetFile || '').trim()
}

function paramKeysNeedingConfirm(event) {
  const params = Array.isArray(event && event.parameters) ? event.parameters : []
  const keys = []
  params.forEach(item => {
    const key = String((item && item.key) || '').trim()
    if (!key) return
    if (paramNeedsConfirm(item)) {
      keys.push(key)
    }
  })
  return keys
}

function getConfirmReasons(event) {
  const reasons = []
  if (!event || typeof event !== 'object') {
    reasons.push('请确认埋点位置')
    return reasons
  }
  if (locationNeedsConfirm(event)) {
    reasons.push('请确认埋点位置')
  }
  paramKeysNeedingConfirm(event).forEach(key => {
    reasons.push('请确认参数 ' + key + ' 的取值')
  })
  if (String(event.uicodeConflict || '').trim()) {
    reasons.push('请确认 uicode（文档与落点不一致）')
  }
  const pathRes = event.accept && event.accept.pathResolution
  if (pathRes && pathRes.status === 'needsConfirm') {
    reasons.push('请确认验收入口路径')
  }
  return reasons
}

function implById(implPayload) {
  const map = {}
  ;((implPayload && implPayload.events) || []).forEach(item => {
    if (item && item.evtId) {
      map[String(item.evtId)] = item
    }
  })
  return map
}

function buildConfirmQueue(eventsPayload, implPayload, options) {
  const opts = options || {}
  const onlyPending = opts.onlyPending !== false
  const implMap = implById(implPayload)
  const docEvents = (eventsPayload && eventsPayload.events) || []
  const items = docEvents.map(doc => {
    const impl = implMap[String(doc.evtId)] || {}
    const merged = Object.assign({}, impl, {
      evtId: String(doc.evtId),
      eventName: doc.eventName || '',
      docIndex: doc.docIndex || 0,
      kind: doc.kind || '',
      confirmed: !!impl.confirmed,
      deferred: !!impl.deferred
    })
    return {
      evtId: merged.evtId,
      eventName: merged.eventName,
      docIndex: merged.docIndex,
      kind: merged.kind,
      confirmed: merged.confirmed,
      needsConfirm: eventNeedsConfirm(merged),
      reasons: getConfirmReasons(merged),
      event: merged
    }
  }).sort((a, b) => (a.docIndex || 0) - (b.docIndex || 0))

  const pending = items.filter(item => item.needsConfirm && !item.confirmed && !item.event.deferred)
  const deferredCount = items.filter(item => item.needsConfirm && !item.confirmed && item.event.deferred).length
  const queue = onlyPending ? pending : items
  return {
    total: docEvents.length,
    needsConfirmCount: items.filter(item => item.needsConfirm).length,
    confirmedCount: items.filter(item => item.confirmed).length,
    pendingCount: pending.length,
    deferredCount,
    items,
    queue,
    done: pending.length === 0
  }
}

function loadConfirmQueue(paths) {
  const eventsPayload = readJson(paths.eventsPath, { events: [] })
  const implPayload = readJson(paths.implPath, { events: [] })
  return buildConfirmQueue(eventsPayload, implPayload)
}

function findNextPending(queueInfo, afterEvtId) {
  const list = (queueInfo && queueInfo.queue) || []
  if (!list.length) {
    return ''
  }
  if (!afterEvtId) {
    return list[0] ? list[0].evtId : ''
  }
  const idx = list.findIndex(item => String(item.evtId) === String(afterEvtId))
  if (idx === -1) {
    return list[0] ? list[0].evtId : ''
  }
  for (let i = idx + 1; i < list.length; i += 1) {
    if (list[i].needsConfirm && !list[i].confirmed && !(list[i].event && list[i].event.deferred)) {
      return list[i].evtId
    }
  }
  return ''
}

function queueProgress(queueInfo, evtId) {
  const list = (queueInfo && queueInfo.queue) || []
  const total = list.length
  if (!total) {
    return { index: 0, total: 0, label: '0 / 0' }
  }
  const idx = list.findIndex(item => String(item.evtId) === String(evtId))
  const index = idx === -1 ? 1 : idx + 1
  return {
    index,
    total,
    label: index + ' / ' + total
  }
}

function printHelp() {
  console.log(`
needs-confirm — 判断 impl 事件是否需要人工确认，输出待确认队列

Usage:
  node needs-confirm.js --excel=docs/2.3埋点需求文档.xlsx
  node needs-confirm.js --excel=docs/2.3埋点需求文档.xlsx --evt=95936
  node needs-confirm.js --excel=docs/2.3埋点需求文档.xlsx --json

Options:
  --evt       只输出单条是否需要确认
  --all       输出全部事件（含已确认），默认只输出待确认队列
  --json      机器可读 JSON
`)
}

function main() {
  const { findRepoRoot, parseArgs } = require('../lib/lib')
  const { defaultPaths } = require('../extract/report')
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(__dirname)
  const paths = defaultPaths(repoRoot, args)
  const queueInfo = loadConfirmQueue(paths)
  const evtId = String(args.evt || args.evtId || '').trim()

  if (evtId) {
    const item = queueInfo.items.find(row => String(row.evtId) === evtId)
    const payload = item || { evtId, needsConfirm: true, confirmed: false, reasons: ['未在 impl.json 中找到'] }
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2))
    } else {
      console.log('== needs-confirm ==')
      console.log(`evtId: ${payload.evtId}`)
      console.log(`needsConfirm: ${payload.needsConfirm}`)
      console.log(`confirmed: ${payload.confirmed}`)
      ;(payload.reasons || []).forEach(reason => console.log(`  - ${reason}`))
    }
    return
  }

  const output = args.all
    ? queueInfo
    : {
      total: queueInfo.total,
      pendingCount: queueInfo.pendingCount,
      confirmedCount: queueInfo.confirmedCount,
      done: queueInfo.done,
      queue: queueInfo.queue
    }

  if (args.json) {
    console.log(JSON.stringify(output, null, 2))
    return
  }
  console.log('== needs-confirm ==')
  console.log(`全部 ${queueInfo.total} / 需确认 ${queueInfo.needsConfirmCount} / 已确认 ${queueInfo.confirmedCount} / 待处理 ${queueInfo.pendingCount}`)
  queueInfo.queue.forEach(item => {
    console.log(`  ${item.evtId} ${item.eventName || '-'}${item.confirmed ? ' [confirmed]' : ''}`)
    ;(item.reasons || []).slice(0, 3).forEach(reason => console.log(`    · ${reason}`))
  })
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message || error)
    process.exit(1)
  }
}

module.exports = {
  paramNeedsConfirm,
  eventNeedsConfirm,
  locationNeedsConfirm,
  paramKeysNeedingConfirm,
  getConfirmReasons,
  buildConfirmQueue,
  loadConfirmQueue,
  findNextPending,
  queueProgress
}
