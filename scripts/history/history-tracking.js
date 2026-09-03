const fs = require('fs')
const path = require('path')
const { toPosix, writeJson } = require('../lib/lib')
const { aliasRootForFile, resolveSourceRoots, skipWalkDir } = require('../lib/source-roots')
const { detectAdaptor } = require('../extract/detect-adaptor')
const { templatePath } = require('../lib/skill-paths')

const SOURCE_EXTS = /\.(js|jsx|ts|tsx)$/i
const SKIP_IMPORT = /\.(styl|css|scss|less|sass|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|json|md)$/i
const SKIP_ROUTE = /\/(test|error)\//i
const CALL_SCAN_LIMIT = 400000
const IMPORT_DEPTH_MAX = 18

function pad(n) {
  return String(n).padStart(2, '0')
}

function stampParts(date) {
  const d = date || new Date()
  return {
    year: String(d.getFullYear()),
    mmdd: pad(d.getMonth() + 1) + pad(d.getDate()),
    hms: pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()),
    iso: d.toISOString()
  }
}

function historyOutputPaths(repoRoot, date) {
  const stamp = stampParts(date)
  const relHtml = path.join('docs/historyTracking', stamp.year, stamp.mmdd + '_' + stamp.hms + '.html')
  const relJson = path.join('docs/historyTracking', stamp.year, '_raw', stamp.mmdd + '_' + stamp.hms + '.json')
  return {
    stamp,
    htmlRel: toPosix(relHtml),
    jsonRel: toPosix(relJson),
    htmlPath: path.join(repoRoot, relHtml),
    jsonPath: path.join(repoRoot, relJson)
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    return ''
  }
}

function lineNumber(content, index) {
  let line = 1
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) {
      line += 1
    }
  }
  return line
}

