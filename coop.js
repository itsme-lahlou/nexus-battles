'use strict';
/* ============================================================
   CYBER DEFENSE: NEXUS — mp.js · 2-player co-op client
   One map · one Nexus · one enemy stream · ONE shared coin pool.
   Host simulates the world; guest sends actions and renders
   interpolated snapshots. Requires server.py on the LAN.
   ============================================================ */

/* ========================= CONFIG ========================= */
const W = 960, H = 600;
const OWNER_COLORS = ['#00e5ff', '#ff5edb'];   // P1 cyan, P2 magenta

const TOWER_TYPES = {
  pulse:  { key: 'pulse',  name: 'PULSE CANNON',  cost: 100, damage: 14, range: 135, rate: 1.15, projSpeed: 460, splash: 0,  color: '#19d3ff', desc: 'BALANCED DEFENSE' },
  laser:  { key: 'laser',  name: 'LASER NODE',    cost: 180, damage: 5,  range: 125, rate: 4.5,  projSpeed: 0,   splash: 0,  color: '#b366ff', desc: 'RAPID FIRE BEAM' },
  plasma: { key: 'plasma', name: 'PLASMA CANNON', cost: 300, damage: 42, range: 155, rate: 0.45, projSpeed: 280, splash: 60, color: '#ff8c1a', desc: 'HEAVY SPLASH DAMAGE' },
};
const UPGRADE_COSTS = [100, 200];
const SELL_RATE = 0.7;

const ENEMY_TYPES = {
  scout: { key: 'scout', name: 'SCOUT DRONE', hp: 40,  speed: 90,  r: 10, reward: 10,  dmg: 5 },
  speed: { key: 'speed', name: 'SPEED DRONE', hp: 26,  speed: 165, r: 8,  reward: 12,  dmg: 5 },
  tank:  { key: 'tank',  name: 'ARMORED TANK', hp: 160, speed: 46,  r: 15, reward: 25,  dmg: 15 },
  elite: { key: 'elite', name: 'ELITE UNIT',   hp: 115, speed: 72,  r: 13, reward: 40,  dmg: 10 },
  boss:  { key: 'boss',  name: 'OMEGA TITAN',  hp: 700, speed: 32,  r: 24, reward: 150, dmg: 30, boss: true },
};
const BOSS_NAMES = ['OMEGA TITAN', 'VOID REAVER', 'HEX WARLORD', 'NULL DEVOURER'];

const START_COINS = 400, START_HP = 120, COUNTDOWN_TIME = 5, EARLY_BONUS = 25;

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
      case 'wave':    [440, 554].forEach((f, i) => this.tone({ f, f2: f * 1.4, type: 'sawtooth', dur: 0.22, vol: 0.06, delay: i * 0.25 })); break;
      case 'boss':    [110, 110, 110].forEach((f, i) => this.tone({ f, f2: 82, type: 'sawtooth', dur: 0.42, vol: 0.14, delay: i * 0.45 })); break;
      case 'hit':     this.tone({ f: 130, f2: 55, type: 'sine', dur: 0.28, vol: 0.2 }); this.noise(0.15, 0.1, 300); break;
      case 'error':   this.tone({ f: 140, type: 'square', dur: 0.12, vol: 0.08 }); break;
      case 'click':   this.tone({ f: 700, dur: 0.04, vol: 0.04, type: 'square' }); break;
      case 'over':    [392, 311, 233, 155].forEach((f, i) => this.tone({ f, type: 'sawtooth', dur: 0.4, vol: 0.1, delay: i * 0.3 })); break;
    }
  },
};

/* ========================= STATE ========================= */
const state = {
  screen: 'menu',            // 'menu' | 'wait' | 'game'
  role: null,                // 'host' | 'guest'
  phase: 'idle',             // 'idle' | 'countdown' | 'wave' | 'gameover'
  time: 0, paused: false,
  coins: START_COINS, coinsShown: START_COINS,
  hp: START_HP,
  wave: 0, wavesCompleted: 0, kills: 0,
  countdown: 0, waveTime: 0, waveStarts: 0,
  spawnQueue: [], spawnIdx: 0,
  enemies: [], towers: [], projectiles: [], beams: [], particles: [],
  selPadIdx: null, buildChoice: null,
  hover: { x: -999, y: -999 },
  shake: 0, bossName: '',
  lastCountNum: null, lastWaveStarts: 0,
  lastSyncAt: 0, warnedHostLost: false, warnedGuestLost: false,
  net: { code: null, token: null, seat: 0, names: ['', ''], pollFail: 0, syncing: false },
};
let eidCounter = 0;
// host-side pending visual effects for the guest (flushed with each sync)
const pend = { bm: [], bo: [], kl: [], sk: [], tx: [], sh: 0, nx: 0 };

const $ = id => document.getElementById(id);
const cv = $('mp-cv'), ctx = cv.getContext('2d');
const arenaEl = $('mp-arena');
const hpVal = $('mp-hp'), coinsVal = $('mp-coins'), waveVal = $('mp-wave'), enemiesVal = $('mp-enemies');
const chipHp = $('mp-chip-hp'), chipCoins = $('mp-chip-coins');
const annEl = $('mp-announce'), annTitle = annEl.querySelector('.ann-title'), annSub = annEl.querySelector('.ann-sub');
const toastEl = $('mp-toast'), vignetteEl = $('mp-vignette');
const bossBarEl = $('mp-bossbar'), bossNameEl = $('mp-boss-name'), bossFillEl = $('mp-boss-fill');
const warnEl = $('mp-boss-warning');

/* ========================= MAP ========================= */
const WAYPOINTS = [
  [-40, 80], [790, 80], [790, 200], [170, 200], [170, 320],
  [790, 320], [790, 440], [890, 440], [890, 520],
];
const PATH = (() => {
  const segs = []; let total = 0;
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const [x1, y1] = WAYPOINTS[i], [x2, y2] = WAYPOINTS[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    segs.push({ x1, y1, x2, y2, len, start: total, angle: Math.atan2(y2 - y1, x2 - x1) });
    total += len;
  }
  return { segs, total };
})();
const NEXUS = { x: WAYPOINTS[WAYPOINTS.length - 1][0], y: WAYPOINTS[WAYPOINTS.length - 1][1] };

const PADS = [
  [320, 26], [560, 26],
  [430, 140], [600, 140], [890, 140],
  [90, 265], [300, 265], [520, 265], [700, 265], [890, 265],
  [90, 380], [430, 380], [600, 380],
  [300, 505], [520, 505], [680, 505], [790, 520], [80, 520],
].map(([x, y], i) => ({ i, x, y, tower: null }));

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

function padAt(x, y) {
  for (const p of PADS) if (Math.hypot(p.x - x, p.y - y) < 27) return p;
  return null;
}
function towerAtPad(i) { return state.towers.find(t => t.padIndex === i) || null; }
function isHost() { return state.role === 'host'; }
function myColor() { return OWNER_COLORS[state.net.seat] || '#fff'; }

/* ========================= ENTITIES ========================= */
class Enemy {
  constructor(type, hpMul) {
    this.eid = ++eidCounter;
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
    if (Math.random() < 0.4) spawnText(this.x + (Math.random() * 14 - 7), this.y - this.radius - 6, String(Math.round(amount)), '#cfefff', 11);
    if (this.hp <= 0) this.die();
  }
  die() {
    this.alive = false;
    state.kills++;
    addCoins(this.def.reward);
    explode(this.x, this.y, this.bodyColor(), this.def.boss ? 34 : 8 + Math.floor(this.radius), this.def.boss ? 240 : 130, this.def.boss ? 5 : 3);
    Sound.play(this.def.boss ? 'bigboom' : 'boom');
    if (this.def.boss) {
      state.shake = Math.max(state.shake, 3);
      pend.kl.push([r1(this.x), r1(this.y), this.def.reward, '#ff2038']);
      announce('BOSS DESTROYED', '+' + this.def.reward + ' COINS', 'good', 1800);
    } else {
      pend.kl.push([r1(this.x), r1(this.y), this.def.reward, this.bodyColor()]);
    }
  }
  bodyColor() {
    return { scout: '#ff8c3d', speed: '#ffd23d', tank: '#ff5d78', elite: '#c05cff', boss: '#ff2038' }[this.type];
  }
  reachNexus() {
    this.alive = false;
    damageNexus(this.def.dmg);
  }
}

