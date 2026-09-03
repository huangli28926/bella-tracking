const fs = require('fs')
const path = require('path')

function isRepoRoot(dir) {
  const hasClient = fs.existsSync(path.join(dir, 'client'))
  const hasDocs = fs.existsSync(path.join(dir, 'docs'))
  const hasTrack = fs.existsSync(path.join(dir, 'packages', 'track-acceptance'))
  if (hasClient && (hasDocs || hasTrack)) {
    return true
  }
  const hasGit = fs.existsSync(path.join(dir, '.git'))
  if (hasGit && (hasDocs || fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, 'src')))) {
    return true
  }
  return false
}

function walkForRepoRoot(startDir) {
  let dir = path.resolve(startDir)
  for (let i = 0; i < 16; i += 1) {
    if (isRepoRoot(dir)) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return ''
}

function findRepoRoot(startDir) {
  const fromCwd = walkForRepoRoot(process.cwd())
  if (fromCwd) {
    return fromCwd
  }
  if (startDir) {
    const fromStart = walkForRepoRoot(startDir)
    if (fromStart) {
      return fromStart
    }
  }
  return path.resolve(process.cwd())
}

function parseArgs(argv) {
  const args = argv.slice(2)
  const result = { _: [] }
  args.forEach(arg => {
    if (!arg.startsWith('--')) {
      result._.push(arg)
      return
    }
    const eq = arg.indexOf('=')
    if (eq === -1) {
      result[arg.slice(2)] = true
      return
    }
    result[arg.slice(2, eq)] = arg.slice(eq + 1)
  })
  return result
}

function docSlug(excelPath) {
  return path.basename(excelPath, path.extname(excelPath))
}

function safeEvtFileName(evtId) {
  const raw = String(evtId || 'unknown').trim() || 'unknown'
  return raw.replace(/[^\w.-]+/g, '_')
}

function safeParamFileName(paramKey) {
  const raw = String(paramKey || 'param').trim() || 'param'
  return raw.replace(/[^\w.-]+/g, '_')
}

function isInsideDir(dir, targetPath) {
  const root = path.resolve(dir) + path.sep
  const resolved = path.resolve(targetPath)
  return resolved === path.resolve(dir) || resolved.startsWith(root)
}

function resolveExcel(repoRoot, value) {
  if (!value) {
    return ''
  }
  if (path.isAbsolute(value)) {
    return value
  }
  const fromRepo = path.resolve(repoRoot, value)
  if (fs.existsSync(fromRepo)) {
    return fromRepo
  }
  return path.resolve(process.cwd(), value)
}

function ensureDocsDir(repoRoot) {
  const docsDir = path.join(repoRoot, 'docs')
  fs.mkdirSync(docsDir, { recursive: true })
  return docsDir
}

/**
 * 埋点 xlsx 必须落在仓库根 docs/ 下（含子目录即可）。
 * 不在则 mkdir docs 后把文件移动到 docs/{原文件名}。
 * 源已不存在时尝试 docs/{basename}（上次已搬过）。
 */
function ensureExcelInDocs(repoRoot, excelPath) {
  if (!excelPath) {
    return ''
  }
  const abs = path.resolve(excelPath)
  const docsDir = ensureDocsDir(repoRoot)
  const dest = path.join(docsDir, path.basename(abs))
  if (isInsideDir(docsDir, abs) && fs.existsSync(abs)) {
    return abs
  }
  if (!fs.existsSync(abs)) {
    if (fs.existsSync(dest)) {
      return dest
    }
    return abs
  }
  if (path.resolve(dest) === abs) {
    return abs
  }
  if (fs.existsSync(dest)) {
    throw new Error(`docs 下已存在同名文件，未移动: ${dest}（源: ${abs}）`)
  }
  try {
    fs.renameSync(abs, dest)
  } catch (error) {
    if (error && error.code === 'EXDEV') {
      fs.copyFileSync(abs, dest)
      fs.unlinkSync(abs)
    } else {
      throw error
    }
  }
  console.log(`已将埋点文档移动到 docs/: ${abs} -> ${dest}`)
  return dest
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function readJson(filePath, fallback) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function toPosix(filePath) {
  return String(filePath || '').split(path.sep).join('/')
}

function relFrom(fromFile, targetPath) {
  return toPosix(path.relative(path.dirname(fromFile), targetPath))
}

function readDotEnv(repoRoot) {
  const envPath = path.join(repoRoot || process.cwd(), '.env')
  const out = {}
  if (!fs.existsSync(envPath)) {
    return out
  }
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    const text = String(line || '').trim()
    if (!text || text.charAt(0) === '#') {
      return
    }
    const eq = text.indexOf('=')
    if (eq <= 0) {
      return
    }
    const key = text.slice(0, eq).trim()
    let value = text.slice(eq + 1).trim()
    if ((value.charAt(0) === '"' && value.charAt(value.length - 1) === '"')
      || (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")) {
      value = value.slice(1, -1)
    }
    out[key] = value
  })
  return out
}

function parseQuery(urlStr) {
  const out = {}
  try {
    const parsed = new URL(urlStr, 'http://seed.invalid')
    parsed.searchParams.forEach((value, key) => {
      out[key] = value
    })
  } catch (error) {
    // ignore
  }
  return out
}

function toPathAndSearch(urlStr, base) {
  try {
    const parsed = new URL(urlStr, base || 'http://seed.invalid')
    return parsed.pathname + parsed.search + parsed.hash
  } catch (error) {
    const text = String(urlStr || '')
    return text.charAt(0) === '/' ? text : '/' + text
  }
}

function replaceQueryParam(pathAndQuery, key, value) {
  if (!key || value === undefined || value === null || value === '') {
    return pathAndQuery
  }
  try {
    const parsed = new URL(pathAndQuery, 'http://seed.invalid')
    parsed.searchParams.set(key, String(value))
    return parsed.pathname + parsed.search + parsed.hash
  } catch (error) {
    return pathAndQuery
  }
}

function joinOrigin(origin, pathAndQuery) {
  const base = String(origin || '').replace(/\/$/, '')
  const rel = String(pathAndQuery || '')
  if (!rel) {
    return base
  }
  if (/^https?:\/\//i.test(rel)) {
    return rel
  }
  return base + (rel.charAt(0) === '/' ? rel : '/' + rel)
}

/**
 * 验收入口：
 * - baseUrl = origin（协议+主机+端口）
 * - seedUrl = 种子入口 path+全部 query，禁止删减
 * housedelCode 从 seedUrl 解析，不另写默认房源号覆盖种子参数。
 */
function envAcceptUrls(repoRoot, overrides) {
  const opts = overrides || {}
  const env = readDotEnv(repoRoot)
  const rawBase = String(
    opts.baseUrl || env.baseUrl || env.BASE_URL || process.env.TRACK_ACCEPT_BASE_URL || opts.fallback || ''
  ).trim()
  const rawSeed = String(
    opts.seedUrl || env.seedUrl || env.SEED_URL || process.env.TRACK_ACCEPT_SEED_URL || ''
  ).trim()

  let origin = ''
  let seedUrl = ''

  if (rawSeed) {
    if (/^https?:\/\//i.test(rawSeed)) {
      try {
        origin = new URL(rawSeed).origin
      } catch (error) {
        origin = ''
      }
      seedUrl = toPathAndSearch(rawSeed)
    } else {
      seedUrl = rawSeed.charAt(0) === '/' ? rawSeed : '/' + rawSeed
    }
  }

  if (rawBase) {
    if (/^https?:\/\//i.test(rawBase)) {
      try {
        const parsed = new URL(rawBase)
        if (!origin) {
          origin = parsed.origin
        }
        if (!seedUrl && (parsed.pathname !== '/' || parsed.search || parsed.hash)) {
          seedUrl = parsed.pathname + parsed.search + parsed.hash
        }
      } catch (error) {
        if (!origin) {
          origin = rawBase.replace(/\/$/, '')
        }
      }
    } else if (!origin) {
      origin = rawBase.replace(/\/$/, '')
    }
  }

  if (opts.housedelCode && seedUrl) {
    seedUrl = replaceQueryParam(seedUrl, 'housedelCode', opts.housedelCode)
  }

  const query = parseQuery(seedUrl)
  return {
    origin,
    seedUrl,
    absoluteUrl: joinOrigin(origin, seedUrl),
    housedelCode: query.housedelCode || '',
    query
  }
}

function envBaseUrl(repoRoot, fallback) {
  return envAcceptUrls(repoRoot, { fallback }).origin
}

module.exports = {
  docSlug,
  ensureDocsDir,
  ensureExcelInDocs,
  envAcceptUrls,
  envBaseUrl,
  findRepoRoot,
  isInsideDir,
  joinOrigin,
  parseArgs,
  resolveExcel,
  parseQuery,
  readJson,
  relFrom,
  readDotEnv,
  replaceQueryParam,
  safeEvtFileName,
  safeParamFileName,
  toPathAndSearch,
  toPosix,
  writeJson
}
