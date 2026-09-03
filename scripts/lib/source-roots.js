const fs = require('fs')
const path = require('path')
const { readDotEnv, toPosix } = require('./lib')

const SKIP_DIR = /^(node_modules|dist|build|coverage|\.git|\.next|vendor|__pycache__|\.turbo|out)$/
const SOURCE_EXTS = /\.(js|jsx|ts|tsx|vue)$/i
const ROOT_BASENAMES = /^(src|app|pages|views)$/
const ENV_KEYS = ['sourceRoot', 'SOURCE_ROOT', 'TRACKING_SOURCE_ROOTS']

function repoDocsAbs(repoRoot) {
  return path.resolve(repoRoot, 'docs')
}

function isUnderRepoDocs(repoRoot, absPath) {
  const docs = repoDocsAbs(repoRoot) + path.sep
  const resolved = path.resolve(absPath)
  return resolved === repoDocsAbs(repoRoot) || resolved.startsWith(docs)
}

function skipWalkDir(repoRoot, parentAbs, name) {
  if (SKIP_DIR.test(name)) {
    return true
  }
  if (name.charAt(0) === '.' && name !== '.tracking') {
    return true
  }
  if (name === 'docs' && path.resolve(parentAbs) === path.resolve(repoRoot)) {
    return true
  }
  return false
}

function parseEnvRoots(env) {
  let raw = ''
  for (let i = 0; i < ENV_KEYS.length; i += 1) {
    const value = String(env[ENV_KEYS[i]] || '').trim()
    if (value) {
      raw = value
      break
    }
  }
  if (!raw) {
    return []
  }
  return raw.split(/[,;\n]/).map(item => item.trim()).filter(Boolean)
}

function dirHasSourceFile(dirAbs, repoRoot, depth) {
  if (depth > 10 || isUnderRepoDocs(repoRoot, dirAbs)) {
    return false
  }
  let entries
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true })
  } catch (error) {
    return false
  }
  for (let i = 0; i < entries.length; i += 1) {
    const ent = entries[i]
    const full = path.join(dirAbs, ent.name)
    if (ent.isDirectory()) {
      if (skipWalkDir(repoRoot, dirAbs, ent.name)) {
        continue
      }
      if (dirHasSourceFile(full, repoRoot, depth + 1)) {
        return true
      }
    } else if (SOURCE_EXTS.test(ent.name)) {
      return true
    }
  }
  return false
}

function collapseNested(roots) {
  const sorted = roots.slice().sort((a, b) => a.rel.length - b.rel.length)
  const kept = []
  sorted.forEach(item => {
    const covered = kept.some(parent => (
      item.abs === parent.abs
      || item.abs.startsWith(parent.abs + path.sep)
    ))
    if (!covered) {
      kept.push(item)
    }
  })
  return kept
}

function collectExploreCandidates(repoRoot, dirAbs, depth, acc) {
  if (depth > 8) {
    return
  }
  let entries
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true })
  } catch (error) {
    return
  }
  entries.forEach(ent => {
    if (!ent.isDirectory()) {
      return
    }
    if (skipWalkDir(repoRoot, dirAbs, ent.name)) {
      return
    }
    const full = path.join(dirAbs, ent.name)
    if (isUnderRepoDocs(repoRoot, full)) {
      return
    }
    if (ROOT_BASENAMES.test(ent.name) && dirHasSourceFile(full, repoRoot, 0)) {
      acc.push({
        rel: toPosix(path.relative(repoRoot, full)) || '.',
        abs: full
      })
    }
    collectExploreCandidates(repoRoot, full, depth + 1, acc)
  })
}

function exploreSourceRoots(repoRoot) {
  const acc = []
  collectExploreCandidates(repoRoot, repoRoot, 0, acc)
  const unique = []
  const seen = {}
  acc.forEach(item => {
    if (!seen[item.abs]) {
      seen[item.abs] = true
      unique.push(item)
    }
  })
  let roots = collapseNested(unique)
  if (!roots.length) {
    let entries
    try {
      entries = fs.readdirSync(repoRoot, { withFileTypes: true })
    } catch (error) {
      entries = []
    }
    entries.forEach(ent => {
      if (!ent.isDirectory() || skipWalkDir(repoRoot, repoRoot, ent.name)) {
        return
      }
      const full = path.join(repoRoot, ent.name)
      if (dirHasSourceFile(full, repoRoot, 0)) {
        roots.push({
          rel: toPosix(ent.name),
          abs: full
        })
      }
    })
  }
  if (!roots.length && dirHasSourceFile(repoRoot, repoRoot, 0)) {
    roots.push({ rel: '.', abs: repoRoot })
  }
  return collapseNested(roots).sort((a, b) => a.rel.localeCompare(b.rel))
}

function resolveFromEnv(repoRoot, rels) {
  const roots = []
  const missing = []
  const skippedDocs = []
  rels.forEach(rel => {
    const abs = path.resolve(repoRoot, rel)
    if (isUnderRepoDocs(repoRoot, abs)) {
      skippedDocs.push(rel)
      return
    }
    if (!fs.existsSync(abs)) {
      missing.push(rel)
      return
    }
    roots.push({
      rel: toPosix(path.relative(repoRoot, abs)) || '.',
      abs
    })
  })
  if (skippedDocs.length) {
    throw new Error('sourceRoot 不能指向仓库根 docs/: ' + skippedDocs.join(', '))
  }
  if (!roots.length) {
    throw new Error('sourceRoot 配置的路径都不存在: ' + (missing.join(', ') || '(空)'))
  }
  if (missing.length) {
    throw new Error('sourceRoot 中有不存在的路径: ' + missing.join(', '))
  }
  return collapseNested(roots)
}

function resolveSourceRoots(repoRoot) {
  const env = readDotEnv(repoRoot)
  const envRels = parseEnvRoots(env)
  if (envRels.length) {
    return {
      mode: 'env',
      roots: resolveFromEnv(repoRoot, envRels)
    }
  }
  const roots = exploreSourceRoots(repoRoot)
  if (!roots.length) {
    throw new Error('未配置 sourceRoot，且自动探索未找到源码目录（已跳过 docs/）')
  }
  return {
    mode: 'explore',
    roots
  }
}

function aliasRootForFile(absPath, roots) {
  const resolved = path.resolve(absPath)
  let best = roots[0] ? roots[0].abs : ''
  let bestLen = 0
  roots.forEach(root => {
    const abs = path.resolve(root.abs)
    if (resolved === abs || resolved.startsWith(abs + path.sep)) {
      if (abs.length >= bestLen) {
        best = abs
        bestLen = abs.length
      }
    }
  })
  return best
}

module.exports = {
  aliasRootForFile,
  isUnderRepoDocs,
  resolveSourceRoots,
  skipWalkDir
}
