#!/usr/bin/env node
/* eslint-disable no-console */
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const path = require('path')
const url = require('url')
const {
  findRepoRoot,
  isInsideDir,
  parseArgs,
  readJson,
  safeEvtFileName,
  safeParamFileName,
  toPosix,
  writeJson
} = require('../lib/lib')
const { normalizeImpl } = require('../accept/normalize-impl')
const { applyConfirmAction } = require('./confirm-gate')
const { buildReport, defaultPaths, mergeImplEvent, renderReviewToFile, renderToFile } = require('../extract/report')
const {
  findNextPending,
  loadConfirmQueue,
  queueProgress
} = require('./needs-confirm')
const { lockImplPayload } = require('../lib/lock-doc-uicode')
const {
  applyToPayload,
  loadMergedMemory,
  upsertFromConfirmedEvent,
  writeFieldMemory
} = require('../lib/field-memory')

const SCRIPT_DIR = __dirname
const DEFAULT_PORT = 3920
const PORT_ATTEMPTS = 11
const MAX_BODY = 6 * 1024 * 1024
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

function printHelp() {
  console.log(`
serve-impl — 落库 HTML 本地矫正服务（回写 impl.json、上传提示图）

Usage:
  node serve-impl.js --excel=docs/2.3埋点需求文档.xlsx
  node serve-impl.js --slug=2.3埋点需求文档 --port=3920
  node serve-impl.js --excel=docs/2.3埋点需求文档.xlsx --evt=95936
  node serve-impl.js --excel=docs/2.3埋点需求文档.xlsx --no-open

打开: http://127.0.0.1:3920/{文档名}-落库.html
带 --evt= 时打开 ?evt={evtId}&mode=confirm 矫正向导，定位到该条。
默认启动后自动打开浏览器；--no-open 可关掉。
3920 被占用时依次试到 3930；同 slug 已在跑则复用，不重复起进程。
静态打开 HTML 只能只读；编辑/上传必须走本服务。
`)
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new Error('JSON 解析失败'))
      }
    })
    req.on('error', reject)
  })
}

function shouldOpenBrowser(args) {
  if (args['no-open'] || args.noOpen) {
    return false
  }
  if (args.open === 'false' || args.open === false) {
    return false
  }
  return true
}

function openBrowser(pageUrl) {
  const platform = process.platform
  let cmd = 'xdg-open'
  let cmdArgs = [pageUrl]
  if (platform === 'darwin') {
    cmd = 'open'
    cmdArgs = ['-a', 'Google Chrome', pageUrl]
  } else if (platform === 'win32') {
    cmd = 'cmd'
    cmdArgs = ['/c', 'start', '', pageUrl]
  }
  try {
    const child = spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' })
    child.on('error', error => {
      console.warn(`自动打开浏览器失败: ${error.message || error}`)
    })
    child.unref()
    if (platform === 'darwin') {
      try {
        const escapedUrl = String(pageUrl).replace(/"/g, '\\"')
        const appleScript = [
          'tell application "Google Chrome"',
          `  open location "${escapedUrl}"`,
          '  activate',
          'end tell'
        ].join('\n')
        const chrome = spawn('osascript', ['-e', appleScript], { detached: true, stdio: 'ignore' })
        chrome.on('error', () => {})
        chrome.unref()
      } catch (error) {
        console.warn(`自动激活浏览器失败: ${error.message || error}`)
      }
    }
  } catch (error) {
    console.warn(`自动打开浏览器失败: ${error.message || error}`)
  }
}

function evtArg(args) {
  return String(args.evt || args.evtId || '').trim()
}

function pageUrl(port, htmlName, evtId, mode) {
  const params = new URLSearchParams()
  if (evtId) params.set('evt', String(evtId))
  if (mode) params.set('mode', String(mode))
  const qs = params.toString()
  return `http://127.0.0.1:${port}/${encodeURI(htmlName)}${qs ? `?${qs}` : ''}`
}

function reviewPageUrl(req, paths) {
  const host = (req && req.headers && req.headers.host) || ''
  const base = host ? `http://${host}` : ''
  const name = path.basename(paths.reviewHtmlPath || '')
  return base && name ? `${base}/${encodeURI(name)}` : ''
}

function serveMetaPath(paths) {
  return path.join(paths.outDir, '_raw', 'serve.json')
}

function writeServeMeta(paths, port, extra) {
  writeJson(serveMetaPath(paths), Object.assign({
    port,
    pid: process.pid,
    slug: paths.slug,
    url: pageUrl(port, path.basename(paths.htmlPath)),
    startedAt: new Date().toISOString()
  }, extra || {}))
}

function probeStatus(port) {
  return new Promise(resolve => {
    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path: '/api/status',
      timeout: 600
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          resolve(payload && payload.ok ? payload : null)
        } catch (error) {
          resolve(null)
        }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
  })
}

