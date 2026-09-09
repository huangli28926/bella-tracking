#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { findRepoRoot, parseArgs, readJson } = require('../lib/lib')
const { defaultPaths, renderToFile } = require('../extract/report')
const { eventNeedsConfirm, getConfirmReasons } = require('./needs-confirm')
const {
  ensureServing,
  evtArg,
  openBrowser,
  pageUrl,
  shouldOpenBrowser,
  sleep
} = require('./serve-impl')
const { closeConfirmTab } = require('./close-confirm-tab')

const SCRIPT_DIR = __dirname
const DEFAULT_TIMEOUT_SEC = 600
const DEFAULT_POLL_MS = 1000

function printHelp() {
  console.log(`
confirm-event — 打开落库页矫正向导，可选等待用户确认或跳过

Usage:
  node confirm-event.js --excel=docs/2.3埋点需求文档.xlsx --evt=95936 --wait
  node confirm-event.js --excel=docs/2.3埋点需求文档.xlsx --evt=95936 --if-needed --wait

Options:
  --evt / --evtId   必填，定位到该事件
  --wait            轮询 impl.json 直到 confirmed 或 deferred
  --if-needed       仅当 needsConfirm 且尚未 confirmed 时才打开；否则 skipped
  --timeout=600     --wait 超时秒数，默认 600
  --poll-ms=1000    轮询间隔
  --no-open         不打开浏览器（仍可 --wait）
  --force-open      超时重试时再开一次该条确认页
  --json            输出机器可读 JSON
  --port            矫正服务起始端口，默认 3920
`)
}

function loadEvent(paths, evtId) {
  const impl = readJson(paths.implPath, { events: [] })
  return (impl.events || []).find(item => String(item.evtId) === String(evtId)) || null
}

function eventHandled(event) {
  return !!(event && (event.confirmed || event.deferred))
}

async function waitHandled(paths, evtId, timeoutMs, intervalMs) {
  const start = Date.now()
  let lastBeat = start
  while (Date.now() - start < timeoutMs) {
    const event = loadEvent(paths, evtId)
    if (eventHandled(event)) {
      return event
    }
    if (Date.now() - lastBeat >= 30000) {
      lastBeat = Date.now()
      const left = Math.max(0, Math.round((timeoutMs - (Date.now() - start)) / 1000))
      console.log(`仍在等待 evt ${evtId} 确认或跳过… 剩余 ${left}s`)
    }
    await sleep(intervalMs)
  }
  return null
}

function printResult(payload, asJson) {
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }
  console.log('== confirm-event ==')
  Object.keys(payload).forEach(key => {
    if (key === 'event') {
      return
    }
    const value = payload[key]
    if (value === undefined || value === null || value === '') {
      return
    }
    console.log(`${key}: ${value}`)
  })
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const evtId = evtArg(args)
  if (!evtId) {
    printHelp()
    throw new Error('confirm-event 需要 --evt=...')
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const paths = defaultPaths(repoRoot, args)
  if (!paths.eventsPath || !fs.existsSync(paths.eventsPath)) {
    printHelp()
    throw new Error(`events.json 不存在: ${paths.eventsPath || '(未提供 --excel / --slug)'}`)
  }

  renderToFile(paths)
  const event = loadEvent(paths, evtId)
  const needsConfirm = eventNeedsConfirm(event)
  const alreadyHandled = eventHandled(event)
  const ifNeeded = !!(args['if-needed'] || args.ifNeeded)

  if (ifNeeded && (alreadyHandled || !needsConfirm)) {
    printResult({
      evtId,
      status: 'skipped',
      needsConfirm,
      confirmed: !!(event && event.confirmed),
      deferred: !!(event && event.deferred),
      reason: event && event.confirmed ? 'already confirmed' : (event && event.deferred ? 'already deferred' : 'high confidence, no interrupt')
    }, args.json)
    return
  }

  const serving = await ensureServing(paths, args)
  const htmlName = path.basename(paths.htmlPath)
  const openUrl = pageUrl(serving.port, htmlName, evtId, 'confirm')
  const openTab = shouldOpenBrowser(args)
  if (openTab) {
    openBrowser(openUrl)
  }

  const payload = {
    evtId,
    status: args.wait ? 'waiting' : 'opened',
    needsConfirm,
    confirmed: !!(event && event.confirmed),
    deferred: !!(event && event.deferred),
    reasons: getConfirmReasons(event),
    reused: !!serving.reused,
    openedTab: !!openTab,
    port: serving.port,
    openUrl
  }

  if (!args.wait) {
    payload.status = 'opened'
    printResult(payload, args.json)
    console.log('未加 --wait：打开后即退出。用户在向导中确认或跳过后，再读 impl.json 继续。')
    return
  }

  const timeoutSec = Number(args.timeout || DEFAULT_TIMEOUT_SEC) || DEFAULT_TIMEOUT_SEC
  const pollMs = Number(args['poll-ms'] || args.pollMs || DEFAULT_POLL_MS) || DEFAULT_POLL_MS
  console.log(`等待页面「确认并关闭」或「跳过稍后处理」（超时 ${timeoutSec}s）…`)
  console.log(`Open: ${openUrl}`)
  const handledEvent = await waitHandled(paths, evtId, timeoutSec * 1000, pollMs)
  if (handledEvent) {
    payload.status = handledEvent.confirmed ? 'confirmed' : 'deferred'
    payload.confirmed = !!handledEvent.confirmed
    payload.deferred = !!handledEvent.deferred
    payload.event = handledEvent
    const closed = closeConfirmTab({ evtId, openUrl })
    payload.closedTab = closed.closed || 0
    if (closed.reason) {
      payload.closeReason = closed.reason
    }
    printResult(payload, args.json)
    return
  }
  payload.status = 'timeout'
  payload.confirmed = false
  if (shouldOpenBrowser(args)) {
    openBrowser(openUrl)
    payload.openedTab = true
    console.log('等待超时，已重新打开矫正向导')
  }
  printResult(payload, args.json)
  console.error(`超时未处理: ${openUrl}`)
  process.exit(2)
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message || error)
    process.exit(1)
  })
}

module.exports = { loadEvent, waitHandled, eventHandled }
