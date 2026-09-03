#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs')
const net = require('net')
const path = require('path')
const { spawnSync } = require('child_process')
const { defaultAcceptPaths } = require('../accept/accept-chain')
const { envAcceptUrls, findRepoRoot, parseArgs, readJson } = require('../lib/lib')
const { inspectLanding } = require('../lib/landing-ready')
const { validateFiles } = require('../accept/validate-impl')
const { SKILL_ROOT } = require('../lib/skill-paths')

const SCRIPT_DIR = __dirname

function printHelp() {
  console.log(`
doctor — 检查 bella-tracking 运行环境和当前文档产物

Usage:
  node doctor.js --excel=docs/2.3埋点需求文档.xlsx

Options:
  --excel     推断 docs/tracking/impl/{文档名}/
  --port      检查矫正服务端口，默认 3920
  --json      输出机器可读 JSON
`)
}

function checkPort(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', err => {
      const code = err.code || String(err.message || err)
      if (code === 'EPERM' || code === 'EACCES') {
        resolve({ ok: true, message: `not checkable in this environment (${code})` })
        return
      }
      resolve({ ok: false, message: code })
    })
    server.once('listening', () => {
      server.close(() => resolve({ ok: true, message: 'available' }))
    })
    server.listen(port, '127.0.0.1')
  })
}

function hasModule(name) {
  const candidates = [
    path.join(SKILL_ROOT, 'node_modules', name),
    path.join(findRepoRoot(SCRIPT_DIR), 'node_modules', name),
    name
  ]
  for (let i = 0; i < candidates.length; i += 1) {
    try {
      require.resolve(candidates[i])
      return true
    } catch (error) {
      // continue
    }
  }
  return false
}

function item(name, ok, message, extra) {
  return Object.assign({ name, ok: !!ok, message: message || '' }, extra || {})
}

async function buildChecks(args) {
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const paths = defaultAcceptPaths(repoRoot, args)
  const checks = []
  checks.push(item('repoRoot', fs.existsSync(repoRoot), repoRoot))

  const py = spawnSync('python3', ['--version'], { encoding: 'utf8' })
  checks.push(item('python3', py.status === 0, (py.stdout || py.stderr || '').trim() || 'not found'))
  checks.push(item('playwright', hasModule('playwright'), hasModule('playwright') ? 'installed' : 'missing'))

  if (args.excel) {
    const excelPath = path.isAbsolute(args.excel) ? args.excel : path.resolve(repoRoot, args.excel)
    checks.push(item('excel', fs.existsSync(excelPath), excelPath))
  }

  const files = [
    ['events.json', paths.eventsPath],
    ['impl.json', paths.implPath],
    ['adaptor.json', paths.adaptorPath],
    ['accept-chain.json', paths.chainPath],
    ['accept report', paths.acceptJson]
  ]
  files.forEach(pair => {
    checks.push(item(pair[0], !!pair[1] && fs.existsSync(pair[1]), pair[1] || '(missing path)'))
  })

  if (paths.eventsPath && fs.existsSync(paths.eventsPath)) {
    const landing = inspectLanding(paths)
    const miss = landing.missingDiagrams || []
    checks.push(item(
      'diagram pngs',
      miss.length === 0,
      miss.length ? `missing ${miss.length}: ${miss.slice(0, 8).join(',')}` : 'all events have images'
    ))
  }

  const urls = envAcceptUrls(repoRoot, {
    baseUrl: args['base-url'] || '',
    seedUrl: args['seed-url'] || '',
    housedelCode: args.housedel || ''
  })
  checks.push(item('baseUrl', !!urls.origin, urls.origin || 'missing .env baseUrl'))
  checks.push(item('seedUrl', !!urls.seedUrl, urls.seedUrl || 'missing .env seedUrl'))

  const port = Number(args.port || 3920) || 3920
  const portCheck = await checkPort(port)
  checks.push(item(`port ${port}`, portCheck.ok, portCheck.message))

  if (paths.implPath && fs.existsSync(paths.implPath) && paths.eventsPath && fs.existsSync(paths.eventsPath)) {
    try {
      const result = validateFiles(paths, args, repoRoot)
      const errors = result.issues.filter(issue => issue.severity === 'error').length
      const warnings = result.issues.filter(issue => issue.severity === 'warn').length
      checks.push(item('impl validation', errors === 0, `errors=${errors} warnings=${warnings}`, {
        errors,
        warnings
      }))
    } catch (error) {
      checks.push(item('impl validation', false, String(error.message || error)))
    }
  }

  const adaptor = readJson(paths.adaptorPath, null)
  if (adaptor) {
    checks.push(item('adaptor sdk', !!adaptor.sdkId, adaptor.sdkId || 'missing sdkId'))
    checks.push(item('adaptor styles', !!((adaptor.styles || []).length), `${(adaptor.styles || []).length} styles`))
  }
  return checks
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const checks = await buildChecks(args)
  const failed = checks.filter(check => !check.ok)
  if (args.json) {
    console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2))
  } else {
    console.log('== doctor ==')
    checks.forEach(check => {
      console.log(`${check.ok ? 'OK  ' : 'FAIL'} ${check.name}: ${check.message}`)
    })
  }
  if (failed.length) process.exitCode = 1
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message || error)
    process.exit(1)
  })
}

module.exports = { buildChecks }
