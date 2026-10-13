# Spotify API efficiency (feat/spotify-api-efficiency)

Branch work for reducing wasted `api.spotify.com` traffic without changing show behavior or Connect playback.

**Do not push/deploy from this note alone — controlled review first.**

## What changed (summary)

| Area | Change | Risk |
|------|--------|------|
| Meter | 30s / 5m / 60m windows; clientId + label + status; `QUOTA_EXCEEDED` vs other 429 | Low |
| Failsafe | Clears only hosts on the hottest developer Client ID prefix | Medium (document; opt-in env) |
| Playlist tracks | Trust fresh in-memory cache ≤2m without snapshot GET (`TEMPO_PLAYLIST_TRACKS_TRUST_CACHE_MS`) | Low |
| `/v1/me` | 30m cache on `getCurrentUserProfileBrief` | Low |
| Transfer | One devices list + transfer; no post profile/devices/player | Low |
| Device keepalive | Off unless `TEMPO_SPOTIFY_DEVICE_KEEPALIVE=1` | Low (legacy DEFAULT only) |
| Search modal | One `limit=20` instead of two `limit=10` pages | Low |
| Host reconnect | No redundant `/current-playback`; OAuth second devices poll only if empty | Low |
| Playback monitors | **Unchanged** (protected) | — |
| Org shelf Spotify hydrate | Still banned (`check:spotify-shelf`) | — |

## Manual Connect checklist (unchanged rules)

Hard-refresh host → Spotify desktop has Now Playing → Start Game → audio past 1s → confirm `context_uri` / `ok=true` in Railway. No URI-fallback after context; no `transfer(play=false)`.

## Rollback

Revert this branch / cherry-pick inverse of the efficiency commits. Env knobs: set `TEMPO_PLAYLIST_TRACKS_TRUST_CACHE_MS=0` to restore always-snapshot; `TEMPO_SPOTIFY_DEVICE_KEEPALIVE=1` to restore keepalive.
