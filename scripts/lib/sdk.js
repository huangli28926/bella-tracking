const fs = require('fs')
const path = require('path')
const { readJson } = require('./lib')
const { SKILL_ROOT, skillPath } = require('./skill-paths')

const SDK_DIR = skillPath('sdk')

function loadSdkProfiles() {
  if (!fs.existsSync(SDK_DIR)) {
    return []
  }
  return fs.readdirSync(SDK_DIR)
    .filter(name => name.endsWith('.json') && name !== 'schema.json')
    .map(name => readJson(path.join(SDK_DIR, name), null))
    .filter(Boolean)
}

function matchProfileByText(text, profiles) {
  const src = String(text || '')
  const list = profiles || loadSdkProfiles()
  for (let i = 0; i < list.length; i += 1) {
    const includes = list[i].scriptIncludes || []
    for (let j = 0; j < includes.length; j += 1) {
      if (includes[j] && src.indexOf(includes[j]) !== -1) {
        return list[i]
      }
    }
  }
  return null
}

function profileById(id, profiles) {
  const list = profiles || loadSdkProfiles()
  const key = String(id || '')
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === key) {
      return list[i]
    }
  }
  return null
}

function defaultProfile(profiles) {
  const list = profiles || loadSdkProfiles()
  return profileById('lianjia-ulog-1.3', list) || list[0] || null
}

const DEFAULT_REPORT_URL_INCLUDES = [
  'dig.lianjia.com/alliance.gif',
  'dig.lianjia.com/check.gif'
]

function reportUrlIncludes(profile) {
  const fromProfile = profile && profile.reportUrlIncludes
  if (Array.isArray(fromProfile) && fromProfile.length) {
    return fromProfile.filter(Boolean)
  }
  return DEFAULT_REPORT_URL_INCLUDES.slice()
}

function isReportUrl(url, profile) {
  const text = String(url || '')
  if (!text) {
    return false
  }
  const needles = reportUrlIncludes(profile)
  for (let i = 0; i < needles.length; i += 1) {
    if (needles[i] && text.indexOf(needles[i]) !== -1) {
      return true
    }
  }
  return false
}

function parseEvtIdFromReportUrl(url) {
  const text = String(url || '')
  if (!text) {
    return ''
  }
  try {
    const parsed = new URL(text)
    const keys = ['evt', 'evtid', 'event_id', 'eid']
    for (let i = 0; i < keys.length; i += 1) {
      const value = parsed.searchParams.get(keys[i])
      if (value) {
        return String(value)
      }
    }
  } catch (error) {
    // fall through to regex
  }
  const match = text.match(/[?&]evt(?:id)?=([^&]+)/i)
  if (!match || !match[1]) {
    return ''
  }
  try {
    return decodeURIComponent(match[1])
  } catch (error) {
    return match[1]
  }
}

const ACCEPT_LOG_PERSIST_KEY = '__trackAcceptLogsPersist'
const ACCEPT_GIF_PERSIST_KEY = '__trackAcceptGifPersist'

function createAcceptLogSink() {
  const logs = []
  return {
    logs,
    push: function (rec) {
      if (!rec) {
        return
      }
      logs.push(rec)
    }
  }
}

async function attachAcceptLogSink(context, sink, gifSink) {
  if (!context) {
    return
  }
  if (sink) {
    await context.exposeBinding('__trackAcceptReport', function (source, rec) {
      sink.push(rec)
    })
  }
  if (gifSink) {
    await context.exposeBinding('__trackAcceptGif', function (source, rec) {
      gifSink.push(rec)
    })
  }
}

/**
 * 验收采集永远拦 SDK 主方法（默认 $ULOG.send）。
 * 项目二次封装 / v3 便捷方法最终都会进这里。
 * 发出时同步写入页面数组 + sessionStorage，并抄一份到 Playwright binding，
 * 避免点击后立刻跳转导致只读新页 window 采不到。
 * 上报 GIF：拦 Image.src / sendBeacon，同样 persist；run-accept 在 BrowserContext 上听 request。
 */
