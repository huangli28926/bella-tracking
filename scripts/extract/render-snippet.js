const { toPosix } = require('../lib/lib')

function styleById(adaptor, id) {
  const styles = (adaptor && adaptor.styles) || []
  for (let i = 0; i < styles.length; i += 1) {
    if (styles[i].id === id) {
      return styles[i]
    }
  }
  return null
}

function dirOf(filePath) {
  const text = toPosix(filePath || '')
  const idx = text.lastIndexOf('/')
  return idx === -1 ? '' : text.slice(0, idx)
}

/**
 * 跟随落点文件：targetFile 已有写法 > 同目录最常见 > 全仓 default > sdk-send。
 * 禁止在没有封装的仓里发明 wrapper。
 */
function pickStyle(adaptor, opts) {
  const options = opts || {}
  if (options.styleId) {
    const locked = styleById(adaptor, options.styleId)
    if (locked) {
      return locked
    }
  }
  const target = toPosix(options.targetFile || '')
  const fileStyle = (adaptor && adaptor.fileStyle) || {}
  if (target && fileStyle[target]) {
    const hit = styleById(adaptor, fileStyle[target])
    if (hit) {
      return hit
    }
  }
  if (target) {
    const dir = dirOf(target)
    const counts = {}
    Object.keys(fileStyle).forEach(file => {
      if (dir && file.indexOf(dir + '/') === 0) {
        const id = fileStyle[file]
        counts[id] = (counts[id] || 0) + 1
      }
    })
    let best = ''
    let n = 0
    Object.keys(counts).forEach(id => {
      if (counts[id] > n) {
        n = counts[id]
        best = id
      }
    })
    if (best) {
      const hit = styleById(adaptor, best)
      if (hit) {
        return hit
      }
    }
  }
  const fallbackId = (adaptor && adaptor.defaultStyleId) || 'sdk-send'
  return styleById(adaptor, fallbackId) || styleById(adaptor, 'sdk-send') || ((adaptor && adaptor.styles) || [])[0] || null
}

function fillSnippet(template, vars) {
  const data = vars || {}
  // uicode 必须由调用方从 events.json 传入，禁止自行改写
  const action = data.action == null || data.action === '' ? '{}' : String(data.action)
  return String(template || '')
    .replace(/\{\{eventType\}\}/g, data.eventType || 'Module_Click')
    .replace(/\{\{evtId\}\}/g, data.evtId || '')
    .replace(/\{\{pid\}\}/g, data.pid || '')
    .replace(/\{\{uicode\}\}/g, data.uicode || '')
    .replace(/\{\{action\}\}/g, action)
    .replace(/\{\{domClass\}\}/g, data.domClass || 'CLICKDATA')
}

function renderSnippet(adaptor, vars) {
  const style = pickStyle(adaptor, vars)
  if (!style || !style.snippet) {
    return fillSnippet(
      "window.$ULOG.send('{{evtId}}', {\n  event: '{{eventType}}',\n  pid: '{{pid}}',\n  uicode: '{{uicode}}',\n  action: {{action}}\n})",
      vars
    )
  }
  return fillSnippet(style.snippet, vars)
}

function renderSdkWire(vars) {
  return fillSnippet(
    "window.$ULOG.send('{{evtId}}', {\n  event: '{{eventType}}',\n  pid: '{{pid}}',\n  uicode: '{{uicode}}',\n  action: {{action}}\n})",
    vars
  )
}

module.exports = {
  fillSnippet,
  pickStyle,
  renderSdkWire,
  renderSnippet,
  styleById
}
