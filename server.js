// server.js
// Express + WebTorrent streaming server (fixed & hardened)

const express = require('express')
const cors = require('cors')
const WebTorrent = require('webtorrent')
const parseTorrent = require('parse-torrent')
const mime = require('mime-types')
const jwt = require('jsonwebtoken')
const fs = require('fs')
const path = require('path')

const { PORT, REQUIRE_AUTH, JWT_SECRET, TORRENT_TMP_DIR, TTR_CLEANUP_MINUTES } = require('./config')

if (!fs.existsSync(TORRENT_TMP_DIR)) {
  fs.mkdirSync(TORRENT_TMP_DIR, { recursive: true })
}

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const client = new WebTorrent()
client.on('error', err => {
  console.error('[webtorrent] client error', err && err.message)
})

// Manage automatic cleanup of idle torrents
const cleanupTimers = new Map()
function touchCleanup(torrent) {
  try {
    if (!torrent || !torrent.infoHash) return
    const key = torrent.infoHash
    if (cleanupTimers.has(key)) clearTimeout(cleanupTimers.get(key))
    const ms = Math.max(1000, TTR_CLEANUP_MINUTES * 60 * 1000)
    const t = setTimeout(() => {
      try {
        torrent.destroy({ destroyStore: true }, () => {
          cleanupTimers.delete(key)
          console.log(`[cleanup] destroyed torrent ${key}`)
        })
      } catch (e) {
        console.warn('[cleanup] error destroying torrent', e && e.message)
      }
    }, ms)
    cleanupTimers.set(key, t)
  } catch (e) {
    // ignore
  }
}

function requireAuthMiddleware(req, res, next) {
  if (!REQUIRE_AUTH) return next()
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header (Bearer token)' })
  }
  const token = auth.slice(7)
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid token' })
    req.user = decoded
    next()
  })
}

// Utility: try to find existing torrent by infoHash (if parseable)
function findExistingTorrent(torrentId) {
  try {
    const parsed = parseTorrent(torrentId) // works for magnet, infoHash, torrent Buffer (if provided)
    if (parsed && parsed.infoHash) {
      const lower = parsed.infoHash.toLowerCase()
      return client.torrents.find(t => t.infoHash && t.infoHash.toLowerCase() === lower) || null
    }
  } catch (e) {
    // parse failed (maybe it's a URL). Fallback: try direct match
  }
  // fallback: try match by id string against torrent.infoHash or magnetURI
  const q = String(torrentId).toLowerCase()
  return client.torrents.find(t => (t.infoHash && t.infoHash.toLowerCase() === q) || (t.magnetURI && t.magnetURI.toLowerCase() === q)) || null
}

async function addOrGetTorrent(torrentId) {
  const existing = findExistingTorrent(torrentId)
  if (existing) return existing

  // Return a Promise that resolves when the torrent object is available.
  return new Promise((resolve, reject) => {
    let timedout = false
    const timeout = setTimeout(() => {
      timedout = true
      reject(new Error('Timeout waiting for torrent metadata (20s)'))
    }, 20000)

    try {
      // client.add accepts magnet uri, .torrent url, infoHash, Buffer etc.
      client.add(torrentId, { path: TORRENT_TMP_DIR }, t => {
        if (timedout) {
          // we already rejected
          try { t.destroy({ destroyStore: true }) } catch (e) {}
          return
        }
        clearTimeout(timeout)
        resolve(t)
      })
    } catch (err) {
      clearTimeout(timeout)
      reject(err)
    }
  })
}

// Helper: choose a file: by index, by filename substring, prefer common video/audio, else largest
function chooseFile(torrent, { fileIndex, filename } = {}) {
  if (!torrent || !torrent.files || torrent.files.length === 0) return null
  if (typeof fileIndex !== 'undefined' && !Number.isNaN(Number(fileIndex))) {
    const idx = Number(fileIndex)
    if (torrent.files[idx]) return torrent.files[idx]
  }
  if (filename) {
    const f = torrent.files.find(ff => ff.name === filename || ff.name.endsWith(filename) || ff.name.toLowerCase().includes(filename.toLowerCase()))
    if (f) return f
  }
  const preferExt = ['.mp4', '.m4v', '.webm', '.mkv', '.mp3', '.m4a', '.ogg', '.wav']
  for (const ext of preferExt) {
    const f = torrent.files.find(file => file.name.toLowerCase().endsWith(ext))
    if (f) return f
  }
  // fallback to largest
  return torrent.files.reduce((a, b) => (a.length > b.length ? a : b))
}

