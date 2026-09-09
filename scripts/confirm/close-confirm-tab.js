#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require('child_process')
const { parseArgs } = require('../lib/lib')

function needleFor(evtId, openUrl) {
  const id = String(evtId || '').trim()
  if (id) {
    return `evt=${id}&mode=confirm`
  }
  return String(openUrl || '').trim()
}

function appleScriptClose(needle) {
  const escaped = String(needle).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return [
    'tell application "Google Chrome"',
    '  set closedCount to 0',
    '  repeat with w in windows',
    '    set tabList to tabs of w',
    '    set tabCount to count of tabList',
    '    repeat with i from tabCount to 1 by -1',
    '      try',
    `        if URL of tab i of w contains "${escaped}" then`,
    '          close tab i of w',
    '          set closedCount to closedCount + 1',
    '        end if',
    '      end try',
    '    end repeat',
    '  end repeat',
    '  return closedCount',
    'end tell'
  ].join('\n')
}

function closeConfirmTab(opts) {
  const evtId = opts && opts.evtId
  const openUrl = opts && opts.openUrl
  const needle = needleFor(evtId, openUrl)
  if (!needle) {
    return { ok: false, closed: 0, reason: 'missing url' }
  }
  if (process.platform === 'darwin') {
    const result = spawnSync('osascript', ['-e', appleScriptClose(needle)], {
      encoding: 'utf8'
    })
    if (result.status !== 0) {
      return {
        ok: false,
        closed: 0,
        reason: String(result.stderr || result.error || 'osascript failed').trim()
      }
    }
    const closed = Number(String(result.stdout || '').trim()) || 0
    return { ok: true, closed, reason: closed ? '' : 'no matching Chrome tab' }
  }
  return { ok: false, closed: 0, reason: `unsupported platform ${process.platform}` }
}

function main() {
  const args = parseArgs(process.argv)
  const result = closeConfirmTab({
    evtId: args.evt || args.evtId,
    openUrl: args.url || args.openUrl
  })
  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`close-confirm-tab closed=${result.closed} ok=${result.ok} ${result.reason || ''}`.trim())
  }
  if (!result.ok && result.closed === 0 && args.strict) {
    process.exit(1)
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

module.exports = { closeConfirmTab, needleFor }
