import {RULES, DIRECTIONS, makeState, advance, allowed, equal, routeForFrame, trimRoute, pointAt, directionFromKey, enqueueDirection} from './engine.mjs';
import {$, cfg, jsonp, loadProfile, clearProfile, studentLabel} from './common.mjs';

const profile = loadProfile();
if (!profile) location.replace('./');

const game = $('#game'), canvas = $('#board'), ctx = canvas.getContext('2d');
let state = makeState(), previous = state, queue = [], progress = 1, startedAt = 0, lastFrame = 0;
let graceUsed = false, best = null, runId = crypto.randomUUID(), audio = null, sound = false;
const pending = new Map(), submitting = new Set();
const statuses = {ready: '준비', running: '플레이 중', collision: '게임 종료', win: '완주', aborted: '중도 종료'};

// ---------- header ----------
if (profile) {
  $('#profile-name').textContent = profile.name;
  $('#profile-detail').textContent = studentLabel(profile);
  $('#board-link').href = 'board.html?grade=' + profile.grade + '&cls=' + profile.classNo;
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
  canvas.width = 680 * dpr;
  canvas.height = 600 * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
function setSave(text, type = '') {
  const el = $('#save-state');
  el.textContent = text;
  el.className = type;
}
function overlay(kicker, title, description, button) {
  $('#overlay').hidden = false;
  $('#overlay-kicker').textContent = kicker;
  $('#overlay-title').textContent = title;
  $('#overlay-description').textContent = description;
  $('#play').textContent = button;
}
function drawApple(food, scale = 1) {
  if (!food || scale <= 0) return;
  const x = (food.x + .5) * 40, y = (food.y + .5) * 40;
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.fillStyle = '#739d3325'; ctx.beginPath(); ctx.ellipse(1, 15, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ed5144'; ctx.beginPath(); ctx.moveTo(0, -10); ctx.bezierCurveTo(-20, -20, -19, 16, -1, 17); ctx.bezierCurveTo(19, 18, 20, -20, 0, -10); ctx.fill();
  ctx.fillStyle = '#ff8a7355'; ctx.beginPath(); ctx.ellipse(-6, -4, 3, 6, .3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#725b28'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(2, -18); ctx.stroke();
  ctx.fillStyle = '#55872f'; ctx.beginPath(); ctx.ellipse(8, -15, 7, 3, -.4, 0, Math.PI * 2); ctx.fill();
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
  ctx.clearRect(0, 0, 680, 600);
  for (let y = 0; y < RULES.rows; y++) for (let x = 0; x < RULES.cols; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#a2d149' : '#aad751';
    ctx.fillRect(x * 40, y * 40, 40, 40);
  }
  if (state.ate && state.mode === 'running') {
    drawApple(previous.food, 1 - alpha * .8);
    if (alpha > .7) drawApple(state.food, Math.min(1, (alpha - .7) / .3));
  } else drawApple(state.food);
  const route = routeForFrame(previous, state, alpha);
  const bodyEnd = Math.max(.05, route.length - .5);
  strokeRoute(trimRoute(route.points, bodyEnd), 27, '#416de4');
  const tailSteps = 12;
  for (let i = 0; i < tailSteps; i++) {
    const a = bodyEnd + i * .5 / tailSteps, b = bodyEnd + (i + 1) * .5 / tailSteps;
    strokeRoute([pointAt(route.points, a), pointAt(route.points, b)], Math.max(1.4, 27 * (1 - i / tailSteps)), '#416de4');
  }
  // Eyes look toward the next queued turn so a buffered input is visible immediately.
  const h = route.head, d = queue[0] || route.direction;
  const hx = (h.x + .5) * 40, hy = (h.y + .5) * 40;
  ctx.fillStyle = '#416de4'; ctx.beginPath(); ctx.arc(hx, hy, 14.5, 0, Math.PI * 2); ctx.fill();
  for (const side of [-1, 1]) {
    const ex = hx + d.x * 7 - d.y * side * 8, ey = hy + d.y * 7 + d.x * side * 8;
    ctx.fillStyle = '#f9fcff'; ctx.beginPath(); ctx.ellipse(ex, ey, 6.1, 6.7, Math.atan2(d.y, d.x), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#263b7c'; ctx.beginPath(); ctx.arc(ex + d.x * 2, ey + d.y * 2, 3.2, 0, Math.PI * 2); ctx.fill();
  }
  if (state.mode === 'collision') {
    ctx.fillStyle = '#e8514333'; ctx.beginPath(); ctx.arc(hx, hy, 24, 0, Math.PI * 2); ctx.fill();
  }
  const scoreText = String(state.score), stateText = statuses[state.mode] || '준비';
  if (scoreText !== lastScoreText) $('#score').textContent = lastScoreText = scoreText;
  if (stateText !== lastStateText) $('#game-state').textContent = lastStateText = stateText;
}
function tone(type) {
  if (!sound) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.connect(gain); gain.connect(audio.destination); osc.type = 'sine';
    osc.frequency.setValueAtTime(type === 'eat' ? 700 : 170, audio.currentTime);
    osc.frequency.exponentialRampToValueAtTime(type === 'eat' ? 1000 : 70, audio.currentTime + .12);
    gain.gain.setValueAtTime(.06, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .16);
    osc.start(); osc.stop(audio.currentTime + .17);
  } catch {}
}

// ---------- game flow ----------
function reset() {
  state = makeState(); previous = state; progress = 1; queue = []; runId = crypto.randomUUID(); startedAt = 0;
  $('#abort').disabled = true;
  $('#best').textContent = best ?? '-';
  overlay('READY', '준비됐나요?', '방향키를 누르면 바로 출발합니다.\n벽과 몸을 피해 사과를 먹어 보세요.', '시작하기');
  $('#overlay-foot').textContent = '방향키 또는 W A S D';
  setSave('방향키를 눌러 출발하세요.');
  draw();
  game.focus({preventScroll: true});
}
function begin(direction) {
  state = {...state, mode: 'running'};
  $('#overlay').hidden = true;
  $('#abort').disabled = false;
  startedAt = performance.now();
  lastFrame = startedAt;
  setSave('사과를 먹고 최고 기록을 만들어 보세요.');
  queue = [direction];
  step();
}
function step() {
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
  } else if (state.ate) tone('eat');
}
function handleDirection(name) {
  const d = DIRECTIONS[name];
  if (!d || !profile) return;
  if (state.mode === 'ready') {
    if (allowed(state.direction, d)) begin(d);
    return;
  }
  if (state.mode !== 'running') return;
  // Early-turn grace: a key pressed just after a cell boundary re-routes the step that just started,
  // so a slightly late press still turns at the intended cell instead of one cell later.
  // Only a straight step can be re-routed, and only once, so a turn the player already made is never undone.
  if (!queue.length && !graceUsed && progress < RULES.turnGrace && previous !== state && previous.mode === 'running'
      && equal(state.direction, previous.direction) && !equal(d, state.direction) && allowed(previous.direction, d)) {
    graceUsed = true;
    state = advance(previous, d);
    afterStep();
    draw();
    return;
  }
  queue = enqueueDirection(queue, state.direction, d);
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
  }
  requestAnimationFrame(frame);
}
function finish() {
  const endedBy = state.mode === 'win' ? 'win' : 'collision', score = state.score;
  best = Math.max(best ?? 0, score);
  $('#best').textContent = best;
  $('#abort').disabled = true;
  tone('end');
  overlay(endedBy === 'win' ? 'BOARD COMPLETE' : 'GAME OVER', endedBy === 'win' ? '모든 칸을 채웠어요!' : '이번 기록 ' + score + '점', '다시 시작해 나의 최고점에 도전해요.', '다시 시작');
  $('#overlay-foot').textContent = 'Enter 또는 버튼으로 다시 시작';
  submitResult({runId, studentId: profile.studentId, name: profile.name, grade: profile.grade, classNo: profile.classNo, score,
    elapsedMs: Math.round(performance.now() - startedAt), ticks: state.ticks, endedBy, version: RULES.version});
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
  } else if ((event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter') && !['ready', 'running'].includes(state.mode)) {
    event.preventDefault();
    reset();
  } else if (event.code === 'Space') {
    event.preventDefault();
  }
}, {capture: true});
$('#play').addEventListener('click', () => {
  if (state.mode === 'ready') begin(DIRECTIONS.right);
  else reset();
});
// Buttons must not keep focus, otherwise Space/Enter would re-trigger them.
for (const b of document.querySelectorAll('button')) b.addEventListener('mouseup', () => b.blur());
$('#abort').addEventListener('click', () => abort());
canvas.addEventListener('pointerdown', () => game.focus({preventScroll: true}));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode === 'running') abort('탭을 벗어나 중도 종료했습니다. 기록은 저장하지 않습니다.');
});
window.addEventListener('blur', () => { lastFrame = performance.now(); });
$('#sound').addEventListener('click', () => {
  sound = !sound;
  $('#sound').textContent = sound ? '소리 켜짐' : '소리 꺼짐';
  $('#sound').setAttribute('aria-pressed', String(sound));
  $('#sound').setAttribute('aria-label', sound ? '소리 끄기' : '소리 켜기');
  if (sound) tone('eat');
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
  getState: () => ({mode: state.mode, score: state.score, ticks: state.ticks, progress, queue: queue.length, head: {...state.snake[0]}, direction: {...state.direction}}),
  getPendingCount: () => pending.size,
});
