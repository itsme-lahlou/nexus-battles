'use strict';
/* ============================================================
   CYBER DEFENSE: NEXUS — mp.js · 1v1 VERSUS BATTLES
   Two players, two maps, two Nexuses, two economies.
   Each round the baseline wave hits BOTH maps, and each player
   spends coins on towers OR on enemy packs sent at the rival.
   Sending also grows your income (extra coins every round).
   Last Nexus standing wins.
   Host simulates both boards; guest sends actions and renders
   interpolated snapshots. Requires server.py on the LAN.
   ============================================================ */

/* ========================= CONFIG ========================= */
const W = 780, H = 520;                        // logical world — stretched to fill each board
function buildRoute() {
  const y1 = Math.round(H * 0.21), y2 = Math.round(H * 0.5), y3 = Math.round(H * 0.79);
  const xR = W - 120, xL = 120;
  WAYPOINTS = [[-40, y1], [xR, y1], [xR, y2], [xL, y2], [xL, y3], [W - 80, y3]];
  NEXUS.x = W - 80; NEXUS.y = y3;
  rebuildPath();
  buildScenery();
}

function rebuildPath() {
  PATH.segs.length = 0; PATH.total = 0;
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const [x1, y1] = WAYPOINTS[i], [x2, y2] = WAYPOINTS[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    PATH.segs.push({ x1, y1, x2, y2, len, start: PATH.total, angle: Math.atan2(y2 - y1, x2 - x1) });
    PATH.total += len;
  }
}                        // world tuned to the split-view frames
const OWNER_COLORS = ['#5fd4ff', '#ff8ade'];   // P1 cyan, P2 magenta

const TOWER_TYPES = {
  pulse:  { key: 'pulse',  name: 'PULSE CANNON',  cost: 100, damage: 14, range: 135, rate: 1.15, projSpeed: 460, splash: 0,  color: '#19d3ff', desc: 'BALANCED DEFENSE' },
  laser:  { key: 'laser',  name: 'LASER NODE',    cost: 180, damage: 5,  range: 125, rate: 4.5,  projSpeed: 0,   splash: 0,  color: '#b366ff', desc: 'RAPID FIRE BEAM' },
  plasma: { key: 'plasma', name: 'PLASMA CANNON', cost: 300, damage: 42, range: 155, rate: 0.45, projSpeed: 280, splash: 60, color: '#ff8c1a', desc: 'HEAVY SPLASH DAMAGE' },
};
const UPGRADE_COSTS = [100, 200];
const SELL_RATE = 0.7;

const ENEMY_TYPES = {
  scout: { key: 'scout', name: 'SCOUT DRONE', hp: 40,  speed: 90,  r: 10, reward: 8,   dmg: 4 },
  speed: { key: 'speed', name: 'SPEED DRONE', hp: 26,  speed: 165, r: 8,  reward: 10,  dmg: 4 },
  tank:  { key: 'tank',  name: 'ARMORED TANK', hp: 160, speed: 46,  r: 15, reward: 20,  dmg: 12 },
  elite: { key: 'elite', name: 'ELITE UNIT',   hp: 115, speed: 72,  r: 13, reward: 32,  dmg: 10 },
  boss:  { key: 'boss',  name: 'OMEGA TITAN',  hp: 700, speed: 32,  r: 24, reward: 120, dmg: 40, boss: true },
};

// attack packs: bought by you, spawned on your rival's map.
// income = extra coins you earn at the end of every round (persists).
const PACKS = {
  swarm: { name: 'SCOUT SWARM', cost: 60,  type: 'scout', count: 8, gap: 0.35, inc: 2,  minWave: 1, color: '#ff9a4d' },
  speed: { name: 'SPEED SQUAD', cost: 95,  type: 'speed', count: 6, gap: 0.28, inc: 3,  minWave: 2, color: '#ffd23d' },
  tank:  { name: 'TANK PAIR',   cost: 120, type: 'tank',  count: 2, gap: 1.0,  inc: 4,  minWave: 3, color: '#9fb2d8' },
  elite: { name: 'ELITE DUO',   cost: 170, type: 'elite', count: 2, gap: 0.9,  inc: 6,  minWave: 4, color: '#c05cff' },
  boss:  { name: 'BOSS RUSH',   cost: 320, type: 'boss',  count: 1, gap: 1,    inc: 10, minWave: 5, color: '#ff5964' },
};
const SEND_CAP = 18;          // max enemies queued on one board at once
const START_COINS = 250, START_HP = 150, COUNTDOWN_TIME = 4;
const MAX_ROUND = 30;         // if both survive this long, higher HP wins

/* ========================= SOUND ========================= */
const Sound = {
  ctx: null, master: null, enabled: true, last: {},
  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      } catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(o) {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + (o.delay || 0), dur = o.dur || 0.15;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + dur);
    g.gain.setValueAtTime(o.vol || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.03);
  },
  noise(dur, vol, freq) {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx, len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq || 800;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
  },
  play(name) {
    if (!this.enabled || !this.ctx) return;
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < 55) return;
    this.last[name] = now;
    switch (name) {
      case 'shoot':   this.tone({ f: 760, f2: 180, type: 'square', dur: 0.09, vol: 0.045 }); break;
      case 'laser':   this.tone({ f: 1500, f2: 900, type: 'sawtooth', dur: 0.05, vol: 0.028 }); break;
      case 'plasma':  this.tone({ f: 170, f2: 50, type: 'sawtooth', dur: 0.3, vol: 0.12 }); break;
      case 'boom':    this.noise(0.22, 0.13, 700); break;
      case 'bigboom': this.noise(0.5, 0.25, 420); this.tone({ f: 120, f2: 38, type: 'sine', dur: 0.5, vol: 0.2 }); break;
      case 'coin':    this.tone({ f: 988, dur: 0.06, vol: 0.05, type: 'square' });
                      this.tone({ f: 1319, dur: 0.09, vol: 0.05, type: 'square', delay: 0.06 }); break;
      case 'buy':     this.tone({ f: 523, f2: 784, dur: 0.14, vol: 0.08, type: 'triangle' }); break;
      case 'upgrade': [523, 659, 880].forEach((f, i) => this.tone({ f, dur: 0.09, vol: 0.07, type: 'triangle', delay: i * 0.07 })); break;
      case 'sell':    this.tone({ f: 784, f2: 392, dur: 0.16, vol: 0.07, type: 'triangle' }); break;
      case 'send':    this.tone({ f: 220, f2: 440, type: 'square', dur: 0.14, vol: 0.08 }); break;
      case 'wave':    [440, 554].forEach((f, i) => this.tone({ f, f2: f * 1.4, type: 'sawtooth', dur: 0.22, vol: 0.06, delay: i * 0.25 })); break;
      case 'hit':     this.tone({ f: 130, f2: 55, type: 'sine', dur: 0.28, vol: 0.2 }); this.noise(0.15, 0.1, 300); break;
      case 'error':   this.tone({ f: 140, type: 'square', dur: 0.12, vol: 0.08 }); break;
      case 'click':   this.tone({ f: 700, dur: 0.04, vol: 0.04, type: 'square' }); break;
      case 'win':     [523, 659, 784, 1047].forEach((f, i) => this.tone({ f, type: 'triangle', dur: 0.25, vol: 0.1, delay: i * 0.16 })); break;
      case 'lose':    [392, 311, 233, 155].forEach((f, i) => this.tone({ f, type: 'sawtooth', dur: 0.4, vol: 0.1, delay: i * 0.3 })); break;
    }
  },
};

/* ========================= STATE ========================= */
function newBoard(seat, name) {
  return {
    seat, name: name || ('PLAYER ' + (seat + 1)),
    coins: START_COINS, coinsShown: START_COINS,
    hp: START_HP, income: 0, kills: 0,
    enemies: [], towers: [], projectiles: [], beams: [], particles: [],
    spawnQueue: [], spawnIdx: 0, waveTime: 0, cleared: true,
    sentQueue: [], sentCursor: 0,
    shake: 0, selTid: null, buildChoice: null,
    lastAct: 'BUILDING DEFENSES…',
    pend: { bm: [], bo: [], kl: [], sk: [], tx: [], sh: 0, nx: 0 },
  };
}

const state = {
  screen: 'menu',            // 'menu' | 'wait' | 'game'
  role: null,                // 'host' | 'guest'
  phase: 'idle',             // 'idle' | 'countdown' | 'wave' | 'gameover'
  time: 0, speed: 1, paused: false,
  wave: 0, countdown: 0, waveStarts: 0,
  boards: [newBoard(0), newBoard(1)],
  mySeat: 0,
  hover: { x: -999, y: -999 },
  lastCountNum: null, lastWaveStarts: 0,
  lastSyncAt: 0, warnedHostLost: false, warnedGuestLost: false,
  net: { code: null, token: null, seat: 0, since: 0,
    names: ['', ''], pollFail: 0, syncing: false, started: false, hadTwo: false },
};
let eidCounter = 0;

const $ = id => document.getElementById(id);
const cvMe = $('vs-cv-me'), ctxMe = cvMe.getContext('2d');
const cvOpp = $('vs-cv-opp'), ctxOpp = cvOpp.getContext('2d');

const hpVal = $('vs-head-me-hp'), coinsVal = $('vs-coins'), incomeVal = $('vs-income');
const roundVal = $('vs-round'), chipCoins = $('vs-chip-coins');
const meFill = $('vs-head-me-fill'), oppFill = $('vs-head-opp-fill');
const oppHpNum = $('vs-head-opp-hp');
const annEl = $('vs-announce'), annTitle = annEl.querySelector('.ann-title'), annSub = annEl.querySelector('.ann-sub');
const toastEl = $('vs-toast'), vignetteMe = $('vs-vignette-me'), vignetteOpp = $('vs-vignette-opp');

function myBoard() { return state.boards[state.net.seat]; }
function foeBoard() { return state.boards[1 - state.net.seat]; }
function isHost() { return state.role === 'host'; }

