# CYBER DEFENSE: NEXUS

A neon space tower-defense game: single-player, 2-player co-op, and 1v1 versus battles.
Pure HTML/CSS/vanilla JavaScript — no frameworks, no build step. Multiplayer runs on a
tiny Python server (stdlib only, no dependencies).

## Play (local)

```bash
python3 server.py
```

Open http://localhost:8137 — single-player works at that URL; click **1v1 Battles** or
**Co-op** for multiplayer.

## Play with friends (internet)

1. Push this repo to GitHub.
2. On [Render](https://render.com) (free): New → Web Service → connect the repo.
   - Language: Python · Start command: `python3 server.py`
3. Share the rendered URL. One player hosts a room, the other joins with the code.

## Play with friends (same Wi-Fi)

Run `python3 server.py` on one machine, then everyone opens
`http://<that-machine's-ip>:8137`.

## Modes

- **Single player** — classic tower defense, progressive rounds.
- **1v1 Battles** — split screen, two maps, shared round timer: buy towers to defend
  your Nexus or buy enemy packs to rush your rival's. Income grows with every send.
- **Co-op** — shared Nexus, shared coins, defend together against the same waves.

All game art is drawn with Canvas — no assets needed.
