#!/usr/bin/env node
/* eslint-disable no-console */
const { findRepoRoot, parseArgs } = require('../lib/lib')
const { defaultPaths, renderToFile } = require('./report')
const { assertValidImpl } = require('../accept/validate-impl')

const SCRIPT_DIR = __dirname

function printHelp() {
  console.log(`
render-html — 将 events.json + impl.json 渲染为可视化落库 HTML

Usage:
  node render-html.js --events=docs/tracking/impl/2.3埋点需求文档/_raw/2.3埋点需求文档.events.json
  node render-html.js --excel=docs/2.3埋点需求文档.xlsx

Options:
  --events   dump-excel 产出的 events.json
  --impl     Cursor 写入的 impl.json（可缺省）
  --excel    用于推断默认路径（docs/tracking/impl/{文档名}/）
  --out      输出 HTML，默认 docs/tracking/impl/{文档名}/{文档名}-落库.html
`)
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const paths = defaultPaths(repoRoot, args)
  if (!paths.eventsPath) {
    printHelp()
    throw new Error('未提供 --events / --excel')
  }
  try {
    assertValidImpl(paths, args, repoRoot)
  } catch (error) {
    if (String(error.message || error).indexOf('impl.json 不存在') === -1) {
      throw error
    }
  }
  const report = renderToFile(paths)
  console.log('== render-html ==')
  console.log(`Events: ${paths.eventsPath}`)
  console.log(`Impl: ${paths.implPath}`)
  console.log(`HTML: ${paths.htmlPath}`)
  console.log(`事件 ${report.eventCount} / 已分析 ${report.implCount} / 已实现 ${report.existingCount} / 验收通过 ${report.acceptedCount} / 待确认 ${report.unresolvedCount}`)
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