function canPlaceAt(b, x, y) {
  if (x < TOWER_R || x > W - TOWER_R || y < TOWER_R || y > H - TOWER_R) return false;
  if (Math.hypot(x - NEXUS.x, y - NEXUS.y) < 60) return false; // keep the Nexus clear
  for (const s of PATH.segs) { // keep the enemy road clear
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy;
    let t = ((x - s.x1) * dx + (y - s.y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    if (Math.hypot(x - (s.x1 + dx * t), y - (s.y1 + dy * t)) < PATH_CLEAR) return false;
  }
  for (const t of b.towers) {
    if (Math.hypot(t.x - x, t.y - y) < TOWER_CLEAR) return false;
  }
  return true;
}
function nameOf(seat) { return state.net.names[seat] || ('PLAYER ' + (seat + 1)); }
function ownerColor(seat) { return OWNER_COLORS[seat] || '#fff'; }

/* ========================= MAP ========================= */
let WAYPOINTS = [];
const PATH = { segs: [], total: 0 };
const NEXUS = { x: 0, y: 0 };

const TOWER_R = 24;    // tower footprint
const PATH_CLEAR = 52; // min distance from path centre-line (road half-width + tower)
const TOWER_CLEAR = 52; // min distance between towers

function posAtDist(d) {
  d = Math.max(0, Math.min(d, PATH.total));
  for (const s of PATH.segs) {
    if (d <= s.start + s.len) {
      const t = (d - s.start) / s.len;
      return { x: s.x1 + (s.x2 - s.x1) * t, y: s.y1 + (s.y2 - s.y1) * t, angle: s.angle };
    }
  }
  const s = PATH.segs[PATH.segs.length - 1];
  return { x: s.x2, y: s.y2, angle: s.angle };
}

function towerNear(b, x, y, r = 26) {
  let best = null, bd = r;
  for (const t of b.towers) {
    const d = Math.hypot(t.x - x, t.y - y);
    if (d <= bd) { best = t; bd = d; }
  }
  return best;
}
function towerById(b, tid) { return b.towers.find(t => t.tid === tid) || null; }
function isHost() { return state.role === 'host'; }

function canPlaceAt(b, x, y) {
  if (x < TOWER_R || x > W - TOWER_R || y < TOWER_R || y > H - TOWER_R) return false;
  if (Math.hypot(x - NEXUS.x, y - NEXUS.y) < 60) return false; // keep the Nexus clear
  for (const s of PATH.segs) { // keep the enemy road clear
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy;
    let t = ((x - s.x1) * dx + (y - s.y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    if (Math.hypot(x - (s.x1 + dx * t), y - (s.y1 + dy * t)) < PATH_CLEAR) return false;
  }
  for (const t of b.towers) {
    if (Math.hypot(t.x - x, t.y - y) < TOWER_CLEAR) return false;
  }
  return true;
}

/* ========================= ENTITIES ========================= */
class Enemy {
  constructor(board, type, hpMul, sent, sentBy) {
    this.eid = ++eidCounter;
    this.board = board;
    this.def = ENEMY_TYPES[type];
    this.type = type;
    this.hp = this.maxHp = Math.round(this.def.hp * hpMul);
    this.speed = this.def.speed *
      (1 + Math.min((state.wave - 1) * 0.035, 0.5)) *
      (0.88 + Math.random() * 0.28);
    this.radius = this.def.r;
    this.dist = 0;
    this.x = WAYPOINTS[0][0]; this.y = WAYPOINTS[0][1];
    this.angle = 0; this.flash = 0; this.seed = Math.random() * 100;
    this.sent = !!sent; this.sentBy = sentBy;
    this.alive = true;
  }
  update(dt) {
    if (!this.alive) return;
    this.dist += this.speed * dt;
    this.flash = Math.max(0, this.flash - dt);
    if (this.dist >= PATH.total) { this.reachNexus(); return; }
    const p = posAtDist(this.dist);
    this.x = p.x; this.y = p.y; this.angle = p.angle;
  }
  damage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    this.flash = 0.09;
    if (Math.random() < 0.4) spawnText(this.board, this.x + (Math.random() * 14 - 7), this.y - this.radius - 6, String(Math.round(amount)), '#cfefff', 11);
    if (this.hp <= 0) this.die();
  }
  die() {
    this.alive = false;
    this.board.kills++;
    addCoins(this.board, this.def.reward);
    explode(this.board, this.x, this.y, this.bodyColor(), this.def.boss ? 30 : 8 + Math.floor(this.radius), this.def.boss ? 220 : 130, this.def.boss ? 5 : 3);
    Sound.play(this.def.boss ? 'bigboom' : 'boom');
    if (this.def.boss) {
      this.board.shake = Math.max(this.board.shake, 3);
      announce((this.sent ? nameOf(this.sentBy) + "'S BOSS" : this.def.name) + ' DOWN', 'IN ' + nameOf(this.board.seat) + "'S BASE", 'good', 1600);
    }
    pend(this.board).kl.push([r1(this.x), r1(this.y), this.def.reward, this.bodyColor(), this.sent ? 1 : 0]);
  }
  bodyColor() {
    return { scout: '#ff9a4d', speed: '#ffd23d', tank: '#9fb2d8', elite: '#c05cff', boss: '#ff5964' }[this.type];
  }
  reachNexus() {
    this.alive = false;
    damageBoard(this.board, this.def.dmg, this.sent, this.sentBy);
  }
}

let tidCounter = 0;
class Tower {
  constructor(x, y, type, owner) {
    this.tid = ++tidCounter;
    this.def = TOWER_TYPES[type];
    this.type = type;
    this.owner = owner;
    this.x = x; this.y = y;
    this.level = 1;
    this.damage = this.def.damage;
    this.range = this.def.range;
    this.fireDelay = 1 / this.def.rate;
    this.cooldown = 0;
    this.angle = -Math.PI / 2;
    this.invested = this.def.cost;
    this.kills = 0;
    this.recoil = 0;
  }
  update(b, dt) {
    this.cooldown -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 5);
    const target = this.acquireTarget(b);
    if (target) {
      const want = Math.atan2(target.y - this.y, target.x - this.x);
      let d = want - this.angle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.angle += d * Math.min(1, dt * 10);
      if (this.cooldown <= 0) {
        this.fire(b, target);
        this.cooldown = this.fireDelay;
      }
    }
  }
  acquireTarget(b) {
    let best = null;
    for (const e of b.enemies) {
      if (!e.alive) continue;
      if (Math.hypot(e.x - this.x, e.y - this.y) > this.range + e.radius) continue;
      if (!best || e.dist > best.dist) best = e;
    }
    return best;
  }
  muzzle() {
    return { x: this.x + Math.cos(this.angle) * 16, y: this.y + Math.sin(this.angle) * 16 };
  }
  fire(b, target) {
    const m = this.muzzle();
    b.particles.push(new Particle({ kind: 'flash', x: m.x, y: m.y, size: 9, color: this.def.color, life: 0.1 }));
    if (this.type === 'laser') {
      target.damage(this.damage);
      b.beams.push({ x1: m.x, y1: m.y, x2: target.x, y2: target.y, life: 0.08, maxLife: 0.08, color: this.def.color });
      b.pend.bm.push([r1(m.x), r1(m.y), r1(target.x), r1(target.y), this.def.color]);
      Sound.play('laser');
    } else {
      b.projectiles.push(new Projectile(m.x, m.y, target, this));
      b.pend.sk.push([r1(m.x), r1(m.y), this.type === 'plasma' ? 'plasma' : 'shoot']);
      Sound.play(this.type === 'plasma' ? 'plasma' : 'shoot');
      this.recoil = 1;
    }
  }
  sellValue() { return Math.round(this.invested * SELL_RATE); }
}

class Projectile {
  constructor(x, y, target, tower) {
    this.x = x; this.y = y;
    this.target = target; this.tower = tower;
    this.speed = tower.def.projSpeed;
    this.damage = tower.damage;
    this.splash = tower.def.splash;
    this.color = tower.def.color;
    this.tx = target.x; this.ty = target.y;
    this.px = x; this.py = y;
    this.dead = false;
    this.life = 3;
  }
  update(b, dt) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    if (this.target && this.target.alive) { this.tx = this.target.x; this.ty = this.target.y; }
    const dx = this.tx - this.x, dy = this.ty - this.y;
    const d = Math.hypot(dx, dy);
    const hitR = (this.target && this.target.alive) ? this.target.radius * 0.7 + 3 : 3;
    const step = this.speed * dt;
    if (d <= step + hitR) { this.x = this.tx; this.y = this.ty; this.impact(b); return; }
    this.px = this.x; this.py = this.y;
    this.x += dx / d * step;
    this.y += dy / d * step;
  }
  impact(b) {
    this.dead = true;
    if (this.splash > 0) {
      for (const e of b.enemies) {
        if (!e.alive) continue;
        const dist = Math.hypot(e.x - this.x, e.y - this.y);
        if (dist <= this.splash + e.radius) {
          e.damage(this.damage * (1 - 0.6 * Math.min(1, dist / this.splash)));
        }
      }
      explode(b, this.x, this.y, this.color, 16, 170, 3.5);
      b.particles.push(new Particle({ kind: 'ring', x: this.x, y: this.y, size: this.splash + 8, color: this.color, life: 0.3 }));
      Sound.play('boom');
    } else if (this.target && this.target.alive) {
      this.target.damage(this.damage);
      b.particles.push(new Particle({ kind: 'flash', x: this.x, y: this.y, size: 7, color: this.color, life: 0.1 }));
    }
  }
}

class Particle {
  constructor(o) {
    Object.assign(this, { kind: 'spark', x: 0, y: 0, vx: 0, vy: 0, drag: 1, life: 0.5, size: 3, color: '#fff', text: '' }, o);
    this.maxLife = this.life;
    this.dead = false;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.drag !== 1) {
      const f = Math.pow(this.drag, dt * 60);
      this.vx *= f; this.vy *= f;
    }
  }
}

function r1(v) { return Math.round(v * 10) / 10; }
function pend(b) { return b.pend; }

function explode(b, x, y, color, count = 12, power = 130, size = 3) {
  if (b.particles.length > 320) count = Math.min(count, 5);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = power * (0.3 + Math.random() * 0.7);
    b.particles.push(new Particle({
      kind: 'spark', x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.88,
      life: 0.3 + Math.random() * 0.4,
      size: size * (0.6 + Math.random() * 0.8),
      color: i % 3 === 0 ? '#ffffff' : color,
    }));
  }
  b.particles.push(new Particle({ kind: 'ring', x, y, size: 24 + size * 4, color, life: 0.32 }));
  b.particles.push(new Particle({ kind: 'flash', x, y, size: 14 + size * 2, color: '#ffffff', life: 0.12 }));
  b.pend.bo.push([r1(x), r1(y), color, size]);
}

function spawnText(b, x, y, text, color, size = 12) {
  if (b.particles.length > 380) return;
  b.particles.push(new Particle({ kind: 'text', x, y, vx: 0, vy: -34, life: 0.75, text, color, size }));
}

/* ========================= ECONOMY ========================= */
function addCoins(b, n) {
  b.coins += n;
  Sound.play('coin');
  if (b.seat === state.net.seat) bumpEl(chipCoins);
}

function spendCoins(b, n) { b.coins -= n; }

function damageBoard(b, dmg, sent, sentBy) {
  if (state.phase === 'gameover') return;
  b.hp = Math.max(0, b.hp - dmg);
  explode(b, NEXUS.x, NEXUS.y, '#ff4d5e', 10, 120, 3);
  spawnText(b, NEXUS.x, NEXUS.y - 40, '-' + dmg, '#ff6b6b', 15);
  b.pend.nx = (b.pend.nx || 0) + dmg;
  Sound.play('hit');
  if (sent && isHost()) announce(nameOf(sentBy) + ' IS RUSHING ' + nameOf(b.seat) + '!', 'DEFEND!', 'bad', 1300);
  if (b.hp <= 0) gameOver(1 - b.seat);
}

let toastTimer = null;
function toastMsg(text, cls = '') {
  toastEl.textContent = text;
  toastEl.className = 'show ' + cls;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = ''; }, 1400);
}

function deny(msg) { toastMsg(msg); Sound.play('error'); }

let annTimer = null;
function announce(title, sub = '', cls = '', hold = 1500) {
  annTitle.textContent = title;
  annSub.textContent = sub;
  annEl.className = 'show ' + cls;
  clearTimeout(annTimer);
  if (hold > 0) annTimer = setTimeout(() => { annEl.className = ''; }, hold);
  if (isHost() && hold > 0) hostPublish('ann', { title, sub, cls, hold });
}
function hideAnnounce() { clearTimeout(annTimer); annEl.className = ''; }

