const { spawnSync } = require('child_process')
const { readDotEnv, toPosix } = require('./lib')

function git(repoRoot, args) {
  return spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  })
}

function gitText(repoRoot, args) {
  const result = git(repoRoot, args)
  if (result.status !== 0) {
    const err = String(result.stderr || result.stdout || '').trim()
    const error = new Error(err || ('git ' + args.join(' ') + ' failed'))
    error.gitStatus = result.status
    throw error
  }
  return String(result.stdout || '')
}

function refExists(repoRoot, ref) {
  const result = git(repoRoot, ['rev-parse', '--verify', ref])
  return result.status === 0
}

function resolveTrackingMode(repoRoot) {
  const env = readDotEnv(repoRoot)
  const raw = String(env.trackingMode || env.TRACKING_MODE || '').trim().toLowerCase()
  if (raw === 'backfill') {
    return 'backfill'
  }
  return ''
}

function resolveTrackingBaseline(repoRoot) {
  const env = readDotEnv(repoRoot)
  const raw = String(env.trackingBaseline || env.TRACKING_BASELINE || '').trim()
  const baseline = raw || 'master'
  if (!refExists(repoRoot, baseline)) {
    const error = new Error(
      'trackingBaseline 不存在: ' + baseline +
      '。请在仓库根 .env 写正确的分支/ref，禁止默默改用其它分支。'
    )
    error.code = 'BASELINE_MISSING'
    error.baseline = baseline
    throw error
  }
  return baseline
}

function listPeriodFiles(repoRoot, baseline) {
  const text = gitText(repoRoot, ['diff', baseline + '...HEAD', '--name-only'])
  const files = {}
  text.split(/\r?\n/).forEach(line => {
    const rel = toPosix(line).trim()
    if (rel) {
      files[rel] = true
    }
  })
  return files
}

function listAddedFiles(repoRoot, baseline) {
  const text = gitText(repoRoot, ['diff', baseline + '...HEAD', '--diff-filter=A', '--name-only'])
  const files = {}
  text.split(/\r?\n/).forEach(line => {
    const rel = toPosix(line).trim()
    if (rel) {
      files[rel] = true
    }
  })
  return files
}

function parseAddedLineRanges(diffText) {
  const ranges = []
  const plusLines = []
  String(diffText || '').split(/\n/).forEach(line => {
    const hunk = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/)
    if (hunk) {
      const start = Number(hunk[1])
      const count = hunk[2] === undefined ? 1 : Number(hunk[2])
      ranges.push({ start, end: start + Math.max(count, 0) - 1 })
      return
    }
    if (line.indexOf('+++') === 0 || line.indexOf('---') === 0) {
      return
    }
    if (line.charAt(0) === '+') {
      plusLines.push(line.slice(1))
    }
  })
  return { ranges, plusLines }
}

function fileDiffAgainstBaseline(repoRoot, baseline, relFile) {
  const result = git(repoRoot, ['diff', baseline + '...HEAD', '-U0', '--', relFile])
  if (result.status !== 0) {
    return ''
  }
  return String(result.stdout || '')
}

function loadPeriodDiff(repoRoot) {
  const baseline = resolveTrackingBaseline(repoRoot)
  const trackingMode = resolveTrackingMode(repoRoot)
  const files = listPeriodFiles(repoRoot, baseline)
  const addedFiles = listAddedFiles(repoRoot, baseline)
  const diffCache = {}
  return {
    baseline,
    trackingMode,
    files,
    addedFiles,
    isPeriodFile(relFile) {
      return !!files[toPosix(relFile)]
    },
    isAddedFile(relFile) {
      return !!addedFiles[toPosix(relFile)]
    },
    addedInfo(relFile) {
      const key = toPosix(relFile)
      if (!diffCache[key]) {
        diffCache[key] = parseAddedLineRanges(fileDiffAgainstBaseline(repoRoot, baseline, key))
      }
      return diffCache[key]
    }
  }
}

function lineInAddedRanges(line, ranges) {
  const n = Number(line)
  return (ranges || []).some(range => n >= range.start && n <= range.end)
}

function jumpAddedThisPeriod(period, relFile, line, targetPath) {
  const file = toPosix(relFile)
  if (!period.isPeriodFile(file)) {
    return false
  }
  if (period.isAddedFile(file)) {
    return true
  }
  const info = period.addedInfo(file)
  if (lineInAddedRanges(line, info.ranges)) {
    return true
  }
  const needle = String(targetPath || '').replace(/\?.*$/, '')
  if (!needle) {
    return false
  }
  return info.plusLines.some(text => text.indexOf(needle) !== -1)
}

module.exports = {
  git,
  gitText,
  jumpAddedThisPeriod,
  listAddedFiles,
  listPeriodFiles,
  loadPeriodDiff,
  parseAddedLineRanges,
  refExists,
  resolveTrackingBaseline,
  resolveTrackingMode
}
