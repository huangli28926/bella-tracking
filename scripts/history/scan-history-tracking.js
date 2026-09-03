#!/usr/bin/env node
/* eslint-disable no-console */
const { spawn } = require('child_process')
const path = require('path')
const { findRepoRoot, parseArgs } = require('../lib/lib')
const { scanAndWrite } = require('./history-tracking')

const SCRIPT_DIR = __dirname

function printHelp() {
  console.log(`
scan-history-tracking — 静态扫描仓库已落地埋点与页面跳转

Usage:
  node scan-history-tracking.js
  node scan-history-tracking.js --open

不读 .env seedUrl。产出：
  docs/historyTracking/YYYY/MMDD_HHmmss.html
  docs/historyTracking/YYYY/_raw/MMDD_HHmmss.json
`)
}

function fileUrl(absPath) {
  const resolved = path.resolve(absPath)
  if (process.platform === 'win32') {
    return 'file:///' + resolved.replace(/\\/g, '/')
  }
  return 'file://' + encodeURI(resolved)
}

function openPath(absPath) {
  const cmd = process.platform === 'darwin'
    ? 'open'
    : (process.platform === 'win32' ? 'cmd' : 'xdg-open')
  const args = process.platform === 'win32' ? ['/c', 'start', '', absPath] : [absPath]
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const result = scanAndWrite(repoRoot)
  const stats = result.graph.stats || {}
  console.log('== scan-history-tracking ==')
  console.log('HTML: ' + result.htmlPath)
  console.log('JSON: ' + result.jsonPath)
  console.log('URL:  ' + fileUrl(result.htmlPath))
  console.log(
    '页面 ' + stats.pageCount +
    ' / 埋点 ' + stats.eventCount +
    ' / 跳转边 ' + stats.edgeCount +
    ' / 组件文件 ' + stats.fileCount
  )
  if (args.open) {
    openPath(result.htmlPath)
    console.log('已尝试用系统浏览器打开')
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