class Tower {
  constructor(padIndex, type, owner) {
    this.padIndex = padIndex;
    const pad = PADS[padIndex];
    this.type = type;
    this.def = TOWER_TYPES[type];
    this.owner = owner;
    this.x = pad.x; this.y = pad.y;
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
  update(dt) {
    this.cooldown -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 5);
    const target = this.acquireTarget();
    if (target) {
      const want = Math.atan2(target.y - this.y, target.x - this.x);
      let d = want - this.angle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.angle += d * Math.min(1, dt * 10);
      if (this.cooldown <= 0) {
        this.fire(target);
        this.cooldown = this.fireDelay;
      }
    }
  }
  acquireTarget() {
    let best = null;
    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (Math.hypot(e.x - this.x, e.y - this.y) > this.range + e.radius) continue;
      if (!best || e.dist > best.dist) best = e;
    }
    return best;
  }
  muzzle() {
    return { x: this.x + Math.cos(this.angle) * 16, y: this.y + Math.sin(this.angle) * 16 };
  }
  fire(target) {
    const m = this.muzzle();
    state.particles.push(new Particle({ kind: 'flash', x: m.x, y: m.y, size: 9, color: this.def.color, life: 0.1 }));
    if (this.type === 'laser') {
      target.damage(this.damage);
      state.beams.push({ x1: m.x, y1: m.y, x2: target.x, y2: target.y, life: 0.08, maxLife: 0.08, color: this.def.color });
      pend.bm.push([r1(m.x), r1(m.y), r1(target.x), r1(target.y), this.def.color]);
      Sound.play('laser');
    } else {
      state.projectiles.push(new Projectile(m.x, m.y, target, this));
      pend.sk.push([r1(m.x), r1(m.y), this.type === 'plasma' ? 'plasma' : 'shoot']);
      Sound.play(this.type === 'plasma' ? 'plasma' : 'shoot');
      this.recoil = 1;
    }
  }
  upgrade(stat) {
    if (this.level >= 3) return;
    const cost = UPGRADE_COSTS[this.level - 1];
    if (state.coins < cost) { deny('NOT ENOUGH COINS'); shakeEl($('mp-up-' + stat)); return; }
    spendCoins(cost);
    this.invested += cost;
    this.damage *= 1.45;
    this.range *= 1.15;
    this.fireDelay /= 1.18;
    if (stat === 'damage') this.damage *= 1.3;
    if (stat === 'range') this.range *= 1.2;
    if (stat === 'speed') this.fireDelay /= 1.25;
    this.level++;
    state.particles.push(new Particle({ kind: 'ring', x: this.x, y: this.y, size: 44, color: OWNER_COLORS[this.owner], life: 0.45 }));
    spawnText(this.x, this.y - 30, 'UPGRADED! LV ' + this.level, '#ffd54a', 14);
    Sound.play('upgrade');
    noteAction((this.owner === state.net.seat ? 'YOU' : nameOf(this.owner)) + ' upgraded ' + this.def.name + ' → LV ' + this.level);
    updateInspector();
  }
  sellValue() { return Math.floor(this.invested * SELL_RATE); }
  sell() {
    addCoins(this.sellValue());
    noteAction((this.owner === state.net.seat ? 'YOU' : nameOf(this.owner)) + ' sold ' + this.def.name + ' (+' + this.sellValue() + ')');
    state.particles.push(new Particle({ kind: 'ring', x: this.x, y: this.y, size: 36, color: myColor(), life: 0.4 }));
    PADS[this.padIndex].tower = null;
    state.towers.splice(state.towers.indexOf(this), 1);
    Sound.play('sell');
    if (state.selPadIdx === this.padIndex) { state.selPadIdx = null; }
    updateInspector();
  }
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
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    if (this.target && this.target.alive) { this.tx = this.target.x; this.ty = this.target.y; }
    const dx = this.tx - this.x, dy = this.ty - this.y;
    const d = Math.hypot(dx, dy);
    const hitR = (this.target && this.target.alive) ? this.target.radius * 0.7 + 3 : 3;
    const step = this.speed * dt;
    if (d <= step + hitR) { this.x = this.tx; this.y = this.ty; this.impact(); return; }
    this.px = this.x; this.py = this.y;
    this.x += dx / d * step;
    this.y += dy / d * step;
  }
  impact() {
    this.dead = true;
    if (this.splash > 0) {
      for (const e of state.enemies) {
        if (!e.alive) continue;
        const dist = Math.hypot(e.x - this.x, e.y - this.y);
        if (dist <= this.splash + e.radius) {
          e.damage(this.damage * (1 - 0.6 * Math.min(1, dist / this.splash)));
        }
      }
      explode(this.x, this.y, this.color, 16, 170, 3.5);
      state.particles.push(new Particle({ kind: 'ring', x: this.x, y: this.y, size: this.splash + 8, color: this.color, life: 0.3 }));
      Sound.play('boom');
    } else if (this.target && this.target.alive) {
      this.target.damage(this.damage);
      state.particles.push(new Particle({ kind: 'flash', x: this.x, y: this.y, size: 7, color: this.color, life: 0.1 }));
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

function explode(x, y, color, count = 12, power = 130, size = 3) {
  if (state.particles.length > 420) count = Math.min(count, 5);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = power * (0.3 + Math.random() * 0.7);
    state.particles.push(new Particle({
      kind: 'spark', x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.88,
      life: 0.3 + Math.random() * 0.4,
      size: size * (0.6 + Math.random() * 0.8),
      color: i % 3 === 0 ? '#ffffff' : color,
    }));
  }
  state.particles.push(new Particle({ kind: 'ring', x, y, size: 24 + size * 4, color, life: 0.32 }));
  state.particles.push(new Particle({ kind: 'flash', x, y, size: 14 + size * 2, color: '#ffffff', life: 0.12 }));
  pend.bo.push([r1(x), r1(y), color, size]);
}

function spawnText(x, y, text, color, size = 12) {
  if (state.particles.length > 460) return;
  state.particles.push(new Particle({ kind: 'text', x, y, vx: 0, vy: -34, life: 0.75, text, color, size }));
}

/* ========================= WAVES (host authority) ========================= */
function hpMultiplier(n) { return 1 + (n - 1) * 0.22 + Math.pow(n - 1, 2) * 0.035; }

function buildWave(n) {
  const q = []; let t = 0;
  const add = (type, count, gap) => { for (let i = 0; i < count; i++) { q.push({ type, t }); t += gap; } };
  add('scout', Math.min(14 + n * 5, 70), 0.38);
  if (n >= 2) add('speed', Math.min(2 + n * 2, 40), 0.3);
  if (n >= 3) add('tank', Math.min(2 + Math.floor((n - 3) / 2), 12), 1.3);
  if (n >= 4) add('elite', Math.min(1 + Math.floor((n - 2) / 2), 10), 1.0);
  const bossCount = Math.min(1 + Math.ceil(n / 2), 12);
  for (let i = 0; i < bossCount; i++) q.push({ type: 'boss', t: t + 1.2 + i * 2.6 });
  return q;
}

function spawnEnemy(type) {
  const e = new Enemy(type, hpMultiplier(state.wave));
  state.enemies.push(e);
  if (e.def.boss) {
    state.bossName = BOSS_NAMES[state.kills % BOSS_NAMES.length]; // rotates per kill count — decorative
    bossBarEl.classList.add('on');
  }
}

function beginCountdown(n) {
  state.wave = n;
  state.phase = 'countdown';
  state.countdown = n === 1 ? COUNTDOWN_TIME : COUNTDOWN_TIME + 1.5;
  state.lastCountNum = null;
  updateWaveButton();
}

function startWave() {
  state.phase = 'wave';
  state.waveTime = 0;
  state.spawnIdx = 0;
  state.spawnQueue = buildWave(state.wave);
  state.waveStarts++;
  hideAnnounce();
  warnEl.classList.remove('on'); void warnEl.offsetWidth; warnEl.classList.add('on');
  setTimeout(() => warnEl.classList.remove('on'), 2400);
  $('mp-warn-name').textContent = BOSS_NAMES[state.kills % BOSS_NAMES.length];
  Sound.play('boss');
  updateWaveButton();
}

function completeWave() {
  const bonus = 80 + state.wave * 15;
  state.wavesCompleted++;
  addCoins(bonus);
  announce('WAVE COMPLETE', '+' + bonus + ' COINS', 'good', 1800);
  Sound.play('coin');
  beginCountdown(state.wave + 1);
}

function enemiesRemaining() {
  return state.enemies.length + (state.spawnQueue.length - state.spawnIdx);
}

/* ========================= ECONOMY / FEEDBACK ========================= */
function nameOf(seat) { return state.net.names[seat] || ('PLAYER ' + (seat + 1)); }

function noteAction(str) {
  state.lastActions = state.lastActions || ['', ''];
  if (isHost()) state.lastActions[0] = str; // host relays via action feed below
  updateConsoles();
}

function addCoins(n) {
  state.coins += n;
  Sound.play('coin');
  bumpEl(chipCoins);
  updateShopUI();
  updateInspector();
}

function spendCoins(n) {
  state.coins -= n;
  updateShopUI();
  updateInspector();
}

function damageNexus(dmg) {
  if (state.phase === 'gameover') return;
  state.hp = Math.max(0, state.hp - dmg);
  explode(NEXUS.x, NEXUS.y, '#ff4d5e', 10, 120, 3);
  spawnText(NEXUS.x, NEXUS.y - 40, '-' + dmg, '#ff6b6b', 15);
  pend.nx = dmg;
  Sound.play('hit');
  bumpEl(chipHp);
  if (state.hp <= 0) gameOver();
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
  if (isHost() && hold > 0 && hold !== Infinity) hostPublish('ann', { title, sub, cls, hold });
}

function hideAnnounce() { clearTimeout(annTimer); annEl.className = ''; }

function shakeEl(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

function bumpEl(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function updateShopUI() {
  document.querySelectorAll('#mp-shop .card').forEach(card => {
    const def = TOWER_TYPES[card.dataset.type];
    const afford = state.coins >= def.cost;
    card.classList.toggle('locked', !afford);
    card.classList.toggle('can-buy', afford);
    card.classList.toggle('selected', state.buildChoice === card.dataset.type);
  });
}

function updateWaveButton() {
  const b = $('mp-btn-wave'), l = $('mp-wave-label'), s = $('mp-wave-sub');
  const mine = isHost();
  b.disabled = !mine || state.phase !== 'countdown';
  if (state.phase === 'countdown') {
    l.textContent = '🚀 START WAVE ' + state.wave;
    s.textContent = mine ? ('EARLY BONUS +' + EARLY_BONUS + ' 🪙') : 'HOST LAUNCHES THE WAVE';
  } else if (state.phase === 'wave') {
    l.textContent = 'WAVE ' + state.wave + ' IN PROGRESS';
    s.textContent = enemiesRemaining() + ' HOSTILES LEFT';
  } else {
    l.textContent = state.phase === 'gameover' ? 'SYSTEM OFFLINE' : 'STANDBY';
    s.textContent = '';
  }
}

function updateInspector() {
  const t = state.selPadIdx !== null ? towerAtPad(state.selPadIdx) : null;
  const empty = $('mp-insp-empty'), body = $('mp-insp-body');
  if (!t) {
    empty.classList.remove('hidden');
    body.classList.add('hidden');
    empty.innerHTML = state.selPadIdx !== null
      ? 'PAD SELECTED<br>PICK A TOWER FROM THE SHOP'
      : 'SELECT A PAD OR A TOWER<br>ON THE GRID';
    return;
  }
  empty.classList.add('hidden');
  body.classList.remove('hidden');
  const oc = OWNER_COLORS[t.owner];
  $('mp-insp-name').textContent = t.def.name;
  $('mp-insp-name').style.textShadow = '0 0 10px ' + oc;
  $('mp-insp-owner').textContent = t.owner === state.net.seat ? 'YOURS' : nameOf(t.owner) + "'S";
  $('mp-insp-owner').style.color = oc;
  $('mp-insp-lv').textContent = 'LV ' + t.level;
  $('mp-insp-stats').innerHTML = `
    <div class="stat"><span>DAMAGE</span><b>${Math.round(t.damage)}</b></div>
    <div class="stat"><span>RANGE</span><b>${Math.round(t.range)}</b></div>
    <div class="stat"><span>FIRE RATE</span><b>${(1 / t.fireDelay).toFixed(1)}/s</b></div>
    <div class="stat"><span>KILLS</span><b>${t.kills}</b></div>`;
  const max = t.level >= 3;
  [['damage', 'DAMAGE'], ['range', 'RANGE'], ['speed', 'SPEED']].forEach(([k, label]) => {
    const b = $('mp-up-' + k);
    b.disabled = max;
    b.querySelector('.up-name').textContent = max ? label + ' MAXED' : 'UPGRADE ' + label;
    b.querySelector('.up-cost').textContent = max ? '—' : UPGRADE_COSTS[t.level - 1] + ' 🪙';
  });
  $('mp-btn-sell').textContent = 'SELL TOWER  +' + t.sellValue() + ' 🪙';
}

function updateConsoles() {
  const acts = state.lastActions || ['', ''];
  [0, 1].forEach(seat => {
    const el = $(seat === 0 ? 'mp-cons-p1' : 'mp-cons-p2');
    el.querySelector('.cons-name').textContent = nameOf(seat);
    el.querySelector('.cons-you').style.display = seat === state.net.seat ? 'inline' : 'none';
    const tw = state.towers.filter(t => t.owner === seat).length;
    el.querySelector('.cons-body').textContent = 'TOWERS ' + tw + ' · ' + (acts[seat] || 'BUILDING DEFENSES…');
  });
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

function publishAction(data) {
  if (isHost()) { applyAction(data, 0); return; }
  api('publish', { code: state.net.code, token: state.net.token, type: 'act', data }).catch(() => {});
}

// ---- host: apply a guest action to the authoritative sim ----
function applyAction(a, seat) {
  if (state.phase === 'gameover' || state.phase === 'idle') return;
  if (a.op === 'wave') { tryStartWave(); return; }
  if (a.op === 'build') {
    const pad = PADS[a.pad];
    if (!pad || pad.tower) return deny('PAD ALREADY TAKEN');
    const def = TOWER_TYPES[a.tower];
    if (!def) return;
    if (state.coins < def.cost) return deny('NOT ENOUGH COINS');
    spendCoins(def.cost);
    const t = new Tower(a.pad, a.tower, seat);
    pad.tower = t;
    state.towers.push(t);
    state.particles.push(new Particle({ kind: 'ring', x: pad.x, y: pad.y, size: 42, color: OWNER_COLORS[seat], life: 0.45 }));
    spawnText(pad.x, pad.y - 28, '-' + def.cost, '#ff6b6b', 12);
    Sound.play('buy');
    noteActionFeed(seat, 'built ' + def.name);
  } else if (a.op === 'upgrade') {
    const t = towerAtPad(a.pad);
    if (!t) return;
    if (t.level >= 3) return deny('ALREADY MAX LEVEL');
    const cost = UPGRADE_COSTS[t.level - 1];
    if (state.coins < cost) return deny('NOT ENOUGH COINS');
    spendCoins(cost);
    t.invested += cost;
    t.damage *= 1.45; t.range *= 1.15; t.fireDelay /= 1.18;
    if (a.stat === 'damage') t.damage *= 1.3;
    if (a.stat === 'range') t.range *= 1.2;
    if (a.stat === 'speed') t.fireDelay /= 1.25;
    t.level++;
    state.particles.push(new Particle({ kind: 'ring', x: t.x, y: t.y, size: 44, color: OWNER_COLORS[t.owner], life: 0.45 }));
    spawnText(t.x, t.y - 30, 'UPGRADED! LV ' + t.level, '#ffd54a', 14);
    Sound.play('upgrade');
    noteActionFeed(seat, 'upgraded ' + t.def.name + ' → LV ' + t.level);
  } else if (a.op === 'sell') {
    const t = towerAtPad(a.pad);
    if (!t) return;
    addCoins(t.sellValue());
    noteActionFeed(seat, 'sold ' + t.def.name + ' (+' + t.sellValue() + ')');
    state.particles.push(new Particle({ kind: 'ring', x: t.x, y: t.y, size: 36, color: OWNER_COLORS[t.owner], life: 0.4 }));
    PADS[t.padIndex].tower = null;
    state.towers.splice(state.towers.indexOf(t), 1);
    Sound.play('sell');
  }
  if (state.selPadIdx !== null) updateInspector();
}

function noteActionFeed(seat, str) {
  state.lastActions = state.lastActions || ['', ''];
  state.lastActions[seat] = (seat === state.net.seat ? 'YOU ' : nameOf(seat) + ' ') + str;
  if (isHost()) hostPublish('act', { seat, str });
  updateConsoles();
}

function tryStartWave() {
  if (state.phase !== 'countdown') return;
  if (state.countdown > 0.25 && isHost()) {
    addCoins(EARLY_BONUS);
    toastMsg('+' + EARLY_BONUS + ' EARLY WAVE BONUS', 'gold');
  }
  startWave();
}

// ---- host: build & publish a world snapshot ----
function buildSync() {
  return {
    type: 'sync',
    coins: Math.round(state.coins),
    hp: Math.max(0, Math.ceil(state.hp)),
    wave: state.wave,
    phase: state.phase,
    cd: state.phase === 'countdown' ? r1(state.countdown) : 0,
    paused: state.paused,
    kills: state.kills,
    wstart: state.waveStarts,
    bossName: state.bossName || '',
    lastAct: state.lastActions || ['', ''],
    towers: state.towers.map(t => ({
      i: t.padIndex, o: t.owner, ty: t.type, lv: t.level,
      d: r1(t.damage), r: Math.round(t.range), f: r1(1 / t.fireDelay),
      k: t.kills, inv: t.invested, a: r1(t.angle),
    })),
    enemies: state.enemies.map(e => ({
      id: e.eid, ty: e.type, d: r1(e.dist), s: r1(e.speed),
      hp: Math.max(0, Math.ceil(e.hp)), m: e.maxHp,
    })),
    fx: {
      bm: pend.bm.splice(0, 20),
      bo: pend.bo.splice(0, 24),
      kl: pend.kl.splice(0, 24),
      sk: pend.sk.splice(0, 24),
      tx: pend.tx.splice(0, 20),
      sh: pend.sh, nx: pend.nx,
    },
  };
}

function flushPend() {
  pend.bm.length = 0; pend.bo.length = 0; pend.kl.length = 0;
  pend.sk.length = 0; pend.tx.length = 0; pend.sh = 0; pend.nx = 0;
}

// ---- guest: apply a snapshot ----
function applySync(s) {
  state.lastSyncAt = performance.now();
  state.warnedHostLost = false;
  state.coins = s.coins;
  state.hp = s.hp;
  state.wave = s.wave;
  state.kills = s.kills;
  state.paused = s.paused;
  state.bossName = s.bossName || '';
  state.lastActions = s.lastAct || ['', ''];

  // towers (rebuilt from snapshot)
  state.towers = s.towers.map(st => {
    const t = new Tower(st.i, st.ty, st.o);
    t.level = st.lv;
    t.damage = st.d; t.range = st.r; t.fireDelay = 1 / Math.max(0.01, st.f);
    t.kills = st.k; t.invested = st.inv; t.angle = st.a;
    return t;
  });
  for (const p of PADS) p.tower = null;
  for (const t of state.towers) PADS[t.padIndex].tower = t;

  // enemies: merge into interpolated local entities
  const seen = new Set();
  for (const se of s.enemies) {
    seen.add(se.id);
    let e = state.enemies.find(x => x.eid === se.id);
    if (!e) {
      e = {
        eid: se.id, type: se.ty, def: ENEMY_TYPES[se.ty],
        radius: ENEMY_TYPES[se.ty].r, d: se.d, speed: se.s,
        hp: se.hp, maxHp: se.m, alive: true,
        flash: 0, seed: Math.random() * 100, x: -99, y: -99, angle: 0,
      };
      state.enemies.push(e);
    } else {
      e.speed = se.s; e.hp = se.hp; e.maxHp = se.m;
      e.d += (se.d - e.d) * 0.35;
    }
  }
  state.enemies = state.enemies.filter(e => {
    if (seen.has(e.eid)) return true;
    return false; // host removed it (killed or leaked) — its fx event covers the visuals
  });
  for (const e of state.enemies) {
    e.d = Math.min(e.d, PATH.total);
    const p = posAtDist(e.d);
    e.x = p.x; e.y = p.y; e.angle = p.angle;
  }

  // visual effects
  const fx = s.fx || {};
  for (const b of (fx.bm || [])) {
    state.beams.push({ x1: b[0], y1: b[1], x2: b[2], y2: b[3], life: 0.08, maxLife: 0.08, color: b[4] });
    Sound.play('laser');
  }
  for (const k of (fx.kl || [])) {
    explode(k[0], k[1], k[3], k[2] >= 150 ? 30 : 10, k[2] >= 150 ? 220 : 130, k[2] >= 150 ? 5 : 3);
    spawnText(k[0], k[1] - 14, '+' + k[2] + ' 🪙', '#ffd54a', 14);
    Sound.play(k[2] >= 150 ? 'bigboom' : 'boom');
    Sound.play('coin');
    state.kills++;
  }
  for (const bo of (fx.bo || [])) explode(bo[0], bo[1], bo[2], 8, 120, bo[3]);
  for (const sk of (fx.sk || [])) {
    state.particles.push(new Particle({ kind: 'flash', x: sk[0], y: sk[1], size: 9, color: '#ffffff', life: 0.1 }));
    Sound.play(sk[2]);
  }
  for (const tx of (fx.tx || [])) spawnText(tx[0], tx[1], tx[2], tx[3], tx[4]);
  if (fx.sh) state.shake = Math.max(state.shake, Math.min(fx.sh, 3));
  if (fx.nx) {
    explode(NEXUS.x, NEXUS.y, '#ff4d5e', 12, 140, 3);
    spawnText(NEXUS.x, NEXUS.y - 40, '-' + fx.nx, '#ff6b6b', 15);
    Sound.play('hit');
    bumpEl(chipHp);
  }

  // phase transitions
  if (s.wstart !== state.lastWaveStarts) {
    state.lastWaveStarts = s.wstart;
    hideAnnounce();
    warnEl.classList.remove('on'); void warnEl.offsetWidth; warnEl.classList.add('on');
    setTimeout(() => warnEl.classList.remove('on'), 2400);
    $('mp-warn-name').textContent = s.bossName || BOSS_NAMES[0];
    Sound.play('boss');
  }
  if (s.phase === 'countdown') {
    state.phase = 'countdown';
    state.countdown = s.cd;
    if (s.cd <= COUNTDOWN_TIME) {
      const n = Math.max(1, Math.ceil(s.cd));
      if (n !== state.lastCountNum) {
        state.lastCountNum = n;
        announce('WAVE ' + s.wave + ' INCOMING', String(n), 'count', 0);
        popDigit();
      }
    }
  } else if (state.phase === 'countdown' && s.phase !== 'countdown') {
    state.lastCountNum = null;
  }
  if (s.phase === 'wave') state.phase = 'wave';
  if (s.phase !== 'gameover' && state.phase === 'gameover') state.phase = 'wave';
  state.spawnQueue = [];
  state.spawnIdx = 0;
  bossBarEl.classList.toggle('on', state.enemies.some(e => e.type === 'boss'));
  if (bossBarEl.classList.contains('on')) bossNameEl.textContent = s.bossName || 'OMEGA TITAN';
  updateWaveButton();
  updateShopUI();
  updateInspector();
  updateConsoles();
}

// ---- polling loops (both sides poll; host also publishes) ----
let netAcc = 0;
let NET_SESSION = 0; // bumped on every room create/join — stale loops self-terminate

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
      const prev = state.net.names;
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
        if (res.seats.count < 2 && state.net.hadTwo && !state.warnedGuestLost) {
          state.warnedGuestLost = true;
          if (isHost()) { state.paused = true; announce('PLAYER 2 DISCONNECTED', 'GAME PAUSED', 'bad', 0); }
        } else if (res.seats.count === 2 && state.warnedGuestLost) {
          state.warnedGuestLost = false;
          if (isHost()) { state.paused = false; hideAnnounce(); }
          announce('PLAYER RECONNECTED', 'RESUME DEFENSE', 'good', 1800);
        }
      }
      void prev;
    }
  } catch (e) {
    state.net.pollFail++;
    if (state.net.pollFail > 3 && state.screen === 'game' && !isHost() &&
        performance.now() - state.lastSyncAt > 8000 && !state.warnedHostLost) {
      state.warnedHostLost = true;
      announce('CONNECTION LOST', 'HOST IS GONE', 'bad', 0);
    }
  }
  if (state.net.code) setTimeout(pollLoop, 60);
}