async function findExistingServer(paths, startPort, attempts) {
  const begin = Number(startPort || DEFAULT_PORT) || DEFAULT_PORT
  const left = Number(attempts || PORT_ATTEMPTS) || PORT_ATTEMPTS
  for (let i = 0; i < left; i += 1) {
    const port = begin + i
    const status = await probeStatus(port)
    if (status && String(status.slug || '') === String(paths.slug || '')) {
      return { port, status }
    }
  }
  return null
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function spawnServeImpl(paths, args, startPort) {
  const argv = [path.join(SCRIPT_DIR, 'serve-impl.js'), '--no-open', `--port=${startPort}`]
  if (args.excel) {
    argv.push(`--excel=${args.excel}`)
  } else if (args.slug || paths.slug) {
    argv.push(`--slug=${args.slug || paths.slug}`)
  }
  const child = spawn(process.execPath, argv, {
    cwd: findRepoRoot(SCRIPT_DIR),
    detached: true,
    stdio: 'ignore'
  })
  child.unref()
  return child
}

async function ensureServing(paths, args) {
  const startPort = Number(args.port || DEFAULT_PORT) || DEFAULT_PORT
  const existing = await findExistingServer(paths, startPort, PORT_ATTEMPTS)
  if (existing) {
    return { port: existing.port, reused: true, pid: 0 }
  }
  const child = spawnServeImpl(paths, args, startPort)
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const found = await findExistingServer(paths, startPort, PORT_ATTEMPTS)
    if (found) {
      return { port: found.port, reused: false, pid: child.pid || 0 }
    }
    await sleep(200)
  }
  throw new Error('serve-impl 启动超时')
}

function listenAvailable(server, host, startPort, attempts) {
  return new Promise((resolve, reject) => {
    let port = startPort
    let left = attempts

    function tryPort() {
      const onError = err => {
        if (err.code === 'EADDRINUSE' && left > 1) {
          left -= 1
          port += 1
          setImmediate(tryPort)
          return
        }
        reject(err)
      }
      server.once('error', onError)
      server.listen(port, host, () => {
        server.removeListener('error', onError)
        resolve(port)
      })
    }

    tryPort()
  })
}

function extOfMime(mime) {
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/gif') return '.gif'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'image/svg+xml') return '.svg'
  return '.png'
}

function hintRel(evtId, paramKey, ext) {
  const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 6)
  return toPosix(path.join('_raw', 'hints', safeEvtFileName(evtId), safeParamFileName(paramKey) + '-' + stamp + (ext || '.png')))
}

function stripQuery(rel) {
  return String(rel || '').split('?')[0]
}

function paramHintImages(event, paramKey) {
  const param = ((event && event.parameters) || []).find(item => item.key === paramKey)
  const images = param && param.hint && Array.isArray(param.hint.images) ? param.hint.images : []
  return images.map(rel => toPosix(stripQuery(rel))).filter(Boolean)
}