// Parse Range header: returns {start,end} or null
function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
  if (!m) return null
  let start = m[1] === '' ? null : parseInt(m[1], 10)
  let end = m[2] === '' ? null : parseInt(m[2], 10)
  if (start === null && end !== null) {
    // suffix form bytes=-X
    start = Math.max(size - end, 0)
    end = size - 1
  } else if (start !== null && end === null) {
    end = size - 1
  }
  if (start === null || end === null || isNaN(start) || isNaN(end) || start > end || start < 0 || end >= size) return null
  return { start, end }
}

// Endpoint: list files in torrent
app.get('/api/files', requireAuthMiddleware, async (req, res) => {
  try {
    const id = req.query.magnet || req.query.id || req.query.torrent
    if (!id) return res.status(400).json({ error: 'Missing ?magnet=<magnet-uri|infohash|url>' })

    const torrent = await addOrGetTorrent(id)
    await new Promise(resolve => torrent.ready ? resolve() : torrent.once('ready', resolve))

    touchCleanup(torrent)

    res.json({
      name: torrent.name,
      infoHash: torrent.infoHash,
      files: torrent.files.map((f, i) => ({
        index: i,
        name: f.name,
        length: f.length
      }))
    })
  } catch (err) {
    console.error('/api/files error', err && err.message)
    res.status(500).json({ error: err.message })
  }
})

// Endpoint: stream a file with Range support
app.get('/api/stream', requireAuthMiddleware, async (req, res) => {
  try {
    const id = req.query.magnet || req.query.id || req.query.torrent
    if (!id) return res.status(400).send('Missing ?magnet=<magnet-uri|infohash|url>')

    const fileIndex = req.query.fileIndex
    const filename = req.query.filename
    const forceDownload = req.query.d === '1' || req.query.download === '1'

    const torrent = await addOrGetTorrent(id)
    await new Promise(resolve => torrent.ready ? resolve() : torrent.once('ready', resolve))

    touchCleanup(torrent)

    const file = chooseFile(torrent, { fileIndex, filename })
    if (!file) return res.status(404).send('No file found in torrent')

    const size = file.length
    const rangeHeader = req.headers.range || req.headers.Range
    const range = parseRange(rangeHeader, size)
    const contentType = mime.lookup(file.name) || 'application/octet-stream'

    // common headers
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', contentType)

    if (forceDownload) {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`)
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`)
    }

    let stream
    if (range) {
      const { start, end } = range
      const chunkSize = (end - start) + 1
      res.status(206)
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
      res.setHeader('Content-Length', String(chunkSize))
      // create read stream for range
      stream = file.createReadStream({ start, end })
    } else {
      res.status(200)
      res.setHeader('Content-Length', String(size))
      stream = file.createReadStream()
    }

    let closed = false
    const onClose = () => {
      closed = true
      try { stream.destroy() } catch (e) {}
    }
    req.on('close', onClose)
    req.on('aborted', onClose)
    res.on('close', onClose)

    stream.on('error', (err) => {
      console.error('[stream] stream error', err && err.message)
      if (!res.headersSent) {
        res.status(500).send('Stream error')
      } else {
        try { res.end() } catch (e) {}
      }
    })

    stream.pipe(res)

  } catch (err) {
    console.error('/api/stream error', err && err.message)
    if (!res.headersSent) res.status(500).send('Internal Server Error: ' + (err && err.message))
  }
})

// Demo token endpoint (if auth enabled)
app.get('/api/token', (req, res) => {
  if (!REQUIRE_AUTH) return res.json({ token: null })
  const token = jwt.sign({ user: 'demo' }, JWT_SECRET, { expiresIn: '1h' })
  res.json({ token })
})

// Start
app.listen(PORT, () => {
  console.log(`🚀 Torrent stream server listening on http://localhost:${PORT}`)
  console.log(`REQUIRE_AUTH=${REQUIRE_AUTH ? 'true' : 'false'}`)
})
