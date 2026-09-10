#!/usr/bin/env node
const { isAcceptCli } = require('../cli')
/* eslint-disable no-console */
const { findRepoRoot, parseArgs } = require('../../lib/lib')
const { defaultFinalPaths, renderFinalToFile } = require('./final-report')

const SCRIPT_DIR = __dirname

function printHelp() {
  console.log(`
render-final — 合并落库 + 验收结果，生成终稿 HTML（仅真实验收后）

Usage:
  node render-final.js --excel=docs/2.3埋点需求文档.xlsx

Options:
  --excel   用于推断 docs/tracking/impl/{文档名}/ 路径
  --out     输出 HTML，默认 {文档名}-终稿.html
`)
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const paths = defaultFinalPaths(repoRoot, args)
  if (args.out) {
    const path = require('path')
    paths.finalHtml = path.isAbsolute(args.out)
      ? args.out
      : path.resolve(repoRoot, args.out)
  }
  if (!paths.eventsPath || !paths.acceptJson) {
    printHelp()
    throw new Error('未提供 --excel（或缺少 events / 验收 JSON）')
  }
  const report = renderFinalToFile(paths)
  console.log('== render-final ==')
  console.log(`HTML: ${paths.finalHtml}`)
  console.log(`事件 ${report.eventCount} / 通过 ${report.summary.pass} / 缺失 ${report.summary.missing || 0} / 待确认 ${report.summary.needConfirm || 0}`)
}

if (isAcceptCli(module)) {
  try {
    main()
  } catch (error) {
    console.error(error.message || error)
    process.exit(1)
  }
}

module.exports = { main }
