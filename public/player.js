// player.js - minimal UI to list files and play via /api/stream
const magnetInput = document.getElementById('magnet')
const loadBtn = document.getElementById('loadBtn')
const fileList = document.getElementById('fileList')
const player = document.getElementById('player')

let token = null // used only if REQUIRE_AUTH=true

async function getToken() {
  try {
    const r = await fetch('/api/token')
    const j = await r.json()
    token = j.token
    if (token) {
      alert('Token received (demo). Use Authorization: Bearer <token> header for API calls (the webpage will use it automatically).')
    } else {
      alert('Auth not required on server.')
    }
  } catch (err) {
    console.error(err)
    alert('Failed to get token: ' + (err && err.message))
  }
}

async function loadFiles() {
  const magnet = magnetInput.value.trim()
  if (!magnet) return alert('Enter a magnet or torrent url or infohash')

  fileList.innerHTML = 'Loading...'

  try {
    const headers = token ? { 'Authorization': 'Bearer ' + token } : undefined
    const res = await fetch(`/api/files?magnet=${encodeURIComponent(magnet)}`, { headers })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || 'Failed to load files')
    }
    const data = await res.json()
    fileList.innerHTML = ''
    data.files.forEach(f => {
      const btn = document.createElement('button')
      btn.className = 'file-btn'
      btn.textContent = `${f.index}: ${f.name} (${(f.length / (1024*1024)).toFixed(2)} MB)`
      btn.onclick = () => {
        const headers = token ? { 'Authorization': 'Bearer ' + token } : undefined
        // video element will make Range requests automatically
        player.src = `/api/stream?magnet=${encodeURIComponent(magnet)}&fileIndex=${f.index}`
        player.load()
        player.play().catch(()=>{})
      }
      fileList.appendChild(btn)
    })
  } catch (err) {
    console.error(err)
    fileList.innerHTML = ''
    alert('Error: ' + (err && err.message))
  }
}

loadBtn.addEventListener('click', loadFiles)
