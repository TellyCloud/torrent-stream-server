const express = require('express')
const WebTorrent = require('webtorrent')
const jwt = require('jsonwebtoken')
const cors = require('cors')
const mime = require('mime-types')
const { PORT, JWT_SECRET, REQUIRE_AUTH } = require('./config')

const app = express()
app.use(cors())
app.use(express.static('public'))

// Keep torrent client alive
const client = new WebTorrent()
const CLEANUP_TTL = 1000 * 60 * 5
const timers = new Map()

function touchTorrent(torrent) {
  if (timers.has(torrent.infoHash)) clearTimeout(timers.get(torrent.infoHash))
  timers.set(torrent.infoHash, setTimeout(() => {
    torrent.destroy({ destroyStore: true })
    timers.delete(torrent.infoHash)
  }, CLEANUP_TTL))
}

function authMiddleware(req, res, next) {
  if (!REQUIRE_AUTH) return next()
  const auth = req.headers.authorization
  if (!auth) return res.status(401).json({ error: 'Missing token' })
  const token = auth.split(' ')[1]
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid token' })
    req.user = decoded
    next()
  })
}

app.get('/api/stream', authMiddleware, async (req, res) => {
  try {
    const torrentId = req.query.magnet
    if (!torrentId) return res.status(400).json({ error: 'Missing magnet link' })

    let torrent = client.get(torrentId)
    if (!torrent) {
      torrent = await new Promise((resolve, reject) => {
        client.add(torrentId, { path: '/tmp' }, t => resolve(t))
      })
    }

    await new Promise(resolve => torrent.ready ? resolve() : torrent.on('ready', resolve))

    touchTorrent(torrent)

    let file
    if (req.query.fileIndex) {
      file = torrent.files[parseInt(req.query.fileIndex, 10)]
    } else {
      file = torrent.files.reduce((a, b) => (a.length > b.length ? a : b))
    }

    const range = req.headers.range
    const size = file.length
    let start = 0, end = size - 1

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      if (match) {
        if (match[1]) start = parseInt(match[1], 10)
        if (match[2]) end = parseInt(match[2], 10)
      }
    }

    if (start >= size || end >= size) {
      res.status(416).end()
      return
    }

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mime.lookup(file.name) || 'application/octet-stream'
    })

    file.createReadStream({ start, end }).pipe(res)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Simple API to list files in torrent
app.get('/api/files', authMiddleware, async (req, res) => {
  const torrentId = req.query.magnet
  if (!torrentId) return res.status(400).json({ error: 'Missing magnet link' })

  let torrent = client.get(torrentId)
  if (!torrent) {
    torrent = await new Promise((resolve, reject) => {
      client.add(torrentId, { path: '/tmp' }, t => resolve(t))
    })
  }

  await new Promise(resolve => torrent.ready ? resolve() : torrent.on('ready', resolve))

  touchTorrent(torrent)

  res.json({
    name: torrent.name,
    files: torrent.files.map((f, idx) => ({
      index: idx,
      name: f.name,
      length: f.length
    }))
  })
})

// Token generation (demo purpose)
app.get('/api/token', (req, res) => {
  if (!REQUIRE_AUTH) return res.json({ token: null })
  const token = jwt.sign({ user: "demo" }, JWT_SECRET, { expiresIn: "1h" })
  res.json({ token })
})

app.listen(PORT, () => {
  console.log(`🚀 Torrent server running on http://localhost:${PORT}`)
})