function popDigit() {
  annSub.classList.remove('pop');
  void annSub.offsetWidth;
  annSub.classList.add('pop');
}

function shakeEl(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

function bumpEl(el) {
  if (!el) return;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

/* ========================= ROUNDS (host authority) ========================= */
// gentle intro: flat HP for the first 3 rounds, then it compounds
function hpMultiplier(n) {
  if (n <= 3) return 1;
  return 1 + (n - 3) * 0.15 + Math.pow(n - 3, 1.6) * 0.04;
}

function buildWave(n) {
  const q = []; let t = 0;
  const add = (type, count, gap) => { for (let i = 0; i < count; i++) { q.push({ type, t }); t += gap; } };
  // progressive difficulty: easy warm-up, new enemy taught one at a time,
  // then the ramp kicks in from round 4 (bosses only come from sends)
  if (n <= 3) {
    add('scout', 5 + n * 2, 0.55);            // r1: 7 · r2: 9 · r3: 11
  } else {
    add('scout', Math.min(10 + n * 3, 40), 0.42);
    add('speed', Math.min(n - 2, 16), 0.36);
  }
  if (n === 3) add('speed', 3, 0.4);          // meet the speed drone
  if (n === 5) add('tank', 1, 1.5);           // meet the tank
  if (n >= 6) add('tank', Math.min(Math.floor(n / 2) - 1, 8), 1.4);
  if (n >= 8) add('elite', Math.min(Math.floor((n - 5) / 2), 6), 1.1);
  return q; // bosses only arrive because a player sent them
}

function spawnEnemy(b, type, sent, sentBy) {
  const e = new Enemy(b, type, hpMultiplier(state.wave), sent, sentBy);
  b.enemies.push(e);
}

function beginCountdown(n) {
  state.wave = n;
  state.phase = 'countdown';
  state.countdown = n === 1 ? COUNTDOWN_TIME + 1 : 3.5;
  state.lastCountNum = null;
}

function startWave() {
  state.phase = 'wave';
  state.waveStarts++;
  for (const b of state.boards) {
    b.waveTime = 0;
    b.spawnIdx = 0;
    b.spawnQueue = buildWave(state.wave);
    b.sentCursor = 0;
    b.cleared = false;
  }
  hideAnnounce();
  announce('ROUND ' + state.wave, 'DEFEND · ATTACK · PROSPER', 'warn', 1500);
  Sound.play('wave');
}

function completeRound() {
  const bonusBase = 80 + state.wave * 15;
  for (const b of state.boards) {
    const total = bonusBase + b.income * 12;
    addCoins(b, total);
    if (b.seat === state.net.seat) announce('ROUND COMPLETE', '+' + total + ' COINS', 'good', 1800);
    b.lastAct = 'EARNED +' + total;
  }
  Sound.play('coin');
  hostPublish('act', { seat: -1, str: 'round ' + state.wave + ' complete' });
  // stalemate breaker: past the final round, the healthier Nexus takes it
  if (state.wave >= MAX_ROUND) {
    const [a, b] = state.boards;
    gameOver(a.hp === b.hp ? -1 : (a.hp > b.hp ? 0 : 1));
    return;
  }
  beginCountdown(state.wave + 1);
}

function updateBoard(b, dt) {
  b.waveTime += dt;
  const q = b.spawnQueue;
  while (b.spawnIdx < q.length && q[b.spawnIdx].t <= b.waveTime) {
    spawnEnemy(b, q[b.spawnIdx].type, false, -1);
    b.spawnIdx++;
  }
  // enemies sent by the rival
  while (b.sentQueue.length && b.sentQueue[0].at <= b.waveTime) {
    const s = b.sentQueue.shift();
    spawnEnemy(b, s.type, true, s.sentBy);
  }
  for (const e of b.enemies) e.update(dt);
  b.enemies = b.enemies.filter(e => e.alive);
  for (const t of b.towers) t.update(b, dt);
  for (const p of b.projectiles) p.update(b, dt);
  b.projectiles = b.projectiles.filter(p => !p.dead);
  if (b.spawnIdx >= q.length && b.sentQueue.length === 0 && b.enemies.length === 0) {
    b.cleared = true;
  }
}

/* ========================= ACTIONS ========================= */
function applyAction(a, seat) {
  if (state.phase === 'gameover' || state.phase === 'idle') return;
  const b = state.boards[seat];
  if (!b || !a) return; // echoes / stale events carry no board seat
  if (a.op === 'send') { applySend(seat, a.pack); return; }
  if (a.op === 'build') {
    const def = TOWER_TYPES[a.tower];
    if (!def) return;
    if (!canPlaceAt(b, a.x, a.y)) return deny('CAN\u2019T BUILD THERE');
    if (b.coins < def.cost) return deny('NOT ENOUGH COINS');
    spendCoins(b, def.cost);
    const t = new Tower(a.x, a.y, a.tower, seat);
    b.towers.push(t);
    b.particles.push(new Particle({ kind: 'ring', x: t.x, y: t.y, size: 42, color: ownerColor(seat), life: 0.45 }));
    spawnText(b, t.x, t.y - 28, '-' + def.cost, '#ff6b6b', 12);
    Sound.play('buy');
    noteAction(seat, 'built ' + def.name);
  } else if (a.op === 'upgrade') {
    const t = towerById(b, a.tid);
    if (!t) return;
    if (t.level >= 3) return deny('ALREADY MAX LEVEL');
    const cost = UPGRADE_COSTS[t.level - 1];
    if (b.coins < cost) return deny('NOT ENOUGH COINS');
    spendCoins(b, cost);
    t.invested += cost;
    t.damage *= 1.45; t.range *= 1.15; t.fireDelay /= 1.18;
    if (a.stat === 'damage') t.damage *= 1.3;
    if (a.stat === 'range') t.range *= 1.2;
    if (a.stat === 'speed') t.fireDelay /= 1.25;
    t.level++;
    b.particles.push(new Particle({ kind: 'ring', x: t.x, y: t.y, size: 44, color: ownerColor(seat), life: 0.45 }));
    spawnText(b, t.x, t.y - 30, 'UPGRADED! LV ' + t.level, '#ffd54a', 14);
    Sound.play('upgrade');
    noteAction(seat, 'upgraded ' + t.def.name + ' → LV ' + t.level);
  } else if (a.op === 'sell') {
    const t = towerById(b, a.tid);
    if (!t) return;
    addCoins(b, t.sellValue());
    noteAction(seat, 'sold ' + t.def.name + ' (+' + t.sellValue() + ')');
    b.particles.push(new Particle({ kind: 'ring', x: t.x, y: t.y, size: 36, color: ownerColor(seat), life: 0.4 }));
    b.towers.splice(b.towers.indexOf(t), 1);
    Sound.play('sell');
  }
  updateInspector();
}

// in versus, each board has its own pads — pads are per-board, so two
// players can legally build on the same pad index on their own maps
function applySend(seat, packKey) {
  const p = PACKS[packKey];
  if (!p) return;
  if (state.wave < p.minWave) return deny(p.name + ' UNLOCKS AT ROUND ' + p.minWave);
  const sender = state.boards[seat];
  const target = state.boards[1 - seat];
  if (sender.coins < p.cost) return deny('NOT ENOUGH COINS');
  if (target.sentQueue.length + p.count > SEND_CAP) return deny('RIVAL IS ALREADY OVERWHELMED');
  spendCoins(sender, p.cost);
  sender.income += p.inc;
  let at = (state.phase === 'wave') ? Math.max(target.sentCursor, target.waveTime) : target.sentCursor;
  for (let i = 0; i < p.count; i++) {
    at += p.gap;
    target.sentQueue.push({ type: p.type, at, sentBy: seat });
  }
  target.sentCursor = at;
  Sound.play('send');
  noteAction(seat, 'sent ' + p.name + ' (income +' + p.inc + ')');
  if (p.type === 'boss') {
    announce(nameOf(seat).toUpperCase() + ' SENT A BOSS!', nameOf(1 - seat).toUpperCase() + ' — INCOMING!', 'bad', 2000);
  }
}

function noteAction(seat, str) {
  const b = state.boards[seat];
  if (b) b.lastAct = (seat === state.net.seat ? 'YOU ' : nameOf(seat) + ' ') + str;
  if (isHost()) hostPublish('act', { seat, str: b ? b.lastAct : str });
  updateConsoles();
}

function publishAction(data) {
  if (isHost()) { applyAction(data, state.net.seat); return; }
  api('publish', { code: state.net.code, token: state.net.token, type: 'act', data }).catch(() => {});
}

/* ========================= NET ========================= */
async function api(path, body) {
  const res = await fetch('/api/' + path, body !== undefined ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : undefined);
  if (!res.ok) {
    const err = new Error('api ' + path);
    err.status = res.status;
    err.payload = await res.json().catch(() => ({}));
    throw err;
  }
  return res.json();
}

function hostPublish(type, data) {
  if (!state.net.code) return;
  api('publish', { code: state.net.code, token: state.net.token, type, data }).catch(() => {});
}

function buildSync() {
  const snaps = [snapBoard(state.boards[0]), snapBoard(state.boards[1])];
  // sh/nx are accumulators (unlike the spliced arrays) — clear after snapshot
  // or the guest replays the same damage/shake on every sync forever
  for (const b of state.boards) {
    b.pend.sh = 0;
    b.pend.nx = 0;
  }
  return {
    type: 'sync',
    wave: state.wave,
    phase: state.phase,
    cd: state.phase === 'countdown' ? r1(state.countdown) : 0,
    paused: state.paused,
    wstart: state.waveStarts,
    names: state.net.names,
    b: snaps,
  };
}

function snapBoard(b) {
  const q = {};
  for (const s of b.sentQueue) q[s.type] = (q[s.type] || 0) + 1;
  return {
    coins: Math.round(b.coins),
    hp: Math.max(0, Math.ceil(b.hp)),
    income: b.income,
    kills: b.kills,
    lastAct: b.lastAct,
    q,
    towers: b.towers.map(t => ({
      id: t.tid, x: r1(t.x), y: r1(t.y), ty: t.type, lv: t.level,
      d: r1(t.damage), r: Math.round(t.range), f: r1(1 / t.fireDelay),
      k: t.kills, inv: t.invested, a: r1(t.angle),
    })),
    enemies: b.enemies.map(e => ({
      id: e.eid, ty: e.type, d: r1(e.dist), s: r1(e.speed),
      hp: Math.max(0, Math.ceil(e.hp)), m: e.maxHp,
      st: e.sent ? (e.sentBy + 1) : 0,
    })),
    fx: {
      bm: b.pend.bm.splice(0, 20),
      bo: b.pend.bo.splice(0, 24),
      kl: b.pend.kl.splice(0, 24),
      sk: b.pend.sk.splice(0, 24),
      tx: b.pend.tx.splice(0, 20),
      sh: b.pend.sh, nx: b.pend.nx,
    },
  };
}

function flushPend() {
  for (const b of state.boards) {
    b.pend.bm.length = 0; b.pend.bo.length = 0; b.pend.kl.length = 0;
    b.pend.sk.length = 0; b.pend.tx.length = 0; b.pend.sh = 0; b.pend.nx = 0;
  }
}

function applySync(s) {
  state.lastSyncAt = performance.now();
  state.warnedHostLost = false;
  state.wave = s.wave;
  state.names = s.names;

  s.b.forEach((snap, seat) => {
    const b = state.boards[seat];
    b.coins = snap.coins;
    b.hp = snap.hp;
    b.income = snap.income;
    b.kills = snap.kills;
    b.lastAct = snap.lastAct || b.lastAct;
    b.pendingQueue = snap.q || {};

    b.towers = snap.towers.map(st => {
      const t = new Tower(st.x, st.y, st.ty, seat);
      t.tid = st.id;
      t.level = st.lv;
      t.damage = st.d; t.range = st.r; t.fireDelay = 1 / Math.max(0.01, st.f);
      t.kills = st.k; t.invested = st.inv; t.angle = st.a;
      return t;
    });

    // merge enemies by id, interpolating distance
    const seen = new Set();
    for (const se of snap.enemies) {
      seen.add(se.id);
      let e = b.enemies.find(x => x.eid === se.id);
      if (!e) {
        e = {
          eid: se.id, type: se.ty, def: ENEMY_TYPES[se.ty],
          radius: ENEMY_TYPES[se.ty].r, d: se.d, speed: se.s,
          hp: se.hp, maxHp: se.m, alive: true, sent: se.st > 0, sentBy: se.st - 1,
          flash: 0, seed: Math.random() * 100, x: -99, y: -99, angle: 0,
        };
        b.enemies.push(e);
      } else {
        e.speed = se.s; e.hp = se.hp; e.maxHp = se.m;
        e.d += (se.d - e.d) * 0.35;
      }
    }
    b.enemies = b.enemies.filter(e => seen.has(e.eid));
    for (const e of b.enemies) {
      e.d = Math.min(e.d, PATH.total);
      const p = posAtDist(e.d);
      e.x = p.x; e.y = p.y; e.angle = p.angle;
    }

    // replay visual effects
    const fx = snap.fx || {};
    for (const bm of (fx.bm || [])) {
      b.beams.push({ x1: bm[0], y1: bm[1], x2: bm[2], y2: bm[3], life: 0.08, maxLife: 0.08, color: bm[4] });
      Sound.play('laser');
    }
    for (const k of (fx.kl || [])) {
      explode(b, k[0], k[1], k[3], k[2] >= 120 ? 26 : 9, k[2] >= 120 ? 200 : 130, k[2] >= 120 ? 5 : 3);
      spawnText(b, k[0], k[1] - 14, '+' + k[2] + ' 🪙', '#ffd54a', 13);
      Sound.play(k[2] >= 120 ? 'bigboom' : 'boom');
      Sound.play('coin');
    }
    for (const bo of (fx.bo || [])) explode(b, bo[0], bo[1], bo[2], 7, 110, bo[3]);
    for (const sk of (fx.sk || [])) {
      b.particles.push(new Particle({ kind: 'flash', x: sk[0], y: sk[1], size: 9, color: '#ffffff', life: 0.1 }));
      Sound.play(sk[2]);
    }
    for (const tx of (fx.tx || [])) spawnText(b, tx[0], tx[1], tx[2], tx[3], tx[4]);
    if (fx.sh) b.shake = Math.max(b.shake, Math.min(fx.sh, 3));
    if (fx.nx) {
      explode(b, NEXUS.x, NEXUS.y, '#ff4d5e', 10, 120, 3);
      spawnText(b, NEXUS.x, NEXUS.y - 40, '-' + fx.nx, '#ff6b6b', 15);
      Sound.play('hit');
    }
    b.particles = b.particles.filter(p => !p.dead);
  });

  // phase transitions
  if (s.wstart !== state.lastWaveStarts) {
    state.lastWaveStarts = s.wstart;
    hideAnnounce();
    announce('ROUND ' + s.wave, 'DEFEND · ATTACK · PROSPER', 'warn', 1500);
    Sound.play('wave');
  }
  if (s.phase === 'countdown') {
    state.phase = 'countdown';
    state.countdown = s.cd;
    if (s.cd <= COUNTDOWN_TIME) {
      const n = Math.max(1, Math.ceil(s.cd));
      if (n !== state.lastCountNum) {
        state.lastCountNum = n;
        announce('ROUND ' + s.wave + ' INCOMING', String(n), 'count', 0);
        popDigit();
      }
    }
  } else if (state.phase === 'countdown' && s.phase !== 'countdown') {
    state.lastCountNum = null;
  }
  if (s.phase === 'wave') state.phase = 'wave';
  if (s.phase !== 'gameover' && state.phase === 'gameover') state.phase = 'wave';

  updateShopUI();
  updateAttackUI();
  updateInspector();
  updateConsoles();
}

let NET_SESSION = 0;

async function pollLoop() {
  if (!state.net.code) return;
  const session = state.net.session;
  try {
    const res = await api('events?code=' + state.net.code +
      '&token=' + state.net.token + '&since=' + state.net.since);
    if (state.net.session !== session) return; // superseded by a newer room
    state.net.pollFail = 0;
    state.net.since = res.events.length ? res.events[res.events.length - 1].seq : state.net.since;
    for (const ev of res.events) handleEvent(ev);
    if (res.seats) {
      state.net.names = ['', ''];
      for (const p of res.seats.players) state.net.names[p.seat] = p.name;
      if (state.screen === 'wait') {
        updateWaitScreen(res.seats.count);
        if (res.seats.count >= 2 && isHost() && !state.net.started) {
          state.net.started = true;
          state.net.hadTwo = true;
          startBattle();
        }
      }
      if (state.screen === 'game') {
        if (res.seats.count >= 2) state.net.hadTwo = true;
        if (res.seats.count < 2 && state.net.hadTwo && !state.warnedGuestLost && state.phase !== 'gameover') {
          state.warnedGuestLost = true;
          // rival left the match — remaining player takes the win
          if (isHost()) gameOver(state.net.seat);
        }
      }
    }
  } catch (e) {
    state.net.pollFail++;
    if (state.net.pollFail > 3 && state.screen === 'game' && !isHost() &&
        performance.now() - state.lastSyncAt > 8000 && !state.warnedHostLost &&
        state.phase !== 'gameover') {
      state.warnedHostLost = true;
      showGameOver({ winner: state.net.seat, reason: 'HOST LEFT' });
    }
  }
  if (state.net.code && state.net.session === session) setTimeout(pollLoop, 60);
}

function handleEvent(ev) {
  if (ev.type === 'sync' && !isHost()) { applySync(ev.data); return; }
  if (ev.type === 'act' && isHost()) { applyAction(ev.data, ev.seat); return; }
  if (ev.type === 'ann' && !isHost()) {
    announce(ev.data.title, ev.data.sub, ev.data.cls, ev.data.hold);
    return;
  }
  if (ev.type === 'world' && !isHost()) {
    buildRoute(ev.data.w, ev.data.h);
      return;
  }
  if (ev.type === 'start' && !isHost() && state.screen !== 'game') { startBattle(); return; }
  if (ev.type === 'over' && !isHost()) { showGameOver(ev.data); return; }
  if (ev.type === 'deny' && !isHost()) { deny(ev.data.msg); return; }
  if (ev.type === 'left') {
    toastMsg((ev.data && ev.data.name ? ev.data.name : 'RIVAL') + ' LEFT');
    return;
  }
}

let netAcc = 0;
function hostSyncTick(dt) {
  netAcc += dt;
  if (netAcc >= 0.1) {
    netAcc = 0;
    hostPublish('sync', buildSync());
  }
}

/* ========================= UI PANELS ========================= */
function updateShopUI() {
  const b = myBoard();
  document.querySelectorAll('#vs-shop .card').forEach(card => {
    const def = TOWER_TYPES[card.dataset.type];
    const afford = b.coins >= def.cost;
    card.classList.toggle('locked', !afford);
    card.classList.toggle('can-buy', afford);
    card.classList.toggle('selected', b.buildChoice === card.dataset.type);
  });
}

function updateAttackUI() {
  const me = myBoard(), foe = foeBoard();
  const q = foe.pendingQueue || {};
  document.querySelectorAll('#vs-attack .card').forEach(card => {
    const p = PACKS[card.dataset.pack];
    if (!p) return;
    const afford = me.coins >= p.cost && state.wave >= p.minWave;
    card.classList.toggle('locked', !afford);
    card.classList.toggle('can-buy', afford);
    const badge = card.querySelector('.card-queue');
    const n = q[p.type] || 0;
    badge.textContent = n > 0 ? '×' + n : '';
    badge.style.display = n > 0 ? 'flex' : 'none';
  });
}

function updateInspector() {
  const b = myBoard();
  const insp = $('vs-inspector');
  const t = b.selTid !== null ? towerById(b, b.selTid) : null;
  if (!t) { insp.classList.add("hidden"); return; }
  insp.classList.remove('hidden');
  const max = t.level >= 3;
  [['damage', 'DMG'], ['range', 'RNG'], ['speed', 'SPD']].forEach(([k, label]) => {
    const btn = $('vs-up-' + k);
    btn.disabled = max;
    btn.querySelector('.up-name').textContent = max ? label + ' MAX' : label;
    btn.querySelector('.up-cost').textContent = max ? 'MAX' : UPGRADE_COSTS[t.level - 1] + ' 🪙';
  });
  $('vs-btn-sell').textContent = 'SELL +' + t.sellValue();
}

function updateConsoles() {
  // board headers carry names; nothing else needed here
  $('vs-head-me-name').textContent = nameOf(state.net.seat) + ' (YOU)';
  $('vs-head-opp-name').textContent = nameOf(1 - state.net.seat);
}

/* ========================= INPUT ========================= */
function canvasPos(e, canvas) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}

function onMyCanvasClick(e) {
  if (state.screen !== 'game' || state.phase === 'gameover') return;
  Sound.ensure();
  const b = myBoard();
  const p = canvasPos(e, cvMe);
  const t = towerNear(b, p.x, p.y);
  if (t) {
    b.selTid = t.tid;
    b.buildChoice = null;
    updateShopUI(); updateInspector();
    Sound.play('click');
    return;
  }
  if (b.buildChoice) {
    publishAction({ op: 'build', x: r1(p.x), y: r1(p.y), tower: b.buildChoice });
    b.buildChoice = null;      // placed — deselect automatically
    updateShopUI();
    return;
  }
  b.selTid = null;
  updateInspector();
}

function onDefenseCardClick(type) {
  if (state.screen !== 'game' || state.phase === 'gameover') return;
  Sound.ensure();
  Sound.play('click');
  const b = myBoard();
  b.buildChoice = b.buildChoice === type ? null : type;
  b.selTid = null;
  updateShopUI(); updateInspector();
}

function onAttackCardClick(packKey) {
  if (state.screen !== 'game' || state.phase === 'gameover') return;
  Sound.ensure();
  const p = PACKS[packKey];
  if (state.wave < p.minWave) { deny(p.name + ' UNLOCKS AT ROUND ' + p.minWave); return; }
  publishAction({ op: 'send', pack: packKey });
}

/* ========================= UPDATE ========================= */
function updateHost(dt) {
  state.time += dt;
  for (const b of state.boards) {
    b.coinsShown += (b.coins - b.coinsShown) * Math.min(1, dt * 8);
    if (Math.abs(b.coins - b.coinsShown) < 0.6) b.coinsShown = b.coins;
    b.shake = Math.max(0, b.shake - dt * 22);
    if (b.pend.sh < b.shake) b.pend.sh = b.shake;
    for (const p of b.particles) p.update(dt);
    b.particles = b.particles.filter(p => !p.dead);
    for (const bm of b.beams) bm.life -= dt;
    b.beams = b.beams.filter(bm => bm.life > 0);
  }
  if (state.phase === 'gameover') return;

  if (state.phase === 'countdown') {
    state.countdown -= dt;
    if (state.countdown <= COUNTDOWN_TIME) {
      const n = Math.max(1, Math.ceil(state.countdown));
      if (n !== state.lastCountNum) {
        state.lastCountNum = n;
        announce('ROUND ' + state.wave + ' INCOMING', String(n), 'count', 0);
        popDigit();
      }
    }
    if (state.countdown <= 0) startWave();
  } else if (state.phase === 'wave') {
    updateBoard(state.boards[0], dt);
    updateBoard(state.boards[1], dt);
    if (state.boards[0].cleared && state.boards[1].cleared) completeRound();
  }
}

function updateGuest(dt) {
  state.time += dt;
  for (const b of state.boards) {
    b.coinsShown += (b.coins - b.coinsShown) * Math.min(1, dt * 8);
    if (Math.abs(b.coins - b.coinsShown) < 0.6) b.coinsShown = b.coins;
    b.shake = Math.max(0, b.shake - dt * 22);
    for (const p of b.particles) p.update(dt);
    b.particles = b.particles.filter(p => !p.dead);
    for (const bm of b.beams) bm.life -= dt;
    b.beams = b.beams.filter(bm => bm.life > 0);
  }
  if (state.phase === 'gameover') return;
  for (const b of state.boards) {
    for (const e of b.enemies) {
      e.d = Math.min(e.d + e.speed * dt, PATH.total);
      e.flash = Math.max(0, e.flash - dt);
      const p = posAtDist(e.d);
      e.x = p.x; e.y = p.y; e.angle = p.angle;
    }
  }
}

/* ========================= RENDER ========================= */
const STARS = [];
const NEBULAS = [];
const PLANETS = [];

function buildScenery() {
  STARS.length = 0;
  for (let i = 0; i < 130; i++) STARS.push({
    x: Math.random() * W, y: Math.random() * H,
    r: 0.6 + Math.random() * 1.5,
    tw: Math.random() * Math.PI * 2,
    sp: 0.6 + Math.random() * 1.8,
  });
  NEBULAS.length = 0;
  NEBULAS.push({ x: W * 0.27, y: H * 0.33, r: Math.min(W, H) * 0.42, c: 'rgba(124, 77, 255, 0.15)', dx: 5, dy: 3 });
  NEBULAS.push({ x: W * 0.72, y: H * 0.76, r: Math.min(W, H) * 0.46, c: 'rgba(0, 150, 199, 0.13)', dx: -4, dy: 4 });
  NEBULAS.push({ x: W * 0.5, y: H * 0.55, r: Math.min(W, H) * 0.3, c: 'rgba(255, 105, 220, 0.07)', dx: 4, dy: -5 });
  PLANETS.length = 0;
  PLANETS.push({ x: W * 0.06, y: H * 0.09, r: Math.min(W, H) * 0.05, c1: '#8ff0ff', c2: '#2b6fb0', ring: true });
  PLANETS.push({ x: W * 0.95, y: H * 0.12, r: Math.min(W, H) * 0.035, c1: '#ffd98a', c2: '#c77b3a', ring: false });
  PLANETS.push({ x: W * 0.96, y: H * 0.9, r: Math.min(W, H) * 0.03, c1: '#c9a0ff', c2: '#6a3fb5', ring: false });
}
let shooting = null;
let shootingTimer = 4;

function drawGrid(c, dt) {
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#101735');
  bg.addColorStop(0.55, '#0b1128');
  bg.addColorStop(1, '#080c1e');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  for (const n of NEBULAS) {
    const nx = n.x + Math.sin(state.time * 0.05 * n.dx) * 28;
    const ny = n.y + Math.cos(state.time * 0.05 * n.dy) * 18;
    const g = c.createRadialGradient(nx, ny, 0, nx, ny, n.r);
    g.addColorStop(0, n.c);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(nx - n.r, ny - n.r, n.r * 2, n.r * 2);
  }
  for (const p of PLANETS) {
    const g = c.createRadialGradient(p.x - p.r * 0.4, p.y - p.r * 0.4, p.r * 0.2, p.x, p.y, p.r);
    g.addColorStop(0, p.c1);
    g.addColorStop(1, p.c2);
    c.fillStyle = g;
    c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
    if (p.ring) {
      c.strokeStyle = 'rgba(255,255,255,0.4)';
      c.lineWidth = 3;
      c.beginPath();
      c.ellipse(p.x, p.y, p.r * 1.65, p.r * 0.5, -0.35, 0, Math.PI * 2);
      c.stroke();
    }
  }
  for (const s of STARS) {
    c.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(state.time * s.sp + s.tw));
    c.fillStyle = s.r > 1.4 ? '#cfeaff' : '#ffffff';
    c.beginPath(); c.arc(s.x, s.y, s.r, 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 1;
  shootingTimer -= dt;
  if (shootingTimer <= 0 && !shooting) {
    shooting = {
      x: W * 0.15 + Math.random() * W * 0.6, y: Math.random() * H * 0.3,
      vx: 320 + Math.random() * 160, vy: 110 + Math.random() * 70,
      life: 0.9,
    };
    shootingTimer = 6 + Math.random() * 7;
  }
  if (shooting) {
    shooting.life -= dt;
    shooting.x += shooting.vx * dt;
    shooting.y += shooting.vy * dt;
    c.strokeStyle = 'rgba(255,255,255,' + Math.max(0, shooting.life) * 0.8 + ')';
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(shooting.x, shooting.y);
    c.lineTo(shooting.x - shooting.vx * 0.13, shooting.y - shooting.vy * 0.13);
    c.stroke();
    if (shooting.life <= 0 || shooting.x > W + 80) shooting = null;
  }
}

function pathPolyline(c) {
  c.beginPath();
  c.moveTo(WAYPOINTS[0][0], WAYPOINTS[0][1]);
  for (let i = 1; i < WAYPOINTS.length; i++) c.lineTo(WAYPOINTS[i][0], WAYPOINTS[i][1]);
}

function drawPath(c) {
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = 'rgba(120, 190, 255, 0.13)';
  c.lineWidth = 48;
  pathPolyline(c); c.stroke();
  c.strokeStyle = '#1c2650';
  c.lineWidth = 40;
  pathPolyline(c); c.stroke();
  c.strokeStyle = 'rgba(130, 200, 255, 0.10)';
  c.lineWidth = 32;
  pathPolyline(c); c.stroke();
  c.strokeStyle = 'rgba(150, 215, 255, 0.6)';
  c.lineWidth = 3.5;
  c.setLineDash([3, 24]);
  c.lineDashOffset = -state.time * 55;
  pathPolyline(c); c.stroke();
  c.setLineDash([]);
  c.fillStyle = 'rgba(160, 220, 255, 0.42)';
  for (let d = 55; d < PATH.total; d += 90) {
    const p = posAtDist(d);
    const bounce = Math.sin(state.time * 4 + d * 0.05) * 1.6;
    c.save();
    c.translate(p.x, p.y + bounce);
    c.rotate(p.angle);
    c.beginPath();
    c.moveTo(6, 0); c.lineTo(-4, 6); c.lineTo(-1.5, 0); c.lineTo(-4, -6);
    c.closePath(); c.fill();
    c.restore();
  }
  for (let i = 0; i < 6; i++) {
    const d = (state.time * 90 + i * PATH.total / 6) % PATH.total;
    const p = posAtDist(d);
    const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, 11);
    g.addColorStop(0, 'rgba(190, 240, 255, 0.9)');
    g.addColorStop(1, 'rgba(190, 240, 255, 0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(p.x, p.y, 11, 0, Math.PI * 2); c.fill();
  }
}

function drawNexus(c, b) {
  const crit = b.hp <= 45;
  const pulse = 0.5 + 0.5 * Math.sin(state.time * (crit ? 6 : 2.2));
  const glowCol = crit ? 'rgba(255, 90, 110, 0.4)' : 'rgba(110, 220, 255, 0.3)';
  const g = c.createRadialGradient(NEXUS.x, NEXUS.y, 4, NEXUS.x, NEXUS.y, 74);
  g.addColorStop(0, glowCol);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.beginPath(); c.arc(NEXUS.x, NEXUS.y, 74, 0, Math.PI * 2); c.fill();

  c.save();
  c.translate(NEXUS.x, NEXUS.y);
  c.rotate(-0.35);
  c.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  c.lineWidth = 5;
  c.beginPath();
  c.ellipse(0, 0, 40, 13, 0, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = 'rgba(160, 230, 255, 0.5)';
  c.lineWidth = 2;
  c.beginPath();
  c.ellipse(0, 0, 45, 15.5, 0, 0, Math.PI * 2);
  c.stroke();
  c.rotate(0.35);
  const body = c.createRadialGradient(-8, -9, 4, 0, 0, 26);
  if (crit) {
    body.addColorStop(0, '#ffd3d8');
    body.addColorStop(0.5, '#ff6b7a');
    body.addColorStop(1, '#b32036');
  } else {
    body.addColorStop(0, '#d9f7ff');
    body.addColorStop(0.5, '#5fd4ff');
    body.addColorStop(1, '#2570c9');
  }
  c.fillStyle = body;
  c.beginPath(); c.arc(0, 0, 25 + pulse * 1.5, 0, Math.PI * 2); c.fill();
  c.lineWidth = 3;
  c.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  c.stroke();
  // this nexus belongs to someone — tint the smile
  c.fillStyle = '#123055';
  c.beginPath(); c.arc(-8, -4, 3.2, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(8, -4, 3.2, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#123055';
  c.lineWidth = 2.4;
  c.lineCap = 'round';
  c.beginPath();
  if (crit) c.arc(0, 12, 6, Math.PI * 1.15, Math.PI * 1.85);
  else c.arc(0, 6, 7, Math.PI * 0.15, Math.PI * 0.85);
  c.stroke();
  c.fillStyle = crit ? 'rgba(255, 120, 140, 0.5)' : 'rgba(255, 140, 190, 0.4)';
  c.beginPath(); c.arc(-14, 4, 3.4, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(14, 4, 3.4, 0, Math.PI * 2); c.fill();
  for (let i = 0; i < 3; i++) {
    const a = state.time * 1.2 + i / 3 * Math.PI * 2;
    c.fillStyle = 'rgba(255, 255, 255, 0.85)';
    c.beginPath();
    c.arc(Math.cos(a) * 46, Math.sin(a) * 17, 2.2, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();

  const bw = 58, ratio = Math.max(0, b.hp / START_HP);
  c.fillStyle = 'rgba(8, 14, 30, 0.85)';
  c.beginPath();
  c.roundRect(NEXUS.x - bw / 2, NEXUS.y + 40, bw, 8, 4);
  c.fill();
  c.fillStyle = ratio > 0.5 ? '#5ded9f' : ratio > 0.25 ? '#ffd54a' : '#ff6b6b';
  c.beginPath();
  c.roundRect(NEXUS.x - bw / 2, NEXUS.y + 40, Math.max(3, bw * ratio), 8, 4);
  c.fill();
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
}

function drawEyes(c, cx, cy, lookAngle, size, spacing, angry = false) {
  const px = Math.cos(lookAngle + Math.PI / 2);
  const py = Math.sin(lookAngle + Math.PI / 2);
  for (const side of [-1, 1]) {
    const x = cx + px * spacing * side;
    const y = cy + py * spacing * side;
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(x, y, size, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#1b2438';
    c.beginPath();
    c.arc(x + Math.cos(lookAngle) * size * 0.38, y + Math.sin(lookAngle) * size * 0.38,
      size * 0.48, 0, Math.PI * 2);
    c.fill();
    if (angry) {
      c.strokeStyle = '#1b2438';
      c.lineWidth = size * 0.34;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x - size * 0.85, y - size * 1.2 + side * size * 0.35);
      c.lineTo(x + size * 0.85, y - size * 1.2 - side * size * 0.35);
      c.stroke();
    }
  }
}

function drawEnemy(c, e) {
  const bob = Math.sin(state.time * 8 + e.seed) * 1.8;
  const y = e.y + bob;
  c.fillStyle = 'rgba(0, 0, 0, 0.3)';
  c.beginPath();
  c.ellipse(e.x, e.y + e.radius * 0.9, e.radius * 0.9, e.radius * 0.35, 0, 0, Math.PI * 2);
  c.fill();

  c.save();
  c.translate(e.x, y);
  const wig = Math.sin(state.time * 9 + e.seed) * 0.08;
  c.rotate(e.angle + wig);
  c.lineWidth = 3;

  if (e.type === 'scout') {
    c.fillStyle = '#ff9a4d';
    c.strokeStyle = '#d9662a';
    c.beginPath(); c.arc(0, 0, e.radius, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath();
    c.moveTo(-2, -e.radius);
    c.quadraticCurveTo(-6, -e.radius - 7, 0, -e.radius - 8);
    c.lineWidth = 2; c.stroke();
    c.fillStyle = '#ffe3b3';
    c.beginPath(); c.arc(0, -e.radius - 8, 2.4, 0, Math.PI * 2); c.fill();
  } else if (e.type === 'speed') {
    c.fillStyle = 'rgba(255, 210, 61, 0.4)';
    for (let i = 1; i <= 3; i++) {
      c.beginPath();
      c.arc(-e.radius - i * 5, Math.sin(state.time * 10 + i) * 2, e.radius * (0.7 - i * 0.15), 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#ffd23d';
    c.strokeStyle = '#d9a520';
    c.beginPath(); c.arc(0, 0, e.radius, 0, Math.PI * 2); c.fill(); c.stroke();
  } else if (e.type === 'tank') {
    c.fillStyle = '#9fb2d8';
    c.strokeStyle = '#5c6f96';
    c.beginPath();
    c.roundRect(-e.radius, -e.radius * 0.85, e.radius * 2, e.radius * 1.7, 7);
    c.fill(); c.stroke();
    c.fillStyle = '#42527a';
    c.beginPath();
    c.roundRect(-e.radius + 1, -e.radius * 0.85 - 4, e.radius * 2 - 2, 5, 2.5);
    c.fill();
    c.beginPath();
    c.roundRect(-e.radius + 1, e.radius * 0.85 - 1, e.radius * 2 - 2, 5, 2.5);
    c.fill();
    c.fillStyle = '#fff3b0';
    c.beginPath(); c.arc(e.radius - 3, 0, 3, 0, Math.PI * 2); c.fill();
  } else if (e.type === 'elite') {
    const aura = 0.35 + 0.25 * Math.sin(state.time * 5 + e.seed);
    c.strokeStyle = 'rgba(200, 140, 255,' + aura + ')';
    c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, e.radius + 5, 0, Math.PI * 2); c.stroke();
    const g = c.createRadialGradient(-3, -4, 2, 0, 0, e.radius);
    g.addColorStop(0, '#e6c2ff');
    g.addColorStop(1, '#8a3bd1');
    c.fillStyle = g;
    c.strokeStyle = '#5b1e8a';
    c.beginPath(); c.arc(0, 0, e.radius, 0, Math.PI * 2); c.fill(); c.stroke();
    c.strokeStyle = 'rgba(230, 194, 255, 0.75)';
    c.lineWidth = 2.5;
    c.beginPath();
    c.ellipse(0, 0, e.radius * 1.55, e.radius * 0.5, -0.4, 0, Math.PI * 2);
    c.stroke();
  } else {
    const g = c.createRadialGradient(-8, -9, 3, 0, 0, e.radius);
    g.addColorStop(0, '#ff9aa4');
    g.addColorStop(1, '#c22733');
    c.fillStyle = g;
    c.strokeStyle = '#8e1226';
    c.lineWidth = 4;
    c.beginPath(); c.arc(0, 0, e.radius, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = 'rgba(140, 20, 35, 0.55)';
    c.beginPath(); c.arc(-e.radius * 0.45, e.radius * 0.3, 4.5, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(e.radius * 0.4, -e.radius * 0.5, 3.2, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(e.radius * 0.25, e.radius * 0.5, 2.6, 0, Math.PI * 2); c.fill();
    const ma = state.time * 1.6;
    c.fillStyle = '#ffd1d6';
    c.strokeStyle = '#c96a76';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(Math.cos(ma) * (e.radius + 11), Math.sin(ma) * (e.radius * 0.45), 5, 0, Math.PI * 2);
    c.fill(); c.stroke();
  }
  if (e.flash > 0) {
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = Math.min(1, e.flash * 10) * 0.75;
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(0, 0, e.radius * 1.1, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }
  c.restore();

  const es = e.type === 'boss' ? 5.5 : e.type === 'tank' ? 3.4 : e.type === 'elite' ? 3 : 2.7;
  const eyeY = y - e.radius * 0.15;
  const angry = e.type === 'boss' || e.type === 'tank';
  drawEyes(c, e.x, eyeY, e.angle, es, e.radius * 0.45, angry);
  if (e.type === 'boss') {
    c.strokeStyle = '#1b2438';
    c.lineWidth = 2.4;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(e.x, eyeY + e.radius * 0.55, 6, Math.PI * 1.15, Math.PI * 1.85);
    c.stroke();
  }
  // who sent this critter (only for rush enemies)
  if (e.sent) {
    c.fillStyle = 'rgba(' + hexRgb(ownerColor(e.sentBy)) + ',0.9)';
    c.font = 'bold 9px "Segoe UI", system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('▲', e.x, y - e.radius - 16);
    c.textAlign = 'start';
  }

  if (e.hp < e.maxHp) {
    const w = e.def.boss ? 60 : 22, h = 5;
    const ratio = Math.max(0, e.hp / e.maxHp);
    const bx = e.x - w / 2, by = y - e.radius - (e.sent ? 26 : 13);
    c.fillStyle = 'rgba(8, 14, 30, 0.85)';
    c.beginPath(); c.roundRect(bx, by, w, h, 2.5); c.fill();
    c.fillStyle = ratio > 0.5 ? '#5ded9f' : ratio > 0.25 ? '#ffd54a' : '#ff6b6b';
    if (ratio > 0) {
      c.beginPath(); c.roundRect(bx, by, Math.max(2.5, w * ratio), h, 2.5); c.fill();
    }
  }
}

function renderTowerGlyph(c, type, level, angle, time, recoil) {
  const def = TOWER_TYPES[type];
  c.fillStyle = '#1b2748';
  c.strokeStyle = 'rgba(255,255,255,0.22)';
  c.lineWidth = 2;
  c.beginPath(); c.arc(0, 0, 14, 0, Math.PI * 2); c.fill(); c.stroke();
  if (level >= 2) {
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.beginPath(); c.arc(0, 0, 11.5, 0, Math.PI * 2); c.stroke();
  }
  if (level >= 3) {
    c.save();
    c.rotate(time * 1.2);
    c.setLineDash([4, 5]);
    c.strokeStyle = 'rgba(' + hexRgb(def.color) + ',0.9)';
    c.beginPath(); c.arc(0, 0, 16, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    c.restore();
  }
  if (type === 'pulse') {
    c.save();
    c.rotate(angle);
    c.fillStyle = '#0f3350';
    if (level >= 3) {
      c.beginPath(); c.roundRect(-4, -9, 17, 4.5, 2); c.fill();
      c.beginPath(); c.roundRect(-4, 4.5, 17, 4.5, 2); c.fill();
    } else {
      c.beginPath(); c.roundRect(-4, -3, 18, 6, 3); c.fill();
    }
    c.restore();
    const g = c.createRadialGradient(-3, -3, 1, 0, 0, 10);
    g.addColorStop(0, '#a8eeff');
    g.addColorStop(1, '#1a8bb5');
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, 9.5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#0c4a63';
    c.lineWidth = 2.5;
    c.stroke();
    c.fillStyle = '#eaffff';
    c.beginPath(); c.arc(1.5, 0, 3 + Math.sin(time * 5) * 0.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#0c4a63';
    c.beginPath(); c.arc(2.2, 0, 1.3, 0, Math.PI * 2); c.fill();
  } else if (type === 'laser') {
    c.fillStyle = '#2c1850';
    c.beginPath(); c.roundRect(-4, 1, 8, 10, 3); c.fill();
    c.save();
    c.rotate(time * 1.6);
    const g = c.createLinearGradient(-7, -8, 7, 7);
    g.addColorStop(0, '#efd6ff');
    g.addColorStop(1, '#9b4ddb');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, -10); c.lineTo(7, 0); c.lineTo(0, 10); c.lineTo(-7, 0);
    c.closePath();
    c.fill();
    c.strokeStyle = '#4b1a85';
    c.lineWidth = 2.5;
    c.stroke();
    c.restore();
    c.strokeStyle = 'rgba(213, 160, 255,' + (0.35 + 0.25 * Math.sin(time * 4)) + ')';
    c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, 12, 0, Math.PI * 2); c.stroke();
  } else {
    c.save();
    c.rotate(angle);
    c.fillStyle = '#5c2c0a';
    c.beginPath(); c.roundRect(2 - recoil * 3, -5, 15, 10, 4); c.fill();
    c.beginPath(); c.roundRect(2 - recoil * 3, -7, 6, 14, 3); c.fill();
    c.restore();
    const g = c.createRadialGradient(-3, -3, 1, 0, 0, 11);
    g.addColorStop(0, '#ffe0a8');
    g.addColorStop(1, '#d96f10');
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, 11, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#7a3a05';
    c.lineWidth = 2.5;
    c.stroke();
    c.fillStyle = '#fff3d6';
    c.beginPath(); c.arc(0, 0, 3.6 + Math.sin(time * 6) * 0.8, 0, Math.PI * 2); c.fill();
  }
  for (let i = 0; i < level; i++) {
    c.fillStyle = '#ffd54a';
    c.beginPath();
    c.arc(-6 + i * 6, 19, 2, 0, Math.PI * 2);
    c.fill();
  }
}

function drawTower(c, t) {
  const oc = ownerColor(t.owner);
  const g = c.createRadialGradient(t.x, t.y, 2, t.x, t.y, 24);
  g.addColorStop(0, 'rgba(' + hexRgb(oc) + ',0.32)');
  g.addColorStop(1, 'rgba(' + hexRgb(oc) + ',0)');
  c.fillStyle = g;
  c.beginPath(); c.arc(t.x, t.y, 24, 0, Math.PI * 2); c.fill();
  c.save();
  c.translate(t.x, t.y);
  c.scale(1.25, 1.25);
  renderTowerGlyph(c, t.type, t.level, t.angle, state.time, t.recoil || 0);
  c.restore();
  const bx = t.x + 15, by = t.y - 21 - Math.sin(state.time * 3 + t.x * 0.05) * 1.5;
  c.fillStyle = oc;
  c.beginPath(); c.arc(bx, by, 4.5, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#eaf6ff';
  c.lineWidth = 1.5;
  c.stroke();
  c.strokeStyle = 'rgba(234, 246, 255, 0.55)';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(bx, by + 4.5);
  c.lineTo(t.x + 9, t.y - 9);
  c.stroke();
}

function drawBeams(c, b) {
  c.globalCompositeOperation = 'lighter';
  c.lineCap = 'round';
  for (const bm of b.beams) {
    const a = bm.life / bm.maxLife;
    c.globalAlpha = 0.25 * a;
    c.strokeStyle = bm.color;
    c.lineWidth = 7;
    c.beginPath(); c.moveTo(bm.x1, bm.y1); c.lineTo(bm.x2, bm.y2); c.stroke();
    c.globalAlpha = 0.95 * a;
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(bm.x1, bm.y1); c.lineTo(bm.x2, bm.y2); c.stroke();
  }
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
}

function drawProjectiles(c, b) {
  c.globalCompositeOperation = 'lighter';
  for (const p of b.projectiles) {
    c.strokeStyle = p.color;
    c.globalAlpha = 0.55;
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(p.px, p.py); c.lineTo(p.x, p.y); c.stroke();
    c.globalAlpha = 1;
    c.fillStyle = p.color;
    c.beginPath(); c.arc(p.x, p.y, p.splash ? 6 : 4, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(p.x, p.y, p.splash ? 2.8 : 1.8, 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
}

function drawParticles(c, b) {
  for (const p of b.particles) {
    const a = Math.max(0, p.life / p.maxLife);
    if (p.kind === 'spark') {
      c.globalAlpha = a;
      c.fillStyle = p.color;
      c.beginPath(); c.arc(p.x, p.y, p.size * a, 0, Math.PI * 2); c.fill();
    } else if (p.kind === 'ring') {
      const r = p.size * (1 - a) + 3;
      c.globalAlpha = a * 0.9;
      c.strokeStyle = p.color;
      c.lineWidth = 2.5;
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.stroke();
    } else if (p.kind === 'flash') {
      c.globalAlpha = a * 0.6;
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = p.color;
      c.beginPath(); c.arc(p.x, p.y, p.size * (1.6 - a * 0.6), 0, Math.PI * 2); c.fill();
      c.globalCompositeOperation = 'source-over';
    } else if (p.kind === 'text') {
      c.globalAlpha = Math.min(1, a * 1.6);
      c.font = 'bold ' + p.size + 'px "Segoe UI", system-ui, sans-serif';
      c.textAlign = 'center';
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = 3;
      c.strokeText(p.text, p.x, p.y);
      c.fillStyle = p.color;
      c.fillText(p.text, p.x, p.y);
      c.textAlign = 'start';
    }
  }
  c.globalAlpha = 1;
}

function drawRangeOverlay(c, b) {
  const selTower = b.selTid !== null ? towerById(b, b.selTid) : null;
  if (selTower) {
    c.globalAlpha = 0.5;
    c.strokeStyle = '#9fdcff';
    c.lineWidth = 1.5;
    c.setLineDash([8, 8]);
    c.lineDashOffset = -state.time * 20;
    c.beginPath(); c.arc(selTower.x, selTower.y, selTower.range, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 0.07;
    c.fillStyle = '#9fdcff';
    c.fill();
    c.globalAlpha = 1;
  }
  // free-placement ghost preview
  if (b.buildChoice) {
    const def = TOWER_TYPES[b.buildChoice];
    const ok = canPlaceAt(b, state.hover.x, state.hover.y);
    const col = ok ? def.color : '#ff5964';
    c.globalAlpha = 0.5;
    c.strokeStyle = col;
    c.lineWidth = 1.5;
    c.setLineDash([8, 8]);
    c.lineDashOffset = -state.time * 20;
    c.beginPath(); c.arc(state.hover.x, state.hover.y, def.range, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 0.25;
    c.fillStyle = col;
    c.fill();
    c.globalAlpha = 0.5;
    c.save();
    c.translate(state.hover.x, state.hover.y);
    c.scale(1.25, 1.25);
    renderTowerGlyph(c, b.buildChoice, 1, -Math.PI / 2, state.time, 0);
    c.restore();
    c.globalAlpha = 1;
  }
}

function renderBoard(cv, b, dt, isMine) {
  const dpr = window.devicePixelRatio || 1;
  const cw = cv.clientWidth || W, chh = cv.clientHeight || H;
  const bw = Math.round(cw * dpr), bh = Math.round(chh * dpr);
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  const c = cv.getContext('2d');
  const sx = bw / W, sy = bh / H;
  c.setTransform(sx, 0, 0, sy, 0, 0);
  c.clearRect(0, 0, W, H);
  c.save();
  if (b.shake > 0) {
    c.translate((Math.random() * 2 - 1) * b.shake, (Math.random() * 2 - 1) * b.shake);
  }
  drawGrid(c, dt);
  drawPath(c);
  drawNexus(c, b);
  for (const t of b.towers) drawTower(c, t);
  for (const e of b.enemies) drawEnemy(c, e);
  drawBeams(c, b);
  drawProjectiles(c, b);
  drawParticles(c, b);
  if (isMine) drawRangeOverlay(c, b);
  c.restore();
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (state.paused && state.phase !== 'gameover') {
    c.fillStyle = 'rgba(8, 12, 30, 0.6)';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#eaf6ff';
    c.font = '900 38px "Segoe UI", system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('PAUSED', W / 2, H / 2);
    c.font = '600 13px "Segoe UI", system-ui, sans-serif';
    c.fillStyle = '#8aa6d8';
    c.fillText(isMine ? 'PRESS PLAY TO RESUME' : 'WAITING FOR HOST…', W / 2, H / 2 + 28);
    c.textAlign = 'start';
  }
}

function render(dt) {
  renderBoard(cvMe, myBoard(), dt, true);
  renderBoard(cvOpp, foeBoard(), dt, false);
}

/* ========================= FLOW ========================= */
function showScreen(name) {
  state.screen = name;
  $('mp-menu').classList.toggle('hidden', name !== 'menu');
  $('mp-wait').classList.toggle('hidden', name !== 'wait');
  $('vs-game').classList.toggle('hidden', name !== 'game');
}

function updateWaitScreen(count) {
  const st = $('mp-wait-status');
  $('mp-wait-players').innerHTML = state.net.names.map((n, i) =>
    `<div class="wait-player s${i}"><span class="dot"></span>P${i + 1} — ${n || 'WAITING…'}</div>`
  ).join('');
  st.textContent = count >= 2 ? 'RIVAL CONNECTED — LAUNCHING BATTLE…' : 'WAITING FOR AN OPPONENT…';
}

async function createRoom() {
  const name = $('mp-name').value.trim() || 'COMMANDER';
  try { localStorage.setItem('mp_name', name); } catch (e) { /* ignore */ }
  try {
    const res = await api('create', { name: '⚔ ' + name, playerName: name, mode: 'versus' });
    NET_SESSION++;
    state.net = { code: res.code, token: res.token, seat: res.seat, since: 0,
      names: [name, ''], pollFail: 0, started: false, hadTwo: false, session: NET_SESSION };
    state.mySeat = res.seat;
    state.role = 'host';
    $('vs-room-tag').textContent = '#' + res.code;
    showScreen('wait');
    updateWaitScreen(1);
    pollLoop();
  } catch (e) {
    toastMsg('COULD NOT CREATE ROOM — IS server.py RUNNING?');
  }
}

async function joinRoom(code) {
  const name = $('mp-name').value.trim() || 'COMMANDER';
  try { localStorage.setItem('mp_name', name); } catch (e) { /* ignore */ }
  try {
    const res = await api('join', { code, playerName: name, mode: 'versus' });
    NET_SESSION++;
    state.net = { code: res.code, token: res.token, seat: res.seat, since: 0,
      names: ['', ''], pollFail: 0, started: false, hadTwo: false, session: NET_SESSION };
    state.mySeat = res.seat;
    state.role = 'guest';
    showScreen('wait');
    pollLoop();
  } catch (e) {
    toastMsg(e.payload && e.payload.error === 'ROOM FULL'
      ? 'ROOM FULL — 2/2 PLAYERS' : 'ROOM NOT FOUND');
  }
}

async function leaveRoom() {
  const { code, token } = state.net;
  state.net.code = null;
  if (code && token) {
    try { await api('leave', { code, token }); } catch (e) { /* ignore */ }
  }
  hideAnnounce();
  $('vs-gameover').classList.remove('on');
  showScreen('menu');
  refreshRooms();
}

function startBattle() {
  Sound.ensure();
  state.net.started = true;
  resetGameState();
  showScreen('game');
  if (isHost()) {
    // size the world to THIS player's board so the map fills the screen
    const frame = cvMe.parentElement;
    const fw = frame.clientWidth || 900, fh = frame.clientHeight || 560;
    const aspect = Math.max(1.0, Math.min(fw / fh, 2.0));
    const w = 820;
    const h = Math.max(430, Math.min(Math.round(w / aspect), 880));
    buildRoute(w, h);
    hostPublish('world', { w, h });
    beginCountdown(1);
    hostPublish('start', {});
  }
  announce('NEXUS BATTLES', 'DEFEND YOURS · DESTROY THEIRS', 'warn', 2400);
  updateConsoles();
  updateShopUI();
  updateAttackUI();
  updateInspector();
}

function resetGameState() {
  state.phase = 'idle';
  state.time = 0; state.paused = false;
  state.wave = 0; state.countdown = 0; state.waveStarts = 0;
  state.lastCountNum = null; state.lastWaveStarts = 0;
  state.lastSyncAt = performance.now();
  state.warnedHostLost = false; state.warnedGuestLost = false;
  eidCounter = 0;
  state.boards = [newBoard(0, nameOf(0)), newBoard(1, nameOf(1))];
  hideAnnounce();
  toastEl.className = '';
  vignetteMe.classList.remove('on');
  vignetteOpp.classList.remove('on');
  $('vs-gameover').classList.remove('on');
  updateShopUI();
  updateAttackUI();
  updateInspector();
}

function gameOver(winnerSeat) {
  if (state.phase === 'gameover') return;
  state.phase = 'gameover';
  state.paused = false;
  Sound.play(winnerSeat === state.net.seat ? 'win' : 'over');
  const loserBoard = state.boards[winnerSeat === 0 ? 1 : 0];
  if (winnerSeat !== -1) {
    explode(loserBoard, NEXUS.x, NEXUS.y, '#ff4d3d', 26, 200, 4);
    explode(loserBoard, NEXUS.x, NEXUS.y, '#ff8c1a', 18, 160, 4);
    loserBoard.shake = 6;
  }
  const stats = {
    winner: winnerSeat,
    names: state.net.names,
    wave: state.wave,
    kills: [state.boards[0].kills, state.boards[1].kills],
    income: [state.boards[0].income, state.boards[1].income],
  };
  if (isHost()) {
    hostPublish('over', stats);
    showGameOver(stats);
  }
}

function showGameOver(stats) {
  state.phase = 'gameover';
  hideAnnounce();
  const iWon = stats.winner === state.net.seat;
  $('vs-go-title').textContent = stats.winner === -1 ? '🤝 DRAW' : iWon ? '🏆 VICTORY!' : '💀 DEFEAT';
  $('vs-go-title').style.color = stats.winner === -1 ? '#9fd9ff' : iWon ? '#ffd54a' : '#ff6b7a';
  $('vs-go-sub').textContent = stats.reason === 'HOST LEFT' ? 'OPPONENT LEFT THE MATCH'
    : iWon ? 'RIVAL NEXUS DESTROYED' : stats.winner === -1 ? 'BOTH NEXUSES STAND' : 'YOUR NEXUS HAS FALLEN';
  $('vs-go-names').textContent = (stats.names ? stats.names[0] : 'P1') + '  VS  ' + (stats.names ? stats.names[1] : 'P2');
  $('vs-go-wave').textContent = stats.wave;
  $('vs-go-kills').textContent = stats.kills ? stats.kills[state.net.seat] : 0;
  $('vs-go-income').textContent = '+' + (stats.income ? stats.income[state.net.seat] : 0) + ' / ROUND';
  $('vs-gameover').classList.add('on');
  Sound.play(iWon ? 'win' : 'lose');
}

/* ========================= LOBBY ========================= */
let lobbyTimer = null;

async function refreshRooms() {
  try {
    const res = await api('rooms');
    const list = $('mp-room-list');
    list.innerHTML = '';
    const rooms = res.rooms.filter(r => r.mode === 'versus');
    if (!rooms.length) {
      list.innerHTML = '<div class="room-empty">NO OPEN ROOMS — CREATE ONE!</div>';
    }
    for (const r of rooms) {
      const row = document.createElement('div');
      row.className = 'room-row';
      const full = r.players >= 2;
      row.innerHTML =
        `<div class="room-info"><span class="room-name"></span><span class="room-code">#${r.code}</span></div>` +
        `<span class="room-count ${full ? 'full' : ''}">${r.players}/2</span>`;
      row.querySelector('.room-name').textContent = r.name;
      const btn = document.createElement('button');
      btn.className = 'btn small';
      btn.textContent = full ? 'FULL' : 'ENTER';
      btn.disabled = full;
      btn.addEventListener('click', () => joinRoom(r.code));
      row.appendChild(btn);
      list.appendChild(row);
    }
  } catch (e) {
    $('mp-room-list').innerHTML =
      '<div class="room-empty">SERVER OFFLINE — RUN: python3 server.py</div>';
  }
}

/* ========================= INPUT & PANELS ========================= */
function buildShop() {
  const shop = $('vs-shop');
  for (const key of Object.keys(TOWER_TYPES)) {
    const def = TOWER_TYPES[key];
    const card = document.createElement('div');
    card.className = 'card tile';
    card.dataset.type = key;
    card.title = def.name + ' · DMG ' + def.damage + ' · RNG ' + def.range + ' · ' + def.rate.toFixed(1) + '/s';
    card.innerHTML =
      '<canvas class="tile-ico" width="38" height="38"></canvas>' +
      '<div class="tile-cost">' + def.cost + '</div>';
    card.addEventListener('click', () => onDefenseCardClick(key));
    shop.appendChild(card);
    const ic = card.querySelector('canvas').getContext('2d');
    ic.translate(19, 20);
    ic.scale(1.0, 1.0);
    renderTowerGlyph(ic, key, 3, -Math.PI / 2, 1.2, 0);
  }
  const atk = $('vs-attack');
  for (const key of Object.keys(PACKS)) {
    const p = PACKS[key];
    const card = document.createElement('div');
    card.className = 'card tile atk';
    card.dataset.pack = key;
    card.title = p.name + ' · ' + p.count + '× ' + ENEMY_TYPES[p.type].name + ' → rival · INCOME +' + p.inc;
    card.innerHTML =
      `<span class="tile-dot" style="background:radial-gradient(circle at 35% 30%, ${p.color}, rgba(0,0,0,0.55))"></span>` +
      `<div class="tile-txt">` +
        `<div class="card-name">${p.name}</div>` +
        `<div class="tile-sub">INCOME +${p.inc}</div>` +
      `</div>` +
      `<div class="card-queue"></div>` +
      `<div class="tile-cost">${p.cost}</div>`;
    card.addEventListener('click', () => onAttackCardClick(key));
    atk.appendChild(card);
  }
}

function wireEvents() {
  $('mp-btn-host').addEventListener('click', () => {
    Sound.ensure(); Sound.play('click');
    $('mp-menu-home').classList.add('hidden');
    $('mp-menu-rooms').classList.remove('hidden');
    refreshRooms();
    clearInterval(lobbyTimer);
    lobbyTimer = setInterval(refreshRooms, 2000);
  });
  $('mp-btn-create').addEventListener('click', () => {
    clearInterval(lobbyTimer);
    createRoom();
  });
  $('mp-btn-rooms-back').addEventListener('click', () => {
    Sound.play('click');
    $('mp-menu-rooms').classList.add('hidden');
    $('mp-menu-home').classList.remove('hidden');
    clearInterval(lobbyTimer);
  });
  $('mp-btn-leave-wait').addEventListener('click', () => leaveRoom());
  $('vs-btn-leave').addEventListener('click', () => leaveRoom());
  $('vs-btn-lobby').addEventListener('click', () => leaveRoom());

  $('vs-btn-pause').addEventListener('click', () => {
    if (!isHost() || state.phase === 'gameover') return;
    state.paused = !state.paused;
    $('vs-btn-pause').textContent = state.paused ? '▶' : '⏸';
    Sound.play('click');
  });
  $('vs-btn-speed').addEventListener('click', () => {
    if (!isHost()) return;
    state.speed = state.speed === 1 ? 2 : 1;
    $('vs-btn-speed').textContent = state.speed + 'x';
    Sound.play('click');
  });
  $('vs-btn-sound').addEventListener('click', () => {
    Sound.ensure();
    Sound.enabled = !Sound.enabled;
    $('vs-btn-sound').textContent = Sound.enabled ? '🔊' : '🔇';
    if (Sound.enabled) Sound.play('click');
  });

  ['damage', 'range', 'speed'].forEach(stat => {
    $('vs-up-' + stat).addEventListener('click', () => {
      const b = myBoard();
      const t = b.selTid !== null ? towerById(b, b.selTid) : null;
      if (t && t.level < 3) publishAction({ op: 'upgrade', tid: t.tid, stat });
    });
  });
  $('vs-btn-sell').addEventListener('click', () => {
    const b = myBoard();
    const t = b.selTid !== null ? towerById(b, b.selTid) : null;
    if (t) publishAction({ op: 'sell', tid: t.tid });
  });

  cvMe.addEventListener('click', onMyCanvasClick);
  cvMe.addEventListener('mousemove', e => {
    state.hover = canvasPos(e, cvMe);
    cvMe.style.cursor = (myBoard().buildChoice || towerNear(myBoard(), state.hover.x, state.hover.y)) ? 'pointer' : 'default';
  });
  cvMe.addEventListener('mouseleave', () => { state.hover = { x: -999, y: -999 }; });
  cvMe.addEventListener('contextmenu', e => {
    e.preventDefault();
    const b = myBoard();
    b.selTid = null; b.buildChoice = null;
    updateShopUI(); updateInspector();
  });
  cvOpp.style.cursor = 'default';

  window.addEventListener('keydown', e => {
    if (state.screen !== 'game') return;
    if (e.code === 'Escape') {
      const b = myBoard();
      b.selTid = null; b.buildChoice = null;
      updateShopUI(); updateInspector();
    }
  });
}

/* ========================= HUD ========================= */
const hudCache = {};
function setText(el, key, v) {
  if (hudCache[key] !== v) { hudCache[key] = v; el.textContent = v; }
}

function updateHUD() {
  const me = myBoard(), foe = foeBoard();
  setText(hpVal, 'hp', String(Math.max(0, me.hp)));
  setText(coinsVal, 'coins', Math.floor(me.coinsShown).toLocaleString('en-US'));
  setText(incomeVal, 'inc', '+' + me.income);
  setText(roundVal, 'round', String(Math.max(1, state.wave)));
  setText(oppHpNum, 'ohp', String(Math.max(0, foe.hp)));
  meFill.style.width = Math.max(0, me.hp / START_HP * 100) + '%';
  meFill.style.background = me.hp / START_HP > 0.35
    ? 'linear-gradient(90deg, #5ded9f, #37ffa0)' : 'linear-gradient(90deg, #ffb054, #ff5d78)';
  oppFill.style.width = Math.max(0, foe.hp / START_HP * 100) + '%';
  vignetteMe.classList.toggle('on', me.hp <= 40 && state.phase !== 'gameover');
  vignetteOpp.classList.toggle('on', foe.hp <= 40 && state.phase !== 'gameover');
  const lagEl = $('vs-chip-lag');
  if (lagEl) {
    const lagging = !isHost() && state.screen === 'game' && state.phase !== 'gameover' &&
      performance.now() - state.lastSyncAt > 1500;
    lagEl.classList.toggle('hidden', !lagging);
  }
}

function popDigit() {
  annSub.classList.remove('pop');
  void annSub.offsetWidth;
  annSub.classList.add('pop');
}

/* ========================= MAIN LOOP ========================= */
let lastT = performance.now();
let lastFrameAt = performance.now();
let rafPending = false;
function frame(now) {
  rafPending = false;
  lastFrameAt = performance.now();
  const dtRaw = Math.min((now - lastT) / 1000, 0.25);
  lastT = now;
  if (state.screen === 'game') {
    const dt = dtRaw * (isHost() ? (state.speed || 1) : 1);
    if (!state.paused) {
      if (isHost()) {
        const steps = Math.max(1, Math.ceil(dt / 0.034));
        for (let i = 0; i < steps; i++) updateHost(dt / steps);
        hostSyncTick(dtRaw);
      } else {
        updateGuest(dt);
      }
    }
    updateHUD();
    render(dt);
  }
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(frame);
  }
}

// worker watchdog: keeps the host sim alive when the tab is hidden
try {
  const ticker = new Worker(URL.createObjectURL(new Blob(
    ['setInterval(()=>postMessage(0),50)'],
    { type: 'text/javascript' }
  )));
  ticker.onmessage = () => {
    if (performance.now() - lastFrameAt > 400) frame(performance.now());
  };
} catch (e) { /* workers unavailable */ }

/* ========================= INIT ========================= */
function init() {
  try { $('mp-name').value = localStorage.getItem('mp_name') || ''; } catch (e) { /* ignore */ }
  buildShop();
  wireEvents();
  updateShopUI();
  updateAttackUI();
  updateInspector();
  updateConsoles();
  showScreen('menu');
  requestAnimationFrame(frame);
}

init();
