#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  docSlug,
  ensureExcelInDocs,
  findRepoRoot,
  parseArgs,
  resolveExcel,
  safeEvtFileName,
  toPosix,
  writeJson
} = require('../lib/lib')
const { detectAndWrite } = require('./detect-adaptor')

const SCRIPT_DIR = __dirname

function printHelp() {
  console.log(`
dump-excel — 解析埋点需求 Excel，下载示意图（不按页面名称过滤）

Usage:
  node dump-excel.js --excel=docs/2.3埋点需求文档.xlsx
  node dump-excel.js --excel=... --out=docs/tracking/impl/2.3埋点需求文档

Options:
  --excel   埋点需求 xlsx（相对仓库根或绝对路径）
  --out     该文档落库目录，默认 docs/tracking/impl/{文档名}
  --skip-images  只解析，不下载示意图（仅入口 7；无 URL 仍失败）
  --force-images  已有示意图也重新下载
  --image-workers 示意图并发下载数，默认 5

示意图必须全部成功（有 URL 且文件非空，或本地缓存命中）。
失败（含缺 URL）时仍写出 events.json 后以非 0 退出，禁止继续 render / 分析 / 写码。
`)
}

function parseWorkbook(excelPath) {
  const py = path.join(SCRIPT_DIR, 'parse_xlsx.py')
  const result = spawnSync('python3', [py, excelPath], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  })
  if (result.status !== 0) {
    throw new Error(
      `解析 Excel 失败:\n${result.stderr || result.stdout || result.error}`
    )
  }
  return JSON.parse(result.stdout)
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const client = /^https:/i.test(url) ? https : http
    const req = client.get(url, {
      headers: { 'User-Agent': 'bella-tracking/1.0' },
      timeout: 30000
    }, res => {
      const status = res.statusCode || 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        download(res.headers.location, dest).then(resolve, reject)
        return
      }
      if (status !== 200) {
        res.resume()
        reject(new Error(`HTTP ${status}`))
        return
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      const file = fs.createWriteStream(dest)
      res.pipe(file)
      file.on('finish', () => {
        file.close(() => resolve(dest))
      })
      file.on('error', reject)
    })
    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
    })
    req.on('error', reject)
  })
}

function hasCachedFile(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0
  } catch (error) {
    return false
  }
}

function unlinkQuiet(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch (error) {
    // ignore
  }
}

function markDiagramFail(event, stats, reason) {
  const message = String(reason || 'unknown')
  stats.fail += 1
  stats.failures.push({ evtId: String(event.evtId || ''), reason: message })
  event.diagramPath = ''
  event.diagramError = message
  console.log(`  示意图 ${event.evtId}: fail (${message})`)
}

async function downloadImageEvent(event, imagesDir, opts, stats) {
  const url = event.diagramUrl || (event.diagramUrls && event.diagramUrls[0]) || ''
  if (!url) {
    event.diagramRelPath = ''
    markDiagramFail(event, stats, '缺少示意图 URL')
    return
  }
  const fileName = `${safeEvtFileName(event.evtId)}.png`
  const dest = path.join(imagesDir, fileName)
  event.diagramRelPath = toPosix(path.join('_raw', 'images', fileName))
  event.diagramPath = dest
  event.diagramError = ''
  if (opts.skipImages) {
    stats.skip += 1
    return
  }
  if (!opts.forceImages && hasCachedFile(dest)) {
    stats.cached += 1
    console.log(`  示意图 ${event.evtId}: cached`)
    return
  }
  try {
    await download(url, dest)
    if (!hasCachedFile(dest)) {
      unlinkQuiet(dest)
      markDiagramFail(event, stats, '下载文件为空')
      return
    }
    stats.ok += 1
    console.log(`  示意图 ${event.evtId}: ok`)
  } catch (error) {
    unlinkQuiet(dest)
    markDiagramFail(event, stats, error.message || error)
  }
}

