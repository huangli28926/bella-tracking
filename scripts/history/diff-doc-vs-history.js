#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  docSlug,
  ensureExcelInDocs,
  findRepoRoot,
  parseArgs,
  readJson,
  resolveExcel,
  toPosix,
  writeJson
} = require('../lib/lib')
const { scanAndWrite } = require('./history-tracking')

const SCRIPT_DIR = __dirname
const ASK_EXCEL = '需要梳理哪个历史埋点文档的数据，请给出该历史埋点 excel'

function printHelp() {
  console.log(`
diff-doc-vs-history — 文档 evtId 与仓内已扫描埋点做差集，列出缺失

Usage:
  node diff-doc-vs-history.js --excel=docs/2.6埋点需求文档.xlsx
  node diff-doc-vs-history.js --excel=docs/2.6埋点需求文档.xlsx --scan-json=docs/historyTracking/2026/_raw/0831_165400.json
  node diff-doc-vs-history.js --excel=... --json

无可用 xlsx 时打印询问句并以 exit 2 退出，不 dump、不扫描。
`)
}

function isXlsx(filePath) {
  return /\.xlsx$/i.test(String(filePath || ''))
}

function walkJsonFiles(dir, acc) {
  if (!fs.existsSync(dir)) {
    return acc
  }
  fs.readdirSync(dir).forEach(name => {
    const abs = path.join(dir, name)
    let stat
    try {
      stat = fs.statSync(abs)
    } catch (error) {
      return
    }
    if (stat.isDirectory()) {
      walkJsonFiles(abs, acc)
      return
    }
    if (stat.isFile() && name.endsWith('.json')) {
      acc.push({ abs, mtime: stat.mtimeMs })
    }
  })
  return acc
}

function findLatestScanJson(repoRoot) {
  const rawRoot = path.join(repoRoot, 'docs/historyTracking')
  const files = walkJsonFiles(rawRoot, []).filter(item => item.abs.indexOf(`${path.sep}_raw${path.sep}`) !== -1)
  files.sort((a, b) => b.mtime - a.mtime)
  return files.length ? files[0].abs : ''
}

function collectCodeEvtIds(graph) {
  const set = {}
  const pages = (graph && graph.pages) || []
  pages.forEach(page => {
    (page.events || []).forEach(evt => {
      const id = String(evt.evtId || '').trim()
      if (id) {
        set[id] = true
      }
    })
  })
  return set
}

function dumpEventsIfNeeded(repoRoot, excelPath, eventsPath) {
  if (fs.existsSync(eventsPath)) {
    return
  }
  const dump = path.join(SCRIPT_DIR, '..', 'extract', 'dump-excel.js')
  const result = spawnSync(process.execPath, [dump, `--excel=${excelPath}`, '--skip-images'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'dump-excel 失败')
  }
}

