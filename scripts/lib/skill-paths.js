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

module.exports = {
  LIB_DIR,
  SCRIPTS_ROOT,
  SKILL_ROOT,
  scriptPath,
  skillPath,
  templatePath
}
