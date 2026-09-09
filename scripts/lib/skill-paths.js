const path = require('path')

const LIB_DIR = __dirname
const SCRIPTS_ROOT = path.resolve(LIB_DIR, '..')
const SKILL_ROOT = path.resolve(SCRIPTS_ROOT, '..')

function skillPath() {
  return path.join.apply(path, [SKILL_ROOT].concat([].slice.call(arguments)))
}

function scriptPath() {
  return path.join.apply(path, [SCRIPTS_ROOT].concat([].slice.call(arguments)))
}

function templatePath(name) {
  return skillPath('templates', name)
}

function shellQuote(filePath) {
  return JSON.stringify(String(filePath))
}

/** Agent-facing shell: node "<skill>/scripts/..." [args]. cwd stays the project root. */
function nodeCommand(scriptRel, argsString) {
  const parts = Array.isArray(scriptRel) ? scriptRel : String(scriptRel).split('/')
  const abs = scriptPath.apply(null, parts)
  const tail = argsString ? ' ' + String(argsString) : ''
  return 'node ' + shellQuote(abs) + tail
}

function nodeAndCommand(steps) {
  return (steps || []).map(step => nodeCommand(step.script, step.args)).join(' && ')
}

module.exports = {
  LIB_DIR,
  SCRIPTS_ROOT,
  SKILL_ROOT,
  nodeAndCommand,
  nodeCommand,
  scriptPath,
  skillPath,
  templatePath
}
