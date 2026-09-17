#!/usr/bin/env python3
"""
CYBER DEFENSE: NEXUS — LAN server
Serves the game files and a tiny rooms API for 2-player co-op.
Python stdlib only — no dependencies.

Run:   python3 server.py        →  http://localhost:8137
LAN:   other players open http://<your-ip>:8137
"""
import json
import os
import random
import string
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", 8137))  # hosting platforms set PORT
MAX_ROOMS = 50
IDLE_KICK = 45      # seconds without a poll before a player is dropped
EMPTY_TTL = 180     # seconds before an empty room is deleted

LOCK = threading.Lock()
ROOMS = {}          # code -> Room


def rand_id(n):
    return "".join(random.choices(string.ascii_letters + string.digits, k=n))


def new_code():
    while True:
        c = "".join(random.choices(string.digits, k=4))
        if c not in ROOMS:
            return c


class Room:
    def __init__(self, name, player_name, mode="versus"):
        self.code = new_code()
        self.name = (name or "COMMAND CENTER")[:24]
        self.mode = mode if mode in ("versus", "coop") else "versus"
        self.created = time.time()
        self.tokens = {}      # token -> {seat, name, last}
        self.events = []      # oldest first: {seq, seat, type, data, t}
        self.seq = 0
        self.cv = threading.Condition()
        self.add_player(player_name)

    def add_player(self, player_name):
        token = rand_id(12)
        seat = len(self.tokens)
        self.tokens[token] = {
            "seat": seat,
            "name": (player_name or "COMMANDER")[:16],
            "last": time.time(),
        }
        self.publish(-1, "seats", self.seats_public())
        return token, seat

    def seats_public(self):
        players = sorted(self.tokens.values(), key=lambda t: t["seat"])
        return {
            "count": len(players),
            "players": [{"seat": t["seat"], "name": t["name"]} for t in players],
        }

    def publish(self, seat, type_, data):
        with self.cv:
            self.seq += 1
            self.events.append({
                "seq": self.seq, "seat": seat,
                "type": type_, "data": data, "t": time.time(),
            })
            if len(self.events) > 4000:
                self.events = self.events[-2000:]
            self.cv.notify_all()

    def events_after(self, seq):
        return [e for e in self.events if e["seq"] > seq]

    def wait_events(self, seq, timeout):
        deadline = time.time() + timeout
        with self.cv:
            while True:
                evs = self.events_after(seq)
                if evs or time.time() >= deadline:
                    return evs
                self.cv.wait(0.1)

    def public(self):
        return {"code": self.code, "name": self.name,
                "players": len(self.tokens), "mode": self.mode}


def janitor():
    while True:
        time.sleep(10)
        now = time.time()
        with LOCK:
            for code in list(ROOMS):
                r = ROOMS[code]
                for tok in list(r.tokens):
                    if now - r.tokens[tok]["last"] > IDLE_KICK:
                        gone = r.tokens.pop(tok)
                        r.publish(-1, "left", {"name": gone["name"]})
                        r.publish(-1, "seats", r.seats_public())
                if not r.tokens and now - r.created > EMPTY_TTL:
                    del ROOMS[code]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    # ------------ helpers ------------
    def _headers(self, status, ctype, length, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self._headers(status, "application/json", len(body))
        self.wfile.write(body)

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    def _room_and_token(self, q):
        """Returns (room, token_str) after validating + touching the token."""
        code = (q.get("code") or [""])[0]
        token = (q.get("token") or [""])[0]
        room = ROOMS.get(code)
        if not room or token not in room.tokens:
            return None, None
        room.tokens[token]["last"] = time.time()
        return room, token

    # ------------ routing ------------
    def do_OPTIONS(self):
        self._headers(204, "text/plain", 0, {
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        })

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)

        if u.path == "/api/rooms":
            with LOCK:
                rooms = [r.public() for r in ROOMS.values()]
            return self._json({"rooms": rooms})

        if u.path == "/api/events":
            with LOCK:
                room, token = self._room_and_token(q)
            if not room:
                return self._json({"error": "GONE"}, 404)
            since = int((q.get("since") or ["0"])[0])
            evs = room.wait_events(since, 3.0)
            return self._json({"events": evs, "seats": room.seats_public()})

        return self.serve_static(u.path)

    def do_POST(self):
        u = urlparse(self.path)
        body = self._body()

        if u.path == "/api/create":
            with LOCK:
                if len(ROOMS) >= MAX_ROOMS:
                    return self._json({"error": "SERVER FULL"}, 503)
                r = Room(body.get("name"), body.get("playerName"),
                         body.get("mode", "versus"))
                ROOMS[r.code] = r
                token = next(iter(r.tokens))
            return self._json({"code": r.code, "token": token, "seat": 0,
                               "seats": r.seats_public()})

        if u.path == "/api/join":
            with LOCK:
                r = ROOMS.get(body.get("code", ""))
                if not r:
                    return self._json({"error": "ROOM NOT FOUND"}, 404)
                if len(r.tokens) >= 2:
                    return self._json({"error": "ROOM FULL"}, 409)
                if body.get("mode", r.mode) != r.mode:
                    return self._json({"error": "MODE MISMATCH"}, 409)
                token, seat = r.add_player(body.get("playerName"))
            return self._json({"code": r.code, "token": token, "seat": seat,
                               "seats": r.seats_public()})

        if u.path == "/api/publish":
            with LOCK:
                room, token = self._room_and_token({
                    "code": [body.get("code", "")],
                    "token": [body.get("token", "")],
                })
            if not room:
                return self._json({"error": "GONE"}, 404)
            seat = room.tokens[token]["seat"]
            room.publish(seat, str(body.get("type", "msg"))[:24],
                         body.get("data", {}))
            return self._json({"ok": True})

        if u.path == "/api/leave":
            with LOCK:
                r = ROOMS.get(body.get("code", ""))
                if r and body.get("token") in r.tokens:
                    gone = r.tokens.pop(body["token"])
                    r.publish(-1, "left", {"name": gone["name"]})
                    r.publish(-1, "seats", r.seats_public())
                    if not r.tokens:
                        del ROOMS[r.code]
            return self._json({"ok": True})

        return self._json({"error": "NOT FOUND"}, 404)

    # ------------ static files ------------
    def serve_static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        safe = os.path.normpath(path).lstrip("/\\")
        full = os.path.join(ROOT, safe)
        if not os.path.abspath(full).startswith(os.path.abspath(ROOT)):
            return self._json({"error": "FORBIDDEN"}, 403)
        if not os.path.isfile(full):
            return self._json({"error": "NOT FOUND"}, 404)
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
        }.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
        with open(full, "rb") as f:
            data = f.read()
        self._headers(200, ctype, len(data))
        self.wfile.write(data)


def main():
    threading.Thread(target=janitor, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"CYBER DEFENSE: NEXUS server → http://localhost:{PORT}")
    print(f"LAN players join via        → http://<your-ip>:{PORT}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nserver stopped")


if __name__ == "__main__":
    main()