function handleEvent(ev) {
  if (ev.type === 'sync' && !isHost()) {
    applySync(ev.data);
    return;
  }
  if (ev.type === 'act' && isHost()) { applyAction(ev.data, ev.seat); return; }
  if (ev.type === 'ann' && !isHost()) {
    const d = ev.data;
    announce(d.title, d.sub, d.cls, d.hold);
    return;
  }
  if (ev.type === 'start' && !isHost() && state.screen !== 'game') {
    startBattle();
    return;
  }
  if (ev.type === 'over' && !isHost()) { showGameOver(ev.data); return; }
  if (ev.type === 'deny' && !isHost()) { deny(ev.data.msg); return; }
  if (ev.type === 'left') {
    toastMsg((ev.data && ev.data.name ? ev.data.name : 'PLAYER') + ' LEFT THE ROOM');
    return;
  }
}

// ---- host: periodic authoritative snapshot ----
function hostSyncTick(dt) {
  netAcc += dt;
  if (netAcc >= 0.08) {
    netAcc = 0;
    const s = buildSync();
    clearAccumulators();
    hostPublish('sync', s);
  }
}

/* ========================= INPUT ========================= */
function canvasPos(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}

function onCanvasClick(e) {
  if (state.screen !== 'game' || state.phase === 'gameover') return;
  Sound.ensure();
  const p = canvasPos(e);
  const pad = padAt(p.x, p.y);
  if (pad) {
    if (pad.tower) {
      state.selPadIdx = pad.tower.padIndex;
      state.buildChoice = null;
      updateShopUI(); updateInspector();
    } else if (state.buildChoice) {
      publishAction({ op: 'build', pad: pad.i, tower: state.buildChoice });
      state.buildChoice = null;
      updateShopUI();
    } else {
      state.selPadIdx = pad.i;
      updateInspector();
    }
    Sound.play('click');
  } else {
    state.selPadIdx = null;
    updateInspector();
  }
}

