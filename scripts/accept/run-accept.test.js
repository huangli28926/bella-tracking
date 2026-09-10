const assert = require('assert')
const test = require('node:test')
const { waitForReportHttp } = require('./run-accept')

const EVT = '96795'
const GIF = `https://dig.lianjia.com/alliance.gif?evt=${EVT}&uicode=x`

function requestRecord(t) {
  return { t: t, url: GIF, method: 'GET', status: 0, statusText: 'requested', error: '', source: 'request' }
}

function hookRecord(t) {
  return { t: t, url: GIF, method: 'GET', status: 0, statusText: 'hook', error: '', source: 'hook' }
}

function responseRecord(t) {
  return { t: t, url: GIF, method: 'GET', status: 200, statusText: 'OK', error: '', source: 'response' }
}

test('waitForReportHttp 只有 request 时不提前收工，等满超时后才回退为「未见响应」', async () => {
  const since = Date.now()
  const records = [requestRecord(since + 1)]
  const started = Date.now()
  const http = await waitForReportHttp(records, since, EVT, 300)
  const elapsed = Date.now() - started
  assert.ok(elapsed >= 280, `应等满超时，实际 ${elapsed}ms`)
  assert.equal(http.matched, true)
  assert.equal(http.ok, false)
  assert.equal(http.source, 'request')
  assert.match(http.reasonZh, /未等到 HTTP 响应/)
})

test('waitForReportHttp 拿到 200 立即返回，不等满超时', async () => {
  const since = Date.now()
  const records = [hookRecord(since + 1), requestRecord(since + 2), responseRecord(since + 5)]
  const started = Date.now()
  const http = await waitForReportHttp(records, since, EVT, 300)
  const elapsed = Date.now() - started
  assert.ok(elapsed < 250, `应在拿到 200 后立刻返回，实际 ${elapsed}ms`)
  assert.equal(http.ok, true)
  assert.equal(http.status, 200)
  assert.equal(http.reasonZh, '')
})

test('waitForReportHttp 等响应晚于 request 到来时仍能拿到 200', async () => {
  const since = Date.now()
  const records = [requestRecord(since + 1)]
  setTimeout(function () {
    records.push(responseRecord(Date.now()))
  }, 120)
  const http = await waitForReportHttp(records, since, EVT, 1500)
  assert.equal(http.ok, true)
  assert.equal(http.status, 200)
})

test('waitForReportHttp 把 requestfailed 视为最终结果，立即返回', async () => {
  const since = Date.now()
  const records = [
    requestRecord(since + 1),
    {
      t: since + 2,
      url: GIF,
      method: 'GET',
      status: 0,
      statusText: '',
      error: 'net::ERR_ABORTED',
      source: 'requestfailed'
    }
  ]
  const started = Date.now()
  const http = await waitForReportHttp(records, since, EVT, 300)
  const elapsed = Date.now() - started
  assert.ok(elapsed < 250, `应在拿到最终结果后立刻返回，实际 ${elapsed}ms`)
  assert.equal(http.ok, false)
  assert.equal(http.source, 'requestfailed')
  assert.match(http.reasonZh, /被页面跳转或卸载中断/)
})

test('waitForReportHttp 完全没有记录时返回未匹配', async () => {
  const since = Date.now()
  const http = await waitForReportHttp([], since, EVT, 120)
  assert.equal(http.matched, false)
  assert.equal(http.ok, false)
})
