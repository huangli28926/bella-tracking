#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { findRepoRoot, parseArgs } = require('../lib/lib')
const { defaultPaths } = require('../extract/report')
const { loadConfirmQueue } = require('./needs-confirm')
const { scriptPath } = require('../lib/skill-paths')

const SCRIPT_DIR = __dirname

function printHelp() {
  console.log(`
confirm-sweep — 按 docIndex 逐条打开待确认埋点，等待用户确认后关页，再开下一条

Usage:
  node confirm-sweep.js --excel=docs/2.3埋点需求文档.xlsx --wait
  node confirm-sweep.js --excel=docs/2.3埋点需求文档.xlsx --wait --timeout=600

Options:
  --wait            每条都等待 confirmed（默认 true）
  --no-wait         只打开第一条，不等待
  --timeout=600     单条等待超时秒数
  --no-open         不打开浏览器
  --json            输出 JSON 摘要
`)
}

function runConfirmEvent(repoRoot, args, evtId) {
  const argv = [
    path.join(SCRIPT_DIR, 'confirm-event.js'),
    `--excel=${args.excel || ''}`,
    `--evt=${evtId}`,
    '--if-needed'
  ]
  if (args.slug) argv.push(`--slug=${args.slug}`)
  if (args.wait !== false && !args['no-wait'] && args.noWait !== true) {
    argv.push('--wait')
  }
  if (args.timeout) argv.push(`--timeout=${args.timeout}`)
  if (args['no-open'] || args.noOpen) argv.push('--no-open')
  if (args['force-open'] || args.forceOpen) argv.push('--force-open')
  if (args.port) argv.push(`--port=${args.port}`)
  return spawnSync(process.execPath, argv, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit'
  })
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  if (!args.excel && !args.slug) {
    printHelp()
    throw new Error('confirm-sweep 需要 --excel=...')
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const paths = defaultPaths(repoRoot, args)
  if (!paths.eventsPath || !fs.existsSync(paths.eventsPath)) {
    throw new Error(`events.json 不存在: ${paths.eventsPath || ''}`)
  }

  const queueInfo = loadConfirmQueue(paths)
  const pending = queueInfo.queue.filter(item => item.needsConfirm && !item.confirmed && !(item.event && item.event.deferred))
  if (!pending.length) {
    const renderReview = spawnSync(process.execPath, [
      scriptPath('extract', 'render-review-html.js'),
      `--excel=${args.excel || ''}`
    ].concat(args.slug ? [`--slug=${args.slug}`] : []), {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'inherit'
    })
    if (renderReview.status !== 0) {
      throw new Error('render-review-html 失败')
    }
    if (args.json) {
      console.log(JSON.stringify({ done: true, processed: 0, skipped: 0, reviewPath: paths.reviewHtmlPath }, null, 2))
    } else {
      console.log('== confirm-sweep ==')
      console.log('无待确认项，已生成矫正汇总页')
      console.log(`Review: ${paths.reviewHtmlPath}`)
    }
    return
  }

  const summary = {
    done: true,
    processed: 0,
    skipped: 0,
    timeout: 0,
    items: []
  }

  pending.forEach(item => {
    const result = runConfirmEvent(repoRoot, args, item.evtId)
    const entry = {
      evtId: item.evtId,
      exitCode: result.status
    }
    summary.items.push(entry)
    if (result.status === 0) {
      summary.processed += 1
    } else if (result.status === 2) {
      summary.timeout += 1
      summary.done = false
    } else {
      summary.skipped += 1
      summary.done = false
    }
  })

  const after = loadConfirmQueue(paths)
  if (after.done) {
    spawnSync(process.execPath, [
      scriptPath('extract', 'render-review-html.js'),
      `--excel=${args.excel || ''}`
    ].concat(args.slug ? [`--slug=${args.slug}`] : []), {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'inherit'
    })
    summary.reviewPath = paths.reviewHtmlPath
  }

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log('== confirm-sweep ==')
    console.log(`处理 ${summary.processed} / 超时 ${summary.timeout} / 跳过 ${summary.skipped}`)
    if (summary.reviewPath) {
      console.log(`Review: ${summary.reviewPath}`)
    }
  }
  if (!summary.done) {
    process.exit(2)
  }
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message || error)
    process.exit(1)
  }
}

module.exports = { main }
