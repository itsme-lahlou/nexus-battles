'use strict';
/* ============================================================
   CYBER DEFENSE: NEXUS — script.js
   Vanilla JS tower defense. Sections:
   CONFIG · SOUND · STATE · MAP · ENTITIES · WAVES · ECONOMY ·
   INPUT · UPDATE · RENDER · FLOW · INIT
   ============================================================ */

/* ========================= CONFIG ========================= */
const W = 960, H = 600;

const TOWER_TYPES = {
  pulse:  { key: 'pulse',  name: 'PULSE CANNON',  cost: 100, damage: 14, range: 135, rate: 1.15, projSpeed: 460, splash: 0,  color: '#19d3ff', desc: 'BALANCED DEFENSE' },
  laser:  { key: 'laser',  name: 'LASER NODE',    cost: 180, damage: 5,  range: 125, rate: 4.5,  projSpeed: 0,   splash: 0,  color: '#b366ff', desc: 'RAPID FIRE BEAM' },
  plasma: { key: 'plasma', name: 'PLASMA CANNON', cost: 300, damage: 42, range: 155, rate: 0.45, projSpeed: 280, splash: 60, color: '#ff8c1a', desc: 'HEAVY SPLASH DAMAGE' },
};
const UPGRADE_COSTS = [100, 200]; // level 1→2, 2→3
const SELL_RATE = 0.7;

const ENEMY_TYPES = {
  scout: { key: 'scout', name: 'SCOUT DRONE', hp: 40,  speed: 90,  r: 10, reward: 10,  dmg: 5 },
  speed: { key: 'speed', name: 'SPEED DRONE', hp: 26,  speed: 165, r: 8,  reward: 12,  dmg: 5 },
  tank:  { key: 'tank',  name: 'ARMORED TANK', hp: 160, speed: 46,  r: 15, reward: 25,  dmg: 15 },
  elite: { key: 'elite', name: 'ELITE UNIT',   hp: 115, speed: 72,  r: 13, reward: 40,  dmg: 10 },
  boss:  { key: 'boss',  name: 'OMEGA TITAN',  hp: 700, speed: 32,  r: 24, reward: 150, dmg: 30, boss: true },
};
const BOSS_NAMES = ['OMEGA TITAN', 'VOID REAVER', 'HEX WARLORD', 'NULL DEVOURER'];

const START_COINS = 300, START_HP = 100, COUNTDOWN_TIME = 5, EARLY_BONUS = 25;

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
  screen: 'menu',            // 'menu' | 'game'
  phase: 'idle',             // 'idle' | 'countdown' | 'wave' | 'gameover'
  time: 0, speed: 1, paused: false,
  coins: START_COINS, coinsShown: START_COINS,
  hp: START_HP,
  wave: 0, wavesCompleted: 0, kills: 0, totalCoinsEarned: 0,
  countdown: 0, waveTime: 0,
  spawnQueue: [], spawnIdx: 0,
  enemies: [], towers: [], projectiles: [], beams: [], particles: [],
  selectedTower: null, selectedPad: null, buildChoice: null,
  hover: { x: -999, y: -999 },
  shake: 0, boss: null, bossCount: 0,
};
let lastCountNum = null;

const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const arenaEl = $('arena');
const hpVal = $('hp-val'), coinsVal = $('coins-val'), waveVal = $('wave-val'), enemiesVal = $('enemies-val');
const chipHp = $('chip-hp'), chipCoins = $('chip-coins');
const annEl = $('announce'), annTitle = annEl.querySelector('.ann-title'), annSub = annEl.querySelector('.ann-sub');
const toastEl = $('toast'), vignetteEl = $('vignette');
const bossBarEl = $('bossbar'), bossNameEl = $('boss-name'), bossFillEl = $('boss-fill');

/* ========================= MAP ========================= */
const WAYPOINTS = [
  [-40, 80], [780, 80], [780, 200], [160, 200], [160, 360], [880, 360], [880, 500],
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
  [350, 25], [560, 25],
  [420, 140], [560, 140], [895, 140],
  [80, 280], [300, 280], [520, 280], [740, 280], [920, 270],
  [350, 450], [620, 450],
].map(([x, y]) => ({ x, y, tower: null }));

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

