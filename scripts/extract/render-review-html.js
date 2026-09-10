#!/usr/bin/env node
/* eslint-disable no-console */
const { findRepoRoot, parseArgs } = require('../lib/lib')
const { defaultPaths, renderReviewToFile } = require('./report')
const { assertValidImpl } = require('../accept/impl/validate-impl')

const SCRIPT_DIR = __dirname

function printHelp() {
  console.log(`
render-review-html — 生成全部确认后的矫正汇总页 {文档名}-矫正.html

Usage:
  node render-review-html.js --excel=docs/2.3埋点需求文档.xlsx

Options:
  --excel    推断 docs/tracking/impl/{文档名}/
  --review-out  自定义输出 HTML 路径
  --json     输出机器可读 JSON
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
  const report = renderReviewToFile(paths)
  if (args.json) {
    console.log(JSON.stringify({
      reviewHtmlPath: paths.reviewHtmlPath,
      summary: report.summary
    }, null, 2))
    return
  }
  console.log('== render-review-html ==')
  console.log(`Review: ${paths.reviewHtmlPath}`)
  console.log(`全部 ${report.summary.total} / 需确认 ${report.summary.needsConfirmCount} / 已确认 ${report.summary.confirmedCount} / 待处理 ${report.summary.pendingCount}`)
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
