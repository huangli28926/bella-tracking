const fs = require('fs')
const path = require('path')
const {
  MOBILE_FALLBACK,
  contextOptions,
  deviceLabel,
  windowSizeArgs
} = require('./accept-device')

const LOGIN_WAIT_MS = 5 * 60 * 1000

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function defaultStoragePath(repoRoot) {
  return path.join(repoRoot, 'docs/tracking/.auth/storage.json')
}

function isLoginUrl(url) {
  const text = String(url || '').toLowerCase()
  if (!text || text === 'about:blank') {
    return false
  }
  return /login\.ke\.com|sso\.ke\.com|test-login\.ke\.com|\/\/[^/]*login[^/]*\.ke\.com/.test(text)
    || /\/login(\?|\/|#|$)/.test(text)
}

function resolveDeviceId(opts) {
  return (opts && opts.deviceId) || 'mobile'
}

async function waitUntilLoggedIn(page, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || LOGIN_WAIT_MS)
  while (Date.now() < deadline) {
    if (!isLoginUrl(page.url())) {
      await sleep(1200)
      if (!isLoginUrl(page.url())) {
        return true
      }
    }
    await sleep(1000)
  }
  throw new Error('登录超时（5 分钟）。请在打开的验收窗口完成扫码/账号登录后重试。')
}

async function saveStorage(context, storagePath) {
  if (!storagePath) {
    return
  }
  fs.mkdirSync(path.dirname(storagePath), { recursive: true })
  await context.storageState({ path: storagePath })
}

function localChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ]
  for (let i = 0; i < candidates.length; i += 1) {
    const filePath = candidates[i]
    if (filePath && fs.existsSync(filePath)) {
      return filePath
    }
  }
  return ''
}

async function launchChrome(playwright, headed, deviceId) {
  const args = windowSizeArgs(deviceId)
  const common = { headless: !headed, args }
  try {
    const browser = await playwright.chromium.launch(Object.assign({}, common, { channel: 'chrome' }))
    console.log('[accept] 浏览器: 本机 Google Chrome (channel=chrome)')
    return browser
  } catch (error) {
    const executablePath = localChromePath()
    if (executablePath) {
      const browser = await playwright.chromium.launch(Object.assign({}, common, { executablePath }))
      console.log('[accept] 浏览器: 本机 Chrome ' + executablePath)
      return browser
    }
    const browser = await playwright.chromium.launch(common)
    console.log('[accept] 浏览器: Playwright Chromium（未找到本机 Chrome）')
    return browser
  }
}

async function openAcceptSession(playwright, opts) {
  const headed = opts.headed !== false
  const deviceId = resolveDeviceId(opts)
  const contextOpts = Object.assign({}, contextOptions(playwright, deviceId))
  if (opts.storageState && fs.existsSync(opts.storageState)) {
    contextOpts.storageState = opts.storageState
  }
  const browser = await launchChrome(playwright, headed, deviceId)
  const context = await browser.newContext(contextOpts)
  if (typeof opts.onContext === 'function') {
    await opts.onContext(context)
  }
  if (opts.initScript) {
    await context.addInitScript(opts.initScript)
  }
  const page = await context.newPage()
  return { browser, context, page, headed, deviceId }
}

async function gotoProbe(page, probeUrl) {
  try {
    await page.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  } catch (error) {
    // SSO 跳转/登录页偶发不触发 domcontentloaded；已落到登录 URL 则继续等人工登录
    if (!isLoginUrl(page.url())) {
      throw error
    }
  }
  await sleep(800)
}

async function ensureLoggedIn(playwright, opts) {
  const storagePath = opts.storageState || ''
  const reused = !!(storagePath && fs.existsSync(storagePath))
  const deviceId = resolveDeviceId(opts)
  console.log('[accept] 设备: ' + deviceId + ' ' + deviceLabel(deviceId))
  let session = await openAcceptSession(playwright, opts)
  const probeUrl = String(opts.probeUrl || opts.baseUrl || '').replace(/\/$/, '') || 'about:blank'
  if (probeUrl !== 'about:blank') {
    await gotoProbe(session.page, probeUrl)
  }

  if (isLoginUrl(session.page.url())) {
    if (!session.headed) {
      await session.browser.close()
      session = await openAcceptSession(playwright, Object.assign({}, opts, { headed: true }))
      await gotoProbe(session.page, probeUrl)
    }
    if (isLoginUrl(session.page.url())) {
      console.log('[accept] 需要登录：请在打开的验收窗口完成登录，完成后会自动继续')
      await waitUntilLoggedIn(session.page, opts.loginTimeoutMs)
    }
    await saveStorage(session.context, storagePath)
    console.log('[accept] 登录态已保存: ' + storagePath)
  } else if (reused) {
    await saveStorage(session.context, storagePath)
    console.log('[accept] 复用登录态: ' + storagePath)
  } else {
    await saveStorage(session.context, storagePath)
    console.log('[accept] 当前无需登录，已写入登录态: ' + storagePath)
  }

  return session
}

module.exports = {
  IPHONE13_FALLBACK: MOBILE_FALLBACK,
  LOGIN_WAIT_MS,
  defaultStoragePath,
  ensureLoggedIn,
  isLoginUrl,
  launchChrome,
  localChromePath,
  openAcceptSession,
  openIphone13: openAcceptSession,
  saveStorage,
  waitUntilLoggedIn
}
