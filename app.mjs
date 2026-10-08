import {RULES, DIRECTIONS, makeState, advance, allowed, equal, routeForFrame, trimRoute, pointAt, directionFromKey, enqueueDirection} from './engine.mjs?v=20261008-cookie1';
import {$, cfg, jsonp, loadProfile, clearProfile, studentLabel} from './common.mjs';

const profile = loadProfile();
if (!profile) location.replace('./');

const game = $('#game'), canvas = $('#board'), ctx = canvas.getContext('2d');
const BOARD_W = RULES.cols * 40, BOARD_H = RULES.rows * 40;
const schoolEmblem = new Image();
schoolEmblem.src = new URL('./gajwa-cookie-logo-v2.webp', import.meta.url).href;
schoolEmblem.onload = () => draw();
let state = makeState(), previous = state, queue = [], progress = 1, startedAt = 0, lastFrame = 0;
let graceUsed = false, best = null, runId = crypto.randomUUID(), audio = null, sound = false, lastSound = '';
let mouth = 0, mouthAt = 0, mouthSnap = false;
try { sound = localStorage.getItem('gajwa-snake-sound') === '1'; } catch {}
// ---------- effects state ----------
const rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
const NEVER = -1e9;
let deathStart = NEVER, deathDelay = 0, deathId = 0, dying = false, overlayVisible = true;
let gulpStart = NEVER, cookieBorn = NEVER, newCookie = null, eatPending = false;
const pool = Array.from({length: 14}, () => ({on: false, k: 0, x: 0, y: 0, vx: 0, vy: 0, a: 0, va: 0, r: 0, vr: 0, born: 0, life: 1, size: 3, color: '#fff', star: false}));
const pending = new Map(), submitting = new Set();
const statuses = {ready: '준비', running: '플레이 중', collision: '게임 종료', win: '완주', aborted: '중도 종료'};

// ---------- header ----------
if (profile) {
  $('#profile-name').textContent = profile.name;
  $('#profile-detail').textContent = studentLabel(profile);
  $('#board-link').href = 'board.html?grade=' + profile.grade + '&cls=' + profile.classNo + '&v=20261007-4';
}
$('#change-profile').addEventListener('click', () => {
  if (state.mode === 'running' && !confirm('학생을 바꾸면 현재 판은 저장되지 않고 종료됩니다. 계속할까요?')) return;
  if (pending.size && !confirm('아직 저장 확인 중인 기록이 있습니다. 그래도 나갈까요?')) return;
  pending.clear();
  clearProfile();
  location.href = './';
});

// ---------- drawing ----------
function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = BOARD_W * dpr;
  canvas.height = BOARD_H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
function setSave(text, type = '') {
  const el = $('#save-state');
  el.textContent = text;
  el.className = type;
}
function overlay(kicker, title, description, button) {
  $('#overlay').hidden = false; overlayVisible = true;
  $('#overlay').classList.remove('enter');
  $('#overlay-kicker').textContent = kicker;
  $('#overlay-title').textContent = title;
  $('#overlay-description').textContent = description;
  $('#play').textContent = button;
}
function spawn(p) { for (const q of pool) if (!q.on) { Object.assign(q, p, {on: true, born: performance.now()}); return; } }
function activeParticles() { let n = 0; for (const q of pool) if (q.on) n++; return n; }
function effectCount(now = performance.now()) {
  return activeParticles() + (now - gulpStart < 400 ? 1 : 0) + (now - cookieBorn < 280 ? 1 : 0) + (dying ? 1 : 0);
}
function easeOutBack(t) { const c = 1.9, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; }
function popScore() {
  if (rmq.matches) return;
  const el = $('#score'); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}
