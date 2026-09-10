/**
 * 同路径验收：脚本自行判断「本条会挡住后面」，改 skip 并恢复种子页。
 * 不依赖用户事先勾选 skipInPath。
 */

function pageCore(url) {
  try {
    const parsed = new URL(String(url || ''))
    return parsed.origin + parsed.pathname
  } catch (error) {
    return String(url || '').split('#')[0].split('?')[0]
  }
}

function pageLeftPath(urlBefore, urlAfter) {
  const before = pageCore(urlBefore)
  const after = pageCore(urlAfter)
  return Boolean(before && after && before !== after)
}

function isClickTarget(target) {
  return Boolean(target && target.trigger && target.trigger.kind === 'click')
}

function isDomMiss(reason) {
  return String(reason || '').indexOf('DOM 中找不到') === 0
}

function skipReasonFor(kind, extra) {
  if (kind === 'navigated') {
    return '点击后离开当前页，已跳过本条并恢复种子入口，继续后续同路径埋点'
  }
  if (kind === 'overlay') {
    return '点击后后续埋点在当前页找不到目标，判定为本条阻断同路径，已跳过并恢复后继续'
  }
  if (kind === 'setup') {
    return extra || '前置步骤失败，本路径其余埋点未执行'
  }
  return extra || '本条会阻断同路径后续验收，已跳过并继续'
}

function toSkipOutcome(outcome, skipReason) {
  const src = outcome && typeof outcome === 'object' ? outcome : {}
  return Object.assign({}, src, {
    status: 'skip',
    reason: 'path_blocker',
    skipReason: skipReason || skipReasonFor('overlay'),
    skipKind: 'path_blocker'
  })
}

function setupSkipOutcome(reason) {
  return {
    status: 'skip',
    reason: 'path_blocker',
    skipReason: skipReasonFor('setup', reason),
    skipKind: 'path_setup',
    fired: null,
    http: null,
    paramDiffs: [],
    emptyParams: [],
    screenshot: '',
    pageScreenshot: '',
    pageUrl: '',
    diagnostic: null
  }
}

/**
 * 本条 fail 是否可能挡住同 path 后续：点过（不是找不到节点）且还有后续。
 */
function mayBlockRest(target, outcome, hasRest) {
  if (!hasRest || !outcome || outcome.status !== 'fail') {
    return false
  }
  if (!isClickTarget(target)) {
    return false
  }
  if (isDomMiss(outcome.reason)) {
    return false
  }
  return true
}

module.exports = {
  isClickTarget,
  isDomMiss,
  mayBlockRest,
  pageLeftPath,
  setupSkipOutcome,
  skipReasonFor,
  toSkipOutcome
}