function onCardClick(type) {
  if (state.screen !== 'game' || state.phase === 'gameover') return;
  Sound.ensure();
  Sound.play('click');
  if (state.selPadIdx !== null && !towerAtPad(state.selPadIdx)) {
    publishAction({ op: 'build', pad: state.selPadIdx, tower: type });
    state.buildChoice = null;
    updateShopUI();
    return;
  }
  state.buildChoice = state.buildChoice === type ? null : type;
  state.selPadIdx = null;
  updateShopUI();
  updateInspector();
}

/* ========================= UPDATE ========================= */
function updateHost(dt) {
  state.time += dt;
  state.coinsShown += (state.coins - state.coinsShown) * Math.min(1, dt * 8);
  if (Math.abs(state.coins - state.coinsShown) < 0.6) state.coinsShown = state.coins;
  state.shake = Math.max(0, state.shake - dt * 22);
  if (pend.sh < state.shake) pend.sh = state.shake;

  for (const p of state.particles) p.update(dt);
  state.particles = state.particles.filter(p => !p.dead);
  for (const b of state.beams) b.life -= dt;
  state.beams = state.beams.filter(b => b.life > 0);

  if (state.phase === 'gameover') return;

  if (state.phase === 'countdown') {
    state.countdown -= dt;
    if (state.countdown <= COUNTDOWN_TIME) {
      const n = Math.max(1, Math.ceil(state.countdown));
      if (n !== state.lastCountNum) {
        state.lastCountNum = n;
        announce('WAVE ' + state.wave + ' INCOMING', String(n), 'count', 0);
        popDigit();
      }
    }
    if (state.countdown <= 0) startWave();
  } else if (state.phase === 'wave') {
    state.waveTime += dt;
    const q = state.spawnQueue;
    while (state.spawnIdx < q.length && q[state.spawnIdx].t <= state.waveTime) {
      spawnEnemy(q[state.spawnIdx].type);
      state.spawnIdx++;
    }
    if (state.spawnIdx >= q.length && state.enemies.length === 0) completeWave();
  }

  for (const e of state.enemies) e.update(dt);
  state.enemies = state.enemies.filter(e => e.alive);
  for (const t of state.towers) t.update(dt);
  for (const p of state.projectiles) p.update(dt);
  state.projectiles = state.projectiles.filter(p => !p.dead);
}