function ensureApisFile(apisPath) {
  if (fs.existsSync(apisPath)) {
    return
  }
  writeJson(apisPath, {
    apis: []
  })
}

function loadImpl(paths) {
  const payload = readJson(paths.implPath, null)
  if (payload && Array.isArray(payload.events)) {
    return payload
  }
  return {
    generatedAt: new Date().toISOString(),
    excelPath: '',
    slug: paths.slug,
    events: []
  }
}

function writeImpl(paths, payload) {
  payload.generatedAt = new Date().toISOString()
  payload.slug = payload.slug || paths.slug
  const eventsPayload = readJson(paths.eventsPath, { events: [] })
  writeJson(paths.implPath, lockImplPayload(payload, eventsPayload))
}

function upsertEvent(payload, nextEvent) {
  const events = Array.isArray(payload.events) ? payload.events.slice() : []
  const idx = events.findIndex(item => String(item.evtId) === String(nextEvent.evtId))
  if (idx === -1) {
    events.push(nextEvent)
  } else {
    events[idx] = nextEvent
  }
  payload.events = events
  return payload
}

function serveStatic(req, res, outDir) {
  const parsed = url.parse(req.url)
  let rel = decodeURIComponent(parsed.pathname || '/')
  if (rel === '/') {
    const htmls = fs.readdirSync(outDir).filter(name => name.endsWith('-落库.html'))
    if (htmls.length === 1) {
      res.writeHead(302, { Location: '/' + encodeURI(htmls[0]) })
      res.end()
      return
    }
    sendJson(res, 200, { ok: true, files: htmls })
    return
  }
  const target = path.resolve(outDir, '.' + rel)
  if (!isInsideDir(outDir, target) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
    return
  }
  const ext = path.extname(target).toLowerCase()
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache'
  })
  fs.createReadStream(target).pipe(res)
}

