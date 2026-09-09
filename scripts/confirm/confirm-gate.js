const { eventParameterGate } = require('../accept/validate-parameter')
const { stampHumanConfirmation } = require('../accept/validate-confirmation-reuse')
const { getConfirmReasons, paramKeysNeedingConfirm } = require('./needs-confirm')

function flattenGateIssues(gate) {
  const issues = []
  ;((gate && gate.parameters) || []).forEach(result => {
    ;(result.issues || []).forEach(item => issues.push(item))
  })
  return issues
}

function attachValidation(event, gate) {
  const next = Object.assign({}, event)
  next.validation = {
    status: gate.status,
    issues: flattenGateIssues(gate)
  }
  return next
}

function paramUnresolvedPhrase(key) {
  return key ? ('请确认参数 ' + key + ' 的取值') : ''
}

function clearAcceptedParamUnresolved(event) {
  const next = Object.assign({}, event)
  const accepted = new Set()
  ;(Array.isArray(next.parameters) ? next.parameters : []).forEach(item => {
    const status = item && item.confirmation && item.confirmation.status
    const key = String((item && item.key) || '').trim()
    if (key && item && String(item.expression || '').trim() && (status === 'confirmed' || status === 'reused')) {
      accepted.add(key)
    }
  })
  next.unresolved = (Array.isArray(next.unresolved) ? next.unresolved : []).filter(item => {
    const text = String(item || '').trim()
    for (const key of accepted) {
      if (text === paramUnresolvedPhrase(key)) return false
    }
    return true
  })
  return next
}

/**
 * Confirm 必须先落事实、再算 confidence、再 validate。
 * INVALID → 拒绝 confirmed
 * 有表达式的参数经人工确认后按 READY 计
 * 仍有空值 / 未确认项 → 保持待确认
 * READY → 才允许 confirmed=true
 */
function applyConfirmAction(event) {
  const stamped = clearAcceptedParamUnresolved(stampHumanConfirmation(event))
  const gate = eventParameterGate(stamped)
  const next = attachValidation(stamped, gate)
  next.deferred = false
  const blockingKeys = paramKeysNeedingConfirm(next)
  const blockingReasons = getConfirmReasons(next)
  if (gate.status === 'READY') {
    next.confirmed = true
    next.deferred = false
    return {
      ok: true,
      confirmed: true,
      pending: false,
      event: next,
      gate,
      blockingKeys,
      blockingReasons
    }
  }
  next.confirmed = false
  if (gate.status === 'INVALID') {
    return {
      ok: false,
      confirmed: false,
      pending: false,
      error: 'Implementation blocked: invalid impl facts',
      event: next,
      gate,
      blockingKeys,
      blockingReasons
    }
  }
  return {
    ok: true,
    confirmed: false,
    pending: true,
    event: next,
    gate,
    blockingKeys,
    blockingReasons
  }
}

module.exports = {
  applyConfirmAction,
  flattenGateIssues
}
