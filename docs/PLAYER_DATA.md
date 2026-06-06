# Player data & accounts

## Overview

Players can use TEMPO in two modes:

| Mode | Identity | Stats |
|------|----------|--------|
| **Account** | Email + password (`player_accounts`) | Lifetime + per-round history |
| **Guest** | Browser `client_id` + display name | Session card/marks only (no lifetime stats) |

Hosts still use **Google OAuth** (`users` table). Player accounts are separate.

## Player accounts

- **Sign up / sign in:** `POST /api/player/signup`, `POST /api/player/login`
- **Session:** JWT in `tempo_player_jwt` (localStorage) + HttpOnly cookie `tempo_player_session`
- **Profile:** `GET /api/player/me` → user, stats, recent rounds
- **Update display name:** `PATCH /api/player/profile` — `{ displayName }`
- **Sign out:** `POST /api/player/logout`

Passwords are hashed with **scrypt** (no plaintext stored). Minimum 8 characters.

Requires `DATABASE_URL`.

## Statistics tracked (logged-in players)

| Stat | When incremented |
|------|------------------|
| `games_joined` | First join to a room/round (`round_token`) |
| `marks_made` | Each server-confirmed mark |
| `bingos_called` | Valid bingo call (including hybrid unofficial) |
| `bingos_won` | Host approves bingo |

Per-round detail lives in `player_round_history`.

## Guest session data

`tempo_players` + `player_room_sessions` persist card/marks by `client_id` (same browser). Survives refresh/reconnect when the round pool is unchanged.

When a logged-in player joins, `client_id` links to `player_user_id`.

## API summary

| Method | Path |
|--------|------|
| POST | `/api/player/signup` |
| POST | `/api/player/login` |
| GET | `/api/player/me` |
| PATCH | `/api/player/profile` |
| POST | `/api/player/logout` |

## Client

- Join gate: `PlayerAccountGate` (sign in / sign up / guest)
- Options sheet: display name edit, lifetime stats grid, recent games list
- Utils: `client/src/utils/playerFetch.ts`
- Socket: `auth.playerToken` on connect; `playerToken` on `join-room`
