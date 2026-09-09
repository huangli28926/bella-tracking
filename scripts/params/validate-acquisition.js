const { ACQUISITION_KINDS } = require('./evidence-types')

function str(value) {
  return value == null ? '' : String(value).trim()
}

function fileText(context, file) {
  const ctx = context || {}
  if (ctx.fileContents && Object.prototype.hasOwnProperty.call(ctx.fileContents, file)) {
    return String(ctx.fileContents[file] || '')
  }
  return ''
}

function referenceCountFor(component, context, step) {
  if (step && step.impact && typeof step.impact.referenceCount === 'number') {
    return step.impact.referenceCount
  }
  const map = (context && context.componentReferences) || {}
  if (component && Object.prototype.hasOwnProperty.call(map, component)) {
    return map[component]
  }
  return 1
}

function jsxReferences(text, component) {
  if (!text || !component) return false
  const escaped = component.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('<(?:' + escaped + ')\\b').test(text)
    || new RegExp('\\b' + escaped + '\\s*\\)').test(text)
    || text.indexOf(component) !== -1
}

function validateAcquisition(parameter, context) {
  const codes = []
  const acq = parameter && parameter.acquisition
  if (parameter && parameter.scopeReachable === true) {
    return {
      status: 'RESOLVED',
      requiresCodeChange: false,
      steps: [],
      impact: { scope: 'local', referenceCount: 0 },
      pathUniqueness: 'unique',
      codes
    }
  }
  if (!acq || typeof acq !== 'object' || Array.isArray(acq)) {
    codes.push('ACQUISITION_PATH_UNKNOWN')
    return { status: 'UNRESOLVED', requiresCodeChange: true, steps: [], impact: null, pathUniqueness: 'unknown', codes }
  }
  const steps = Array.isArray(acq.steps) ? acq.steps : []
  if (!steps.length) {
    codes.push('ACQUISITION_PATH_UNKNOWN')
    return {
      status: 'UNRESOLVED',
      requiresCodeChange: true,
      steps: [],
      impact: acq.impact || null,
      pathUniqueness: 'unknown',
      codes
    }
  }
  if (Array.isArray(acq.alternatePaths) && acq.alternatePaths.length > 1) {
    codes.push('ACQUISITION_NOT_UNIQUE')
    return {
      status: 'CONFLICT',
      requiresCodeChange: true,
      steps,
      impact: acq.impact || null,
      pathUniqueness: 'multiple',
      codes
    }
  }

  let maxCount = 0
  let shared = false
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i] || {}
    if (ACQUISITION_KINDS.indexOf(str(step.kind)) === -1) {
      codes.push('ACQUISITION_PATH_UNKNOWN')
      return { status: 'UNRESOLVED', requiresCodeChange: true, steps, impact: acq.impact || null, pathUniqueness: 'unknown', codes }
    }
    const toComp = str(step.to && step.to.component)
    const fromComp = str(step.from && step.from.component)
    const count = referenceCountFor(toComp || fromComp, context, step)
    step.impact = {
      scope: count > 1 ? 'shared-component' : (str(step.kind) === 'prop-pass' ? 'component-api' : 'local'),
      referenceCount: count
    }
    if (count > maxCount) maxCount = count
    if (count > 1) shared = true

    if (str(step.kind) === 'prop-pass') {
      const fromFile = str(step.from && step.from.file)
      const fromExpr = str(step.from && step.from.expression)
      const binding = str(step.to && step.to.binding)
      const fromText = fileText(context, fromFile)
      if (fromFile && fromText && fromExpr && fromText.indexOf(fromExpr.split('.')[0]) === -1) {
        codes.push('ACQUISITION_PATH_UNKNOWN')
        return { status: 'UNRESOLVED', requiresCodeChange: true, steps, impact: acq.impact || null, pathUniqueness: 'unknown', codes }
      }
      if (fromFile && fromText && toComp && !jsxReferences(fromText, toComp)) {
        codes.push('ACQUISITION_PATH_UNKNOWN')
        return { status: 'UNRESOLVED', requiresCodeChange: true, steps, impact: acq.impact || null, pathUniqueness: 'unknown', codes }
      }
      if (!binding || !fromExpr) {
        codes.push('ACQUISITION_PATH_UNKNOWN')
        return { status: 'UNRESOLVED', requiresCodeChange: true, steps, impact: acq.impact || null, pathUniqueness: 'unknown', codes }
      }
    }
    if (str(step.kind) === 'hook-call' || str(step.kind) === 'context-read') {
      const hookFile = str(step.from && step.from.file)
      const hookName = str(step.from && (step.from.hook || step.from.expression))
      const providerOk = step.providerVerified === true || (context && context.providerVerified === true)
      const text = fileText(context, hookFile)
      if (hookFile && text && hookName && text.indexOf(hookName.replace(/\(.*$/, '')) === -1) {
        codes.push('ACQUISITION_PATH_UNKNOWN')
        return { status: 'UNRESOLVED', requiresCodeChange: true, steps, impact: acq.impact || null, pathUniqueness: 'unknown', codes }
      }
      if (!providerOk) {
        codes.push('ACQUISITION_PATH_UNKNOWN')
        return { status: 'UNRESOLVED', requiresCodeChange: true, steps, impact: acq.impact || null, pathUniqueness: 'unknown', codes }
      }
    }
    if (str(step.kind) === 'url-read') {
      const field = str(step.from && (step.from.queryKey || step.from.expression))
      const urlFieldExists = step.urlFieldExists === true || (context && context.urlFieldExists === true)
      if (!field || !urlFieldExists) {
        codes.push('URL_SEMANTIC_UNKNOWN')
        return { status: 'UNRESOLVED', requiresCodeChange: true, steps, impact: acq.impact || null, pathUniqueness: 'unknown', codes }
      }
    }
  }

  const impact = {
    scope: shared ? 'shared-component' : (maxCount === 1 && steps.some(s => str(s.kind) === 'prop-pass') ? 'component-api' : 'local'),
    referenceCount: maxCount
  }
  if (shared) {
    codes.push('SHARED_COMPONENT_IMPACT')
    return {
      status: 'UNRESOLVED',
      requiresCodeChange: true,
      steps,
      impact,
      pathUniqueness: 'unique',
      codes
    }
  }
  return {
    status: 'RESOLVED',
    requiresCodeChange: true,
    steps,
    impact,
    pathUniqueness: 'unique',
    codes
  }
}

function isValidatedAcquisition(parameter) {
  const acq = parameter && parameter.acquisition
  return !!(
    parameter
    && parameter.scopeReachable === false
    && acq
    && acq.status === 'RESOLVED'
    && str(parameter.pathUniqueness) !== 'multiple'
    && str(parameter.pathUniqueness) !== 'unknown'
    && acq.impact
    && acq.impact.scope !== 'shared-component'
    && (!Array.isArray(acq.steps) || acq.steps.every(step => !step.impact || step.impact.referenceCount === 1))
  )
}

module.exports = {
  validateAcquisition,
  isValidatedAcquisition,
  referenceCountFor
}
