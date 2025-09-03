# Torrent Stream Server (Express + WebTorrent)

## Quick start
1. Copy files into `torrent-stream-server/`
2. `cp .env.example .env` and edit if needed
3. `npm install`
4. `npm start`
5. Open `http://localhost:3000` and paste a magnet link (e.g. Sintel magnet) then click a file and press play.

## Endpoints
- `GET /api/files?magnet=<MAGNET_OR_INFOHASH_OR_URL>` - list files in the torrent
- `GET /api/stream?magnet=<...>&fileIndex=0` - stream a file (supports Range requests)
- `GET /api/token` - demo token if `REQUIRE_AUTH=true`

## Notes
- Server stores temporary pieces in `TORRENT_TMP_DIR` (default `./tmp`).
- For browser-to-node peer connectivity (WebRTC), use `webtorrent-hybrid` or WebTorrent Desktop as seeders. This server uses normal bittorrent transports (tcp/udp).
- For long-term streaming in production, use a persistent server or scale with a long-lived instance — serverless functions have timeouts and limited temps.

