# AzuraVote
Small external voting add-on for an existing AzuraCast station.

AzuraVote adds native-looking thumbs-up/thumbs-down controls to the AzuraCast public player, stores listener votes in SQLite, and can optionally sync high/low rated songs into AzuraCast playlists.

It does not modify AzuraCast core files.
## What It Does

- Shows vote buttons inside the AzuraCast public player.
- Adds an anonymous station chat, hidden until the listener clicks Chat.
- Allows one vote per listener per song.
- Lets a listener change their vote.
- Shows a ratings list for tracks.
- Stores votes locally in `./data/votes.sqlite`.
- Can optionally add highly rated tracks to a high-rotation playlist and low-rated tracks to a low-rotation/excluded playlist.

<img width="1699" height="839" alt="image" src="https://github.com/user-attachments/assets/d3d2f7c2-83a6-4ed8-9564-8517cdf84bfc" style="width: 50%;"/>

## Requirements
- A working AzuraCast station.
- Docker Compose.
- Access to AzuraCast custom nginx config for the `/votes/` proxy.
- Access to `Station -> Public Pages -> Branding -> Custom JS for Public Pages`.

## Install
From the project folder:
```sh
git clone https://github.com/tac2sc/azuravote
cd ./azuravote

cp .env.example .env
nano ./env

docker compose up -d --build

cp ./azuracast/* /var/azuracast 
cd /var/azuracast
```
Now review your AzuraCast docker configuration, and docker compose up -d --build
Notes:
- `PUBLIC_BASE_URL` must be one canonical URL only.
- Put both `http://` and `https://` origins in `CORS_ALLOWED_ORIGINS` if you use both.
- Set either `AZURACAST_STATION_ID`, `AZURACAST_STATION_SHORT_NAME`, or both.
- Do not expose port `3099` directly to the public internet.
## AzuraCast custom nginx config
```nginx
location ^~ /votes/ {
    proxy_pass http://172.17.0.1:3099/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```
The default azuravote setup binds the app to `172.17.0.1:3099` so the AzuraCast container can reach it while keeping it off the public internet.
Verify:
```sh
curl -i http://yourhost.radio/votes/health
```
## Widget Install
In AzuraCast, open:
`Station -> Public Pages -> Branding -> Custom JS for Public Pages`
Paste the contents of `azuracast/custom_js_for_public_pages.js`. That script includes the
external-stream metadata updater and loads AzuraVote with this cache-versioned URL:
```js
(function () {
  var s = document.createElement("script");
  s.src = "/votes/embed.js?v=11";
  s.defer = true;
  document.head.appendChild(s);
})();
```
Save, then reload the public station page.
When `public/embed.js` changes, increase the cache number, for example `v=2`, `v=3`, etc.

## External-stream metadata and voting

`azuracast/custom_js_for_public_pages.js` detects supported external streams, updates the
AzuraCast now-playing labels, and polls the matching same-origin nginx metadata endpoint
every ten seconds:

- Loops Radio: stream URLs containing `progressive.ozelip.com/7670/stream` use
  `/loopsradio-metadata` and the stable source ID `loops-radio`.
- Yoga Chill: stream URLs containing `radio4.vip-radios.fm:18027` use
  `/yogachill-metadata` and the stable source ID `yoga-chill`.

The proxy locations live in `azuracast/nginx-custom.conf`, keeping upstream metadata
requests same-origin for the public page. The Loops Radio location is enabled. Yoga Chill
voting remains inactive until the commented `/yogachill-metadata` proxy location is
configured and enabled with an upstream that returns plain-text song metadata.

The updater stores its latest state in `window.AZURAVOTE_EXTERNAL_METADATA` and dispatches
an `azuravote:external-metadata` DOM event with the same payload. Successful metadata uses:

```js
{ active: true, source: "loops-radio", available: true, artist: "Artist", title: "Title" }
```

A failed, empty, or non-successful metadata response publishes
`{ active: true, source, available: false }`; fallback display labels are never used as a
song identity after a failed response. Selecting the main stream or an unsupported stream
immediately publishes `{ active: false }` and restores normal AzuraCast now-playing voting.

For valid external metadata, `public/embed.js` calls
`POST /votes/api/external-now-playing` with JSON `{ "artist": "...", "title": "..." }`.
The resolver normalizes and upserts the song, then returns that listener's existing totals.
Songs with the same normalized artist and title share the existing
`meta:artist::title` identity across every stream.

