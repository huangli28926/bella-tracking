#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { findRepoRoot, parseArgs, toPosix, writeJson, readJson } = require('../lib/lib')
const { resolveSourceRoots, skipWalkDir } = require('../lib/source-roots')
const { defaultPaths } = require('./report')
const {
  loadSdkProfiles,
  matchProfileByText,
  profileById,
  defaultProfile
} = require('../lib/sdk')

const SCRIPT_DIR = __dirname
const SOURCE_EXTS = /\.(js|jsx|ts|tsx|vue)$/i
const MARKUP_EXTS = /\.(html|ejs|htm)$/i
const OVERRIDE_CANDIDATES = [
  'docs/tracking/adaptor.json',
  '.tracking/adaptor.json'
]

function printHelp() {
  console.log(`
detect-adaptor — 探测公司 SDK 版本 + 项目二次封装（不写死函数名）

Usage:
  node detect-adaptor.js --excel=docs/2.3埋点需求文档.xlsx
  node detect-adaptor.js --out=docs/tracking/impl/xxx/_raw/adaptor.json

探测结果写入 _raw/adaptor.json。docs/tracking/adaptor.json 存在时作为人工锁定覆盖。
`)
}

function listScanRoots(repoRoot) {
  return resolveSourceRoots(repoRoot)
}

function walkFiles(repoRoot, dir, extRe, acc, depth) {
  if (depth > 14) {
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
      walkFiles(repoRoot, full, extRe, acc, depth + 1)
      return
    }
    if (extRe.test(ent.name)) {
      acc.push(full)
    }
  })
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    return ''
  }
}

function countMatches(text, needle) {
  if (!needle) {
    return 0
  }
  let n = 0
  let from = 0
  while (from < text.length) {
    const idx = text.indexOf(needle, from)
    if (idx === -1) {
      break
    }
    n += 1
    from = idx + needle.length
  }
  return n
}

function detectSdkProfile(markupFiles, profiles) {
  const hits = []
  for (let i = 0; i < markupFiles.length; i += 1) {
    const text = readText(markupFiles[i])
    const profile = matchProfileByText(text, profiles)
    if (profile) {
      hits.push({ file: markupFiles[i], id: profile.id })
    }
  }
  if (!hits.length) {
    return { profile: defaultProfile(profiles), evidence: [] }
  }
  const counts = {}
  hits.forEach(hit => {
    counts[hit.id] = (counts[hit.id] || 0) + 1
  })
  let bestId = hits[0].id
  let bestN = 0
  Object.keys(counts).forEach(id => {
    if (counts[id] > bestN) {
      bestN = counts[id]
      bestId = id
    }
  })
  return {
    profile: profileById(bestId, profiles) || defaultProfile(profiles),
    evidence: hits.slice(0, 8).map(hit => hit.file)
  }
}

function exportedNames(content) {
  const names = []
  const push = name => {
    if (name && names.indexOf(name) === -1) {
      names.push(name)
    }
  }
  const exportFn = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g
  let match = exportFn.exec(content)
  while (match) {
    push(match[1])
    match = exportFn.exec(content)
  }
  const exportList = /export\s*\{([^}]+)\}/g
  match = exportList.exec(content)
  while (match) {
    match[1].split(',').forEach(part => {
      const bits = part.trim().split(/\s+as\s+/)
      push((bits[0] || '').trim())
      if (bits[1]) {
        push(bits[1].trim())
      }
    })
    match = exportList.exec(content)
  }
  const moduleExports = /(?:module\.)?exports\.([A-Za-z_$][\w$]*)/g
  match = moduleExports.exec(content)
  while (match) {
    push(match[1])
    match = moduleExports.exec(content)
  }
  return names
}