function fireEat(now = performance.now()) {
  eatPending = false;
  gulpStart = now; cookieBorn = now;
  newCookie = state.foods.find(food => !previous.foods.some(old => equal(old, food))) || null;
  if (rmq.matches || !state.ateFood) return;
  const cx = (state.ateFood.x + .5) * 40, cy = (state.ateFood.y + .5) * 40;
  for (let i = 0; i < 6; i++) {
    const ang = i * Math.PI / 3 + Math.random() * .6, sp = 50 + Math.random() * 50;
    spawn({k: 1, x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 400, size: 3 + Math.random() * 2, color: i % 2 ? '#9c5a2a' : '#f5cd86', star: false});
  }
}
function spawnDeath(head, cd) {
  if (rmq.matches) return;
  const hx = (head.x + .5) * 40, hy = (head.y + .5) * 40, base = Math.atan2(cd.y, cd.x);
  for (let i = 0; i < 7; i++) {
    spawn({k: 0, x: hx, y: hy, a: base + (i / 6 - .5) * 2.4, va: (i % 2 ? 1 : -1) * (.004 + Math.random() * .003), r: 20, vr: .012 + Math.random() * .014,
      life: 750 + Math.random() * 150, size: 3 + Math.random() * 2.5, color: i % 2 ? '#fff' : '#ffe680', star: i % 3 !== 2});
  }
}
function drawStar(x, y, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) { const rr = i % 2 ? r * .4 : r, an = rot + i * Math.PI / 4; ctx.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr); }
  ctx.closePath(); ctx.fill();
}
function drawParticles(now) {
  for (const q of pool) {
    if (!q.on) continue;
    const age = now - q.born;
    if (age >= q.life) { q.on = false; continue; }
    const f = age / q.life; let x, y;
    if (q.k === 0) { const an = q.a + q.va * age, rad = q.r + q.vr * age * 1000 / 1000 * 1; x = q.x + Math.cos(an) * rad; y = q.y + Math.sin(an) * rad; }
    else { x = q.x + q.vx * age / 1000; y = q.y + q.vy * age / 1000; }
    ctx.globalAlpha = q.k === 0 ? (age < 400 ? 1 : 1 - (age - 400) / (q.life - 400)) : 1 - f * f; ctx.fillStyle = q.color;
    const s = q.size * (q.k ? 1 - f * .6 : 1);
    if (q.star) drawStar(x, y, s * 2.1, age * .008); else { ctx.beginPath(); ctx.arc(x, y, s * .8, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}
function drawCookie(food, scale = 1) {
  if (!food || scale <= 0) return;
  const x = (food.x + .5) * 40, y = (food.y + .5) * 40;
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.fillStyle = '#685d2525'; ctx.beginPath(); ctx.ellipse(1, 15, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f1ba60'; ctx.strokeStyle = '#a66c32'; ctx.lineWidth = 1.8; ctx.beginPath();
  for (let i = 0; i < 24; i++) { const angle = i * Math.PI / 12, r = 15.5 + Math.sin(i * 2.4) * .7; const px = Math.cos(angle) * r, py = Math.sin(angle) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#ffe4a2'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, 12.5, Math.PI * 1.02, Math.PI * 1.65); ctx.stroke();
  for (const [cx, cy, r] of [[-6,-6,3.2],[5,-7,3.4],[8,3,3.1],[-3,7,3.4],[-8,2,2.4]]) {
    ctx.fillStyle = '#68402c'; ctx.beginPath(); ctx.ellipse(cx, cy, r, r * .86, .3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#966447'; ctx.beginPath(); ctx.arc(cx - .8, cy - .8, r * .3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function strokeRoute(points, width, color) {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i], x = (p.x + .5) * 40, y = (p.y + .5) * 40;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
}
let lastScoreText = '', lastStateText = '';
function draw(alpha = progress) {
  const now = performance.now(), dead = state.mode === 'collision', dt = dead ? now - deathStart : 0;
  ctx.clearRect(0, 0, BOARD_W, BOARD_H);
  ctx.save();
  if (dead && !rmq.matches && dt < 260) { const k = 4 * (1 - dt / 260); ctx.translate(Math.round((Math.random() * 2 - 1) * k), Math.round((Math.random() * 2 - 1) * k)); }
  ctx.fillStyle = '#a2d149'; ctx.fillRect(-10, -10, BOARD_W + 20, BOARD_H + 20);
  for (let y = 0; y < RULES.rows; y++) for (let x = 0; x < RULES.cols; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#a2d149' : '#aad751';
    ctx.fillRect(x * 40, y * 40, 41, 41);
  }
  if (schoolEmblem.complete && schoolEmblem.naturalWidth) {
    const size = BOARD_H * .82; ctx.save(); ctx.globalAlpha = .03; ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(schoolEmblem, (BOARD_W - size) / 2, (BOARD_H - size) / 2, size, size); ctx.restore();
  }
  const ateStep = state.ate && state.mode === 'running';
  if (ateStep && eatPending && alpha >= .7) fireEat(now);
  if (ateStep && alpha < 1) drawCookie(state.ateFood, alpha < .7 ? 1 : (1 - alpha) / .3);
  const pop = now - cookieBorn;
  for (const food of state.foods) {
    const justAdded = ateStep && !previous.foods.some(old => equal(old, food));
    const growing = equal(food, newCookie) && pop < 280;
    drawCookie(food, justAdded && eatPending ? 0 : growing ? Math.max(0, easeOutBack(pop / 280)) : 1);
  }
  const route = routeForFrame(previous, state, alpha);
  const bodyEnd = Math.max(.05, route.length - .5);
  const blink = dead && !rmq.matches && ((dt > 200 && dt < 320) || (dt > 420 && dt < 540));
  const bodyColor = blink ? '#2b479e' : '#416de4';
  strokeRoute(trimRoute(route.points, bodyEnd), 27, bodyColor);
  const tailSteps = 12;
  for (let i = 0; i < tailSteps; i++) {
    const a = bodyEnd + i * .5 / tailSteps, b = bodyEnd + (i + 1) * .5 / tailSteps;
    strokeRoute([pointAt(route.points, a), pointAt(route.points, b)], Math.max(1.4, 27 * (1 - i / tailSteps)), bodyColor);
  }
  const g = (now - gulpStart) / 400;
  if (g >= 0 && g < 1 && !dead) {
    const p = pointAt(route.points, g * bodyEnd);
    ctx.fillStyle = bodyColor; ctx.beginPath(); ctx.arc((p.x + .5) * 40, (p.y + .5) * 40, 13.5 + 3.5 * Math.sin(Math.PI * g), 0, Math.PI * 2); ctx.fill();
  }
  // Eyes look toward the next queued turn so a buffered input is visible immediately.
  const h = route.head, cd = state.crashDirection || route.direction, d = dead ? cd : queue[0] || route.direction;
  let hx = (h.x + .5) * 40, hy = (h.y + .5) * 40, sq = 0;
  if (dead && dt < 180) {
    const p = dt / 180;
    sq = p < .4 ? p / .4 : Math.cos((p - .4) / .6 * Math.PI * 1.5) * (1 - (p - .4) / .6);
    hx += cd.x * sq * 12; hy += cd.y * sq * 12;
  }
  const ang = Math.atan2(d.y, d.x);
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(ang); ctx.scale(1 - .2 * Math.abs(sq), 1 + .2 * Math.abs(sq));
  ctx.fillStyle = bodyColor; ctx.beginPath(); ctx.arc(0, 0, 14.5 + 1.5 * mouth, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // Mouth opens for any cookie within 2 cells straight ahead, then closes on eating.
  let want = 0;
  const targets = ateStep && state.ateFood ? [state.ateFood, ...state.foods] : state.foods;
  if (state.mode === 'running' && !(ateStep && now - gulpStart < 250)) {
    want = targets.some(target => { const fx = target.x - h.x, fy = target.y - h.y;
      return Math.abs(fx * d.y - fy * d.x) < .3 && fx * d.x + fy * d.y > .15 && fx * d.x + fy * d.y <= 2.1; }) ? 1 : 0;
  }
  const mdt = Math.min(100, Math.max(0, now - mouthAt)); mouthAt = now;
  if (rmq.matches) mouth = want;
  else if (want > mouth) mouth = Math.min(want, mouth + mdt / 135);
  else if (want < mouth) mouth = Math.max(want, mouth - mdt / (now - gulpStart < 250 ? 70 : 100));
  if (dead) mouth = 0;
  const gs = now - gulpStart;
  const lip = dead || rmq.matches || gs < 0 || gs > 280 ? 0 : gs < 70 ? gs / 70 : gs < 120 ? 1 : 1 - (gs - 120) / 160;
  const ease = mouth * mouth * (3 - 2 * mouth), open = ease;
  if (open > .02 || lip > .02) {
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(ang);
    const rim = '#5a86f2';
    if (open > .02) {
      const hinge = 8, W = 4 + 20 * open, H = 14.5 + 6 * open;
      ctx.fillStyle = rim; ctx.beginPath(); ctx.ellipse(hinge, 0, W, H, 0, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
      const t = 3.2 + 1.6 * open, iw = Math.max(0, W - t - 1), ih = Math.max(0, H - t);
      ctx.fillStyle = '#1f3c99'; ctx.beginPath(); ctx.ellipse(hinge + 1.5, 0, iw, ih, 0, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
      if (open > .4) {
        ctx.fillStyle = '#fff';
        for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(hinge + 2, sg * (ih - 1.5)); ctx.lineTo(hinge + 2 + 5 * open, sg * (ih - 1.5)); ctx.lineTo(hinge + 2, sg * (ih - 1.5 - 5 * open)); ctx.closePath(); ctx.fill(); }
      }
    }
    if (lip > .02) {
      const l = lip * (1 - open);
      ctx.fillStyle = rim; ctx.beginPath(); ctx.ellipse(11, 0, 1.5 + 4 * l, 14.5 + 3 * l, 0, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#1f3c99'; ctx.lineWidth = 1.6; ctx.globalAlpha = Math.min(1, l * 1.4); ctx.beginPath(); ctx.moveTo(12.5, -10 * l - 3); ctx.lineTo(12.5, 10 * l + 3); ctx.stroke();
    }
    ctx.restore();
  }
  for (const side of [-1, 1]) {
    const ex = hx + d.x * (6 - open * 6) - d.y * side * (8 + open * 2), ey = hy + d.y * (6 - open * 6) + d.x * side * (8 + open * 2);
    ctx.fillStyle = '#f9fcff'; ctx.beginPath(); ctx.ellipse(ex, ey, 6.1, 6.7, ang, 0, Math.PI * 2); ctx.fill();
    if (dead) {
      ctx.strokeStyle = '#263b7c'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.beginPath();
      ctx.moveTo(ex - 3.4, ey - 3.4); ctx.lineTo(ex + 3.4, ey + 3.4); ctx.moveTo(ex + 3.4, ey - 3.4); ctx.lineTo(ex - 3.4, ey + 3.4); ctx.stroke();
    } else { ctx.fillStyle = '#263b7c'; ctx.beginPath(); ctx.arc(ex + d.x * 2, ey + d.y * 2, 3.2, 0, Math.PI * 2); ctx.fill(); }
  }
  drawParticles(now);
  ctx.restore();
  const scoreText = String(state.score), stateText = statuses[state.mode] || '준비';
  if (scoreText !== lastScoreText) { if (lastScoreText !== '' && state.score > Number(lastScoreText)) popScore(); $('#score').textContent = lastScoreText = scoreText; }
  if (stateText !== lastStateText) $('#game-state').textContent = lastStateText = stateText;
}
// ---------- sound (synthesized with Web Audio; no external assets) ----------
let master = null, noiseBuf = null;
function ensureAudio() {
  if (!audio) {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    const comp = audio.createDynamicsCompressor();
    master = audio.createGain(); master.gain.value = .55;
    master.connect(comp); comp.connect(audio.destination);
    noiseBuf = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (audio.state === 'suspended') audio.resume();
  return audio;
}
function env(g, t0, pts) { // pts: [time, value] pairs, exponential between points
  g.gain.setValueAtTime(.0001, t0);
  for (const [t, v] of pts) g.gain.exponentialRampToValueAtTime(Math.max(.0001, v), t0 + t);
}
function osc(a, type, t0, dur, freqs, pts, dest, gainScale = 1) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freqs[0][1], t0);
  for (const [t, f] of freqs.slice(1)) o.frequency.exponentialRampToValueAtTime(f, t0 + t);
  env(g, t0, pts.map(([t, v]) => [t, v * gainScale]));
  o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur);
}
function noise(a, t0, off, dur, type, freq, q, pts, dest) {
  const n = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  n.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
  env(g, t0 + off, pts); n.connect(f); f.connect(g); g.connect(dest);
  n.start(t0 + off, Math.random() * .5); n.stop(t0 + off + dur);
}
function tone(type) {
  if (!sound) return;
  lastSound = type;
  try {
    const a = ensureAudio(), t0 = a.currentTime + .005, out = master;
    if (type === 'turn') { // soft low boop 380 -> 300 (40ms) -> 245 (120ms)
      osc(a, 'sine', t0, .24, [[0, 380], [.04, 300], [.12, 245], [.23, 232]],
        [[.018, .3], [.06, .37], [.12, .2], [.2, .004], [.23, .0002]], out);
    } else if (type === 'eat') { // two noise crunches + faint thump
      noise(a, t0, .055, .1, 'bandpass', 1150, 1.1, [[.012, .55], [.035, .95], [.1, .0005]], out);
      noise(a, t0, .055, .1, 'bandpass', 4500, .8, [[.012, .25], [.035, .45], [.1, .0005]], out);
      noise(a, t0, .15, .09, 'bandpass', 750, 1.3, [[.012, .3], [.035, .5], [.08, .0005]], out);
      osc(a, 'sine', t0 + .05, .1, [[0, 150], [.08, 70]], [[.01, .2], [.09, .001]], out);
    } else if (type === 'death') { // bonk then buzzy downward sweep
      noise(a, t0, .04, .06, 'lowpass', 450, .7, [[.008, .6], [.05, .001]], out);
      osc(a, 'sine', t0 + .04, .14, [[0, 380], [.04, 380], [.045, 300], [.12, 300]], [[.012, .4], [.09, .38], [.12, .02]], out);
      const lp = a.createBiquadFilter(), sg = a.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 1100; lp.connect(sg); sg.connect(out);
      sg.gain.setValueAtTime(.0001, t0 + .2);
      sg.gain.exponentialRampToValueAtTime(.43, t0 + .23); sg.gain.setValueAtTime(.43, t0 + .35);
      sg.gain.exponentialRampToValueAtTime(.001, t0 + .6);
      const sweep = [[.2, 245], [.28, 195], [.36, 156], [.44, 125], [.5, 100], [.56, 80]];
      for (const [wave, gs] of [['triangle', .8], ['square', .22]]) {
        const o = a.createOscillator(), g = a.createGain();
        o.type = wave; g.gain.value = gs; o.frequency.setValueAtTime(sweep[0][1], t0 + .2);
        for (const [t, f] of sweep.slice(1)) o.frequency.exponentialRampToValueAtTime(f, t0 + t);
        o.connect(g); g.connect(lp); o.start(t0 + .2); o.stop(t0 + .62);
      }
    }
  } catch {}
}

// ---------- game flow ----------
function reset() {
  dying = false; deathStart = NEVER; deathId++; gulpStart = NEVER; cookieBorn = NEVER; newCookie = null; eatPending = false;
  for (const q of pool) q.on = false;
  state = makeState(); previous = state; progress = 1; queue = []; runId = crypto.randomUUID(); startedAt = 0;
  $('#abort').disabled = true;
  $('#best').textContent = best ?? '-';
  overlay('READY', '준비됐나요?', 'Enter·스페이스바 또는 시작하기로 게임판을 열어 주세요.\n그다음 방향키를 누르면 출발합니다.', '시작하기');
  $('#overlay-foot').textContent = 'Enter 또는 스페이스바 · 시작하기 클릭';
  setSave('Enter 또는 스페이스바로 준비 화면을 닫아 주세요.');
  draw();
  game.focus({preventScroll: true});
}
// Opening the board is separate from starting a run: no timer or movement until a valid direction.
function prepareToPlay() {
  if (state.mode === 'running' || dying) return;
  if (state.mode !== 'ready') reset();
  overlayVisible = false;
  $('#overlay').hidden = true;
  $('#abort').disabled = true;
  setSave('방향키 또는 W A S D를 눌러 출발하세요.');
  draw();
  game.focus({preventScroll: true});
}
function begin(direction) {
  overlayVisible = false;
  state = {...state, mode: 'running'};
  $('#overlay').hidden = true;
  $('#abort').disabled = false;
  tone('turn');
  startedAt = performance.now();
  lastFrame = startedAt;
  setSave('쿠키를 먹고 최고 기록을 만들어 보세요.');
  queue = [direction];
  step();
}
function step() {
  if (eatPending) fireEat();
  const next = queue.length ? queue.shift() : state.direction;
  previous = state;
  state = advance(state, next);
  progress = 0;
  graceUsed = false;
  afterStep();
}
function afterStep() {
  if (state.mode === 'collision' || state.mode === 'win') {
    previous = state; progress = 1; queue = [];
    finish();
  } else if (state.ate) { tone('eat'); eatPending = true; } else eatPending = false;
}
function handleDirection(name) {
  const d = DIRECTIONS[name];
  if (!d || !profile) return;
  if (state.mode === 'ready') {
    if (!overlayVisible && allowed(state.direction, d)) begin(d);
    return;
  }
  if (state.mode !== 'running') return;
  // Early-turn grace: a key pressed just after a cell boundary re-routes the step that just started,
  // so a slightly late press still turns at the intended cell instead of one cell later.
  // Only a straight step can be re-routed, and only once, so a turn the player already made is never undone.
  if (!queue.length && !graceUsed && progress < RULES.turnGrace && previous !== state && previous.mode === 'running'
      && equal(state.direction, previous.direction) && !equal(d, state.direction) && allowed(previous.direction, d)) {
    graceUsed = true;
    tone('turn');
    state = advance(previous, d);
    afterStep();
    draw();
    return;
  }
  const before = queue, after = enqueueDirection(queue, state.direction, d);
  queue = after;
  if (after.length !== before.length || after.at(-1) !== before.at(-1)) tone('turn');
}
function frame(now) {
  if (state.mode === 'running') {
    const delta = lastFrame ? now - lastFrame : 0;
    lastFrame = now;
    if (delta > 900) {
      abort('화면이 오래 멈춰 현재 판을 중도 종료했어요. 기록은 저장하지 않습니다.');
    } else {
      progress += delta / RULES.tickMs;
      while (progress >= 1 && state.mode === 'running') {
        const rest = progress - 1;
        step();
        if (state.mode === 'running') progress = rest;
      }
      draw();
    }
  } else {
    if (dying && now - deathStart >= deathDelay) showResultModal();
    if (dying || effectCount() > 0) draw();
  }
  requestAnimationFrame(frame);
}
function finish() {
  const endedBy = state.mode === 'win' ? 'win' : 'collision', score = state.score;
  best = Math.max(best ?? 0, score);
  $('#best').textContent = best;
  $('#abort').disabled = true;
  if (endedBy === 'collision') tone('death');
  submitResult({runId, studentId: profile.studentId, name: profile.name, grade: profile.grade, classNo: profile.classNo, score,
    elapsedMs: Math.round(performance.now() - startedAt), ticks: state.ticks, endedBy, version: RULES.version});
  // Result modal waits for the death/win animation.
  dying = true; deathStart = performance.now(); eatPending = false;
  deathDelay = rmq.matches ? 350 : endedBy === 'win' ? 500 : 1000;
  if (endedBy === 'collision') spawnDeath(state.snake[0], state.crashDirection || state.direction);
  const id = ++deathId;
  setTimeout(() => { if (dying && id === deathId) showResultModal(); }, deathDelay + 50);
  draw();
}
function showResultModal() {
  if (!dying) return;
  dying = false;
  const win = state.mode === 'win';
  overlay(win ? 'BOARD COMPLETE' : 'GAME OVER', win ? '모든 칸을 채웠어요!' : '이번 기록 ' + state.score + '점', '다시 시작해 나의 최고점에 도전해요.', '다시 시작');
  $('#overlay-foot').textContent = 'Enter·스페이스바 또는 버튼으로 다시 준비';
  const el = $('#overlay'); void el.offsetWidth; el.classList.add('enter');
  draw();
}
function abort(message = '중도 종료했습니다. 이 판의 기록은 저장하지 않습니다.') {
  if (!['ready', 'running'].includes(state.mode)) return;
  state = {...state, mode: 'aborted', ate: false}; previous = state; progress = 1; queue = [];
  $('#abort').disabled = true;
  overlay('NOT SAVED', '다음 도전을 기다려요', '중도 종료한 판은 저장되지 않습니다.', '다시 시작');
  $('#overlay-foot').textContent = 'Enter 또는 버튼으로 다시 시작';
  setSave(message);
  draw();
}

// ---------- input ----------
// Listen on window (capture) so keys work no matter which element has focus, and use physical key codes
// so W/A/S/D keep working while the Korean IME is active.
window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select')) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const name = directionFromKey(event.code, event.key);
  if (name) {
    event.preventDefault();
    if (!event.repeat || state.mode === 'running') handleDirection(name);
    return;
  }
  if (event.code === 'Escape' || event.key === 'Escape') {
    event.preventDefault();
    abort();
  } else if (event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!event.repeat && overlayVisible && state.mode !== 'running' && !dying) prepareToPlay();
  }
}, {capture: true});
$('#play').addEventListener('click', () => {
  if (overlayVisible && state.mode !== 'running' && !dying) prepareToPlay();
});
// Buttons must not keep focus, otherwise Space/Enter would re-trigger them.
for (const b of document.querySelectorAll('button')) b.addEventListener('mouseup', () => b.blur());
$('#abort').addEventListener('click', () => abort());
canvas.addEventListener('pointerdown', () => game.focus({preventScroll: true}));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode === 'running') abort('탭을 벗어나 중도 종료했습니다. 기록은 저장하지 않습니다.');
});
window.addEventListener('blur', () => { lastFrame = performance.now(); });
function syncSoundButton() {
  $('#sound').textContent = sound ? '소리 켜짐' : '소리 꺼짐';
  $('#sound').setAttribute('aria-pressed', String(sound));
  $('#sound').setAttribute('aria-label', sound ? '소리 끄기' : '소리 켜기');
}
syncSoundButton();
$('#sound').addEventListener('click', () => {
  sound = !sound;
  try { localStorage.setItem('gajwa-snake-sound', sound ? '1' : '0'); } catch {}
  syncSoundButton();
  if (sound) tone('turn');
});
$('#fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await game.requestFullscreen();
  } catch {
    setSave('이 브라우저에서는 전체 화면을 사용할 수 없어요.');
  }
});