function updateGuest(dt) {
  state.time += dt;
  state.coinsShown += (state.coins - state.coinsShown) * Math.min(1, dt * 8);
  if (Math.abs(state.coins - state.coinsShown) < 0.6) state.coinsShown = state.coins;
  state.shake = Math.max(0, state.shake - dt * 22);
  for (const p of state.particles) p.update(dt);
  state.particles = state.particles.filter(p => !p.dead);
  for (const b of state.beams) b.life -= dt;
  state.beams = state.beams.filter(b => b.life > 0);
  if (state.phase === 'gameover') return;
  // smooth local interpolation between snapshots
  for (const e of state.enemies) {
    e.d = Math.min(e.d + e.speed * dt, PATH.total);
    e.flash = Math.max(0, e.flash - dt);
    const p = posAtDist(e.d);
    e.x = p.x; e.y = p.y; e.angle = p.angle;
  }
}

/* ========================= HUD ========================= */
const hudCache = {};
function setText(el, key, v) {
  if (hudCache[key] !== v) { hudCache[key] = v; el.textContent = v; }
}

function updateHUD() {
  setText(hpVal, 'hp', String(Math.max(0, state.hp)));
  setText(coinsVal, 'coins', Math.floor(state.coinsShown).toLocaleString('en-US'));
  setText(waveVal, 'wave', String(Math.max(1, state.wave)));
  setText(enemiesVal, 'en', String(state.enemies.length +
    (isHost() ? (state.spawnQueue.length - state.spawnIdx) : 0)));
  const critical = state.hp <= 35 && state.phase !== 'gameover';
  chipHp.classList.toggle('critical', critical);
  vignetteEl.classList.toggle('on', critical);
  const boss = state.enemies.find(e => e.type === 'boss');
  if (boss) bossFillEl.style.width = Math.max(0, boss.hp / boss.maxHp * 100) + '%';
  if (state.phase === 'wave' && isHost()) {
    const s = enemiesRemaining() + ' HOSTILES REMAINING';
    if (hudCache.wsub !== s) { hudCache.wsub = s; $('mp-wave-sub').textContent = s; }
  }
}

function popDigit() {
  annSub.classList.remove('pop');
  void annSub.offsetWidth;
  annSub.classList.add('pop');
}

/* ========================= RENDER ========================= */
function polyPath(c, n, r, rot = 0) {
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + i / n * Math.PI * 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.closePath();
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
}

/* ---- cartoon space scenery ---- */
const STARS = Array.from({ length: 120 }, () => ({
  x: Math.random() * W, y: Math.random() * H,
  r: 0.6 + Math.random() * 1.5,
  tw: Math.random() * Math.PI * 2,
  sp: 0.6 + Math.random() * 1.8,
}));
const NEBULAS = [
  { x: 210, y: 160, r: 270, c: 'rgba(124, 77, 255, 0.15)', dx: 5, dy: 3 },
  { x: 730, y: 430, r: 310, c: 'rgba(0, 150, 199, 0.13)', dx: -4, dy: 4 },
  { x: 500, y: 300, r: 210, c: 'rgba(255, 105, 220, 0.07)', dx: 4, dy: -5 },
];
const PLANETS = [
  { x: 84, y: 84, r: 25, c1: '#8ff0ff', c2: '#2b6fb0', ring: true },
  { x: 902, y: 66, r: 15, c1: '#ffd98a', c2: '#c77b3a', ring: false },
  { x: 56, y: 548, r: 11, c1: '#c9a0ff', c2: '#6a3fb5', ring: false },
];
let shooting = null;
let shootingTimer = 4;

function drawGrid(dt) {
  // deep-space gradient
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#101735');
  bg.addColorStop(0.55, '#0b1128');
  bg.addColorStop(1, '#080c1e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // drifting nebulas
  for (const n of NEBULAS) {
    const nx = n.x + Math.sin(state.time * 0.05 * n.dx) * 28;
    const ny = n.y + Math.cos(state.time * 0.05 * n.dy) * 18;
    const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, n.r);
    g.addColorStop(0, n.c);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(nx - n.r, ny - n.r, n.r * 2, n.r * 2);
  }
  // cartoon planets
  for (const p of PLANETS) {
    const g = ctx.createRadialGradient(p.x - p.r * 0.4, p.y - p.r * 0.4, p.r * 0.2, p.x, p.y, p.r);
    g.addColorStop(0, p.c1);
    g.addColorStop(1, p.c2);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    if (p.ring) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r * 1.65, p.r * 0.5, -0.35, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // twinkling stars
  for (const s of STARS) {
    ctx.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(state.time * s.sp + s.tw));
    ctx.fillStyle = s.r > 1.4 ? '#cfeaff' : '#ffffff';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // the occasional shooting star
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
    ctx.strokeStyle = 'rgba(255,255,255,' + Math.max(0, shooting.life) * 0.8 + ')';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shooting.x, shooting.y);
    ctx.lineTo(shooting.x - shooting.vx * 0.13, shooting.y - shooting.vy * 0.13);
    ctx.stroke();
    if (shooting.life <= 0 || shooting.x > W + 80) shooting = null;
  }
}

function pathPolyline() {
  ctx.beginPath();
  ctx.moveTo(WAYPOINTS[0][0], WAYPOINTS[0][1]);
  for (let i = 1; i < WAYPOINTS.length; i++) ctx.lineTo(WAYPOINTS[i][0], WAYPOINTS[i][1]);
}

