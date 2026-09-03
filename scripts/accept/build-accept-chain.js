#!/usr/bin/env node
/* eslint-disable no-console */
const { findRepoRoot, parseArgs, readJson, writeJson, envAcceptUrls, readDotEnv } = require('../lib/lib')
const { mergeImplEvent } = require('../extract/report')
const { lockChainExpect, lockImplPayload } = require('../lib/lock-doc-uicode')
const {
  buildAcceptChain,
  defaultAcceptPaths,
  toAcceptPatch
} = require('./accept-chain')
const { assertValidImpl } = require('./validate-impl')
const { resolveAcceptDevice } = require('./accept-device')

const SCRIPT_DIR = __dirname

function printHelp() {
  console.log(`
build-accept-chain — 从 impl.json 的 accept 字段聚合关键路径（项目无关）

Usage:
  node build-accept-chain.js --excel=docs/2.3埋点需求文档.xlsx
  node build-accept-chain.js --excel=... --evt=95941,95942
  node build-accept-chain.js --excel=... --write-impl

说明:
  pageKey / trigger / sharedSteps / navigatesAway 由模型根据代码写入 impl.json.accept。
  本脚本只聚类与校验，不按业务硬编码猜 locator 或入口步骤。

Options:
  --excel       用于推断 docs/tracking/impl/{文档名}/
  --evt         只保留这些 evtId（逗号分隔）
  --write-impl  把链上已解析的 accept 规范化写回 impl（不覆盖已有 accept.trigger.kind / hint）
  --seed-url    覆盖 .env 的 seedUrl（完整 path+query）
  --device      mobile | pc（写入 chain.defaults；可省略）
  --housedel    只替换种子 URL 里的 housedelCode，其它参数保留
`)
}

function patchImplAccept(implPayload, chain) {
  const byId = {}
  ;(chain.paths || []).forEach(pathItem => {
    ;(pathItem.targets || []).forEach(target => {
      byId[target.evtId] = {
        pageKey: pathItem.pageKey,
        entryUrlTemplate: pathItem.entry.url,
        accept: toAcceptPatch(Object.assign({}, target, {
          sharedSteps: pathItem.sharedSteps
        }))
      }
    })
  })
  const events = (implPayload.events || []).map(item => {
    const evtId = String(item.evtId || '')
    const patch = byId[evtId]
    if (!patch) {
      return item
    }
    // 刷新 accept 定位/dataDeps；保留 parameters.hint
    return mergeImplEvent(item, Object.assign({ evtId }, patch))
  })
  return Object.assign({}, implPayload, { events })
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || args.h) {
    printHelp()
    return
  }
  const repoRoot = findRepoRoot(SCRIPT_DIR)
  const paths = defaultAcceptPaths(repoRoot, args)
  if (!paths.implPath) {
    printHelp()
    throw new Error('未提供 --excel / --impl')
  }
  assertValidImpl(paths, args, repoRoot)
  const implPayload = readJson(paths.implPath, null)
  if (!implPayload) {
    throw new Error(`impl.json 不存在: ${paths.implPath}`)
  }
  const eventsPayload = readJson(paths.eventsPath, { events: [] })
  const urls = envAcceptUrls(repoRoot, {
    seedUrl: args['seed-url'] || '',
    housedelCode: args.housedel || ''
  })
  const deviceId = resolveAcceptDevice(args, readDotEnv(repoRoot))
  const chain = lockChainExpect(buildAcceptChain(implPayload, eventsPayload, {
    evtIds: args.evt || '',
    seedUrl: urls.seedUrl,
    housedelCode: urls.housedelCode,
    deviceId
  }), eventsPayload)
  writeJson(paths.chainPath, chain)

  if (args['write-impl']) {
    const next = lockImplPayload(patchImplAccept(implPayload, chain), eventsPayload)
    next.generatedAt = new Date().toISOString()
    writeJson(paths.implPath, next)
  }

  const targetCount = chain.paths.reduce((sum, item) => sum + item.targets.length, 0)
  console.log('== build-accept-chain ==')
  console.log(`Impl: ${paths.implPath}`)
  console.log(`Chain: ${paths.chainPath}`)
  console.log(`seed: ${urls.origin}${urls.seedUrl || '(missing seedUrl)'}`)
  console.log(`paths ${chain.paths.length} / targets ${targetCount} / pending ${chain.pending.length}`)
  chain.paths.forEach(item => {
    const ids = item.targets.map(target => target.evtId).join(',')
    console.log(`  ${item.pathId}  [${ids}]`)
  })
  if (chain.pending.length) {
    chain.pending.forEach(item => {
      console.log(`  pending ${item.evtId}: ${item.reason}`)
    })
  }
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message || error)
    process.exit(1)
  }
}

module.exports = { main, patchImplAccept }
