const fs = require('fs')

const JS_KEYWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'this', 'window', 'document',
  'Number', 'String', 'Boolean', 'parseInt', 'parseFloat', 'JSON',
  'Math', 'Date', 'new', 'typeof', 'void', 'return'
])

function str(value) {
  return value == null ? '' : String(value).trim()
}

function expressionRoots(expression) {
  const text = str(expression)
  if (!text) return []
  const roots = []
  const re = /[A-Za-z_$][\w$]*/g
  let match
  while ((match = re.exec(text))) {
    if (JS_KEYWORDS.has(match[0])) continue
    if (match.index > 0 && text[match.index - 1] === '.') continue
    roots.push(match[0])
  }
  return [...new Set(roots)]
}

function extractFunctionBody(source, functionName) {
  const src = String(source || '')
  const name = str(functionName)
  if (!name) return src
  const patterns = [
    new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{'),
    new RegExp('(?:const|let|var)\\s+' + name + '\\s*=\\s*(?:async\\s*)?(?:function\\s*)?\\([^)]*\\)\\s*\\{'),
    new RegExp(name + '\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{'),
    new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{')
  ]
  let start = -1
  for (let i = 0; i < patterns.length; i += 1) {
    const m = patterns[i].exec(src)
    if (m) {
      start = m.index + m[0].length - 1
      break
    }
  }
  if (start < 0) return src
  let depth = 0
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return src.slice(start)
}

function identifierBound(scopeText, name) {
  const n = escapeRegExp(name)
  const patterns = [
    new RegExp('\\b(?:const|let|var)\\s+' + n + '\\b'),
    new RegExp('\\bfunction\\s+' + n + '\\b'),
    new RegExp('\\([^)]*\\b' + n + '\\b[^)]*\\)'),
    new RegExp('\\{\\s*' + n + '\\s*\\}'),
    new RegExp('\\b' + n + '\\s*='),
    new RegExp('\\b' + n + '\\s*:')
  ]
  return patterns.some(re => re.test(scopeText))
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readSource(context, file) {
  if (context && context.fileContents && Object.prototype.hasOwnProperty.call(context.fileContents, file)) {
    return String(context.fileContents[file] || '')
  }
  if (!file) return ''
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (err) {
    return ''
  }
}

function computeScopeReachable(parameter, eventContext, context) {
  const ctx = context || {}
  if (ctx.knownSymbols instanceof Set || Array.isArray(ctx.knownSymbols)) {
    const set = ctx.knownSymbols instanceof Set
      ? ctx.knownSymbols
      : new Set(ctx.knownSymbols.map(item => str(item)))
    const roots = expressionRoots(parameter && parameter.expression)
    if (!roots.length) return false
    return roots.every(root => set.has(root))
  }
  const file = str((eventContext && eventContext.targetFile) || ctx.targetFile || '')
  const fn = str((eventContext && eventContext.functionName) || ctx.functionName || '')
  const source = readSource(ctx, file)
  if (!source) return null
  const scope = extractFunctionBody(source, fn)
  const roots = expressionRoots(parameter && parameter.expression)
  if (!roots.length) return false
  const ok = roots.every(root => identifierBound(scope, root) || identifierBound(source, root))
  return ok
}

module.exports = {
  computeScopeReachable,
  expressionRoots,
  extractFunctionBody,
  identifierBound
}