function drawPath() {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // soft outer glow
  ctx.strokeStyle = 'rgba(120, 190, 255, 0.13)';
  ctx.lineWidth = 48;
  pathPolyline(); ctx.stroke();
  // chunky road
  ctx.strokeStyle = '#1c2650';
  ctx.lineWidth = 40;
  pathPolyline(); ctx.stroke();
  ctx.strokeStyle = 'rgba(130, 200, 255, 0.10)';
  ctx.lineWidth = 32;
  pathPolyline(); ctx.stroke();
  // flowing energy dots
  ctx.strokeStyle = 'rgba(150, 215, 255, 0.6)';
  ctx.lineWidth = 3.5;
  ctx.setLineDash([3, 24]);
  ctx.lineDashOffset = -state.time * 55;
  pathPolyline(); ctx.stroke();
  ctx.setLineDash([]);
  // bouncy direction arrows
  ctx.fillStyle = 'rgba(160, 220, 255, 0.42)';
  for (let d = 55; d < PATH.total; d += 90) {
    const p = posAtDist(d);
    const bounce = Math.sin(state.time * 4 + d * 0.05) * 1.6;
    ctx.save();
    ctx.translate(p.x, p.y + bounce);
    ctx.rotate(p.angle);
    ctx.beginPath();
    ctx.moveTo(6, 0); ctx.lineTo(-4, 6); ctx.lineTo(-1.5, 0); ctx.lineTo(-4, -6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // cruising lights
  for (let i = 0; i < 6; i++) {
    const d = (state.time * 90 + i * PATH.total / 6) % PATH.total;
    const p = posAtDist(d);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 11);
    g.addColorStop(0, 'rgba(190, 240, 255, 0.9)');
    g.addColorStop(1, 'rgba(190, 240, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fill();
  }
}

function drawPads() {
  for (const p of PADS) {
    const isSel = state.selPadIdx === p.i;
    const t = p.tower;
    const pulse = 0.5 + 0.5 * Math.sin(state.time * 2.4 + p.x * 0.05);
    const oc = t ? OWNER_COLORS[t.owner] : null;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (!t) {
      const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 34);
      g.addColorStop(0, 'rgba(130, 220, 255,' + (0.10 + pulse * 0.12) + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill();
    }
    // round landing pad
    ctx.beginPath(); ctx.arc(0, 0, 21, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(23, 34, 68, 0.92)';
    ctx.fill();
    ctx.lineWidth = isSel ? 4 : 3;
    ctx.strokeStyle = isSel ? '#c9f6ff'
      : oc ? oc
      : 'rgba(130, 200, 255, ' + (0.35 + pulse * 0.3) + ')';
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.strokeStyle = isSel ? 'rgba(201, 246, 255, 0.7)'
      : oc ? 'rgba(' + hexRgb(oc) + ',0.55)'
      : 'rgba(130, 200, 255, 0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (!t) {
      ctx.fillStyle = 'rgba(170, 235, 255,' + (0.3 + pulse * 0.5) + ')';
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

function drawNexus() {
  const crit = state.hp <= 35;
  const pulse = 0.5 + 0.5 * Math.sin(state.time * (crit ? 6 : 2.2));
  const glowCol = crit ? 'rgba(255, 90, 110, 0.4)' : 'rgba(110, 220, 255, 0.3)';
  const g = ctx.createRadialGradient(NEXUS.x, NEXUS.y, 4, NEXUS.x, NEXUS.y, 74);
  g.addColorStop(0, glowCol);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(NEXUS.x, NEXUS.y, 74, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.translate(NEXUS.x, NEXUS.y);
  // ring behind the planet
  ctx.rotate(-0.35);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(0, 0, 40, 13, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(160, 230, 255, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 45, 15.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.rotate(0.35);
  // cartoon planet body
  const body = ctx.createRadialGradient(-8, -9, 4, 0, 0, 26);
  if (crit) {
    body.addColorStop(0, '#ffd3d8');
    body.addColorStop(0.5, '#ff6b7a');
    body.addColorStop(1, '#b32036');
  } else {
    body.addColorStop(0, '#d9f7ff');
    body.addColorStop(0.5, '#5fd4ff');
    body.addColorStop(1, '#2570c9');
  }
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(0, 0, 25 + pulse * 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.stroke();
  // happy face
  ctx.fillStyle = '#123055';
  ctx.beginPath(); ctx.arc(-8, -4, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(8, -4, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#123055';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (crit) {
    ctx.arc(0, 12, 6, Math.PI * 1.15, Math.PI * 1.85); // worried mouth
  } else {
    ctx.arc(0, 6, 7, Math.PI * 0.15, Math.PI * 0.85);  // smile
  }
  ctx.stroke();
  // cheek blush
  ctx.fillStyle = crit ? 'rgba(255, 120, 140, 0.5)' : 'rgba(255, 140, 190, 0.4)';
  ctx.beginPath(); ctx.arc(-14, 4, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(14, 4, 3.4, 0, Math.PI * 2); ctx.fill();
  // orbiting sparkles
  for (let i = 0; i < 3; i++) {
    const a = state.time * 1.2 + i / 3 * Math.PI * 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 46, Math.sin(a) * 17, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // hp bar
  const bw = 58, ratio = Math.max(0, state.hp / START_HP);
  ctx.fillStyle = 'rgba(8, 14, 30, 0.85)';
  ctx.beginPath();
  ctx.roundRect(NEXUS.x - bw / 2, NEXUS.y + 40, bw, 8, 4);
  ctx.fill();
  ctx.fillStyle = ratio > 0.5 ? '#5ded9f' : ratio > 0.25 ? '#ffd54a' : '#ff6b6b';
  ctx.beginPath();
  ctx.roundRect(NEXUS.x - bw / 2, NEXUS.y + 40, Math.max(3, bw * ratio), 8, 4);
  ctx.fill();
}

function renderTowerGlyph(c, type, level, angle, time, recoil) {
  const def = TOWER_TYPES[type];
  // soft base platform
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
    // camera-lens eye
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
    // plasma: chunky round cannon
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

function drawTower(t) {
  const oc = OWNER_COLORS[t.owner];
  // colored team glow under the tower
  const g = ctx.createRadialGradient(t.x, t.y, 2, t.x, t.y, 24);
  g.addColorStop(0, 'rgba(' + hexRgb(oc) + ',0.32)');
  g.addColorStop(1, 'rgba(' + hexRgb(oc) + ',0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(t.x, t.y, 24, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(t.x, t.y);
  renderTowerGlyph(ctx, t.type, t.level, t.angle, state.time, t.recoil || 0);
  ctx.restore();
  // team badge balloon
  const bx = t.x + 15, by = t.y - 21 - Math.sin(state.time * 3 + t.padIndex) * 1.5;
  ctx.fillStyle = oc;
  ctx.beginPath(); ctx.arc(bx, by, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#eaf6ff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(234, 246, 255, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx, by + 4.5);
  ctx.lineTo(t.x + 9, t.y - 9);
  ctx.stroke();
}

// cartoon googly eyes, drawn upright so they always face the camera
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

function drawEnemy(e) {
  const bob = Math.sin(state.time * 8 + e.seed) * 1.8;
  const y = e.y + bob;
  // soft shadow blob under the body
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + e.radius * 0.9, e.radius * 0.9, e.radius * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(e.x, y);
  const wig = Math.sin(state.time * 9 + e.seed) * 0.08; // cartoon wobble
  ctx.rotate(e.angle + wig);
  ctx.lineWidth = 3;

  if (e.type === 'scout') {
    // round orange blob with antenna
    ctx.fillStyle = '#ff9a4d';
    ctx.strokeStyle = '#d9662a';
    ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-2, -e.radius); ctx.quadraticCurveTo(-6, -e.radius - 7, 0, -e.radius - 8);
    ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ffe3b3';
    ctx.beginPath(); ctx.arc(0, -e.radius - 8, 2.4, 0, Math.PI * 2); ctx.fill();
  } else if (e.type === 'speed') {
    // comet with trail bubbles
    ctx.fillStyle = 'rgba(255, 210, 61, 0.4)';
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(-e.radius - i * 5, Math.sin(state.time * 10 + i) * 2, e.radius * (0.7 - i * 0.15), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffd23d';
    ctx.strokeStyle = '#d9a520';
    ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (e.type === 'tank') {
    // chunky armoured truck
    ctx.fillStyle = '#9fb2d8';
    ctx.strokeStyle = '#5c6f96';
    ctx.beginPath();
    ctx.roundRect(-e.radius, -e.radius * 0.85, e.radius * 2, e.radius * 1.7, 7);
    ctx.fill(); ctx.stroke();
    // treads
    ctx.fillStyle = '#42527a';
    ctx.beginPath();
    ctx.roundRect(-e.radius + 1, -e.radius * 0.85 - 4, e.radius * 2 - 2, 5, 2.5);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-e.radius + 1, e.radius * 0.85 - 1, e.radius * 2 - 2, 5, 2.5);
    ctx.fill();
    // front light
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath(); ctx.arc(e.radius - 3, 0, 3, 0, Math.PI * 2); ctx.fill();
  } else if (e.type === 'elite') {
    // ringed purple planet
    const aura = 0.35 + 0.25 * Math.sin(state.time * 5 + e.seed);
    ctx.strokeStyle = 'rgba(200, 140, 255,' + aura + ')';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, e.radius + 5, 0, Math.PI * 2); ctx.stroke();
    const g = ctx.createRadialGradient(-3, -4, 2, 0, 0, e.radius);
    g.addColorStop(0, '#e6c2ff');
    g.addColorStop(1, '#8a3bd1');
    ctx.fillStyle = g;
    ctx.strokeStyle = '#5b1e8a';
    ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(230, 194, 255, 0.75)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, e.radius * 1.55, e.radius * 0.5, -0.4, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // big angry boss planet with a moon buddy
    const g = ctx.createRadialGradient(-8, -9, 3, 0, 0, e.radius);
    g.addColorStop(0, '#ff9aa4');
    g.addColorStop(1, '#c22733');
    ctx.fillStyle = g;
    ctx.strokeStyle = '#8e1226';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // craters
    ctx.fillStyle = 'rgba(140, 20, 35, 0.55)';
    ctx.beginPath(); ctx.arc(-e.radius * 0.45, e.radius * 0.3, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(e.radius * 0.4, -e.radius * 0.5, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(e.radius * 0.25, e.radius * 0.5, 2.6, 0, Math.PI * 2); ctx.fill();
    // moon buddy orbit
    const ma = state.time * 1.6;
    ctx.fillStyle = '#ffd1d6';
    ctx.strokeStyle = '#c96a76';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(Math.cos(ma) * (e.radius + 11), Math.sin(ma) * (e.radius * 0.45), 5, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
  // hit flash
  if (e.flash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, e.flash * 10) * 0.75;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(0, 0, e.radius * 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();

  // face — drawn upright so it always reads as cute
  const es = e.type === 'boss' ? 5.5 : e.type === 'tank' ? 3.4 : e.type === 'elite' ? 3 : 2.7;
  const eyeY = y - e.radius * 0.15;
  const angry = e.type === 'boss' || e.type === 'tank';
  drawEyes(ctx, e.x, eyeY, e.angle, es, e.radius * 0.45, angry);
  if (e.type === 'boss') {
    // grumpy frown
    ctx.strokeStyle = '#1b2438';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(e.x, eyeY + e.radius * 0.55, 6, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }

  // health bar
  if (e.hp < e.maxHp) {
    const w = e.def.boss ? 60 : 22, h = 5;
    const ratio = Math.max(0, e.hp / e.maxHp);
    const bx = e.x - w / 2, by = y - e.radius - 13;
    ctx.fillStyle = 'rgba(8, 14, 30, 0.85)';
    ctx.beginPath(); ctx.roundRect(bx, by, w, h, 2.5); ctx.fill();
    ctx.fillStyle = ratio > 0.5 ? '#5ded9f' : ratio > 0.25 ? '#ffd54a' : '#ff6b6b';
    if (ratio > 0) {
      ctx.beginPath(); ctx.roundRect(bx, by, Math.max(2.5, w * ratio), h, 2.5); ctx.fill();
    }
  }
}

function drawBeams() {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const b of state.beams) {
    const a = b.life / b.maxLife;
    ctx.globalAlpha = 0.25 * a;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    ctx.globalAlpha = 0.95 * a;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawProjectiles() {
  ctx.globalCompositeOperation = 'lighter';
  for (const p of state.projectiles) {
    ctx.strokeStyle = p.color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.splash ? 6 : 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.splash ? 2.8 : 1.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawParticles() {
  for (const p of state.particles) {
    const a = Math.max(0, p.life / p.maxLife);
    if (p.kind === 'spark') {
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === 'ring') {
      const r = p.size * (1 - a) + 3;
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    } else if (p.kind === 'flash') {
      ctx.globalAlpha = a * 0.6;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - a * 0.6), 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    } else if (p.kind === 'text') {
      ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.font = 'bold ' + p.size + 'px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
      ctx.textAlign = 'start';
    }
  }
  ctx.globalAlpha = 1;
}

function drawRangeOverlay() {
  const selTower = state.selPadIdx !== null ? towerAtPad(state.selPadIdx) : null;
  const hov = padAt(state.hover.x, state.hover.y);
  const list = [];
  if (selTower) list.push({ t: selTower, strong: true });
  if (hov && hov.tower && hov.tower !== selTower) list.push({ t: hov.tower, strong: false });
  for (const { t, strong } of list) {
    ctx.globalAlpha = strong ? 0.5 : 0.3;
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 8]);
    ctx.lineDashOffset = -state.time * 20;
    ctx.beginPath(); ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = strong ? 0.07 : 0.04;
    ctx.fillStyle = '#00e5ff';
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (state.selPadIdx !== null && !towerAtPad(state.selPadIdx) && state.buildChoice) {
    const def = TOWER_TYPES[state.buildChoice];
    const p = PADS[state.selPadIdx];
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = def.color;
    ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.arc(p.x, p.y, def.range, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.3;
    ctx.save();
    ctx.translate(p.x, p.y);
    renderTowerGlyph(ctx, state.buildChoice, 1, -Math.PI / 2, state.time, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

function render(dt) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (state.shake > 0) {
    ctx.translate((Math.random() * 2 - 1) * state.shake, (Math.random() * 2 - 1) * state.shake);
  }
  drawGrid(dt || 0.016);
  drawPath();
  drawPads();
  drawNexus();
  for (const t of state.towers) drawTower(t);
  for (const e of state.enemies) drawEnemy(e);
  drawBeams();
  drawProjectiles();
  drawParticles();
  drawRangeOverlay();
  ctx.restore();
  if (state.paused && state.phase !== 'gameover') {
    ctx.fillStyle = 'rgba(2,6,14,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#eaffff';
    ctx.font = '900 40px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', W / 2, H / 2);
    ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#7fa8c9';
    ctx.fillText('WAITING FOR HOST…', W / 2, H / 2 + 30);
    ctx.textAlign = 'start';
  }
}

/* ========================= FLOW ========================= */
function showScreen(name) {
  state.screen = name;
  $('mp-menu').classList.toggle('hidden', name !== 'menu');
  $('mp-wait').classList.toggle('hidden', name !== 'wait');
  $('mp-game').classList.toggle('hidden', name !== 'game');
  if (name === 'game') fitCanvas();
}

function updateWaitScreen(count) {
  const st = $('mp-wait-status');
  const list = $('mp-wait-players');
  list.innerHTML = state.net.names.map((n, i) =>
    `<div class="wait-player s${i}"><span class="dot"></span>P${i + 1} — ${n || 'WAITING…'}</div>`
  ).join('');
  if (count >= 2) st.textContent = 'PLAYER 2 CONNECTED — LAUNCHING BATTLE…';
  else st.textContent = 'WAITING FOR A SECOND PLAYER…';
}

async function createRoom() {
  const name = $('mp-name').value.trim() || 'COMMANDER';
  try {
    localStorage.setItem('mp_name', name);
  } catch (e) { /* ignore */ }
  try {
    const res = await api('create', { name: 'ROOM ' + name, playerName: name, mode: 'coop' });
    NET_SESSION++;
    state.net = { code: res.code, token: res.token, seat: res.seat, since: 0,
      names: [name, ''], pollFail: 0, syncing: false, session: NET_SESSION };
    $('mp-room-tag').textContent = '#' + res.code;
    state.role = 'host';
    $('mp-wait-code').textContent = res.code;
    showScreen('wait');
    updateWaitScreen(1);
    pollLoop();
  } catch (e) {
    toastMsg('COULD NOT CREATE ROOM — IS server.py RUNNING?');
  }
}

async function joinRoom(code) {
  const name = $('mp-name').value.trim() || 'COMMANDER';
  try {
    localStorage.setItem('mp_name', name);
  } catch (e) { /* ignore */ }
  try {
    const res = await api('join', { code, playerName: name, mode: 'coop' });
    NET_SESSION++;
    state.net = { code: res.code, token: res.token, seat: res.seat, since: 0,
      names: ['', ''], pollFail: 0, syncing: false, session: NET_SESSION };
    $('mp-room-tag').textContent = '#' + res.code;
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
  resetGameState();
  showScreen('menu');
  refreshRooms();
}

function startBattle() {
  Sound.ensure();
  state.net.started = true;
  resetGameState();
  showScreen('game');
  fitCanvas();
  if (isHost()) {
    beginCountdown(1);
    hostPublish('start', {});
  }
  announce('CO-OP DEFENSE ONLINE', 'SHARED COINS — COORDINATE!', 'warn', 2200);
  updateConsoles();
  updateShopUI();
  updateInspector();
  updateWaveButton();
}

function resetGameState() {
  state.phase = 'idle';
  state.time = 0; state.paused = false;
  state.coins = START_COINS; state.coinsShown = START_COINS;
  state.hp = START_HP;
  state.wave = 0; state.wavesCompleted = 0; state.kills = 0;
  state.countdown = 0; state.waveTime = 0; state.waveStarts = 0;
  state.spawnQueue = []; state.spawnIdx = 0;
  state.enemies = []; state.towers = []; state.projectiles = [];
  state.beams = []; state.particles = [];
  state.selPadIdx = null; state.buildChoice = null;
  state.shake = 0; state.bossName = '';
  state.lastCountNum = null; state.lastWaveStarts = 0;
  state.lastSyncAt = performance.now();
  state.warnedHostLost = false; state.warnedGuestLost = false;
  state.lastActions = ['', ''];
  eidCounter = 0;
  flushPend();
  for (const p of PADS) p.tower = null;
  bossBarEl.classList.remove('on');
  hideAnnounce();
  toastEl.className = '';
  chipHp.classList.remove('critical');
  vignetteEl.classList.remove('on');
  hudCache.wsub = '';
  updateShopUI();
  updateInspector();
  updateWaveButton();
  updateConsoles();
}

function gameOver() {
  if (state.phase === 'gameover') return;
  state.phase = 'gameover';
  state.paused = false;
  Sound.play('over');
  state.shake = 14;
  for (let i = 0; i < 3; i++) {
    explode(NEXUS.x + (Math.random() * 40 - 20), NEXUS.y + (Math.random() * 40 - 20),
      i === 0 ? '#ff4d3d' : '#ff8c1a', 22, 200, 4);
  }
  const stats = {
    wave: state.wave,
    kills: state.kills,
    coins: Math.round(state.coins),
    names: state.net.names,
  };
  updateWaveButton();
  if (isHost()) {
    hostPublish('over', stats);
    showGameOver(stats);
  }
}

function showGameOver(stats) {
  state.phase = 'gameover';
  hideAnnounce();
  Sound.play('over');
  $('mp-go-wave').textContent = stats.wave;
  $('mp-go-kills').textContent = stats.kills;
  $('mp-go-coins').textContent = stats.coins.toLocaleString('en-US');
  const [n1, n2] = stats.names || state.net.names;
  $('mp-go-names').textContent = (n1 || 'P1') + '  &  ' + (n2 || 'P2');
  $('mp-gameover').classList.add('on');
  updateWaveButton();
}

function fitCanvas() {
  const r = arenaEl.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return;
  const s = Math.min(r.width / W, r.height / H);
  cv.style.width = Math.floor(W * s) + 'px';
  cv.style.height = Math.floor(H * s) + 'px';
}

/* ========================= LOBBY ========================= */
let lobbyTimer = null;

async function refreshRooms() {
  try {
    const res = await api('rooms');
    const list = $('mp-room-list');
    list.innerHTML = '';
    if (!res.rooms.length) {
      list.innerHTML = '<div class="room-empty">NO OPEN ROOMS — CREATE ONE!</div>';
    }
    for (const r of res.rooms) {
      const row = document.createElement('div');
      row.className = 'room-row';
      const full = r.players >= 2;
      row.innerHTML =
        `<div class="room-info"><span class="room-name"></span><span class="room-code">#${r.code}</span></div>` +
        `<span class="room-count ${full ? 'full' : ''}">${r.players}/2</span>`;
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

/* ========================= INIT ========================= */
function buildShop() {
  const shop = $('mp-shop');
  for (const key of Object.keys(TOWER_TYPES)) {
    const def = TOWER_TYPES[key];
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.type = key;
    card.innerHTML =
      '<canvas class="card-icon" width="46" height="46"></canvas>' +
      '<div class="card-info"><div class="card-name">' + def.name + '</div></div>' +
      '<div class="card-cost">' + def.cost + '</div>';
    card.addEventListener('click', () => onCardClick(key));
    shop.appendChild(card);
    const ic = card.querySelector('canvas').getContext('2d');
    ic.translate(23, 24);
    ic.scale(1.25, 1.25);
    renderTowerGlyph(ic, key, 3, -Math.PI / 2, 1.2, 0);
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
  $('mp-btn-leave').addEventListener('click', () => leaveRoom());
  $('mp-btn-lobby').addEventListener('click', () => {
    $('mp-gameover').classList.remove('on');
    leaveRoom();
  });

  $('mp-btn-wave').addEventListener('click', () => publishAction({ op: 'wave' }));
  $('mp-btn-pause').addEventListener('click', () => {
    if (!isHost() || state.phase === 'gameover') return;
    state.paused = !state.paused;
    $('mp-btn-pause').textContent = state.paused ? '▶' : '⏸';
    Sound.play('click');
  });
  $('mp-btn-speed').addEventListener('click', () => {
    if (!isHost()) return;
    state.speed = state.speed === 1 ? 2 : 1;
    $('mp-btn-speed').textContent = state.speed + 'x';
    Sound.play('click');
  });
  $('mp-btn-sound').addEventListener('click', () => {
    Sound.ensure();
    Sound.enabled = !Sound.enabled;
    $('mp-btn-sound').textContent = Sound.enabled ? '🔊' : '🔇';
    if (Sound.enabled) Sound.play('click');
  });

  ['damage', 'range', 'speed'].forEach(stat => {
    $('mp-up-' + stat).addEventListener('click', () => {
      const t = state.selPadIdx !== null ? towerAtPad(state.selPadIdx) : null;
      if (t && t.level < 3) {
        publishAction({ op: 'upgrade', pad: t.padIndex, stat });
        state.selPadIdx = t.padIndex;
      }
    });
  });
  $('mp-btn-sell').addEventListener('click', () => {
    const t = state.selPadIdx !== null ? towerAtPad(state.selPadIdx) : null;
    if (t) publishAction({ op: 'sell', pad: t.padIndex });
  });

  cv.addEventListener('click', onCanvasClick);
  cv.addEventListener('mousemove', e => {
    const p = canvasPos(e);
    state.hover = p;
    cv.style.cursor = padAt(p.x, p.y) ? 'pointer' : 'default';
  });
  cv.addEventListener('mouseleave', () => { state.hover = { x: -999, y: -999 }; });
  cv.addEventListener('contextmenu', e => {
    e.preventDefault();
    state.selPadIdx = null; state.buildChoice = null;
    updateShopUI(); updateInspector();
  });
  window.addEventListener('keydown', e => {
    if (state.screen !== 'game') return;
    if (e.code === 'Escape') {
      state.selPadIdx = null; state.buildChoice = null;
      updateShopUI(); updateInspector();
    }
  });
  window.addEventListener('resize', () => { if (state.screen === 'game') fitCanvas(); });
}

let lastT = performance.now();
let lastFrameAt = performance.now();
let rafPending = false;
function frame(now) {
  rafPending = false;
  lastFrameAt = performance.now();
  const dtRaw = Math.min((now - lastT) / 1000, 0.25); // substeps prevent tunneling
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
    render(dtRaw);
  }
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(frame);
  }
}

// rAF and page timers suspend in hidden tabs, which would freeze the
// host-authoritative sim for BOTH players — worker timers keep ticking.
try {
  const ticker = new Worker(URL.createObjectURL(new Blob(
    ['setInterval(()=>postMessage(0),50)'],
    { type: 'text/javascript' }
  )));
  ticker.onmessage = () => {
    if (performance.now() - lastFrameAt > 400) {
      frame(performance.now());
    }
  };
} catch (e) { /* workers unavailable — rAF alone still drives the game */ }

function init() {
  try {
    $('mp-name').value = localStorage.getItem('mp_name') || '';
  } catch (e) { /* ignore */ }
  buildShop();
  wireEvents();
  updateShopUI();
  updateInspector();
  updateWaveButton();
  updateConsoles();
  showScreen('menu');
  requestAnimationFrame(frame);
}

init();
