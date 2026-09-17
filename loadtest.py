#!/usr/bin/env python3
"""
Load test for the NEXUS server: simulates N rooms x 2 players.

Usage:  python3 loadtest.py [base_url] [rooms] [seconds]
Example: python3 loadtest.py http://localhost:8138 10 30
"""
import json
import threading
import time
import urllib.request
import sys

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8138"
N_ROOMS = int(sys.argv[2]) if len(sys.argv) > 2 else 10
DURATION = float(sys.argv[3]) if len(sys.argv) > 3 else 30

stop = threading.Event()
lock = threading.Lock()
lat = []                                       # poll latencies (s)
counts = {"polls": 0, "publishes": 0, "events": 0, "errors": 0}

def api(path, body=None, timeout=10):
    if body is None:
        with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
            return json.loads(r.read())
    data = json.dumps(body).encode()
    rq = urllib.request.Request(BASE + path, data=data,
                                headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(rq, timeout=timeout) as r:
        return json.loads(r.read())

def fake_sync(tick):
    """A snapshot shaped like the real ones (~18 enemies, 4 towers)."""
    return {
        "type": "sync", "coins": 150, "hp": 150, "wave": 3, "phase": "wave",
        "cd": 0, "paused": False, "wstart": 3, "kills": tick,
        "names": ["a", "b"], "lastAct": ["", ""],
        "towers": [{"id": i, "x": 100 + i * 40, "y": 200, "ty": "pulse",
                    "lv": 2, "d": 20, "r": 135, "f": 1.1, "k": 1,
                    "inv": 100, "a": 0.5} for i in range(4)],
        "enemies": [{"id": i, "ty": "scout", "d": 100 + i * 23, "s": 90,
                     "hp": 40, "m": 40} for i in range(14 + tick % 12)],
        "fx": {"bm": [], "bo": [], "kl": [], "sk": [], "tx": [], "sh": 0, "nx": 0},
    }

def host_worker(room, token):
    tick = 0
    while not stop.is_set():
        try:
            api("/api/publish", {"code": room, "token": token, "type": "sync",
                                 "data": fake_sync(tick)})
            with lock: counts["publishes"] += 1
        except Exception:
            with lock: counts["errors"] += 1
        tick += 1
        time.sleep(0.08)

def guest_actor(room, token):
    while not stop.is_set():
        try:
            api("/api/publish", {"code": room, "token": token, "type": "act",
                                 "data": {"op": "noop"}})
            with lock: counts["publishes"] += 1
        except Exception:
            with lock: counts["errors"] += 1
        time.sleep(0.5)

def poller(room, token, since=0):
    while not stop.is_set():
        t0 = time.time()
        try:
            res = api(f"/api/events?code={room}&token={token}&since={since}")
            dt = time.time() - t0
            with lock:
                counts["polls"] += 1
                counts["events"] += len(res["events"])
                lat.append(dt)
            since += len(res["events"])
        except Exception:
            with lock: counts["errors"] += 1
            time.sleep(0.2)

def main():
    rooms = []
    for i in range(N_ROOMS):
        r = api("/api/create", {"name": f"LT{i}", "playerName": f"H{i}",
                                "mode": "versus"})
        rooms.append((r["code"], r["token"]))
    print(f"created {len(rooms)} rooms on {BASE}")

    threads = []
    for code, tok in rooms:
        g = api("/api/join", {"code": code, "playerName": "G", "mode": "versus"})
        threads.append(threading.Thread(target=host_worker, args=(code, tok), daemon=True))
        threads.append(threading.Thread(target=poller, args=(code, tok, 0), daemon=True))
        threads.append(threading.Thread(target=poller, args=(code, g["token"], 0), daemon=True))
        threads.append(threading.Thread(target=guest_actor, args=(code, g["token"]), daemon=True))
    for t in threads:
        t.start()

    print(f"simulating {N_ROOMS} rooms x 2 players for {DURATION}s ...")
    t0 = time.time()
    while time.time() - t0 < DURATION:
        time.sleep(2)
        with lock:
            print(f"  t={time.time()-t0:5.1f}s  polls={counts['polls']:6d}  "
                  f"events={counts['events']:8d}  errors={counts['errors']}")
    stop.set()
    time.sleep(1.5)

    s = sorted(lat)
    p50 = s[int(len(s) * 0.50)] * 1000 if s else 0
    p95 = s[int(len(s) * 0.95)] * 1000 if s else 0
    mx = s[-1] * 1000 if s else 0
    with lock:
        print(f"\nRESULT  polls={counts['polls']}  publishes={counts['publishes']}  "
              f"errors={counts['errors']}")
        print(f"RESULT  events relayed={counts['events']}")
        print(f"RESULT  poll latency  p50={p50:.1f}ms  p95={p95:.1f}ms  max={mx:.1f}ms")
    print("PASS" if counts["errors"] == 0 else "FAIL (errors above)")

main()