function buildAcceptHook(profile) {
  const hook = (profile && profile.hook) || {}
  const globalName = hook.global || (profile && profile.global) || '$ULOG'
  const method = hook.method || (profile && profile.method) || 'send'
  const gifNeedles = reportUrlIncludes(profile)
  return `(function(){
  if (window.__trackAcceptHooked) return;
  window.__trackAcceptHooked = true;
  window.__trackAcceptLogs = [];
  window.__trackAcceptApis = [];
  var GLOBAL = ${JSON.stringify(globalName)};
  var METHOD = ${JSON.stringify(method)};
  var PERSIST_KEY = ${JSON.stringify(ACCEPT_LOG_PERSIST_KEY)};
  var GIF_KEY = ${JSON.stringify(ACCEPT_GIF_PERSIST_KEY)};
  var GIF_NEEDLES = ${JSON.stringify(gifNeedles)};
  function isReportGif(url) {
    var text = String(url || '');
    if (!text) return false;
    for (var i = 0; i < GIF_NEEDLES.length; i++) {
      if (GIF_NEEDLES[i] && text.indexOf(GIF_NEEDLES[i]) !== -1) return true;
    }
    return false;
  }
  function pushGif(url) {
    if (!isReportGif(url)) return;
    var rec = { url: String(url), method: 'GET', t: Date.now(), status: 0, statusText: 'hook', source: 'hook' };
    try {
      var prev = [];
      try { prev = JSON.parse(sessionStorage.getItem(GIF_KEY) || '[]'); } catch (g1) {}
      if (!Array.isArray(prev)) prev = [];
      prev.push(rec);
      if (prev.length > 400) prev = prev.slice(-400);
      sessionStorage.setItem(GIF_KEY, JSON.stringify(prev));
    } catch (g2) {}
    try {
      if (typeof window.__trackAcceptGif === 'function') window.__trackAcceptGif(rec);
    } catch (g3) {}
  }
  function wrapSrc(proto) {
    var desc = Object.getOwnPropertyDescriptor(proto, 'src');
    if (!desc || !desc.set) return;
    Object.defineProperty(proto, 'src', {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (v) {
        pushGif(v);
        return desc.set.call(this, v);
      }
    });
  }
  try { wrapSrc(HTMLImageElement.prototype); } catch (g4) {}
  try {
    if (navigator.sendBeacon) {
      var origBeacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function (url, data) {
        pushGif(url);
        return origBeacon(url, data);
      };
    }
  } catch (g5) {}
  function pushLog(evtid, payload) {
    var rec = {
      evtId: String(evtid),
      eventType: payload && payload.event,
      pid: payload && payload.pid,
      uicode: payload && payload.uicode,
      action: (payload && payload.action) || {},
      t: Date.now()
    };
    window.__trackAcceptLogs.push(rec);
    try {
      var prev = [];
      try { prev = JSON.parse(sessionStorage.getItem(PERSIST_KEY) || '[]'); } catch (e1) {}
      if (!Array.isArray(prev)) prev = [];
      prev.push(rec);
      if (prev.length > 400) prev = prev.slice(-400);
      sessionStorage.setItem(PERSIST_KEY, JSON.stringify(prev));
    } catch (e2) {}
    try {
      if (typeof window.__trackAcceptReport === 'function') {
        window.__trackAcceptReport(rec);
      }
    } catch (e3) {}
  }
  function wrap(obj) {
    if (!obj || obj.__trackAcceptWrapped) return obj;
    var orig = obj[METHOD];
    obj[METHOD] = function(evtid, payload) {
      pushLog(evtid, payload);
      if (typeof orig === 'function') return orig.apply(this, arguments);
    };
    obj.__trackAcceptWrapped = true;
    return obj;
  }
  var current = window[GLOBAL];
  wrap(current || (current = {}));
  try {
    Object.defineProperty(window, GLOBAL, {
      configurable: true,
      enumerable: true,
      get: function() { return current; },
      set: function(v) { current = wrap(v || {}); }
    });
  } catch (e) {
    window[GLOBAL] = wrap(window[GLOBAL] || {});
  }
})();`
}

module.exports = {
  SKILL_ROOT,
  SDK_DIR,
  ACCEPT_LOG_PERSIST_KEY,
  ACCEPT_GIF_PERSIST_KEY,
  DEFAULT_REPORT_URL_INCLUDES,
  attachAcceptLogSink,
  buildAcceptHook,
  createAcceptLogSink,
  defaultProfile,
  isReportUrl,
  loadSdkProfiles,
  matchProfileByText,
  parseEvtIdFromReportUrl,
  profileById,
  reportUrlIncludes
}