function renderMissingHtml(payload) {
  const rows = (payload.missing || []).map(item => {
    return '<tr><td><code>' + escapeHtml(item.evtId) + '</code></td>' +
      '<td>' + escapeHtml(item.eventName) + '</td>' +
      '<td>' + escapeHtml(item.eventType) + '</td>' +
      '<td><code>' + escapeHtml(item.uicode) + '</code></td>' +
      '<td>' + escapeHtml(String(item.docIndex)) + '</td></tr>'
  }).join('')
  const body = rows || '<tr><td colspan="5">无缺失（文档 evtId 均已在代码扫描结果中）</td></tr>'
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' +
    escapeHtml(payload.slug) + ' 缺失埋点</title>' +
    '<style>body{font-family:sans-serif;margin:24px}table{border-collapse:collapse;width:100%}' +
    'th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f6f6f6}' +
    '.muted{color:#666}</style></head><body>' +
    '<h1>缺失埋点列表</h1>' +
    '<p class="muted">文档有、代码扫描无（仅比对 evtId 字面量）。Excel: ' +
    escapeHtml(payload.excelRel) + ' · 缺失 ' + payload.missingCount +
    ' / 文档 ' + payload.docCount + ' · 代码去重 ' + payload.codeCount + '</p>' +
    '<table><thead><tr><th>evtId</th><th>事件名称</th><th>类型</th><th>文档 uicode</th><th>docIndex</th></tr></thead><tbody>' +
    body + '</tbody></table></body></html>'
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function askExcelAndExit() {
  console.error(ASK_EXCEL)
  process.exit(2)
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const rawExcel = args.excel || args._[0] || ''
  if (!rawExcel) {
    askExcelAndExit()
  }
  const resolved = resolveExcel(repoRoot, rawExcel)
  const excelPath = ensureExcelInDocs(repoRoot, resolved)
  if (!excelPath || !fs.existsSync(excelPath) || !isXlsx(excelPath)) {
    askExcelAndExit()
  }

  const slug = docSlug(excelPath)
  const outDir = path.resolve(repoRoot, 'docs/tracking/impl', slug)
  const eventsPath = path.join(outDir, '_raw', `${slug}.events.json`)
  dumpEventsIfNeeded(repoRoot, excelPath, eventsPath)
  const eventsDoc = readJson(eventsPath, null)
  const docEvents = (eventsDoc && eventsDoc.events) || []
  if (!docEvents.length) {
    throw new Error('events.json 无事件: ' + eventsPath)
  }

  let scanPath = args['scan-json']
    ? resolveExcel(repoRoot, args['scan-json'])
    : findLatestScanJson(repoRoot)
  if (!scanPath || !fs.existsSync(scanPath)) {
    const scanned = scanAndWrite(repoRoot)
    scanPath = scanned.jsonPath
  }
  const graph = readJson(scanPath, {})
  const codeSet = collectCodeEvtIds(graph)
  const codeCount = Object.keys(codeSet).length

  const missing = []
  const found = []
  docEvents.forEach(evt => {
    const id = String(evt.evtId || '').trim()
    const row = {
      evtId: id,
      eventName: evt.eventName || '',
      eventType: evt.eventType || evt.kind || '',
      uicode: evt.uicode || '',
      docIndex: evt.docIndex
    }
    if (codeSet[id]) {
      found.push(row)
    } else {
      missing.push(row)
    }
  })

  const payload = {
    generatedAt: new Date().toISOString(),
    slug,
    excelRel: toPosix(path.relative(repoRoot, excelPath)),
    scanJson: toPosix(path.relative(repoRoot, scanPath)),
    docCount: docEvents.length,
    codeCount,
    foundCount: found.length,
    missingCount: missing.length,
    complete: missing.length === 0,
    missing,
    found
  }

  const jsonOut = path.join(outDir, `${slug}-缺失埋点.json`)
  const htmlOut = path.join(outDir, `${slug}-缺失埋点.html`)
  writeJson(jsonOut, payload)
  fs.mkdirSync(path.dirname(htmlOut), { recursive: true })
  fs.writeFileSync(htmlOut, renderMissingHtml(payload), 'utf8')

  console.log('== diff-doc-vs-history ==')
  console.log('Excel: ' + payload.excelRel)
  console.log('Scan:  ' + payload.scanJson)
  console.log('文档 ' + payload.docCount + ' / 代码去重 ' + payload.codeCount +
    ' / 已落地 ' + payload.foundCount + ' / 缺失 ' + payload.missingCount)
  if (payload.complete) {
    console.log('完整：文档 evtId 均已出现在历史扫描结果中')
  } else {
    console.log('缺失列表:')
    missing.forEach(item => {
      console.log('  ' + item.evtId + '\t' + item.eventName + '\t' + item.eventType)
    })
  }
  console.log('JSON: ' + jsonOut)
  console.log('HTML: ' + htmlOut)
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2))
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

module.exports = { ASK_EXCEL, main }