// ---------- saving ----------
function postForm(payload) {
  const frameEl = document.createElement('iframe'), form = document.createElement('form');
  frameEl.name = 'gajwa_save_' + payload.runId; frameEl.hidden = true; frameEl.title = '구글 시트 저장 응답';
  form.action = cfg.appsScriptUrl; form.method = 'POST'; form.target = frameEl.name; form.hidden = true;
  const input = document.createElement('input');
  input.type = 'hidden'; input.name = 'payload'; input.value = JSON.stringify(payload);
  form.appendChild(input);
  document.body.append(frameEl, form);
  form.submit();
  setTimeout(() => { form.remove(); frameEl.remove(); }, 60000);
}
async function submitResult(payload) {
  if (submitting.has(payload.runId)) return;
  if (!cfg.appsScriptUrl) { setSave('시트 연결 준비 중이라 이 기록은 저장되지 않았습니다.', 'error'); return; }
  submitting.add(payload.runId);
  pending.set(payload.runId, payload);
  $('#retry-save').hidden = false;
  setSave('구글 시트에 기록을 저장하고 있어요.');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      postForm(payload);
      for (let n = 0; n < 6; n++) {
        await new Promise(r => setTimeout(r, 1500 + n * 250));
        const result = await jsonp('status', {runId: payload.runId});
        if (result.found) {
          pending.delete(payload.runId); submitting.delete(payload.runId);
          $('#retry-save').hidden = pending.size === 0;
          if (runId === payload.runId) setSave('구글 시트 저장 완료 · 랭킹 보드에 곧 반영됩니다.', 'success');
          refreshMine(runId === payload.runId);
          return;
        }
      }
    } catch {}
    if (runId === payload.runId) setSave('저장 응답이 늦어 같은 기록으로 재시도합니다.');
  }
  submitting.delete(payload.runId);
  if (runId === payload.runId) setSave('저장을 확인하지 못했어요. 인터넷 연결을 확인한 뒤 "저장 다시 확인"을 눌러 주세요.', 'error');
}
// Personal best + current class rank (only shown when inside the class TOP10).
async function refreshMine(showRank = false) {
  if (!profile) return;
  try {
    const result = await jsonp('leaderboard', {grade: profile.grade, classNo: profile.classNo, studentId: profile.studentId, studentGrade: profile.grade, studentClass: profile.classNo});
    if (result.personalBest !== undefined) {
      best = Math.max(best ?? 0, Number(result.personalBest));
      if (best > 0 || state.mode !== 'ready') $('#best').textContent = best;
    }
    const mine = (result.entries || []).find(e => String(e.studentId) === profile.studentId);
    if (showRank && mine && ['collision', 'win'].includes(state.mode)) setSave('구글 시트 저장 완료 · 지금 우리 반 ' + mine.rank + '위예요!', 'success');
  } catch {}
}
$('#retry-save').addEventListener('click', () => { for (const p of pending.values()) submitResult(p); });
window.addEventListener('online', () => { for (const p of pending.values()) submitResult(p); });
window.addEventListener('beforeunload', event => { if (pending.size) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('resize', resizeCanvas);

resizeCanvas();
reset();
requestAnimationFrame(frame);
refreshMine();

// Read-only runtime metrics for development checks; no personal data exposed.
window.GAJWA_DEBUG = Object.freeze({
  getState: () => ({mode: state.mode, score: state.score, ticks: state.ticks, progress, queue: queue.length, head: {...state.snake[0]}, direction: {...state.direction}, cols: RULES.cols, rows: RULES.rows, foodCount: state.foods.length, foods: state.foods.map(p => ({...p})), snakeLength: state.snake.length, overlayVisible, effects: effectCount(), lastSound, mouth}),
  getPendingCount: () => pending.size,
});