function createServer(paths) {
  ensureApisFile(paths.apisPath)
  return http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true)
    const route = parsed.pathname || '/'
    try {
      if (route === '/api/status') {
        sendJson(res, 200, {
          ok: true,
          slug: paths.slug,
          excelPath: readJson(paths.eventsPath, {}).excelPath || '',
          implPath: toPosix(paths.implPath),
          htmlPath: toPosix(paths.htmlPath)
        })
        return
      }
      if (route === '/api/report') {
        sendJson(res, 200, { ok: true, report: buildReport(paths) })
        return
      }
      if (route === '/api/confirm-queue') {
        const queueInfo = loadConfirmQueue(paths)
        const evtId = String(parsed.query.evt || parsed.query.evtId || '').trim()
        sendJson(res, 200, {
          ok: true,
          queue: queueInfo,
          progress: evtId ? queueProgress(queueInfo, evtId) : null
        })
        return
      }
      if (route === '/api/apis') {
        sendJson(res, 200, readJson(paths.apisPath, { apis: [] }))
        return
      }
      if (req.method === 'POST' && route === '/api/save-impl') {
        const body = await readBody(req)
        delete body.uicode
        const evtId = String(body.evtId || '')
        const wizardAction = String(body.wizardAction || '').trim()
        if (!evtId) {
          sendJson(res, 400, { ok: false, error: '缺少 evtId' })
          return
        }
        if (wizardAction === 'confirm' && !body.confirmed) {
          sendJson(res, 400, { ok: false, error: '请先勾选「已确认落库内容」' })
          return
        }
        const payload = loadImpl(paths)
        const existing = (payload.events || []).find(item => String(item.evtId) === evtId) || { evtId }
        const patch = Object.assign({}, body)
        if (patch.confirmed === true) delete patch.confirmed
        if (wizardAction === 'confirm') {
          patch.deferred = false
        } else if (wizardAction === 'skip') {
          patch.confirmed = false
          patch.deferred = true
        }
        delete patch.wizardAction
        const merged = mergeImplEvent(existing, patch)
        let nextPayload = normalizeImpl(upsertEvent(payload, merged))
        let saved = (nextPayload.events || []).find(item => String(item.evtId) === evtId) || merged
        let confirmDecision = null
        if (wizardAction === 'confirm') {
          confirmDecision = applyConfirmAction(saved)
          saved = confirmDecision.event
          nextPayload = upsertEvent(nextPayload, saved)
        }
        if (saved.confirmed) {
          const memory = upsertFromConfirmedEvent(loadMergedMemory(paths, nextPayload), saved)
          writeFieldMemory(paths, memory)
          nextPayload = applyToPayload(nextPayload, memory).payload
        }
        writeImpl(paths, nextPayload)
        const report = renderToFile(paths)
        const queueInfo = loadConfirmQueue(paths)
        let nextEvtId = ''
        let reviewUrl = ''
        const stillPending = (queueInfo.queue || []).some(item => String(item.evtId) === evtId)
        if (wizardAction === 'skip' || (wizardAction === 'confirm' && confirmDecision && confirmDecision.ok && !stillPending)) {
          nextEvtId = findNextPending(queueInfo, evtId)
          if (queueInfo.done) {
            renderReviewToFile(paths)
            reviewUrl = reviewPageUrl(req, paths)
          }
        }
        if (confirmDecision && !confirmDecision.ok) {
          sendJson(res, 409, {
            ok: false,
            error: confirmDecision.error,
            gate: confirmDecision.gate,
            report,
            blockingKeys: confirmDecision.blockingKeys || [],
            blockingReasons: confirmDecision.blockingReasons || [],
            wizard: {
              action: 'confirm',
              nextEvtId: '',
              reviewUrl: '',
              done: false,
              progress: queueProgress(queueInfo, evtId)
            }
          })
          return
        }
        sendJson(res, 200, {
          ok: true,
          confirmed: !!saved.confirmed,
          pending: !!(confirmDecision && confirmDecision.pending),
          blockingKeys: confirmDecision ? (confirmDecision.blockingKeys || []) : undefined,
          blockingReasons: confirmDecision ? (confirmDecision.blockingReasons || []) : undefined,
          gate: confirmDecision ? confirmDecision.gate : undefined,
          report,
          wizard: {
            action: wizardAction || 'save',
            nextEvtId,
            reviewUrl,
            done: queueInfo.done,
            waitingForAnalysis: !!queueInfo.waitingForAnalysis,
            unanalyzedCount: queueInfo.unanalyzedCount || 0,
            progress: queueProgress(queueInfo, evtId)
          }
        })
        return
      }
      if (req.method === 'POST' && route === '/api/upload-hint') {
        const body = await readBody(req)
        const evtId = String(body.evtId || '')
        const paramKey = String(body.paramKey || '')
        if (!evtId || !paramKey) {
          sendJson(res, 400, { ok: false, error: '缺少 evtId / paramKey' })
          return
        }
        const raw = String(body.dataBase64 || '').replace(/^data:image\/[a-zA-Z+]+;base64,/, '')
        if (!raw) {
          sendJson(res, 400, { ok: false, error: '缺少图片数据' })
          return
        }
        const buf = Buffer.from(raw, 'base64')
        if (!buf.length) {
          sendJson(res, 400, { ok: false, error: '图片解码失败' })
          return
        }
        const rel = hintRel(evtId, paramKey, extOfMime(body.mime))
        const dest = path.resolve(paths.outDir, rel)
        if (!isInsideDir(path.join(paths.outDir, '_raw', 'hints'), dest)) {
          sendJson(res, 400, { ok: false, error: '非法路径' })
          return
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, buf)
        const payload = loadImpl(paths)
        const existing = (payload.events || []).find(item => String(item.evtId) === evtId) || { evtId, parameters: [] }
        const images = paramHintImages(existing, paramKey).concat([rel])
        const patch = {
          evtId,
          parameters: [{
            key: paramKey,
            hint: { images }
          }]
        }
        const merged = mergeImplEvent(existing, patch)
        writeImpl(paths, upsertEvent(payload, merged))
        const report = renderToFile(paths)
        sendJson(res, 200, { ok: true, imageRel: rel, report })
        return
      }
      if (req.method === 'POST' && route === '/api/delete-hint') {
        const body = await readBody(req)
        const evtId = String(body.evtId || '')
        const paramKey = String(body.paramKey || '')
        if (!evtId || !paramKey) {
          sendJson(res, 400, { ok: false, error: '缺少 evtId / paramKey' })
          return
        }
        const payload = loadImpl(paths)
        const existing = (payload.events || []).find(item => String(item.evtId) === evtId)
        if (existing) {
          const images = paramHintImages(existing, paramKey)
          const one = toPosix(stripQuery(body.imageRel))
          const removing = one ? images.filter(rel => rel === one) : images
          const kept = one ? images.filter(rel => rel !== one) : []
          removing.forEach(rel => {
            const dest = path.resolve(paths.outDir, rel)
            if (isInsideDir(path.join(paths.outDir, '_raw', 'hints'), dest) && fs.existsSync(dest)) {
              fs.unlinkSync(dest)
            }
          })
          const merged = mergeImplEvent(existing, {
            evtId,
            parameters: [{ key: paramKey, hint: { images: kept } }]
          })
          writeImpl(paths, upsertEvent(payload, merged))
        }
        const report = renderToFile(paths)
        sendJson(res, 200, { ok: true, report })
        return
      }
      if (req.method === 'GET') {
        serveStatic(req, res, paths.outDir)
        return
      }
      sendJson(res, 404, { ok: false, error: 'Not Found' })
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error.message || error) })
    }
  })
}