async function downloadImages(events, imagesDir, options) {
  const opts = options || {}
  const stats = { ok: 0, fail: 0, skip: 0, cached: 0, failures: [] }
  const workers = Math.max(1, Math.min(12, Number(opts.workers || 5) || 5))
  let next = 0

  async function worker() {
    while (next < events.length) {
      const idx = next
      next += 1
      await downloadImageEvent(events[idx], imagesDir, opts, stats)
    }
  }

  const jobs = []
  const count = Math.min(workers, events.length)
  for (let i = 0; i < count; i += 1) {
    jobs.push(worker())
  }
  await Promise.all(jobs)

  // Keep metadata deterministic in original event order.
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]
    const fileName = `${safeEvtFileName(event.evtId)}.png`
    const dest = path.join(imagesDir, fileName)
    if (!event.diagramError && event.diagramRelPath && hasCachedFile(dest)) {
      event.diagramPath = dest
    }
  }
  return stats
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const excelPath = ensureExcelInDocs(
    repoRoot,
    resolveExcel(repoRoot, args.excel || args._[0] || '')
  )
  if (!excelPath || !fs.existsSync(excelPath)) {
    printHelp()
    throw new Error(`Excel 不存在: ${excelPath || '(未提供 --excel)'}`)
  }

  const slug = docSlug(excelPath)
  const outDir = args.out
    ? path.resolve(repoRoot, args.out)
    : path.resolve(repoRoot, 'docs/tracking/impl', slug)
  const rawDir = path.join(outDir, '_raw')
  const imagesDir = path.join(rawDir, 'images')
  fs.mkdirSync(imagesDir, { recursive: true })

  console.log('== dump-excel ==')
  console.log(`Excel: ${excelPath}`)
  console.log(`Out: ${outDir}`)

  const parsed = parseWorkbook(excelPath)
  const events = parsed.events || []
  if (!events.length) {
    throw new Error('未解析到任何事件（未按页面名称过滤）。请检查 sheet 表头是否含 evt_id / 事件名称')
  }

  const imageStats = await downloadImages(events, imagesDir, {
    skipImages: Boolean(args['skip-images']),
    forceImages: Boolean(args['force-images']),
    workers: args['image-workers']
  })
  const payload = {
    generatedAt: new Date().toISOString(),
    excelPath: toPosix(path.relative(repoRoot, excelPath)),
    excelAbsPath: excelPath,
    sheetName: parsed.sheetName || '',
    slug,
    eventCount: events.length,
    clickCount: events.filter(item => item.kind === 'click').length,
    viewCount: events.filter(item => item.kind === 'view').length,
    events
  }
  const eventsPath = path.join(rawDir, `${slug}.events.json`)
  writeJson(eventsPath, payload)

  let adaptor = null
  try {
    adaptor = detectAndWrite(repoRoot, path.join(rawDir, 'adaptor.json'))
  } catch (error) {
    console.warn(`adaptor 探测失败（落库仍继续）: ${error.message || error}`)
  }

  console.log(`事件: ${payload.eventCount} (click ${payload.clickCount} / view ${payload.viewCount})`)
  console.log(`示意图: ok=${imageStats.ok} cached=${imageStats.cached} fail=${imageStats.fail} skip=${imageStats.skip}`)
  console.log(`JSON: ${eventsPath}`)
  if (adaptor) {
    console.log(`SDK: ${adaptor.sdkId} / style: ${adaptor.defaultStyleId}`)
  }
  if (imageStats.fail > 0) {
    const lines = (imageStats.failures || []).map(item => `  ${item.evtId} ${item.reason}`)
    throw new Error(
      `示意图下载失败，已中止后续流程（不 render / 不分析 / 不写码）:\n${lines.join('\n')}\n失败数: ${imageStats.fail} / 事件: ${events.length}`
    )
  }
}

main().catch(error => {
  console.error(error.message || error)
  process.exit(1)
})
