# AzuraVote

Small external voting add-on for an existing AzuraCast station.

AzuraVote adds native-looking thumbs-up/thumbs-down controls to the AzuraCast public player, stores listener votes in SQLite, and can optionally sync high/low rated songs into AzuraCast playlists.

It does not modify AzuraCast core files.

## What It Does

- Shows vote buttons inside the AzuraCast public player.
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

Paste this JavaScript:

```js
(function () {
  var s = document.createElement("script");
  s.src = "/votes/embed.js?v=1";
  s.defer = true;
  document.head.appendChild(s);
})();
```

Save, then reload the public station page.

When `public/embed.js` changes, increase the cache number, for example `v=2`, `v=3`, etc.

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
curl -i http://10.0.0.2/votes/health
```

## Rotation Sync

Rotation sync is optional. It uses vote totals to update AzuraCast playlist assignments.

Configure:

```env
AZURACAST_API_KEY=your-admin-api-key
AZURACAST_HIGH_PLAYLIST_ID=2
AZURACAST_LOW_PLAYLIST_ID=3
ROTATION_HIGH_SCORE=2
ROTATION_LOW_SCORE=-2
ROTATION_BLOCK_DAYS=7
```

Preview changes:

```sh
docker compose run --rm azuravote npm run sync:rotation
```

Apply changes:

```sh
docker compose run --rm azuravote npm run sync:rotation:apply
```

## API

Behind the `/votes/` proxy:

- `GET /votes/health`
- `GET /votes/api/now-playing`
- `POST /votes/api/vote`
- `GET /votes/api/ratings`
- `GET /votes/widget`
- `GET /votes/embed.js`

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
