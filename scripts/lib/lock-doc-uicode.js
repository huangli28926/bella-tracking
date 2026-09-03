/**
 * uicode 只从埋点文档（Excel → events.json）读取。
 * 禁止写入 impl.json，禁止落库页编辑，禁止 AI 改写成别的值。
 * 脚本在保存 / 渲染 / 建链 / 验收前强制改回文档值。
 */

function docByEvtId(eventsPayload) {
  const map = {}
  ;((eventsPayload && eventsPayload.events) || []).forEach(event => {
    if (event && event.evtId) {
      map[String(event.evtId)] = event
    }
  })
  return map
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function quoted(q, value) {
  return q + String(value == null ? '' : value) + q
}

function rewriteCodeUicode(code, docEvent) {
  const src = String(code || '')
  const uicode = String((docEvent && docEvent.uicode) || '')
  if (!src || !uicode) {
    return src
  }

  let out = src.replace(/\{\{uicode\}\}/g, uicode)
  out = out.replace(/\buicode\s*:\s*(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, (_, q) => {
    return 'uicode: ' + quoted(q, uicode)
  })

  const evtId = String((docEvent && docEvent.evtId) || '')
  if (!evtId) {
    return out
  }
  const re = new RegExp(
    "(['\"`])" + escapeRegExp(evtId) + "\\1(\\s*,\\s*)(['\"`])([^'\"`]*)\\3(\\s*,\\s*)(['\"`])(?:\\\\.|(?!\\6).)*\\6",
    'g'
  )
  out = out.replace(re, (_, q1, sep1, q2, pidVal, sep2, q3) => {
    return quoted(q1, evtId) + sep1 + quoted(q2, pidVal) + sep2 + quoted(q3, uicode)
  })
  return out
}

function stripImplUicode(implEvent) {
  const next = Object.assign({}, implEvent && typeof implEvent === 'object' ? implEvent : {})
  delete next.uicode
  if (next.accept && typeof next.accept === 'object') {
    next.accept = Object.assign({}, next.accept)
    if (next.accept.expect && typeof next.accept.expect === 'object') {
      next.accept.expect = Object.assign({}, next.accept.expect)
      delete next.accept.expect.uicode
    }
  }
  return next
}

function lockImplEvent(implEvent, docEvent) {
  const next = stripImplUicode(implEvent)
  if (next.code) {
    next.code = rewriteCodeUicode(next.code, docEvent)
  }
  return next
}

function lockImplPayload(implPayload, eventsPayload) {
  const byId = docByEvtId(eventsPayload)
  const src = implPayload && typeof implPayload === 'object' ? implPayload : { events: [] }
  const events = (src.events || []).map(item => {
    return lockImplEvent(item, byId[String(item && item.evtId)])
  })
  return Object.assign({}, src, { events })
}

function implUicodeDrift(before, after) {
  const prev = (before && before.events) || []
  const next = (after && after.events) || []
  if (prev.length !== next.length) {
    return true
  }
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i] && Object.prototype.hasOwnProperty.call(prev[i], 'uicode')) {
      return true
    }
    if ((prev[i] && prev[i].code) !== (next[i] && next[i].code)) {
      return true
    }
    const expect = prev[i] && prev[i].accept && prev[i].accept.expect
    if (expect && Object.prototype.hasOwnProperty.call(expect, 'uicode')) {
      return true
    }
  }
  return false
}

function lockChainExpect(chain, eventsPayload) {
  const byId = docByEvtId(eventsPayload)
  const next = JSON.parse(JSON.stringify(chain || {}))
  ;(next.paths || []).forEach(pathItem => {
    ;(pathItem.targets || []).forEach(target => {
      const doc = byId[String(target.evtId)]
      if (!doc) {
        return
      }
      target.expect = target.expect || {}
      target.expect.uicode = doc.uicode || ''
    })
  })
  return next
}

function persistLockedImpl(writeJson, implPath, payload, eventsPayload) {
  const locked = lockImplPayload(payload, eventsPayload)
  writeJson(implPath, locked)
  return locked
}

module.exports = {
  docByEvtId,
  implUicodeDrift,
  lockChainExpect,
  lockImplEvent,
  lockImplPayload,
  persistLockedImpl,
  rewriteCodeUicode,
  stripImplUicode
}

if (require.main === module) {
  const cases = [
    {
      code: "sendLog('Module_Click', '95936', 'a_app', 'wrong/path', { a: 1 })",
      doc: { evtId: '95936', pid: 'a_app', uicode: 'aiprice2/home' },
      want: "sendLog('Module_Click', '95936', 'a_app', 'aiprice2/home', { a: 1 })"
    },
    {
      code: "window.$ULOG.send('95936', {\n  uicode: 'old/ui'\n})",
      doc: { evtId: '95936', uicode: 'aiprice2/home' },
      want: "window.$ULOG.send('95936', {\n  uicode: 'aiprice2/home'\n})"
    }
  ]
  let failed = 0
  cases.forEach((item, idx) => {
    const got = rewriteCodeUicode(item.code, item.doc)
    if (got !== item.want) {
      failed += 1
      console.error('case', idx, '\n want', item.want, '\n  got', got)
    }
  })
  const locked = lockImplEvent({ evtId: '1', uicode: 'hacked', code: "uicode: 'x'" }, { evtId: '1', uicode: 'doc/ui' })
  if (locked.uicode !== undefined || locked.code !== "uicode: 'doc/ui'") {
    failed += 1
    console.error('strip/lock failed', locked)
  }
  if (failed) {
    process.exit(1)
  }
  console.log('lock-doc-uicode ok')
}
