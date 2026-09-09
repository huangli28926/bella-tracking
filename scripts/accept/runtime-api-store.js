function createApiRuntimeStore() {
  return {
    responses: []
  }
}

function resetApiRuntimeStore(store) {
  if (!store || !Array.isArray(store.responses)) {
    return store
  }
  store.responses.length = 0
  return store
}

function shouldSkipApiBody(url, contentType, skipUrl) {
  if (typeof skipUrl === 'function' && skipUrl(url)) {
    return true
  }
  const ct = String(contentType || '').toLowerCase()
  if (ct.indexOf('image/') === 0) return true
  if (ct.indexOf('text/html') !== -1) return true
  if (ct.indexOf('text/css') !== -1) return true
  const lower = String(url || '').toLowerCase()
  if (/\.(png|jpe?g|gif|webp|svg|ico|css)(\?|$)/i.test(lower)) return true
  return false
}

function attachApiRuntimeCollector(context, store, opts) {
  const options = opts || {}
  const skipUrl = options.skipUrl
  if (!context || typeof context.on !== 'function' || !store) {
    return store
  }
  context.on('response', async function (response) {
    try {
      const url = response.url()
      const headers = response.headers && response.headers() || {}
      const contentType = headers['content-type'] || headers['Content-Type'] || ''
      if (shouldSkipApiBody(url, contentType, skipUrl)) {
        return
      }
      let body = null
      let bodyParsed = false
      try {
        body = await response.json()
        bodyParsed = true
      } catch (error) {
        return
      }
      store.responses.push({
        t: Date.now(),
        url: url,
        method: response.request ? response.request().method() : '',
        status: response.status(),
        bodyParsed: bodyParsed,
        body: body
      })
    } catch (error) {
      // ignore collector errors; resolver will report missing evidence
    }
  })
  return store
}

module.exports = {
  createApiRuntimeStore,
  resetApiRuntimeStore,
  shouldSkipApiBody,
  attachApiRuntimeCollector
}