/* ========================= ENTITIES ========================= */
class Enemy {
  constructor(type, hpMul) {
    this.def = ENEMY_TYPES[type];
    this.type = type;
    this.hp = this.maxHp = Math.round(this.def.hp * hpMul);
    // enemies get faster every wave, with noticeable per-enemy variation
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
  damage(amount, tower) {
    if (!this.alive) return;
    this.hp -= amount;
    this.flash = 0.09;
    if (Math.random() < 0.55 || this.hp <= 0) {
      spawnText(this.x + (Math.random() * 14 - 7), this.y - this.radius - 6, String(Math.round(amount)), '#cfefff', 11);
    }
    if (this.hp <= 0) this.die(tower);
  }
  die(tower) {
    this.alive = false;
    state.kills++;
    if (tower) tower.kills++;
    addCoins(this.def.reward, this.x, this.y);
    explode(this.x, this.y, this.bodyColor(), this.def.boss ? 34 : 8 + Math.floor(this.radius), this.def.boss ? 240 : 130, this.def.boss ? 5 : 3);
    Sound.play(this.def.boss ? 'bigboom' : 'boom');
    if (this.def.boss) {
      // hand the boss bar to the next surviving boss in the squad
      state.boss = state.enemies.find(e => e !== this && e.alive && e.def.boss) || null;
      if (!state.boss) bossBarEl.classList.remove('on');
      state.shake = Math.max(state.shake, 12);
      announce('BOSS DESTROYED', '+' + this.def.reward + ' COINS', 'good', 1800);
    }
  }
  bodyColor() {
    return { scout: '#ff8c3d', speed: '#ffd23d', tank: '#ff5d78', elite: '#c05cff', boss: '#ff2038' }[this.type];
  }
  reachNexus() {
    this.alive = false;
    if (this.def.boss) {
      state.boss = state.enemies.find(e => e !== this && e.alive && e.def.boss) || null;
      if (!state.boss) bossBarEl.classList.remove('on');
    }
    damageNexus(this.def.dmg);
  }
}

class Tower {
  constructor(pad, type) {
    this.type = type;
    this.def = TOWER_TYPES[type];
    this.pad = pad;
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
      if (!best || e.dist > best.dist) best = e; // furthest toward the Nexus
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
      target.damage(this.damage, this);
      state.beams.push({ x1: m.x, y1: m.y, x2: target.x, y2: target.y, life: 0.08, maxLife: 0.08, color: this.def.color });
      Sound.play('laser');
    } else {
      state.projectiles.push(new Projectile(m.x, m.y, target, this));
      Sound.play(this.type === 'plasma' ? 'plasma' : 'shoot');
      this.recoil = 1;
    }
  }
  upgrade(stat) {
    if (this.level >= 3) return;
    const cost = UPGRADE_COSTS[this.level - 1];
    const btn = $('up-' + stat);
    if (state.coins < cost) {
      toastMsg('NOT ENOUGH COINS');
      Sound.play('error');
      shakeEl(btn);
      return;
    }
    spendCoins(cost);
    this.invested += cost;
    this.damage *= 1.45;
    this.range *= 1.15;
    this.fireDelay /= 1.18;
    if (stat === 'damage') this.damage *= 1.3;
    if (stat === 'range') this.range *= 1.2;
    if (stat === 'speed') this.fireDelay /= 1.25;
    this.level++;
    state.particles.push(new Particle({ kind: 'ring', x: this.x, y: this.y, size: 44, color: '#ffd54a', life: 0.45 }));
    spawnText(this.x, this.y - 30, 'UPGRADED! LV ' + this.level, '#ffd54a', 14);
    Sound.play('upgrade');
    updateInspector();
    updateShopUI();
  }
  sellValue() { return Math.floor(this.invested * SELL_RATE); }
  sell() {
    addCoins(this.sellValue());
    toastMsg('SOLD +' + this.sellValue() + ' 🪙', 'gold');
    state.particles.push(new Particle({ kind: 'ring', x: this.x, y: this.y, size: 36, color: '#00e5ff', life: 0.4 }));
    this.pad.tower = null;
    state.towers.splice(state.towers.indexOf(this), 1);
    Sound.play('sell');
    deselect();
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
          const falloff = 1 - 0.6 * Math.min(1, dist / this.splash);
          e.damage(this.damage * falloff, this.tower);
        }
      }
      explode(this.x, this.y, this.color, 16, 170, 3.5);
      state.particles.push(new Particle({ kind: 'ring', x: this.x, y: this.y, size: this.splash + 8, color: this.color, life: 0.3 }));
      Sound.play('boom');
    } else if (this.target && this.target.alive) {
      this.target.damage(this.damage, this.tower);
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
}

function spawnText(x, y, text, color, size = 12) {
  if (state.particles.length > 460) return;
  state.particles.push(new Particle({ kind: 'text', x, y, vx: 0, vy: -34, life: 0.75, text, color, size }));
}

/* ========================= WAVES ========================= */
function hpMultiplier(n) { return 1 + (n - 1) * 0.22 + Math.pow(n - 1, 2) * 0.035; }

function buildWave(n) {
  const q = []; let t = 0;
  const add = (type, count, gap) => { for (let i = 0; i < count; i++) { q.push({ type, t }); t += gap; } };
  add('scout', Math.min(14 + n * 5, 70), 0.38);
  if (n >= 2) add('speed', Math.min(2 + n * 2, 40), 0.3);
  if (n >= 3) add('tank', Math.min(2 + Math.floor((n - 3) / 2), 12), 1.3);
  if (n >= 4) add('elite', Math.min(1 + Math.floor((n - 2) / 2), 10), 1.0);
  // a boss squad closes out EVERY wave — boss rewards fuel the economy, keeping it hard but winnable
  const bossCount = Math.min(1 + Math.ceil(n / 2), 12);
  for (let i = 0; i < bossCount; i++) q.push({ type: 'boss', t: t + 1.2 + i * 2.6 });
  return q;
}

function spawnEnemy(type) {
  const e = new Enemy(type, hpMultiplier(state.wave));
  state.enemies.push(e);
  if (e.def.boss) {
    state.boss = e;
    bossNameEl.textContent = BOSS_NAMES[state.bossCount % BOSS_NAMES.length];
    state.bossCount++;
    bossBarEl.classList.add('on');
  }
}

function beginCountdown(n) {
  state.wave = n;
  state.phase = 'countdown';
  state.countdown = n === 1 ? COUNTDOWN_TIME : COUNTDOWN_TIME + 1.5;
  lastCountNum = null;
  updateWaveButton();
}

