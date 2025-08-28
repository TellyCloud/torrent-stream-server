async function loadFiles() {
  const magnet = document.getElementById('magnet').value
  if (!magnet) return alert("Enter a magnet link")

  const res = await fetch(`/api/files?magnet=${encodeURIComponent(magnet)}`)
  const data = await res.json()

  const list = document.getElementById('file-list')
  list.innerHTML = ""

  data.files.forEach(file => {
    const btn = document.createElement('button')
    btn.textContent = `${file.index}: ${file.name} (${(file.length / (1024*1024)).toFixed(2)} MB)`
    btn.onclick = () => {
      document.getElementById('player').src = `/api/stream?magnet=${encodeURIComponent(magnet)}&fileIndex=${file.index}`
    }
    list.appendChild(btn)
    list.appendChild(document.createElement('br'))
  })
}