function parseObjectFields(raw) {
  const out = {}
  String(raw || '').split(',').forEach(part => {
    const text = part.trim()
    if (!text) {
      return
    }
    const colon = text.indexOf(':')
    if (colon === -1) {
      const key = text.replace(/\s+/g, '')
      if (key) {
        out[key] = key
      }
      return
    }
    const key = text.slice(0, colon).trim()
    const value = text.slice(colon + 1).trim()
    if (key) {
      out[key] = value
    }
  })
  return out
}

function findSendCall(content) {
  const re = /(?:window\.)?\$ULOG\.send\s*\(\s*([^,\n]+)\s*,\s*\{([\s\S]*?)\}/
  const match = re.exec(content)
  if (!match) {
    return null
  }
  return {
    evtArg: match[1].trim(),
    fields: parseObjectFields(match[2])
  }
}

function lastMatch(before, re) {
  let found = null
  let match = re.exec(before)
  while (match) {
    found = match
    match = re.exec(before)
  }
  return found
}

function parseParamList(raw) {
  return String(raw || '')
    .split(',')
    .map(item => item.trim().split(/\s|=/)[0].replace(/^\.\.\./, ''))
    .filter(Boolean)
}

function findEnclosingFn(content, sendIndex) {
  const windowStart = Math.max(0, sendIndex - 800)
  const before = content.slice(windowStart, sendIndex)
  const candidates = [
    lastMatch(before, /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g),
    lastMatch(before, /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(([^)]*)\)\s*\{/g),
    lastMatch(before, /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\(([^)]*)\)\s*=>\s*\{/g)
  ].filter(Boolean)
  if (!candidates.length) {
    return null
  }
  candidates.sort((a, b) => a.index - b.index)
  const match = candidates[candidates.length - 1]
  return {
    name: match[1],
    params: parseParamList(match[2])
  }
}

function isTrackingWrapper(fn, sendCall) {
  if (!fn || !sendCall || !fn.params.length) {
    return false
  }
  const evtArg = sendCall.evtArg.replace(/['"`]/g, '')
  if (fn.params.indexOf(evtArg) === -1) {
    return false
  }
  const fields = sendCall.fields || {}
  const mapped = ['event', 'pid', 'uicode', 'action'].filter(key => fields[key])
  return mapped.length >= 2
}

function placeholderFor(role) {
  if (role === 'eventType' || role === 'event') {
    return "'{{eventType}}'"
  }
  if (role === 'evtId' || role === 'evt') {
    return "'{{evtId}}'"
  }
  if (role === 'pid') {
    return "'{{pid}}'"
  }
  if (role === 'uicode') {
    return "'{{uicode}}'"
  }
  if (role === 'action') {
    return '{{action}}'
  }
  return '{{' + role + '}}'
}

function buildWrapperSnippet(name, params, sendCall) {
  const roles = {}
  const evtArg = sendCall.evtArg.replace(/^['"`]|['"`]$/g, '')
  if (!/^['"`]/.test(sendCall.evtArg)) {
    roles[evtArg] = 'evtId'
  }
  const fields = sendCall.fields || {}
  Object.keys(fields).forEach(key => {
    const value = String(fields[key] || '').replace(/;$/, '').trim()
    if (key === 'event') {
      roles[value] = 'eventType'
    } else if (key === 'pid' || key === 'uicode' || key === 'action') {
      roles[value] = key
    }
  })
  const args = params.map(param => {
    const role = roles[param]
    if (role) {
      return placeholderFor(role)
    }
    return 'undefined'
  })
  const known = args.filter(item => item.indexOf('{{') !== -1).length
  if (known < 2) {
    return null
  }
  return name + '(' + args.join(', ') + ')'
}

function detectWrappers(sourceFiles, repoRoot) {
  const wrappers = []
  sourceFiles.forEach(filePath => {
    const content = readText(filePath)
    if (content.indexOf('$ULOG.send') === -1) {
      return
    }
    if (!/\$ULOG\.send\s*\(\s*[A-Za-z_$]/.test(content)) {
      return
    }
    const sendIndex = content.search(/\$ULOG\.send\s*\(/)
    if (sendIndex < 0) {
      return
    }
    const fn = findEnclosingFn(content, sendIndex)
    const sendCall = findSendCall(content)
    if (!isTrackingWrapper(fn, sendCall)) {
      return
    }
    const exported = exportedNames(content)
    if (exported.indexOf(fn.name) === -1) {
      return
    }
    const snippet = buildWrapperSnippet(fn.name, fn.params, sendCall)
    if (!snippet) {
      return
    }
    wrappers.push({
      id: 'wrapper-' + fn.name,
      kind: 'wrapper',
      name: fn.name,
      file: toPosix(path.relative(repoRoot, filePath)),
      params: fn.params,
      snippet,
      mappingKnown: true
    })
  })
  return wrappers
}

function importFromFor(name, content) {
  const re = new RegExp(
    'import\\s+(?:\\{[^}]*\\b' + name + '\\b[^}]*\\}|' + name + ')\\s+from\\s+[\'"]([^\'"]+)[\'"]'
  )
  const match = content.match(re)
  return match ? match[1] : ''
}

function detectFileStyles(sourceFiles, repoRoot, profile, wrappers) {
  const wrapperNames = wrappers.map(item => item.name)
  const fileStyle = {}
  const counts = {}
  const importFromCount = {}

  function bump(id, n) {
    counts[id] = (counts[id] || 0) + (n || 1)
  }

  const sdkStyles = ((profile && profile.callStyles) || []).filter(item => item.kind !== 'wrapper')

  sourceFiles.forEach(filePath => {
    const rel = toPosix(path.relative(repoRoot, filePath))
    const content = readText(filePath)
    const local = {}

    wrapperNames.forEach((name, idx) => {
      const from = importFromFor(name, content)
      if (!from) {
        return
      }
      const n = countMatches(content, name + '(')
      if (!n) {
        return
      }
      if (wrappers[idx] && wrappers[idx].file === rel) {
        return
      }
      local['wrapper-' + name] = (local['wrapper-' + name] || 0) + n
      importFromCount[from] = (importFromCount[from] || 0) + n
    })

    sdkStyles.forEach(style => {
      const call = style.detect && style.detect.call
      if (!call) {
        return
      }
      let n = 0
      if (style.id === 'sdk-send') {
        n = countMatches(content, '$ULOG.send(')
        wrappers.forEach(wrap => {
          if (wrap.file === rel) {
            n = 0
          }
        })
      } else if (style.id === 'lianjia-track-send') {
        n = (content.indexOf('LIANJIA_TRACK') !== -1 && content.indexOf('.send(') !== -1) ? 1 : 0
      } else {
        n = countMatches(content, call)
      }
      if (n) {
        local[style.id] = (local[style.id] || 0) + n
      }
    })

    const domHit = /\bCLICKDATA\b|\bVIEWDATA\b|data-click-evtid|data-view-evtid/.test(content)
    if (domHit && profile && profile.id === 'lianjia-ulog-v3') {
      local['dom-attr'] = (local['dom-attr'] || 0) + 1
    }

    const ids = Object.keys(local)
    if (!ids.length) {
      return
    }
    ids.sort((a, b) => local[b] - local[a])
    fileStyle[rel] = ids[0]
    ids.forEach(id => bump(id, local[id]))
  })

  let defaultStyleId = 'sdk-send'
  let best = 0
  Object.keys(counts).forEach(id => {
    if (counts[id] > best) {
      best = counts[id]
      defaultStyleId = id
    }
  })

  let importFrom = ''
  let importBest = 0
  Object.keys(importFromCount).forEach(from => {
    if (importFromCount[from] > importBest) {
      importBest = importFromCount[from]
      importFrom = from
    }
  })

  wrappers.forEach(wrap => {
    wrap.importFrom = importFrom
  })

  return { fileStyle, counts, defaultStyleId, importFrom }
}

function loadOverride(repoRoot) {
  for (let i = 0; i < OVERRIDE_CANDIDATES.length; i += 1) {
    const abs = path.join(repoRoot, OVERRIDE_CANDIDATES[i])
    if (fs.existsSync(abs)) {
      return {
        rel: OVERRIDE_CANDIDATES[i],
        data: readJson(abs, null)
      }
    }
  }
  return null
}

function detectAdaptor(repoRoot) {
  const profiles = loadSdkProfiles()
  const resolved = listScanRoots(repoRoot)
  const roots = resolved.roots
  const sourceFiles = []
  const markupFiles = []
  roots.forEach(root => {
    walkFiles(repoRoot, root.abs, SOURCE_EXTS, sourceFiles, 0)
    walkFiles(repoRoot, root.abs, MARKUP_EXTS, markupFiles, 0)
  })
  const sdkHit = detectSdkProfile(markupFiles, profiles)
  const profile = sdkHit.profile || defaultProfile(profiles)
  const wrappers = detectWrappers(sourceFiles, repoRoot)
  const usage = detectFileStyles(sourceFiles, repoRoot, profile, wrappers)

  const sdkStyles = ((profile && profile.callStyles) || []).map(style => ({
    id: style.id,
    kind: style.kind,
    snippet: style.snippet,
    eventType: style.eventType || ''
  }))
  const styles = sdkStyles.concat(wrappers.map(wrap => ({
    id: wrap.id,
    kind: 'wrapper',
    name: wrap.name,
    file: wrap.file,
    importFrom: wrap.importFrom || '',
    snippet: wrap.snippet,
    mappingKnown: wrap.mappingKnown
  })))

  const adaptor = {
    generatedAt: new Date().toISOString(),
    sdkId: (profile && profile.id) || 'lianjia-ulog-1.3',
    sdkVersion: (profile && profile.sdkVersion) || '',
    sourceRoots: roots.map(item => item.rel),
    sourceRootMode: resolved.mode,
    styles,
    defaultStyleId: usage.defaultStyleId || 'sdk-send',
    fileStyle: usage.fileStyle,
    counts: usage.counts,
    evidence: {
      sdkScriptFiles: (sdkHit.evidence || []).map(abs => toPosix(path.relative(repoRoot, abs))),
      wrappers: wrappers.map(item => item.file)
    }
  }

  const override = loadOverride(repoRoot)
  if (override && override.data && typeof override.data === 'object') {
    adaptor.overrideFile = override.rel
    if (override.data.sdkId) {
      adaptor.sdkId = override.data.sdkId
    }
    if (override.data.defaultStyleId) {
      adaptor.defaultStyleId = override.data.defaultStyleId
    }
  }
  return adaptor
}

function detectAndWrite(repoRoot, outPath) {
  const adaptor = detectAdaptor(repoRoot)
  if (outPath) {
    writeJson(outPath, adaptor)
  }
  return adaptor
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const paths = defaultPaths(repoRoot, args)
  const outPath = args.out
    ? (path.isAbsolute(args.out) ? args.out : path.resolve(repoRoot, args.out))
    : (paths.adaptorPath || path.join(repoRoot, 'docs/tracking/_raw/adaptor.json'))
  const adaptor = detectAndWrite(repoRoot, outPath)
  console.log('== detect-adaptor ==')
  console.log('SDK: ' + adaptor.sdkId + (adaptor.sdkVersion ? ' (' + adaptor.sdkVersion + ')' : ''))
  console.log('defaultStyle: ' + adaptor.defaultStyleId)
  console.log('styles: ' + (adaptor.styles || []).map(item => item.id).join(', '))
  console.log('files: ' + Object.keys(adaptor.fileStyle || {}).length)
  console.log('sourceRoots(' + adaptor.sourceRootMode + '): ' + (adaptor.sourceRoots || []).join(', '))
  console.log('JSON: ' + outPath)
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
  detectAdaptor,
  detectAndWrite
}
