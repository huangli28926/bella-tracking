#!/usr/bin/env node
const { isAcceptCli } = require('../cli')
/* eslint-disable no-console */
const { findRepoRoot, parseArgs, readJson, writeJson } = require('../../lib/lib')
const { defaultAcceptPaths } = require('../chain/accept-chain')
const { buildAcceptReport, enrichReportMedia, renderAcceptReport } = require('./accept-report')

const SCRIPT_DIR = __dirname

function printHelp() {
  console.log(`
render-accept-report — 将验收 JSON 或 accept-chain 渲染为 HTML

Usage:
  node render-accept-report.js --excel=docs/2.3埋点需求文档.xlsx
`)
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const paths = defaultAcceptPaths(repoRoot, args)
  if (!paths.chainPath) {
    printHelp()
    throw new Error('未提供 --excel')
  }
  const saved = readJson(paths.acceptJson, null)
  const chain = readJson(paths.chainPath, { paths: [], pending: [] })
  const report = saved || buildAcceptReport(chain, { planOnly: true })
  const eventsPayload = readJson(paths.eventsPath, { events: [] })
  const implPayload = readJson(paths.implPath, { events: [] })
  enrichReportMedia(report, {
    htmlPath: paths.acceptHtml,
    shotsDir: paths.shotsDir,
    events: eventsPayload.events || [],
    implEvents: implPayload.events || []
  })
  if (saved) {
    writeJson(paths.acceptJson, report)
  }
  renderAcceptReport(report, paths.acceptHtml)
  console.log('== render-accept-report ==')
  console.log(paths.acceptHtml)
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