function buildCommentMask(text) {
  const n = text.length
  const mask = Buffer.alloc(n)
  let i = 0
  while (i < n) {
    const c = text[i]
    const next = i + 1 < n ? text[i + 1] : ''
    if (c === '/' && next === '/') {
      while (i < n && text[i] !== '\n') {
        mask[i] = 1
        i += 1
      }
      continue
    }
    if (c === '/' && next === '*') {
      mask[i] = 1
      mask[i + 1] = 1
      i += 2
      while (i < n && !(text[i] === '*' && i + 1 < n && text[i + 1] === '/')) {
        mask[i] = 1
        i += 1
      }
      if (i < n) {
        mask[i] = 1
        i += 1
      }
      if (i < n) {
        mask[i] = 1
        i += 1
      }
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      i += 1
      while (i < n) {
        if (text[i] === '\\') {
          i += 2
          continue
        }
        if (q === '`' && text[i] === '$' && text[i + 1] === '{') {
          i += 2
          let depth = 1
          while (i < n && depth > 0) {
            if (text[i] === '{') {
              depth += 1
            } else if (text[i] === '}') {
              depth -= 1
            } else if (text[i] === '\\') {
              i += 1
            }
            i += 1
          }
          continue
        }
        if (text[i] === q) {
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    i += 1
  }
  return mask
}

function extractCallArgs(content, openParenIndex) {
  const args = []
  let current = ''
  let depthParen = 1
  let depthBrace = 0
  let depthBracket = 0
  let quote = ''
  let escape = false
  let i = openParenIndex + 1
  for (; i < content.length; i += 1) {
    const ch = content[i]
    if (quote) {
      current += ch
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === quote) {
        quote = ''
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      current += ch
      continue
    }
    if (ch === '(') {
      depthParen += 1
      current += ch
      continue
    }
    if (ch === ')') {
      depthParen -= 1
      if (depthParen === 0) {
        if (current.trim()) {
          args.push(current.trim())
        }
        return { args, end: i }
      }
      current += ch
      continue
    }
    if (ch === '{') {
      depthBrace += 1
      current += ch
      continue
    }
    if (ch === '}') {
      depthBrace -= 1
      current += ch
      continue
    }
    if (ch === '[') {
      depthBracket += 1
      current += ch
      continue
    }
    if (ch === ']') {
      depthBracket -= 1
      current += ch
      continue
    }
    if (ch === ',' && depthParen === 1 && depthBrace === 0 && depthBracket === 0) {
      args.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  return { args, end: i }
}

function parseStringLiteral(raw) {
  const text = String(raw || '').trim()
  if (!text) {
    return ''
  }
  const quote = text.charAt(0)
  if ((quote === "'" || quote === '"') && text.charAt(text.length - 1) === quote && text.length >= 2) {
    return text.slice(1, -1)
  }
  if (quote === '`' && text.charAt(text.length - 1) === '`') {
    const inner = text.slice(1, -1)
    const cut = inner.search(/\$\{/)
    return (cut === -1 ? inner : inner.slice(0, cut)).replace(/\$\{[^}]*\}/g, '')
  }
  return ''
}

function objectField(objSrc, key) {
  const re = new RegExp('(?:^|[,{\\s])' + key + '\\s*:\\s*([\'"`][^\'"`]*[\'"`])')
  const match = String(objSrc || '').match(re)
  return match ? parseStringLiteral(match[1]) : ''
}

function typeClass(eventType) {
  const key = String(eventType || '').toLowerCase()
  if (key === 'page_view') {
    return 'type-page-view'
  }
  if (key === 'page_disapper' || key === 'page_disappear' || key === 'page_leave') {
    return 'type-page-leave'
  }
  if (key === 'module_view') {
    return 'type-module-view'
  }
  if (key === 'module_click') {
    return 'type-module-click'
  }
  return 'type-other'
}

function shortRoute(fullPath) {
  const text = String(fullPath || '')
  if (!text || text === '/') {
    return '/'
  }
  const parts = text.replace(/^\//, '').split('/').filter(Boolean)
  if (parts.length <= 2) {
    return parts.join('/')
  }
  return parts.slice(-2).join('/')
}

function displayRel(relFromRepo) {
  return String(relFromRepo || '').replace(/^client\//, '')
}

function shortFile(relFromRepo) {
  const parts = displayRel(relFromRepo).split('/').filter(Boolean)
  return parts.slice(-2).join('/')
}

function skipRoutePath(routePath) {
  const text = String(routePath || '')
  if (!text || text === '/') {
    return false
  }
  return SKIP_ROUTE.test(text + '/') || /^\/error(\/|$)/.test(text)
}

const ENTRY_CONFIG_CANDIDATES = [
  'client/webpack/config.entry.js',
  'webpack/config.entry.js',
  'config.entry.js'
]

function loadWebpackEntries(repoRoot, roots) {
  const out = []
  for (let i = 0; i < ENTRY_CONFIG_CANDIDATES.length; i += 1) {
    const abs = path.join(repoRoot, ENTRY_CONFIG_CANDIDATES[i])
    if (!fs.existsSync(abs)) {
      continue
    }
    let mod
    try {
      delete require.cache[require.resolve(abs)]
      mod = require(abs)
    } catch (error) {
      continue
    }
    const map = typeof mod === 'function' ? mod({}) : mod
    if (!map || typeof map !== 'object') {
      continue
    }
    Object.keys(map).forEach(name => {
      const spec = map[name]
      if (typeof spec !== 'string') {
        return
      }
      let entryAbs = ''
      roots.forEach(root => {
        if (entryAbs) {
          return
        }
        entryAbs = resolveImport(abs, spec, root.abs) || resolveExisting(path.join(root.abs, spec))
      })
      if (entryAbs) {
        out.push({ name, entryAbs })
      }
    })
    if (out.length) {
      return out
    }
  }
  return out
}

function walkTextFiles(repoRoot, dir, acc, depth) {
  if (depth > 12) {
    return
  }
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    return
  }
  entries.forEach(ent => {
    if (ent.name === '.' || ent.name === '..') {
      return
    }
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (skipWalkDir(repoRoot, dir, ent.name)) {
        return
      }
      walkTextFiles(repoRoot, full, acc, depth + 1)
      return
    }
    if (/\.(js|jsx|ts|tsx|ejs|html|htm|vue)$/i.test(ent.name)) {
      acc.push(full)
    }
  })
}

function listServedBundleIds(repoRoot, roots) {
  const ids = {}
  const re = /['"`]\/js\/([^/'"`]+)\.js['"`]/g
  roots.forEach(root => {
    const abs = root.abs
    if (!fs.existsSync(abs)) {
      return
    }
    const files = []
    walkTextFiles(repoRoot, abs, files, 0)
    files.forEach(file => {
      const text = readText(file)
      let match = re.exec(text)
      while (match) {
        if (match[1]) {
          ids[match[1].toLowerCase()] = true
        }
        match = re.exec(text)
      }
    })
  })
  return ids
}

function liveWebpackEntries(repoRoot, roots) {
  const entries = loadWebpackEntries(repoRoot, roots)
  if (!entries.length) {
    return []
  }
  const served = listServedBundleIds(repoRoot, roots)
  if (!Object.keys(served).length) {
    return entries
  }
  const live = entries.filter(item => served[String(item.name).toLowerCase()])
  return live.length ? live : entries
}

function isRouteTableFile(content) {
  return /\bpath\s*:\s*['"`]\//.test(content) && /import\s*\(\s*['"]/.test(content)
}

function routerFilesForEntry(entryAbs, clientSrc) {
  const files = [entryAbs]
  const content = readText(entryAbs)
  const mask = buildCommentMask(content)
  collectImports(content, mask, entryAbs, clientSrc).forEach(dep => {
    if (files.indexOf(dep) === -1 && isRouteTableFile(readText(dep))) {
      files.push(dep)
    }
  })
  return files
}

function findRouterFilesFallback(aliasRoot) {
  const files = []
  const pagesDir = path.join(aliasRoot, 'pages')
  if (fs.existsSync(pagesDir)) {
    fs.readdirSync(pagesDir).forEach(name => {
      if (name.charAt(0) === '.') {
        return
      }
      const jsx = path.join(pagesDir, name, 'index.jsx')
      const js = path.join(pagesDir, name, 'index.js')
      if (fs.existsSync(jsx)) {
        files.push(jsx)
      } else if (fs.existsSync(js)) {
        files.push(js)
      }
    })
  }
  const routeData = path.join(aliasRoot, 'configs', 'routeData.js')
  if (fs.existsSync(routeData) && files.indexOf(routeData) === -1) {
    files.push(routeData)
  }
  return files
}

function findRouterFiles(repoRoot, roots) {
  const live = liveWebpackEntries(repoRoot, roots)
  if (!live.length) {
    const files = []
    roots.forEach(root => {
      findRouterFilesFallback(root.abs).forEach(file => {
        if (files.indexOf(file) === -1) {
          files.push(file)
        }
      })
    })
    return files
  }
  const files = []
  live.forEach(item => {
    const aliasRoot = aliasRootForFile(item.entryAbs, roots)
    routerFilesForEntry(item.entryAbs, aliasRoot).forEach(file => {
      if (files.indexOf(file) === -1) {
        files.push(file)
      }
    })
  })
  if (files.length) {
    return files
  }
  const fallback = []
  roots.forEach(root => {
    findRouterFilesFallback(root.abs).forEach(file => {
      if (fallback.indexOf(file) === -1) {
        fallback.push(file)
      }
    })
  })
  return fallback
}

function resolveExisting(base) {
  if (!base) {
    return ''
  }
  const stripped = base.replace(/['"]/g, '')
  const tries = [stripped]
  ;['.js', '.jsx', '.ts', '.tsx'].forEach(ext => {
    if (!SOURCE_EXTS.test(stripped)) {
      tries.push(stripped + ext)
    }
  })
  ;['/index.js', '/index.jsx', '/index.ts', '/index.tsx'].forEach(suffix => {
    tries.push(stripped + suffix)
  })
  for (let i = 0; i < tries.length; i += 1) {
    const candidate = tries[i]
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile() && SOURCE_EXTS.test(candidate)) {
        return candidate
      }
    } catch (error) {
      // ignore
    }
  }
  return ''
}

function resolveImport(fromFile, spec, aliasRoot) {
  const raw = String(spec || '').trim()
  if (!raw || raw.charAt(0) === '!' || SKIP_IMPORT.test(raw)) {
    return ''
  }
  if (raw.indexOf('node_modules') !== -1) {
    return ''
  }
  let base = ''
  if (raw.charAt(0) === '.') {
    base = path.resolve(path.dirname(fromFile), raw)
  } else if (raw.charAt(0) === '/') {
    return ''
  } else {
    const first = raw.split('/')[0]
    const aliasBase = aliasRoot || ''
    const aliasFirst = path.join(aliasBase, first)
    if (!aliasBase || !fs.existsSync(aliasFirst)) {
      return ''
    }
    base = path.join(aliasBase, raw)
  }
  const resolved = resolveExisting(base)
  if (!resolved) {
    return ''
  }
  if (!aliasRoot) {
    return resolved
  }
  const srcRoot = path.resolve(aliasRoot) + path.sep
  if (path.resolve(resolved).indexOf(srcRoot) !== 0 && path.resolve(resolved) !== path.resolve(aliasRoot)) {
    return ''
  }
  return resolved
}

function collectImports(content, mask, fromFile, aliasRoot) {
  const specs = []
  const re = /(?:import\s*\(\s*|from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g
  let match = re.exec(content)
  while (match) {
    if (!mask[match.index]) {
      specs.push(match[1])
    }
    match = re.exec(content)
  }
  const out = []
  const seen = {}
  specs.forEach(spec => {
    const abs = resolveImport(fromFile, spec, aliasRoot)
    if (abs && !seen[abs]) {
      seen[abs] = true
      out.push(abs)
    }
  })
  return out
}

function walkPageFiles(entryAbs, aliasRoot, fileCache) {
  const files = []
  const queue = [{ abs: entryAbs, depth: 0 }]
  const seen = {}
  while (queue.length) {
    const item = queue.shift()
    if (!item.abs || seen[item.abs] || item.depth > IMPORT_DEPTH_MAX) {
      continue
    }
    seen[item.abs] = true
    files.push({ abs: item.abs, depth: item.depth })
    let cached = fileCache.imports[item.abs]
    if (!cached) {
      const content = fileCache.content[item.abs] || readText(item.abs)
      fileCache.content[item.abs] = content
      const mask = fileCache.mask[item.abs] || buildCommentMask(content)
      fileCache.mask[item.abs] = mask
      cached = collectImports(content, mask, item.abs, aliasRoot)
      fileCache.imports[item.abs] = cached
    }
    cached.forEach(dep => {
      if (!seen[dep]) {
        queue.push({ abs: dep, depth: item.depth + 1 })
      }
    })
  }
  return files
}

function wrapperNames(adaptor) {
  const names = []
  ;(adaptor.styles || []).forEach(style => {
    if (style && style.kind === 'wrapper' && style.name) {
      names.push(style.name)
    }
  })
  return names
}

function wrapperFiles(adaptor, repoRoot) {
  const set = {}
  ;(adaptor.styles || []).forEach(style => {
    if (style && style.kind === 'wrapper' && style.file) {
      set[path.resolve(repoRoot, style.file)] = true
    }
  })
  return set
}

function extractEventsInFile(absPath, repoRoot, content, mask, names, skipFile) {
  if (skipFile) {
    return []
  }
  const rel = toPosix(path.relative(repoRoot, absPath))
  const events = []
  const limit = Math.min(content.length, CALL_SCAN_LIMIT)

  names.forEach(name => {
    const re = new RegExp('\\b' + name.replace(/[$*+?()[\]{}|\\]/g, '\\$&') + '\\s*\\(', 'g')
    let match = re.exec(content)
    while (match) {
      if (match.index >= limit) {
        break
      }
      if (!mask[match.index]) {
        const open = match.index + match[0].length - 1
        const parsed = extractCallArgs(content, open)
        const eventType = parseStringLiteral(parsed.args[0] || '')
        const evtId = parseStringLiteral(parsed.args[1] || '')
        const pid = parseStringLiteral(parsed.args[2] || '')
        const uicode = parseStringLiteral(parsed.args[3] || '')
        if (evtId && eventType) {
          events.push({
            evtId,
            eventType,
            pid,
            uicode,
            file: rel,
            line: lineNumber(content, match.index),
            style: 'wrapper-' + name
          })
        }
      }
      match = re.exec(content)
    }
  })

  const sdkRe = /(?:window\.)?\$ULOG\.send\s*\(/g
  let sdkMatch = sdkRe.exec(content)
  while (sdkMatch) {
    if (sdkMatch.index >= limit) {
      break
    }
    if (!mask[sdkMatch.index]) {
      const open = sdkMatch.index + sdkMatch[0].length - 1
      const parsed = extractCallArgs(content, open)
      const evtId = parseStringLiteral(parsed.args[0] || '')
      const obj = parsed.args[1] || ''
      const eventType = objectField(obj, 'event')
      const pid = objectField(obj, 'pid')
      const uicode = objectField(obj, 'uicode')
      if (evtId) {
        events.push({
          evtId,
          eventType: eventType || '-',
          pid,
          uicode,
          file: rel,
          line: lineNumber(content, sdkMatch.index),
          style: 'sdk-send'
        })
      }
    }
    sdkMatch = sdkRe.exec(content)
  }
  return events
}

function pathnameOf(raw) {
  const text = String(raw || '').trim()
  if (!text || text.charAt(0) !== '/') {
    return ''
  }
  return text.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/'
}

function matchKnownRoute(pathname, routes) {
  const target = pathnameOf(pathname)
  if (!target) {
    return ''
  }
  let best = ''
  routes.forEach(route => {
    const p = route.path
    if (target === p || target.indexOf(p + '/') === 0) {
      if (p.length > best.length) {
        best = p
      }
    }
  })
  return best || target
}

function extractPathFromArg(arg) {
  const text = String(arg || '').trim()
  const literal = parseStringLiteral(text)
  if (literal) {
    return pathnameOf(literal)
  }
  const concat = text.match(/^(['"`])(\/[\s\S]*?)\1\s*\+/)
  if (concat) {
    return pathnameOf(concat[2])
  }
  const objPath = objectField(text, 'pathname')
  if (objPath) {
    return pathnameOf(objPath)
  }
  return ''
}

function extractNavInFile(absPath, repoRoot, content, mask) {
  const rel = toPosix(path.relative(repoRoot, absPath))
  const hits = []

  function push(via, index, rawPath) {
    const pathname = pathnameOf(rawPath)
    if (!pathname) {
      return
    }
    hits.push({
      via,
      file: rel,
      line: lineNumber(content, index),
      targetPath: pathname
    })
  }

  const pushRe = /\bhistory\.push\s*\(/g
  let match = pushRe.exec(content)
  while (match) {
    if (!mask[match.index]) {
      const open = match.index + match[0].length - 1
      const parsed = extractCallArgs(content, open)
      push('history.push', match.index, extractPathFromArg(parsed.args[0] || ''))
    }
    match = pushRe.exec(content)
  }

  const replaceRe = /\bhistory\.replace\s*\(/g
  match = replaceRe.exec(content)
  while (match) {
    if (!mask[match.index]) {
      const open = match.index + match[0].length - 1
      const parsed = extractCallArgs(content, open)
      push('history.replace', match.index, extractPathFromArg(parsed.args[0] || ''))
    }
    match = replaceRe.exec(content)
  }

  const linkRe = /\bto\s*=\s*\{?\s*(['"`][^'"`]*['"`])/g
  match = linkRe.exec(content)
  while (match) {
    if (!mask[match.index]) {
      push('Link', match.index, parseStringLiteral(match[1]))
    }
    match = linkRe.exec(content)
  }

  return hits
}

function parseRouterObjects(content, routerFile, aliasRoot, repoRoot) {
  const routes = []
  const re = /\{\s*path\s*:\s*(['"`][^'"`]+['"`])([\s\S]*?)(?=\n\s*\{|\n\s*\]|\n\s*\))/g
  let match = re.exec(content)
  while (match) {
    const routePath = parseStringLiteral(match[1])
    const body = match[2] || ''
    const importMatch = body.match(/import\s*\(\s*(['"`][^'"`]+['"`])\s*\)/)
    const spec = importMatch ? parseStringLiteral(importMatch[1]) : ''
    const bread = body.match(/breadInfo\s*:\s*\[\s*(['"`][^'"`]+['"`])/)
    const pageName = bread ? parseStringLiteral(bread[1]) : ''
    if (routePath && spec && !skipRoutePath(routePath)) {
      const entryAbs = resolveImport(routerFile, spec, aliasRoot)
      if (entryAbs) {
        routes.push({
          path: routePath,
          pageName: pageName || '-',
          entryFile: toPosix(path.relative(repoRoot, entryAbs)),
          entryAbs,
          routerFile: toPosix(path.relative(repoRoot, routerFile))
        })
      }
    }
    match = re.exec(content)
  }
  return routes
}

function fallbackRoute(routerFile, content, aliasRoot, repoRoot) {
  if (/\b(routerData|routeData)\s*\.map/.test(content)) {
    return null
  }
  if (/@category\s+组件库/.test(content) || /@component\s+/.test(content)) {
    return null
  }
  if (/\bpath\s*:/.test(content) && /import\s*\(\s*['"]/.test(content)) {
    return null
  }
  const dirName = path.basename(path.dirname(routerFile))
  const routerTag = content.match(/@router\s+(\S+)/)
  const routePath = routerTag ? routerTag[1] : '/' + dirName
  if (skipRoutePath(routePath)) {
    return null
  }
  return {
    path: routePath,
    pageName: '-',
    entryFile: toPosix(path.relative(repoRoot, routerFile)),
    entryAbs: routerFile,
    routerFile: toPosix(path.relative(repoRoot, routerFile))
  }
}

function collectRoutes(repoRoot, roots) {
  const routerFiles = findRouterFiles(repoRoot, roots)
  const routes = []
  const seen = {}
  routerFiles.forEach(file => {
    const content = readText(file)
    const aliasRoot = aliasRootForFile(file, roots)
    const parsed = parseRouterObjects(content, file, aliasRoot, repoRoot)
    if (parsed.length) {
      parsed.forEach(route => {
        if (!seen[route.path]) {
          seen[route.path] = true
          routes.push(route)
        }
      })
      return
    }
    const fallback = fallbackRoute(file, content, aliasRoot, repoRoot)
    if (fallback && !seen[fallback.path]) {
      seen[fallback.path] = true
      routes.push(fallback)
    }
  })
  routes.sort((a, b) => a.path.localeCompare(b.path))
  return routes
}

function pickUicode(events) {
  const pageView = events.filter(item => String(item.eventType).toLowerCase() === 'page_view' && item.uicode)
  if (pageView.length) {
    return pageView[0].uicode
  }
  const withUi = events.filter(item => item.uicode)
  return withUi.length ? withUi[0].uicode : '-'
}

function buildGraph(repoRoot) {
  const resolved = resolveSourceRoots(repoRoot)
  const roots = resolved.roots
  const adaptor = detectAdaptor(repoRoot)
  const names = wrapperNames(adaptor)
  const skipFiles = wrapperFiles(adaptor, repoRoot)
  const routes = collectRoutes(repoRoot, roots)
  const fileCache = { content: {}, mask: {}, imports: {}, events: {}, navs: {} }

  function eventsOf(absPath) {
    if (fileCache.events[absPath]) {
      return fileCache.events[absPath]
    }
    const content = fileCache.content[absPath] || readText(absPath)
    fileCache.content[absPath] = content
    const mask = fileCache.mask[absPath] || buildCommentMask(content)
    fileCache.mask[absPath] = mask
    const events = extractEventsInFile(absPath, repoRoot, content, mask, names, !!skipFiles[absPath])
    fileCache.events[absPath] = events
    return events
  }

  function navsOf(absPath) {
    if (fileCache.navs[absPath]) {
      return fileCache.navs[absPath]
    }
    const content = fileCache.content[absPath] || readText(absPath)
    fileCache.content[absPath] = content
    const mask = fileCache.mask[absPath] || buildCommentMask(content)
    fileCache.mask[absPath] = mask
    const navs = extractNavInFile(absPath, repoRoot, content, mask)
    fileCache.navs[absPath] = navs
    return navs
  }

  const allFiles = {}
  let pages = routes.map(route => {
    const tree = walkPageFiles(route.entryAbs, aliasRootForFile(route.entryAbs, roots), fileCache)
    const events = []
    const navs = []
    tree.forEach(node => {
      allFiles[toPosix(path.relative(repoRoot, node.abs))] = true
      eventsOf(node.abs).forEach(evt => events.push(evt))
      navsOf(node.abs).forEach(nav => navs.push(nav))
    })
    return {
      path: route.path,
      shortPath: shortRoute(route.path),
      pageName: route.pageName || '-',
      entryFile: route.entryFile,
      uicode: pickUicode(events),
      fileCount: tree.length,
      events,
      navs
    }
  })

  if (!pages.length) {
    const files = []
    roots.forEach(root => walkTextFiles(repoRoot, root.abs, files, 0))
    const sourceFiles = files.filter(file => SOURCE_EXTS.test(file))
    const events = []
    const navs = []
    sourceFiles.forEach(abs => {
      allFiles[toPosix(path.relative(repoRoot, abs))] = true
      eventsOf(abs).forEach(evt => events.push(evt))
      navsOf(abs).forEach(nav => navs.push(nav))
    })
    pages = [{
      path: '/',
      shortPath: '/',
      pageName: '-',
      entryFile: roots[0] ? roots[0].rel : '.',
      uicode: pickUicode(events),
      fileCount: sourceFiles.length,
      events,
      navs
    }]
  }

  const edgeDetails = []
  pages.forEach(page => {
    page.navs.forEach(nav => {
      const targetPath = matchKnownRoute(nav.targetPath, routes)
      if (!targetPath || targetPath === page.path) {
        return
      }
      if (skipRoutePath(targetPath)) {
        return
      }
      edgeDetails.push({
        from: page.path,
        to: targetPath,
        via: nav.via,
        file: nav.file,
        line: nav.line
      })
    })
  })

  const groupMap = {}
  edgeDetails.forEach(edge => {
    const key = edge.from + '|' + edge.to + '|' + edge.via
    if (!groupMap[key]) {
      groupMap[key] = {
        from: edge.from,
        to: edge.to,
        via: edge.via,
        count: 0
      }
    }
    groupMap[key].count += 1
  })
  const edgeGroups = Object.keys(groupMap).map(key => groupMap[key])
  edgeGroups.sort((a, b) => {
    if (a.from !== b.from) {
      return a.from.localeCompare(b.from)
    }
    if (a.to !== b.to) {
      return a.to.localeCompare(b.to)
    }
    return a.via.localeCompare(b.via)
  })
  edgeDetails.sort((a, b) => {
    if (a.from !== b.from) {
      return a.from.localeCompare(b.from)
    }
    if (a.to !== b.to) {
      return a.to.localeCompare(b.to)
    }
    if (a.file !== b.file) {
      return a.file.localeCompare(b.file)
    }
    return a.line - b.line
  })

  const eventKeys = {}
  let eventCount = 0
  pages.forEach(page => {
    page.events.forEach(evt => {
      const key = evt.file + ':' + evt.line + ':' + evt.evtId
      if (!eventKeys[key]) {
        eventKeys[key] = true
        eventCount += 1
      }
    })
  })

  return {
    generatedAt: new Date().toISOString(),
    mode: 'full-static',
    sourceRootMode: resolved.mode,
    sourceRoots: roots.map(item => item.rel),
    adaptor: {
      sdkId: adaptor.sdkId,
      defaultStyleId: adaptor.defaultStyleId,
      wrappers: names
    },
    stats: {
      pageCount: pages.length,
      eventCount,
      edgeCount: edgeDetails.length,
      fileCount: Object.keys(allFiles).length
    },
    pages: pages.map(page => ({
      path: page.path,
      shortPath: page.shortPath,
      pageName: page.pageName,
      entryFile: page.entryFile,
      uicode: page.uicode,
      fileCount: page.fileCount,
      events: page.events
    })),
    edgeGroups,
    edgeDetails
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function isPageLifecycle(eventType) {
  const t = String(eventType || '').toLowerCase()
  return t === 'page_view' || t === 'page_disapper' || t === 'page_disappear' || t === 'page_leave'
}

function lifecycleUiBucket(eventType) {
  const t = String(eventType || '').toLowerCase().replace('disapper', 'disappear')
  if (t === 'page_view') return 'view'
  if (t === 'page_disappear' || t === 'page_leave') return 'leave'
  return ''
}

function pageLifecycleUicodes(page) {
  const set = {}
  ;(page.events || []).forEach(evt => {
    if (!isPageLifecycle(evt.eventType)) return
    if (evt.uicode && evt.uicode !== '-') set[evt.uicode] = true
  })
  return Object.keys(set)
}

function classifyPage(page) {
  const events = page.events || []
  const types = {}
  const pids = {}
  const styles = {}
  const ids = {}
  const uiByKind = { view: {}, leave: {} }
  let dupEvt = false
  let dupUi = false
  events.forEach(evt => {
    const t = evt.eventType || '-'
    types[t] = true
    if (evt.pid) pids[evt.pid] = true
    if (evt.style) styles[evt.style] = true
    if (isPageLifecycle(evt.eventType)) {
      const ui = evt.uicode && evt.uicode !== '-' ? evt.uicode : ''
      const kind = lifecycleUiBucket(evt.eventType)
      if (ui && kind) {
        if (uiByKind[kind][ui]) dupUi = true
        uiByKind[kind][ui] = true
      }
      return
    }
    if (evt.evtId) {
      if (ids[evt.evtId]) dupEvt = true
      ids[evt.evtId] = true
    }
  })
  const typeList = Object.keys(types)
  let category = 'none'
  if (events.length) {
    const lower = typeList.map(t => String(t).toLowerCase())
    const hasClick = lower.some(t => t.indexOf('click') !== -1)
    const hasView = lower.some(t => /view|leave|disappear|disapper/.test(t))
    if (hasClick && hasView) category = 'mixed'
    else if (hasClick) category = 'click'
    else if (hasView) category = 'view'
    else category = 'mixed'
  }
  let status = 'empty'
  const uiOk = page.uicode && page.uicode !== '-'
  const nameOk = page.pageName && page.pageName !== '-'
  if (!events.length) status = 'empty'
  else if (dupEvt || dupUi) status = 'risk'
  else if (!uiOk || !nameOk) status = 'pending'
  else status = 'done'
  const segments = String(page.path || '').replace(/^\//, '').split('/').filter(Boolean)
  const level = !segments.length ? '1' : (segments.length >= 3 ? '3' : String(segments.length))
  return {
    status,
    category,
    types: typeList.join('|'),
    pids: Object.keys(pids).join('|'),
    styles: Object.keys(styles).join('|'),
    level
  }
}

function statusHint(status) {
  if (status === 'pending') return '有埋点，但 pageName 或 uicode 为「-」，需人工核对'
  if (status === 'risk') return '模块 evtId 重复，或 Page_View/Page_Disappear 的 uicode 重复（evtId 允许重复）'
  if (status === 'empty') return '该路由未扫描到任何埋点'
  if (status === 'done') return '有埋点，元数据完整，且无重复风险'
  return ''
}

function statusLabel(status) {
  if (status === 'pending') return '待确认'
  if (status === 'risk') return '有风险'
  if (status === 'empty') return '无数据'
  if (status === 'done') return '已完成'
  return status
}

function optionList(values) {
  return values.map(v => '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</option>').join('')
}

function renderGraphHtml(graph, template) {
  const pages = graph.pages || []
  const statusCounts = { pending: 0, risk: 0, empty: 0, done: 0 }
  const typeSet = {}
  const pidSet = {}
  const styleSet = {}
  const uiPages = {}
  pages.forEach((page, idx) => {
    pageLifecycleUicodes(page).forEach(ui => {
      if (!uiPages[ui]) uiPages[ui] = []
      uiPages[ui].push(idx)
    })
  })
  const sharedUi = {}
  Object.keys(uiPages).forEach(ui => {
    if (uiPages[ui].length > 1) {
      uiPages[ui].forEach(idx => { sharedUi[idx] = true })
    }
  })

  const pageList = pages.map((page, idx) => {
    const info = classifyPage(page)
    if (sharedUi[idx] && info.status !== 'empty') {
      info.status = 'risk'
    }
    statusCounts[info.status] = (statusCounts[info.status] || 0) + 1
    String(info.types).split('|').forEach(t => { if (t) typeSet[t] = true })
    String(info.pids).split('|').forEach(t => { if (t) pidSet[t] = true })
    String(info.styles).split('|').forEach(t => { if (t) styleSet[t] = true })
    const search = [
      page.path,
      page.shortPath,
      page.pageName,
      page.uicode,
      statusLabel(info.status),
      info.category
    ].concat(page.events.map(evt => [evt.evtId, evt.eventType, evt.file].join(' '))).join(' ')
    const openAttr = idx === 0 ? ' open' : ''
    let body
    if (!page.events.length) {
      body = '<p class="empty muted">该路由下未扫描到埋点</p>'
    } else {
      const rows = page.events.map(evt => {
        const rel = displayRel(evt.file)
        const short = shortFile(evt.file) + ':' + evt.line
        const rowSearch = [evt.evtId, evt.eventType, evt.file, shortFile(evt.file)].join(' ')
        return '<tr class="event-row" data-search="' + escapeHtml(rowSearch) + '">' +
          '<td><code class="evt-id">' + escapeHtml(evt.evtId) + '</code></td>' +
          '<td><span class="type-badge ' + typeClass(evt.eventType) + '">' + escapeHtml(evt.eventType) + '</span></td>' +
          '<td class="file-cell"><span class="file-short" title="' + escapeHtml(rel) + '">' +
          escapeHtml(short) + '</span></td></tr>'
      }).join('')
      body = '<div class="table-wrap"><table class="data-table event-table"><thead>' +
        '<tr><th>事件 ID</th><th>类型</th><th>代码位置</th></tr></thead><tbody>' +
        rows + '</tbody></table></div>'
    }
    return '<details class="page-block" id="page-' + idx + '"' +
      ' data-search="' + escapeHtml(search) + '"' +
      ' data-status="' + escapeHtml(info.status) + '"' +
      ' data-category="' + escapeHtml(info.category) + '"' +
      ' data-types="' + escapeHtml(info.types) + '"' +
      ' data-level="' + escapeHtml(info.level) + '"' +
      ' data-pids="' + escapeHtml(info.pids) + '"' +
      ' data-styles="' + escapeHtml(info.styles) + '"' +
      openAttr + '>' +
      '<summary class="page-summary">' +
      '<span class="summary-left">' +
      '<span class="route-full">' + escapeHtml(page.path) + '</span>' +
      '<span class="status-tag status-' + escapeHtml(info.status) + '" title="' + escapeHtml(statusHint(info.status)) + '">' + escapeHtml(statusLabel(info.status)) + '</span>' +
      '</span>' +
      '<span class="summary-right">' +
      '<span class="route-short muted">' + escapeHtml(page.shortPath) + '</span>' +
      '<span class="count-badge">' + page.events.length + ' 埋点</span>' +
      '</span></summary>' +
      '<div class="page-body"><div class="page-meta">' +
      '<span><strong>pageName</strong> ' + escapeHtml(page.pageName || '-') + '</span>' +
      '<span><strong>uicode</strong> <code>' + escapeHtml(page.uicode || '-') + '</code></span>' +
      '<span><strong>组件</strong> ' + page.fileCount + ' 个文件</span>' +
      '</div>' + body + '</div></details>'
  }).join('')

  const edgeGroups = (graph.edgeGroups || []).map(edge => {
    const search = [edge.from, edge.to, edge.via].join(' ')
    return '<tr class="edge-row" data-search="' + escapeHtml(search) + '">' +
      '<td><code class="route-tag">' + escapeHtml(shortRoute(edge.from)) + '</code>' +
      '<span class="muted route-full-hint">' + escapeHtml(edge.from) + '</span></td>' +
      '<td class="arrow-cell">→</td>' +
      '<td><code class="route-tag">' + escapeHtml(shortRoute(edge.to)) + '</code>' +
      '<span class="muted route-full-hint">' + escapeHtml(edge.to) + '</span></td>' +
      '<td><span class="via-badge">' + escapeHtml(edge.via) + '</span></td>' +
      '<td>' + edge.count + '</td></tr>'
  }).join('')

  const edgeDetails = (graph.edgeDetails || []).map(edge => {
    const loc = shortFile(edge.file) + ':' + edge.line
    const search = [edge.from, edge.to, edge.via, edge.file + ':' + edge.line].join(' ')
    return '<tr class="edge-detail-row" data-search="' + escapeHtml(search) + '">' +
      '<td>' + escapeHtml(shortRoute(edge.from)) + '</td>' +
      '<td class="arrow-cell">→</td>' +
      '<td>' + escapeHtml(shortRoute(edge.to)) + '</td>' +
      '<td><span class="via-badge">' + escapeHtml(edge.via) + '</span></td>' +
      '<td class="file-cell"><span title="' + escapeHtml(displayRel(edge.file) + ':' + edge.line) + '">' +
      escapeHtml(loc) + '</span></td></tr>'
  }).join('')

  const wrappers = ((graph.adaptor && graph.adaptor.wrappers) || []).join(' / ') || '$ULOG.send'
  const typeOptions = optionList(Object.keys(typeSet).sort())
  const pidOptions = optionList(Object.keys(pidSet).sort())
  const styleOptions = optionList(Object.keys(styleSet).sort())
  return template
    .replace(/{{TITLE}}/g, 'bella-tracking_v4')
    .replace(/{{SUBTITLE}}/g, '全仓静态扫描 · 调用 ' + escapeHtml(wrappers))
    .replace(/{{GENERATED_AT}}/g, escapeHtml(graph.generatedAt || ''))
    .replace(/{{PAGE_COUNT}}/g, String(graph.stats.pageCount))
    .replace(/{{EVENT_COUNT}}/g, String(graph.stats.eventCount))
    .replace(/{{EDGE_COUNT}}/g, String(graph.stats.edgeCount))
    .replace(/{{FILE_COUNT}}/g, String(graph.stats.fileCount))
    .replace(/{{STATUS_PENDING}}/g, String(statusCounts.pending || 0))
    .replace(/{{STATUS_RISK}}/g, String(statusCounts.risk || 0))
    .replace(/{{STATUS_EMPTY}}/g, String(statusCounts.empty || 0))
    .replace(/{{STATUS_DONE}}/g, String(statusCounts.done || 0))
    .replace(/{{EVENT_TYPE_OPTIONS}}/g, typeOptions)
    .replace(/{{PID_OPTIONS}}/g, pidOptions)
    .replace(/{{STYLE_OPTIONS}}/g, styleOptions)
    .replace(/{{PAGE_LIST}}/g, pageList)
    .replace(/{{EDGE_GROUPS}}/g, edgeGroups || '<tr><td colspan="5" class="muted">未扫描到页面跳转</td></tr>')
    .replace(/{{EDGE_DETAIL_COUNT}}/g, String((graph.edgeDetails || []).length))
    .replace(/{{EDGE_DETAILS}}/g, edgeDetails || '<tr><td colspan="5" class="muted">无</td></tr>')
}

function scanAndWrite(repoRoot, options) {
  const opts = options || {}
  const graph = buildGraph(repoRoot)
  const out = historyOutputPaths(repoRoot, opts.date)
  graph.output = { html: out.htmlRel, json: out.jsonRel }
  writeJson(out.jsonPath, graph)
  const htmlTemplate = readText(templatePath('history-tracking.html'))
  if (!htmlTemplate) {
    throw new Error('缺少模板 templates/history-tracking.html')
  }
  fs.mkdirSync(path.dirname(out.htmlPath), { recursive: true })
  fs.writeFileSync(out.htmlPath, renderGraphHtml(graph, htmlTemplate), 'utf8')
  return { graph, htmlPath: out.htmlPath, jsonPath: out.jsonPath, htmlRel: out.htmlRel }
}

module.exports = {
  buildGraph,
  historyOutputPaths,
  renderGraphHtml,
  scanAndWrite
}
