const { eventParameterGate } = require('../accept/validate-parameter')

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

/**
 * Confirm 必须先落事实、再算 confidence、再 validate。
 * INVALID → 拒绝 confirmed
 * NEEDS_CONFIRM → 保持待确认
 * READY → 才允许 confirmed=true
 */
function applyConfirmAction(event) {
  const gate = eventParameterGate(event)
  const next = attachValidation(event, gate)
  next.deferred = false
  if (gate.status === 'READY') {
    next.confirmed = true
    return { ok: true, confirmed: true, pending: false, event: next, gate }
  }
  next.confirmed = false
  if (gate.status === 'INVALID') {
    return {
      ok: false,
      confirmed: false,
      pending: false,
      error: 'Implementation blocked: invalid impl facts',
      event: next,
      gate
    }
  }
  return {
    ok: true,
    confirmed: false,
    pending: true,
    event: next,
    gate
  }
}

module.exports = {
  applyConfirmAction,
  flattenGateIssues
}