## Useful Commands
Start or update:
```sh
docker compose up -d --build
```
View logs:
```sh
docker compose logs -f azuravote
```
Run tests:
```sh
docker compose run --rm azuravote npm test
```
Check service health:
```sh
curl -i http://yourhost.radio/votes/health
```
From the project folder, run this to see vote totals for every song:
```sh
docker compose exec azuravote node -e 'const Database=require("better-sqlite3"); const db=new Database(process.env.DATABASE_PATH||process.env.DB_PATH||"/data/azuravote.sqlite",{readonly:true}); console.table(db.prepare(`select s.id, s.artist, s.title, coalesce(sum(v.vote_value=1),0) as likes, coalesce(sum(v.vote_value=-1),0) as dislikes, coalesce(sum(v.vote_value),0) as score from songs s left join votes v on v.song_id=s.id group by s.id order by score desc, likes desc, s.last_seen_at desc`).all())'
```
To see individual raw votes:
```
docker compose exec azuravote node -e 'const Database=require("better-sqlite3"); const db=new Database(process.env.DATABASE_PATH||process.env.DB_PATH||"/data/azuravote.sqlite",{readonly:true}); console.table(db.prepare(`select v.id, s.artist, s.title, v.vote_value, v.created_at, v.updated_at, v.voter_ip from votes v join songs s on s.id=v.song_id order by v.updated_at desc`).all())'
```
To clear everything, votes and songs:
```
docker compose exec azuravote node -e 'const Database=require("better-sqlite3"); const db=new Database(process.env.DATABASE_PATH||process.env.DB_PATH||"/data/azuravote.sqlite"); db.exec("delete from votes; delete from songs;"); onsole.log("cleared votes and songs")'
```

## Rotation Sync
Rotation sync is optional. It uses vote totals to update AzuraCast playlist assignments.
Run sync:rotation to preview, sync:rotation:apply to apply
## sync:rotation:apply logic
- if song vote_value ≥ ROTATION_HIGH_SCORE then move song to AZURACAST_HIGH_PLAYLIST
- if song vote_value ≤ ROTATION_LOW_SCORE then move song to AZURACAST_LOW_PLAYLIST

Configure:
```env
AZURACAST_API_KEY=your-admin-api-key #Get in My Account-> API KEYs
AZURACAST_HIGH_PLAYLIST_ID=2
AZURACAST_LOW_PLAYLIST_ID=3
ROTATION_HIGH_SCORE=2
ROTATION_LOW_SCORE=-2
ROTATION_BLOCK_DAYS=7
```
Get PLAYLIST_ID:
```
curl -s \
  -H "Authorization: Bearer YOUR_API_KEY" \
  http://yourhost.radio/api/station/progressiveua/playlists \
  | jq '.[] | {id, name}'
```

Preview changes:
```sh
docker compose run --rm azuravote npm run sync:rotation
```
Apply changes:
```sh
docker compose run --rm azuravote npm run sync:rotation:apply
```

## Important Notes
Voting remains available when listeners select any stream.

<img width="1792" height="675" alt="{8744D799-AD73-4D2A-BFA4-C14C912C3A76}" src="https://github.com/user-attachments/assets/b55ec930-d13e-446c-b664-8efb8b8ec24e" style="width: 50%;"/>

## API
Behind the `/votes/` proxy:
- `GET /votes/health`
- `GET /votes/api/now-playing`
- `POST /votes/api/external-now-playing` with JSON `{ "artist": "...", "title": "..." }`
- `POST /votes/api/vote`
- `GET /votes/api/chat/messages?after=0&limit=50`
- `POST /votes/api/chat/messages` with JSON `{ "message": "Up to 200 characters" }`
- `GET /votes/api/ratings`
- `GET /votes/widget`
- `GET /votes/embed.js`

Chat nicknames are assigned by the server from the first six characters of the listener's voter hash. Full voter hashes and IP addresses remain internal. Chat posting defaults to one message per minute per client IP; configure it with `CHAT_RATE_LIMIT_WINDOW_MS` and `CHAT_RATE_LIMIT_MAX_MESSAGES`.

## Troubleshooting
- `404` on `/votes/health`: the nginx `/votes/` proxy is missing or not loaded.
- `502` on `/votes/health`: AzuraCast nginx cannot reach AzuraVote. Check `docker compose ps`, the port binding, and the proxy target.
- Widget looks old after an update: bump the `v=` number in the Custom JS snippet.
- Votes all look like one listener: check proxy headers and keep `TRUST_PROXY=true` only behind your trusted proxy.

## Backups
Back up:
```text
./data/votes.sqlite
```
