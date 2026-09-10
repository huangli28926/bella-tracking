const path = require('path')

function isAcceptCli(mod) {
  const main = require.main
  if (!main || !main.filename) return false
  if (main === mod) return true
  return path.basename(main.filename) === path.basename(mod.filename)
}

module.exports = { isAcceptCli }
