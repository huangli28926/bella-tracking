const ENTRY_MENU = `请选择本次入口（回复字母或序号）：
1. 验收全流程 A→B→C→D【强烈推荐】（E 仅在 D 失败且你同意后才跑）
2. 落库到写码 A→B→C
3. A 落库（只分析，不写业务源码）
4. D 关键验收
5. E 空值自修复（仅 D 失败后，或你点名 E）
6. F 历史埋点关系
7. 文档 vs 代码：缺失埋点列表
8. 补全历史缺失埋点（依赖入口 7 的缺失表；只写 missing，不改 found）`

const ASK_EXCEL = '请输入本次埋点需求Excel'
const ASK_EXCEL_INVALID = '当前埋点文档路径无效，请核实后，重新输入'
const ASK_HISTORY_EXCEL = '需要梳理哪个历史埋点文档的数据，请给出该历史埋点 excel'

const DEVICE_PROMPT = `请选择 Playwright 打开方式（回复 1 或 2）：
1. 移动端（iPhone 13）
2. PC 端（桌面视口）
未选择前不启动浏览器、不跑验收。`

const FULL_PAGE_PROMPT = '请打开整份落库页，回复「进入 C」。'

const CONFIRM_PROMPT_TAIL = '禁止附猜测或散文；只确认向导闭集项后保存。'

const D_FAIL_CHOICE = `请选择下一步（回复 1 或 2）：
1. 自修复（进入 E；修复失败后会自动打开人工矫正页面）
2. 直接重新进入人工矫正页面
未选择前不改代码、不进 E、不打开 B。`

const F_SCAN_CONFIRM = `node scripts/history/scan-history-tracking.js`

const ENTRY_FROM_RUN = {
  A: 3,
  B: 2,
  C: 2,
  D: 4,
  E: 5,
  F: 6,
  H: 8,
  7: 7
}

function parseEntry(raw) {
  const text = String(raw == null ? '' : raw).trim()
  if (!text) return null
  const key = text.toLowerCase()
  const map = {
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 5,
    6: 6,
    7: 7,
    8: 8,
    a: 3,
    b: 2,
    c: 2,
    d: 4,
    e: 5,
    f: 6,
    h: 8
  }
  const entry = map[key]
  return entry ? { entry, run: runForEntry(entry) } : null
}

function runForEntry(entry) {
  if (entry === 3) return 'A'
  if (entry === 4) return 'D'
  if (entry === 8) return 'H'
  return null
}

function entryFromRun(run) {
  const id = String(run || '').toUpperCase()
  return ENTRY_FROM_RUN[id] || null
}

function hasEntryIntent(args, state) {
  if (parseEntry(args && args.entry)) return true
  if (args && args.run) return true
  if (state && state.entry) return true
  return false
}

function formatConfirmEvent(evtId, reasons) {
  const reasonText = (reasons || []).length
    ? reasons.map(item => `· ${item}`).join('\n')
    : '· 请确认埋点位置'
  return `请在已打开的矫正向导中确认 evtId=${evtId} 后保存。\n${reasonText}\n${CONFIRM_PROMPT_TAIL}`
}

function formatDeleteOldTracking(evtIds) {
  const list = Array.isArray(evtIds) ? evtIds.join('、') : String(evtIds || '')
  return `检测到旧埋点将被删除，请确认是否继续：
1. 保留旧埋点（撤回删除，只写本期新增/原地改参）
2. 确认删除以下旧埋点：${list}
未回复前不继续写码、不进 D。`
}

const DELETE_OLD_TRACKING = formatDeleteOldTracking('{evtId 列表}')

module.exports = {
  ASK_EXCEL,
  ASK_EXCEL_INVALID,
  ASK_HISTORY_EXCEL,
  CONFIRM_PROMPT_TAIL,
  DELETE_OLD_TRACKING,
  DEVICE_PROMPT,
  D_FAIL_CHOICE,
  ENTRY_MENU,
  F_SCAN_CONFIRM,
  FULL_PAGE_PROMPT,
  entryFromRun,
  formatConfirmEvent,
  formatDeleteOldTracking,
  hasEntryIntent,
  parseEntry,
  runForEntry
}
