require('dotenv').config()

module.exports = {
  PORT: Number(process.env.PORT || 3000),
  REQUIRE_AUTH: (process.env.REQUIRE_AUTH === 'true'),
  JWT_SECRET: process.env.JWT_SECRET || 'supersecretkey',
  TORRENT_TMP_DIR: process.env.TORRENT_TMP_DIR || './tmp',
  TTR_CLEANUP_MINUTES: Number(process.env.TTR_CLEANUP_MINUTES || 5)
}
