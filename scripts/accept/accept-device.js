const { DEVICE_PROMPT } = require('../workflow/prompts')

const MOBILE_FALLBACK = {
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true
}

const PC_OPTIONS = {
  viewport: { width: 1440, height: 900 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false
}

const DEVICE_LABEL = {
  mobile: '移动端（iPhone 13）',
  pc: 'PC 端（桌面视口）'
}

function normalizeDevice(raw) {
  const text = String(raw || '').trim().toLowerCase()
  if (!text) {
    return ''
  }
  if (text === 'mobile' || text === 'iphone' || text === 'h5' || text === 'phone' || text === '1') {
    return 'mobile'
  }
  if (text === 'pc' || text === 'desktop' || text === 'web' || text === '2') {
    return 'pc'
  }
  throw new Error('未知设备 `' + text + '`：仅支持 --device=mobile 或 --device=pc')
}

function resolveAcceptDevice(args, env) {
  const fromArgs = args && (args.device || args['accept-device'])
  const fromEnv = env && (env.acceptDevice || env.ACCEPT_DEVICE || env.accept_device)
  return normalizeDevice(fromArgs) || normalizeDevice(fromEnv)
}

function requireAcceptDevice(args, env) {
  const deviceId = resolveAcceptDevice(args, env)
  if (!deviceId) {
    const error = new Error(DEVICE_PROMPT)
    error.code = 'NEED_DEVICE'
    throw error
  }
  return deviceId
}

function viewportForDevice(deviceId) {
  if (deviceId === 'pc') {
    return Object.assign({}, PC_OPTIONS.viewport)
  }
  return Object.assign({}, MOBILE_FALLBACK.viewport)
}

function windowSizeArgs(deviceId) {
  const vp = viewportForDevice(deviceId)
  return ['--window-size=' + vp.width + ',' + vp.height]
}

function contextOptions(playwright, deviceId) {
  if (deviceId === 'pc') {
    return Object.assign({}, PC_OPTIONS)
  }
  const device = playwright && playwright.devices && playwright.devices['iPhone 13']
  const opts = Object.assign({}, device || MOBILE_FALLBACK)
  delete opts.defaultBrowserType
  return opts
}

function deviceLabel(deviceId) {
  return DEVICE_LABEL[deviceId] || (deviceId ? String(deviceId) : '未指定')
}

module.exports = {
  DEVICE_PROMPT,
  MOBILE_FALLBACK,
  PC_OPTIONS,
  contextOptions,
  deviceLabel,
  normalizeDevice,
  requireAcceptDevice,
  resolveAcceptDevice,
  viewportForDevice,
  windowSizeArgs
}