function logOpen(paths, args, port, evtId, reused) {
  const htmlName = path.basename(paths.htmlPath)
  const mode = evtId ? 'confirm' : ''
  const openUrl = pageUrl(port, htmlName, evtId, mode)
  console.log('== serve-impl ==')
  console.log(`Dir: ${paths.outDir}`)
  console.log(`Impl: ${paths.implPath}`)
  if (reused) {
    console.log(`Reuse: ${port}`)
  }
  console.log(`Open: ${openUrl}`)
  if (shouldOpenBrowser(args)) {
    openBrowser(openUrl)
    console.log(reused ? '已尝试打开浏览器矫正页（复用已有服务）' : '已尝试自动打开浏览器矫正页')
  }
  return openUrl
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const paths = defaultPaths(repoRoot, args)
  if (!paths.eventsPath || !fs.existsSync(paths.eventsPath)) {
    printHelp()
    throw new Error(`events.json 不存在: ${paths.eventsPath || '(未提供 --excel / --slug)'}`)
  }
  fs.mkdirSync(path.join(paths.outDir, '_raw', 'hints'), { recursive: true })
  ensureApisFile(paths.apisPath)
  if (!fs.existsSync(paths.htmlPath)) {
    renderToFile(paths)
  }
  const startPort = Number(args.port || DEFAULT_PORT) || DEFAULT_PORT
  const evtId = evtArg(args)
  findExistingServer(paths, startPort, PORT_ATTEMPTS)
    .then(existing => {
      if (existing) {
        logOpen(paths, args, existing.port, evtId, true)
        return null
      }
      const server = createServer(paths)
      return listenAvailable(server, '127.0.0.1', startPort, PORT_ATTEMPTS)
        .then(port => {
          writeServeMeta(paths, port)
          logOpen(paths, args, port, evtId, false)
        })
    })
    .catch(error => {
      console.error(error.message || error)
      process.exit(1)
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
  main,
  DEFAULT_PORT,
  PORT_ATTEMPTS,
  openBrowser,
  pageUrl,
  evtArg,
  shouldOpenBrowser,
  probeStatus,
  findExistingServer,
  ensureServing,
  sleep
}
