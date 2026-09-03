#!/usr/bin/env node
/* eslint-disable no-console */
const { git, resolveTrackingBaseline } = require('../lib/period-diff')
const { findRepoRoot, parseArgs } = require('../lib/lib')

function printHelp() {
  console.log(`
check-old-tracking — 扫描 diff 里被删掉的旧埋点调用，供路径 C 停下来让用户确认

Usage:
  node check-old-tracking.js --json
  node check-old-tracking.js --vs=HEAD
  node check-old-tracking.js --vs=baseline

默认 --vs=HEAD（相对当前提交的未提交改动，适合路径 C 刚写完）。
--vs=baseline 用 .env trackingBaseline（缺省 master）含工作区。
发现净删除时 exit 2，无删除 exit 0。不改业务源码。
`)
}

const TRACKING_LINE = /\$ULOG\.send|ULOG\.send|sendLog\s*\(|CLICKDATA|Module_Click|Module_View|Module_Expo|dig-log/i
const QUOTED_ID = /['"](\d{4,8})['"]/g

function extractEvtIds(line) {
  if (!TRACKING_LINE.test(line)) {
    return []
  }
  const ids = []
  QUOTED_ID.lastIndex = 0
  let match
  while ((match = QUOTED_ID.exec(line))) {
    ids.push(match[1])
  }
  return ids
}

function parseUnifiedDiff(diffText) {
  const files = []
  let current = null
  String(diffText || '').split(/\n/).forEach(line => {
    if (line.indexOf('diff --git ') === 0) {
      current = { file: '', minusIds: {}, plusIds: {}, minusSnippets: [] }
      files.push(current)
      return
    }
    if (!current) {
      return
    }
    if (line.indexOf('+++ b/') === 0) {
      current.file = line.slice(6).trim()
      return
    }
    if (line.indexOf('--- a/') === 0 && !current.file) {
      current.file = line.slice(6).trim()
      return
    }
    if (line.indexOf('+++') === 0 || line.indexOf('---') === 0) {
      return
    }
    if (line.charAt(0) === '-' && line.indexOf('---') !== 0) {
      const ids = extractEvtIds(line.slice(1))
      ids.forEach(id => {
        current.minusIds[id] = (current.minusIds[id] || 0) + 1
      })
      if (ids.length) {
        current.minusSnippets.push({
          evtIds: ids,
          line: line.slice(1).trim().slice(0, 200)
        })
      }
      return
    }
    if (line.charAt(0) === '+' && line.indexOf('+++') !== 0) {
      const ids = extractEvtIds(line.slice(1))
      ids.forEach(id => {
        current.plusIds[id] = (current.plusIds[id] || 0) + 1
      })
    }
  })
  return files.filter(item => item.file && item.file !== '/dev/null')
}

function collectRemovals(files) {
  const plusAnywhere = {}
  files.forEach(item => {
    Object.keys(item.plusIds).forEach(id => {
      plusAnywhere[id] = (plusAnywhere[id] || 0) + item.plusIds[id]
    })
  })
  const removed = []
  files.forEach(item => {
    Object.keys(item.minusIds).forEach(id => {
      const minus = item.minusIds[id]
      const plus = item.plusIds[id] || 0
      if (minus <= plus) {
        return
      }
      const snippets = item.minusSnippets
        .filter(row => row.evtIds.indexOf(id) !== -1)
        .map(row => row.line)
      removed.push({
        evtId: id,
        file: item.file,
        removedCalls: minus - plus,
        relocated: (plusAnywhere[id] || 0) > 0,
        snippets
      })
    })
  })
  return removed
}

function diffArgs(vs, baseline) {
  if (vs === 'baseline') {
    return [baseline]
  }
  return ['HEAD']
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(__dirname)
  const vs = String(args.vs || 'HEAD').trim() || 'HEAD'
  const baseline = resolveTrackingBaseline(repoRoot)
  const spec = diffArgs(vs, baseline)
  const result = git(repoRoot, ['diff', ...spec])
  if (result.status !== 0) {
    const err = String(result.stderr || result.stdout || '').trim()
    throw new Error(err || ('git diff ' + spec.join(' ') + ' failed'))
  }
  const files = parseUnifiedDiff(result.stdout)
  const removed = collectRemovals(files)
  const payload = {
    generatedAt: new Date().toISOString(),
    vs: spec[0],
    baseline,
    removedCount: removed.length,
    removed
  }
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2))
  } else {
    console.log('== check-old-tracking ==')
    console.log('vs: ' + payload.vs)
    if (!removed.length) {
      console.log('无旧埋点净删除')
    } else {
      console.log('旧埋点净删除: ' + removed.length)
      removed.forEach(row => {
        console.log(
          '  ' + row.evtId +
          '  ' + row.file +
          '  -' + row.removedCalls +
          (row.relocated ? '  (diff 内另有新增，可能是挪位置)' : '')
        )
        row.snippets.slice(0, 2).forEach(line => {
          console.log('    - ' + line)
        })
      })
    }
  }
  if (removed.length) {
    process.exitCode = 2
  }
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message || error)
    process.exit(error.code === 'BASELINE_MISSING' ? 3 : 1)
  }
}

module.exports = {
  collectRemovals,
  extractEvtIds,
  parseUnifiedDiff,
  main
}