function startWave() {
  state.phase = 'wave';
  state.waveTime = 0;
  state.spawnIdx = 0;
  state.spawnQueue = buildWave(state.wave);
  // every wave ends with a boss squad — warn dramatically each time
  hideAnnounce(); // clear the wave-incoming countdown text
  $('boss-warn-name').textContent = BOSS_NAMES[state.bossCount % BOSS_NAMES.length];
  const bw = $('boss-warning');
  bw.classList.remove('on'); void bw.offsetWidth; bw.classList.add('on');
  setTimeout(() => bw.classList.remove('on'), 2400);
  state.shake = Math.max(state.shake, 9);
  Sound.play('boss');
  updateWaveButton();
}

function completeWave() {
  const bonus = 80 + state.wave * 15; // richer wave bonus keeps the swarm floods affordable
  state.wavesCompleted++;
  addCoins(bonus);
  announce('WAVE COMPLETE', '+' + bonus + ' COINS', 'good', 1800);
  Sound.play('coin');
  beginCountdown(state.wave + 1);
}

function enemiesRemaining() {
  return state.enemies.length + (state.spawnQueue.length - state.spawnIdx);
}

/* ========================= ECONOMY / UI FEEDBACK ========================= */
function addCoins(n, x, y) {
  state.coins += n;
  state.totalCoinsEarned += n;
  if (x !== undefined) spawnText(x, y - 14, '+' + n + ' 🪙', '#ffd54a', 14);
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
  state.shake = Math.max(state.shake, 6);
  explode(NEXUS.x, NEXUS.y, '#ff4d5e', 12, 140, 3);
  spawnText(NEXUS.x, NEXUS.y - 40, '-' + dmg, '#ff6b6b', 15);
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

let annTimer = null;
function announce(title, sub = '', cls = '', hold = 1500) {
  annTitle.textContent = title;
  annSub.textContent = sub;
  annEl.className = 'show ' + cls;
  clearTimeout(annTimer);
  if (hold > 0) annTimer = setTimeout(() => { annEl.className = ''; }, hold);
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
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function updateShopUI() {
  document.querySelectorAll('.card').forEach(card => {
    const def = TOWER_TYPES[card.dataset.type];
    const afford = state.coins >= def.cost;
    card.classList.toggle('locked', !afford);
    card.classList.toggle('can-buy', afford);
    card.classList.toggle('selected', state.buildChoice === card.dataset.type);
  });
}

function updateWaveButton() {
  const b = $('btn-wave'), l = $('wave-label'), s = $('wave-sub');
  if (state.phase === 'countdown') {
    b.disabled = false;
    l.textContent = 'START WAVE ' + state.wave;
    s.textContent = 'EARLY BONUS +' + EARLY_BONUS + ' 🪙';
  } else if (state.phase === 'wave') {
    b.disabled = true;
    l.textContent = 'WAVE ' + state.wave + ' ACTIVE';
    s.textContent = enemiesRemaining() + ' HOSTILES REMAINING';
  } else {
    b.disabled = true;
    l.textContent = state.phase === 'gameover' ? 'SYSTEM OFFLINE' : 'STANDBY';
    s.textContent = '';
  }
}

function updateInspector() {
  const t = state.selectedTower;
  const empty = $('insp-empty'), body = $('insp-body');
  if (!t) {
    empty.classList.remove('hidden');
    body.classList.add('hidden');
    empty.innerHTML = state.selectedPad
      ? 'PAD SELECTED<br>PICK A TOWER BELOW'
      : 'SELECT A TOWER<br>ON THE GRID';
    return;
  }
  empty.classList.add('hidden');
  body.classList.remove('hidden');
  $('insp-name').textContent = t.def.name;
  $('insp-lv').textContent = 'LV ' + t.level;
  $('insp-stats').innerHTML = `
    <div class="stat"><span>DAMAGE</span><b>${Math.round(t.damage)}</b></div>
    <div class="stat"><span>RANGE</span><b>${Math.round(t.range)}</b></div>
    <div class="stat"><span>FIRE RATE</span><b>${(1 / t.fireDelay).toFixed(1)}/s</b></div>
    <div class="stat"><span>KILLS</span><b>${t.kills}</b></div>`;
  const max = t.level >= 3;
  [['damage', 'DAMAGE'], ['range', 'RANGE'], ['speed', 'SPEED']].forEach(([k, label]) => {
    const b = $('up-' + k);
    b.disabled = max;
    b.querySelector('.up-name').textContent = max ? label + ' MAXED' : 'UPGRADE ' + label;
    b.querySelector('.up-cost').textContent = max ? '—' : UPGRADE_COSTS[t.level - 1] + ' 🪙';
  });
  $('btn-sell').textContent = 'SELL TOWER  +' + t.sellValue() + ' 🪙';
}

/* ========================= INPUT ========================= */
function canvasPos(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}

function deselect() {
  state.selectedTower = null;
  state.selectedPad = null;
  updateInspector();
}

function clearBuildChoice() {
  state.buildChoice = null;
  updateShopUI();
}

function tryBuild(pad, type) {
  const def = TOWER_TYPES[type];
  if (pad.tower) return;
  if (state.coins < def.cost) {
    toastMsg('NOT ENOUGH COINS');
    Sound.play('error');
    shakeEl(document.querySelector('.card[data-type="' + type + '"]'));
    return;
  }
  spendCoins(def.cost);
  const t = new Tower(pad, type);
  pad.tower = t;
  state.towers.push(t);
  state.particles.push(new Particle({ kind: 'ring', x: pad.x, y: pad.y, size: 42, color: '#00e5ff', life: 0.45 }));
  spawnText(pad.x, pad.y - 28, '-' + def.cost, '#ff6b6b', 12);
  Sound.play('buy');
  state.buildChoice = type; // stay in build mode for quick multi-placement
  state.selectedPad = null;
  state.selectedTower = t;
  updateShopUI();
  updateInspector();
}

function onCanvasClick(e) {
  if (state.screen !== 'game' || state.phase === 'gameover') return;
  Sound.ensure();
  const p = canvasPos(e);
  const pad = padAt(p.x, p.y);
  if (pad) {
    if (pad.tower) {
      deselect(); clearBuildChoice();
      state.selectedTower = pad.tower;
      updateInspector();
    } else if (state.buildChoice) {
      tryBuild(pad, state.buildChoice);
    } else {
      deselect();
      state.selectedPad = pad;
      updateInspector();
    }
    Sound.play('click');
  } else {
    deselect(); clearBuildChoice();
  }
}

function onCardClick(type) {
  if (state.screen !== 'game' || state.phase === 'gameover') return;
  Sound.ensure();
  Sound.play('click');
  if (state.selectedPad && !state.selectedPad.tower) {
    state.buildChoice = type;
    tryBuild(state.selectedPad, type);
    return;
  }
  state.buildChoice = state.buildChoice === type ? null : type;
  deselect();
  updateShopUI();
}

function togglePause() {
  if (state.screen !== 'game' || state.phase === 'gameover') return;
  state.paused = !state.paused;
  $('btn-pause').textContent = state.paused ? '▶' : '⏸';
  if (state.paused) announce('PAUSED', 'PRESS SPACE TO RESUME', 'warn', 0);
  else hideAnnounce();
  Sound.play('click');
}

/* ========================= UPDATE ========================= */
function update(dt) {
  state.time += dt;
  state.coinsShown += (state.coins - state.coinsShown) * Math.min(1, dt * 8);
  if (Math.abs(state.coins - state.coinsShown) < 0.6) state.coinsShown = state.coins;
  state.shake = Math.max(0, state.shake - dt * 22);

  for (const p of state.particles) p.update(dt);
  state.particles = state.particles.filter(p => !p.dead);
  for (const b of state.beams) b.life -= dt;
  state.beams = state.beams.filter(b => b.life > 0);

  if (state.phase === 'gameover') return;

  if (state.phase === 'countdown') {
    state.countdown -= dt;
    if (state.countdown <= COUNTDOWN_TIME) {
      const n = Math.max(1, Math.ceil(state.countdown));
      if (n !== lastCountNum) {
        lastCountNum = n;
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

const hudCache = {};
function setText(el, key, v) {
  if (hudCache[key] !== v) { hudCache[key] = v; el.textContent = v; }
}

function updateHUD() {
  setText(hpVal, 'hp', String(Math.max(0, Math.ceil(state.hp))));
  setText(coinsVal, 'coins', Math.floor(state.coinsShown).toLocaleString('en-US'));
  setText(waveVal, 'wave', String(Math.max(1, state.wave)));
  setText(enemiesVal, 'en', String(enemiesRemaining()));
  const critical = state.hp <= 30 && state.phase !== 'gameover';
  chipHp.classList.toggle('critical', critical);
  vignetteEl.classList.toggle('on', critical);
  if (state.boss && state.boss.alive) bossFillEl.style.width = (state.boss.hp / state.boss.maxHp * 100) + '%';
  if (state.phase === 'wave') {
    const s = enemiesRemaining() + ' HOSTILES REMAINING';
    const sub = $('wave-sub');
    if (hudCache.wsub !== s) { hudCache.wsub = s; sub.textContent = s; }
  }
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

function drawGrid() {
  const gs = 40, off = (state.time * 8) % gs;
  ctx.lineWidth = 1;
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? 'rgba(64,140,255,0.06)' : 'rgba(0,229,255,0.09)';
    ctx.beginPath();
    const step = pass === 0 ? gs : gs * 3;
    for (let x = -off * (pass === 0 ? 1 : 0); x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = -off * (pass === 0 ? 1 : 0); y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
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
  ctx.strokeStyle = 'rgba(0,229,255,0.12)';
  ctx.lineWidth = 46;
  pathPolyline(); ctx.stroke();
  ctx.strokeStyle = '#0b1a2e';
  ctx.lineWidth = 38;
  pathPolyline(); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,229,255,0.10)';
  ctx.lineWidth = 30;
  pathPolyline(); ctx.stroke();
  // animated energy dashes
  ctx.strokeStyle = 'rgba(0,229,255,0.55)';
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 20]);
  ctx.lineDashOffset = -state.time * 46;
  pathPolyline(); ctx.stroke();
  ctx.setLineDash([]);
  // direction chevrons
  ctx.fillStyle = 'rgba(0,229,255,0.3)';
  for (let d = 55; d < PATH.total; d += 90) {
    const p = posAtDist(d);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.beginPath();
    ctx.moveTo(5, 0); ctx.lineTo(-3, 5); ctx.lineTo(-1, 0); ctx.lineTo(-3, -5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // moving runner lights
  for (let i = 0; i < 5; i++) {
    const d = (state.time * 90 + i * PATH.total / 5) % PATH.total;
    const p = posAtDist(d);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 10);
    g.addColorStop(0, 'rgba(120,240,255,0.8)');
    g.addColorStop(1, 'rgba(120,240,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fill();
  }
}

function drawPads() {
  for (const p of PADS) {
    const isSel = state.selectedPad === p;
    const pulse = 0.5 + 0.5 * Math.sin(state.time * 2.4 + p.x * 0.05);
    const a = p.tower ? 0.25 : 0.35 + pulse * 0.3;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(8,16,32,0.85)';
    ctx.strokeStyle = isSel ? 'rgba(120,255,255,' + (0.7 + pulse * 0.3) + ')' : 'rgba(0,229,255,' + a + ')';
    ctx.lineWidth = isSel ? 2 : 1.4;
    const s = 20;
    ctx.beginPath();
    ctx.roundRect(-s, -s, s * 2, s * 2, 7);
    ctx.fill(); ctx.stroke();
    // corner brackets
    ctx.strokeStyle = isSel ? 'rgba(120,255,255,0.95)' : 'rgba(0,229,255,' + (a * 0.9) + ')';
    ctx.lineWidth = 2;
    const b = 8, o = s - 3;
    ctx.beginPath();
    ctx.moveTo(-o + b, -o); ctx.lineTo(-o, -o); ctx.lineTo(-o, -o + b);
    ctx.moveTo(o - b, -o); ctx.lineTo(o, -o); ctx.lineTo(o, -o + b);
    ctx.moveTo(-o + b, o); ctx.lineTo(-o, o); ctx.lineTo(-o, o - b);
    ctx.moveTo(o - b, o); ctx.lineTo(o, o); ctx.lineTo(o, o - b);
    ctx.stroke();
    if (!p.tower) {
      ctx.fillStyle = 'rgba(0,229,255,' + (0.25 + pulse * 0.45) + ')';
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

function drawNexus() {
  const crit = state.hp <= 30;
  const col = crit ? '#ff3048' : '#00e5ff';
  const pulse = 0.5 + 0.5 * Math.sin(state.time * (crit ? 7 : 2.6));
  const g = ctx.createRadialGradient(NEXUS.x, NEXUS.y, 4, NEXUS.x, NEXUS.y, 70);
  g.addColorStop(0, crit ? 'rgba(255,50,70,0.4)' : 'rgba(0,229,255,0.32)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(NEXUS.x, NEXUS.y, 70, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.translate(NEXUS.x, NEXUS.y);
  // rotating rings
  ctx.strokeStyle = col;
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 2;
  for (let i = 0; i < 2; i++) {
    ctx.save();
    ctx.rotate(state.time * (i ? -0.9 : 0.7));
    ctx.beginPath();
    ctx.arc(0, 0, 27 + i * 7, 0.3, 0.3 + Math.PI * 1.25);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // hexagon core
  polyPath(ctx, 6, 21, state.time * 0.35);
  ctx.fillStyle = '#071224';
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = col;
  ctx.shadowBlur = 16 + pulse * 12;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // inner core
  ctx.fillStyle = '#eaffff';
  ctx.beginPath();
  ctx.arc(0, 0, 5 + pulse * 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // hp mini bar
  const bw = 56, ratio = Math.max(0, state.hp / START_HP);
  ctx.fillStyle = 'rgba(5,10,20,0.8)';
  ctx.fillRect(NEXUS.x - bw / 2, NEXUS.y + 34, bw, 6);
  ctx.fillStyle = ratio > 0.5 ? '#37ffa0' : ratio > 0.25 ? '#ffd54a' : '#ff4d5e';
  ctx.fillRect(NEXUS.x - bw / 2, NEXUS.y + 34, bw * ratio, 6);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(NEXUS.x - bw / 2, NEXUS.y + 34, bw, 6);
}

function renderTowerGlyph(c, type, level, angle, time, recoil) {
  const def = TOWER_TYPES[type];
  // base plate
  c.fillStyle = '#0a1322';
  c.strokeStyle = 'rgba(0,229,255,0.35)';
  c.lineWidth = 1.5;
  c.beginPath(); c.arc(0, 0, 14, 0, Math.PI * 2); c.fill(); c.stroke();
  if (level >= 2) {
    c.strokeStyle = 'rgba(' + hexRgb(def.color) + ',0.55)';
    c.beginPath(); c.arc(0, 0, 12, 0, Math.PI * 2); c.stroke();
  }
  if (level >= 3) {
    c.save();
    c.rotate(time * 1.2);
    c.setLineDash([4, 5]);
    c.strokeStyle = 'rgba(' + hexRgb(def.color) + ',0.8)';
    c.beginPath(); c.arc(0, 0, 15.5, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    c.restore();
  }

  if (type === 'pulse') {
    c.save();
    c.rotate(angle);
    c.fillStyle = '#0e3049';
    if (level >= 3) {
      c.fillRect(-3, -8.5, 16, 4);
      c.fillRect(-3, 4.5, 16, 4);
    } else {
      c.fillRect(-3, -2.5, 17, 5);
    }
    c.restore();
    const g = c.createRadialGradient(-2, -2, 1, 0, 0, 9);
    g.addColorStop(0, '#7df0ff');
    g.addColorStop(1, '#0a6c8a');
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, 9, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(25,211,255,0.9)';
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = '#eaffff';
    c.beginPath(); c.arc(0, 0, 2.4 + Math.sin(time * 5) * 0.5, 0, Math.PI * 2); c.fill();
  } else if (type === 'laser') {
    c.fillStyle = '#231038';
    c.fillRect(-4, 2, 8, 9);
    c.save();
    c.rotate(time * 1.6);
    const g = c.createLinearGradient(-7, -7, 7, 7);
    g.addColorStop(0, '#e3b8ff');
    g.addColorStop(1, '#7a2dd9');
    c.fillStyle = g;
    polyPath(c, 4, 8, 0);
    c.fill();
    c.strokeStyle = 'rgba(179,102,255,0.95)';
    c.lineWidth = 1.5;
    c.stroke();
    c.restore();
    c.strokeStyle = 'rgba(179,102,255,' + (0.3 + 0.25 * Math.sin(time * 4)) + ')';
    c.beginPath(); c.arc(0, 0, 11, 0, Math.PI * 2); c.stroke();
  } else { // plasma
    c.save();
    c.rotate(angle);
    c.fillStyle = '#4a2208';
    c.fillRect(2 - recoil * 3, -4.5, 14, 9);
    c.fillRect(2 - recoil * 3, -6.5, 5, 13);
    c.restore();
    const g = c.createRadialGradient(-2, -2, 1, 0, 0, 11);
    g.addColorStop(0, '#ffc46b');
    g.addColorStop(1, '#8a3606');
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, 11, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(255,140,26,0.9)';
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = '#fff3d6';
    c.beginPath(); c.arc(0, 0, 3.4 + Math.sin(time * 6) * 0.8, 0, Math.PI * 2); c.fill();
  }
  // level pips
  for (let i = 0; i < level; i++) {
    c.fillStyle = '#ffd54a';
    c.beginPath();
    c.arc(-6 + i * 6, 18, 1.8, 0, Math.PI * 2);
    c.fill();
  }
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
}

function drawTower(t) {
  ctx.save();
  ctx.translate(t.x, t.y);
  renderTowerGlyph(ctx, t.type, t.level, t.angle, state.time, t.recoil);
  ctx.restore();
}

function drawEnemy(e) {
  const bob = Math.sin(state.time * 8 + e.seed) * 1.6;
  // soft glow under enemy
  const g = ctx.createRadialGradient(e.x, e.y + bob, 0, e.x, e.y + bob, e.radius * 2.1);
  g.addColorStop(0, 'rgba(255,70,50,0.22)');
  g.addColorStop(1, 'rgba(255,70,50,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(e.x, e.y + bob, e.radius * 2.1, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.translate(e.x, e.y + bob);
  ctx.rotate(e.angle);
  if (e.type === 'scout') {
    polyPath(ctx, 4, e.radius, 0);
    ctx.fillStyle = '#c2492a'; ctx.fill();
    ctx.strokeStyle = '#ff8c3d'; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.fillStyle = '#ffd9a8';
    ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, Math.PI * 2); ctx.fill();
  } else if (e.type === 'speed') {
    ctx.beginPath();
    ctx.moveTo(12, 0); ctx.lineTo(-8, 6); ctx.lineTo(-4, 0); ctx.lineTo(-8, -6);
    ctx.closePath();
    ctx.fillStyle = '#d9a520'; ctx.fill();
    ctx.strokeStyle = '#ffd23d'; ctx.lineWidth = 1.5; ctx.stroke();
  } else if (e.type === 'tank') {
    polyPath(ctx, 6, e.radius, 0);
    ctx.fillStyle = '#7e2038'; ctx.fill();
    ctx.strokeStyle = '#ff5d78'; ctx.lineWidth = 2; ctx.stroke();
    polyPath(ctx, 6, e.radius * 0.55, 0);
    ctx.fillStyle = '#41506e'; ctx.fill();
    ctx.strokeStyle = '#8fa3c8'; ctx.lineWidth = 1.2; ctx.stroke();
  } else if (e.type === 'elite') {
    const aura = 0.4 + 0.3 * Math.sin(state.time * 5 + e.seed);
    ctx.strokeStyle = 'rgba(192,92,255,' + aura + ')';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, e.radius + 5, 0, Math.PI * 2); ctx.stroke();
    polyPath(ctx, 5, e.radius, -Math.PI / 2);
    ctx.fillStyle = '#5b1e8a'; ctx.fill();
    ctx.strokeStyle = '#c05cff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#f2dcff';
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
  } else { // boss
    ctx.save();
    ctx.rotate(state.time * 0.8);
    ctx.fillStyle = '#5e0f1c';
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(e.radius + 10, 0); ctx.lineTo(e.radius - 2, 6); ctx.lineTo(e.radius - 2, -6);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    polyPath(ctx, 8, e.radius, state.time * 0.3);
    ctx.fillStyle = '#8e1226'; ctx.fill();
    ctx.strokeStyle = '#ff2038'; ctx.lineWidth = 3;
    ctx.shadowColor = '#ff2038'; ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd9d9';
    ctx.beginPath(); ctx.arc(0, 0, 5 + Math.sin(state.time * 6) * 1.6, 0, Math.PI * 2); ctx.fill();
  }
  // hit flash
  if (e.flash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, e.flash * 10) * 0.8;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(0, 0, e.radius * 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();

  // health bar
  if (e.hp < e.maxHp) {
    const w = e.def.boss ? 60 : 22, h = 4;
    const ratio = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = 'rgba(5,10,20,0.8)';
    ctx.fillRect(e.x - w / 2, e.y + bob - e.radius - 11, w, h);
    ctx.fillStyle = ratio > 0.5 ? '#37ffa0' : ratio > 0.25 ? '#ffd54a' : '#ff4d5e';
    ctx.fillRect(e.x - w / 2, e.y + bob - e.radius - 11, w * ratio, h);
  }
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
  const show = [];
  if (state.selectedTower) show.push({ t: state.selectedTower, strong: true });
  const hov = padAt(state.hover.x, state.hover.y);
  if (hov && hov.tower && hov.tower !== state.selectedTower) show.push({ t: hov.tower, strong: false });
  for (const { t, strong } of show) {
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
  // build preview on selected empty pad
  if (state.selectedPad && !state.selectedPad.tower && state.buildChoice) {
    const def = TOWER_TYPES[state.buildChoice];
    const p = state.selectedPad;
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

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#050b16';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (state.shake > 0) {
    ctx.translate((Math.random() * 2 - 1) * state.shake, (Math.random() * 2 - 1) * state.shake);
  }
  drawGrid();
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
}

/* ========================= FLOW ========================= */
function loadNum(key) {
  try { return parseInt(localStorage.getItem(key)) || 0; } catch (e) { return 0; }
}
function saveNum(key, v) {
  try { localStorage.setItem(key, String(v)); } catch (e) { /* ignore */ }
}

function refreshMenuBests() {
  const bw = loadNum('cdn_best_wave'), hs = loadNum('cdn_high_score');
  $('menu-bests').innerHTML = 'BEST WAVE ' + (bw || '—') + ' &nbsp;·&nbsp; HIGH SCORE ' + (hs ? hs.toLocaleString('en-US') : '—');
}

function resetState() {
  state.phase = 'idle';
  state.time = 0; state.speed = 1; state.paused = false;
  state.coins = START_COINS; state.coinsShown = START_COINS;
  state.hp = START_HP;
  state.wave = 0; state.wavesCompleted = 0; state.kills = 0; state.totalCoinsEarned = 0;
  state.countdown = 0; state.waveTime = 0;
  state.spawnQueue = []; state.spawnIdx = 0;
  state.enemies = []; state.towers = []; state.projectiles = []; state.beams = []; state.particles = [];
  state.selectedTower = null; state.selectedPad = null; state.buildChoice = null;
  state.shake = 0; state.boss = null; state.bossCount = 0;
  lastCountNum = null;
  for (const p of PADS) p.tower = null;
  bossBarEl.classList.remove('on');
  $('boss-warning').classList.remove('on');
  hideAnnounce();
  toastEl.className = '';
  chipHp.classList.remove('critical');
  vignetteEl.classList.remove('on');
  $('btn-pause').textContent = '⏸';
  $('btn-speed').textContent = '1x';
  $('btn-menu').textContent = 'MENU';
  delete $('btn-menu').dataset.armed;
  updateShopUI();
  updateInspector();
  updateWaveButton();
}

function showScreen(name) {
  state.screen = name;
  $('menu').classList.toggle('hidden', name !== 'menu');
  $('game').classList.toggle('hidden', name !== 'game');
  if (name === 'game') fitCanvas();
}

function startGame() {
  Sound.ensure();
  $('gameover').classList.remove('on');
  $('howto').classList.remove('on');
  resetState();
  showScreen('game');
  fitCanvas();
  beginCountdown(1);
}

function goMenu() {
  $('gameover').classList.remove('on');
  resetState();
  refreshMenuBests();
  showScreen('menu');
}

function gameOver() {
  if (state.phase === 'gameover') return;
  state.phase = 'gameover';
  state.paused = false;
  deselect();
  clearBuildChoice();
  Sound.play('over');
  state.shake = 14;
  for (let i = 0; i < 3; i++) {
    explode(NEXUS.x + (Math.random() * 40 - 20), NEXUS.y + (Math.random() * 40 - 20), i === 0 ? '#ff4d3d' : '#ff8c1a', 22, 200, 4);
  }
  const score = state.kills * 10 + state.wavesCompleted * 100 + Math.max(0, Math.ceil(state.hp)) * 5;
  const prevBestWave = loadNum('cdn_best_wave');
  const prevHigh = loadNum('cdn_high_score');
  const newBestWave = state.wave > prevBestWave;
  const newHigh = score > prevHigh;
  if (newBestWave) saveNum('cdn_best_wave', state.wave);
  if (newHigh) saveNum('cdn_high_score', score);
  updateWaveButton();
  setTimeout(() => {
    $('go-wave').textContent = state.wave;
    $('go-kills').textContent = state.kills;
    $('go-coins').textContent = state.totalCoinsEarned.toLocaleString('en-US');
    $('go-score').textContent = score.toLocaleString('en-US');
    $('go-best').innerHTML =
      (newBestWave ? '<span class="newbest">NEW BEST WAVE!</span> &nbsp;·&nbsp; ' : '') +
      (newHigh ? '<span class="newbest">NEW HIGH SCORE!</span>' : (!newBestWave && !newHigh ? 'BEST WAVE ' + prevBestWave + ' · HIGH SCORE ' + prevHigh.toLocaleString('en-US') : ''));
    $('gameover').classList.add('on');
  }, 1200);
}

function fitCanvas() {
  const r = arenaEl.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return;
  const s = Math.min(r.width / W, r.height / H);
  cv.style.width = Math.floor(W * s) + 'px';
  cv.style.height = Math.floor(H * s) + 'px';
}

/* ========================= INIT ========================= */
function buildShop() {
  const shop = $('shop');
  for (const key of Object.keys(TOWER_TYPES)) {
    const def = TOWER_TYPES[key];
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.type = key;
    card.innerHTML =
      '<canvas width="52" height="52"></canvas>' +
      '<div class="card-info">' +
        '<div class="card-name">' + def.name + '</div>' +
        '<div class="card-desc">' + def.desc + '</div>' +
        '<div class="card-stats">DMG ' + def.damage + ' · RNG ' + def.range + ' · ' + def.rate.toFixed(1) + '/s' + (def.splash ? ' · AOE' : '') + '</div>' +
      '</div>' +
      '<div class="card-cost">' + def.cost + ' 🪙</div>';
    card.addEventListener('click', () => onCardClick(key));
    shop.appendChild(card);
    const ic = card.querySelector('canvas').getContext('2d');
    ic.translate(26, 27);
    ic.scale(1.5, 1.5);
    renderTowerGlyph(ic, key, 3, -Math.PI / 2, 1.2, 0);
  }
}

function wireEvents() {
  $('btn-start').addEventListener('click', startGame);
  $('btn-how').addEventListener('click', () => { Sound.ensure(); Sound.play('click'); $('howto').classList.add('on'); });
  $('btn-how-close').addEventListener('click', () => { Sound.play('click'); $('howto').classList.remove('on'); });

  $('btn-restart').addEventListener('click', () => { Sound.play('click'); startGame(); });
  $('btn-go-menu').addEventListener('click', () => { Sound.play('click'); goMenu(); });

  $('btn-pause').addEventListener('click', () => { togglePause(); $('btn-pause').blur(); });
  $('btn-speed').addEventListener('click', () => {
    state.speed = state.speed === 1 ? 2 : 1;
    $('btn-speed').textContent = state.speed + 'x';
    $('btn-speed').classList.toggle('primary', state.speed === 2);
    Sound.play('click');
    $('btn-speed').blur();
  });
  $('btn-sound').addEventListener('click', () => {
    Sound.ensure();
    Sound.enabled = !Sound.enabled;
    $('btn-sound').textContent = Sound.enabled ? '🔊' : '🔇';
    if (Sound.enabled) Sound.play('click');
    $('btn-sound').blur();
  });
  $('btn-menu').addEventListener('click', () => {
    // two-step confirm to avoid losing progress on a misclick
    const b = $('btn-menu');
    if (b.dataset.armed) { goMenu(); return; }
    b.dataset.armed = '1';
    b.textContent = 'SURE?';
    Sound.play('click');
    setTimeout(() => { b.textContent = 'MENU'; delete b.dataset.armed; }, 2000);
  });

  $('btn-wave').addEventListener('click', () => {
    if (state.phase !== 'countdown') return;
    if (state.countdown > 0.25) {
      addCoins(EARLY_BONUS);
      toastMsg('+' + EARLY_BONUS + ' EARLY WAVE BONUS', 'gold');
    }
    startWave();
  });

  ['damage', 'range', 'speed'].forEach(stat => {
    $('up-' + stat).addEventListener('click', () => {
      if (state.selectedTower) state.selectedTower.upgrade(stat);
    });
  });
  $('btn-sell').addEventListener('click', () => {
    if (state.selectedTower) state.selectedTower.sell();
  });

  cv.addEventListener('click', onCanvasClick);
  cv.addEventListener('mousemove', e => {
    const p = canvasPos(e);
    state.hover = p;
    cv.style.cursor = padAt(p.x, p.y) ? 'pointer' : 'default';
  });
  cv.addEventListener('mouseleave', () => { state.hover = { x: -999, y: -999 }; });
  cv.addEventListener('contextmenu', e => { e.preventDefault(); deselect(); clearBuildChoice(); });

  window.addEventListener('keydown', e => {
    if (state.screen !== 'game') return;
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    if (e.code === 'Escape') { deselect(); clearBuildChoice(); }
  });

  // close modals by clicking the backdrop
  [['howto', 'btn-how-close'], ['gameover', null]].forEach(([id]) => {
    const m = $(id);
    m.addEventListener('click', e => {
      if (e.target === m && id === 'howto') m.classList.remove('on');
    });
  });

  window.addEventListener('resize', () => { if (state.screen === 'game') fitCanvas(); });
}

let lastT = performance.now();
function frame(now) {
  const dtRaw = Math.min((now - lastT) / 1000, 0.04);
  lastT = now;
  if (state.screen === 'game') {
    if (!state.paused) {
      const total = dtRaw * state.speed;
      const steps = Math.max(1, Math.ceil(total / 0.034));
      for (let i = 0; i < steps; i++) update(total / steps);
    }
    updateHUD();
    render();
  }
  requestAnimationFrame(frame);
}

function init() {
  buildShop();
  wireEvents();
  refreshMenuBests();
  updateShopUI();
  updateInspector();
  updateWaveButton();
  showScreen('menu');
  requestAnimationFrame(frame);
}

init();
