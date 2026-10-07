import {parseStudentId} from './engine.mjs';
import {$, cfg, jsonp, classesPerGrade} from './common.mjs';

const POLL_MS = Math.max(2000, Number(cfg.boardPollMs) || 3000);
const LAST_CLASS_KEY = 'gajwa-board-last-class';
// Keep all ranking views on the current page version, including reloads and shared links.
const BOARD_VERSION = '20261007-4';
const versionedUrl = new URL(location.href);
versionedUrl.searchParams.set('v', BOARD_VERSION);
history.replaceState(null, '', versionedUrl);
const BAR_COLORS = ['#f5c542', '#8f7cf6', '#7fbf4d', '#ef7d5a', '#4fb3e8', '#e86fa8', '#4a762c', '#c98a3c', '#5b6ee1', '#2fb39a'];

let scope = readScope(), timer = null, busy = false, lastData = null, lastOk = 0;
let previousTop = new Map(), previousRecent = new Set(), firstRender = true;

function readScope() {
  const q = new URLSearchParams(location.search);
  if (q.get('view') === 'all') return {type: 'all'};
  const grade = Number(q.get('grade')), classNo = Number(q.get('cls') || q.get('class'));
  if ([1, 2, 3].includes(grade) && Number.isInteger(classNo) && classNo >= 1 && classNo <= 30) return {type: 'class', grade, classNo};
  return null;
}
function writeScope(next) {
  scope = next;
  const url = new URL(location.href);
  url.search = next.type === 'all' ? '?view=all' : '?grade=' + next.grade + '&cls=' + next.classNo;
  url.searchParams.set('v', BOARD_VERSION);
  history.replaceState(null, '', url);
  if (next.type === 'class') localStorage.setItem(LAST_CLASS_KEY, JSON.stringify({grade: next.grade, classNo: next.classNo}));
}
function lastClass() {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_CLASS_KEY) || 'null');
    if (v && [1, 2, 3].includes(v.grade) && v.classNo >= 1) return {type: 'class', grade: v.grade, classNo: v.classNo};
  } catch {}
  return null;
}
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = n => Number(n).toLocaleString('ko-KR', {maximumFractionDigits: 1});
const numberOf = r => { const p = parseStudentId(r.studentId); return p && p.grade === Number(r.grade) && p.classNo === Number(r.classNo) ? p.number : null; };
const hms = d => [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');

// ---------- views ----------
function showBoard() {
  $('#picker').hidden = true;
  $('#board').hidden = false;
  $('#scope-toggle').hidden = false;
  $('#change').hidden = false;
  $('#change').textContent = '반 바꾸기';
  const isClass = scope.type === 'class';
  $('#title').textContent = isClass ? scope.grade + '학년 ' + scope.classNo + '반 실시간 랭킹' : '우리 학교 실시간 랭킹';
  $('#top-title').textContent = isClass ? scope.classNo + '반 TOP 10' : '전교 TOP 10';
  $('#scope-toggle').textContent = isClass ? '전체 랭킹' : '반 랭킹';
  document.title = $('#title').textContent + ' · 가좌 스네이크';
  previousTop = new Map(); previousRecent = new Set(); firstRender = true;
  $('#top-list').replaceChildren();
  $('#top-empty').hidden = true;
  $('#battle-list').replaceChildren();
  if (lastData && sameScope(lastData.scope)) render(lastData);
  poll(true);
}
function sameScope(s) {
  if (!s || !scope) return false;
  return scope.type === 'all' ? s.grade == null && s.classNo == null : s.grade === scope.grade && s.classNo === scope.classNo;
}
function showPicker() {
  $('#board').hidden = true;
  $('#picker').hidden = false;
  $('#scope-toggle').hidden = true;
  $('#change').hidden = !scope;
  $('#change').textContent = '돌아가기';
  buildPicker(lastData?.classStats || []);
  if (!lastData) jsonp('board', {}).then(data => { lastData = data; buildPicker(data.classStats || []); }).catch(() => {});
}
function buildPicker(stats) {
  const classes = classesPerGrade(stats), wrap = $('#picker-grades');
  wrap.replaceChildren();
  for (const grade of [1, 2, 3]) {
    if (!classes[grade].length) continue;
    const row = el('div', 'picker-row');
    row.append(el('span', 'picker-grade', grade + '학년'));
    const buttons = el('div', 'picker-buttons');
    for (const c of classes[grade]) {
      const b = el('button', 'pick', c + '반');
      b.addEventListener('click', () => { writeScope({type: 'class', grade, classNo: c}); showBoard(); });
      buttons.append(b);
    }
    row.append(buttons);
    wrap.append(row);
  }
}

// ---------- rendering ----------
function render(data) {
  $('#participants').textContent = '참여 ' + fmt(data.participants || 0) + '명';
  renderTop(data.entries || []);
  renderBattle(data.classStats || []);
  renderRecent(data.recent || []);
  firstRender = false;
}
function renderTop(entries) {
  const list = $('#top-list'), next = new Map(), frag = document.createDocumentFragment();
  $('#top-empty').hidden = entries.length > 0;
  list.classList.toggle('many', entries.length > 5);
  list.style.setProperty('--rows', String(entries.length > 5 ? Math.ceil(entries.length / 2) : 5));
  for (const e of entries) {
    const key = e.grade + ':' + e.classNo + ':' + e.studentId;
    next.set(key, {score: Number(e.score), rank: Number(e.rank)});
    const li = el('li', 'top-row' + (e.rank <= 3 ? ' podium r' + e.rank : ''));
    li.append(el('span', 'rank', String(e.rank)));
    const who = el('span', 'who');
    who.append(el('b', 'name', e.name));
    const n = numberOf(e);
    who.append(el('small', 'detail', scope.type === 'class' ? (n ? n + '번' : '') : e.grade + '학년 ' + e.classNo + '반' + (n ? ' ' + n + '번' : '')));
    li.append(who, el('span', 'score', fmt(e.score) + '점'));
    const old = previousTop.get(key);
    if (!firstRender && (!old || old.score < Number(e.score) || old.rank > Number(e.rank))) li.classList.add('flash');
    frag.append(li);
  }
  list.replaceChildren(frag);
  previousTop = next;
}
function renderBattle(stats) {
  const list = $('#battle-list'), byKey = new Map(stats.map(s => [s.grade + ':' + s.classNo, s]));
  const classes = classesPerGrade(stats);
  let rows = [];
  if (scope.type === 'class') {
    for (const c of classes[scope.grade]) rows.push({grade: scope.grade, classNo: c, stat: byKey.get(scope.grade + ':' + c)});
  } else {
    // School view: rank classes that already have records, best average first (TOP 10).
    rows = stats.map(s => ({grade: Number(s.grade), classNo: Number(s.classNo), stat: s}))
      .sort((x, y) => y.stat.average - x.stat.average || y.stat.participants - x.stat.participants || x.grade - y.grade || x.classNo - y.classNo)
      .slice(0, 10);
  }
  const max = Math.max(1, ...rows.map(r => r.stat?.average || 0));
  $('#battle-title').firstChild.textContent = scope.type === 'class' ? scope.grade + '학년 반 대항전 ' : '반 대항전 TOP 10 ';
  list.style.setProperty('--rows', String(Math.max(rows.length, 5)));
  if (!rows.length) { list.replaceChildren(el('p', 'empty', '기록이 쌓이면 반 순위가 나타나요')); return; }
  const frag = document.createDocumentFragment();
  rows.forEach((r, i) => {
    const mine = scope.type === 'class' && r.classNo === scope.classNo;
    const row = el('div', 'battle-row' + (mine ? ' mine' : ''));
    row.append(el('span', 'label', scope.type === 'class' ? r.classNo + '반' : r.grade + '학년 ' + r.classNo + '반'));
    if (scope.type !== 'class') row.classList.add('wide');
    const track = el('span', 'track'), bar = el('span', 'bar');
    const avg = r.stat?.average || 0;
    bar.style.width = avg ? Math.max(4, avg / max * 100) + '%' : '0%';
    bar.style.background = !r.stat ? 'var(--ink)' : mine ? '#ef5b4c' : BAR_COLORS[(r.classNo - 1 + (r.grade - 1) * 3) % BAR_COLORS.length];
    track.append(bar);
    row.append(track, el('span', 'value', r.stat ? fmt(avg) : '-'));
    if (r.stat) row.title = r.stat.participants + '명 참여 · 최고 ' + r.stat.top + '점';
    frag.append(row);
  });
  list.replaceChildren(frag);
}
function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (!isFinite(s)) return '';
  if (s < 60) return '방금';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  return Math.floor(s / 86400) + '일 전';
}
function renderRecent(recent) {
  const list = $('#recent-list'), next = new Set();
  if (!recent.length) { list.replaceChildren(el('p', 'recent-empty', '아직 기록이 없어요. 게임을 시작해 보세요!')); return; }
  const frag = document.createDocumentFragment();
  for (const r of recent.slice(0, 5)) {
    const key = r.savedAt + ':' + r.studentId;
    next.add(key);
    const card = el('div', 'recent-card' + (!firstRender && !previousRecent.has(key) ? ' fresh' : ''));
    const n = numberOf(r);
    card.append(el('span', 'who', r.grade + '-' + r.classNo + (n ? ' ' + n + '번 ' : ' ') + r.name));
    const line = el('span', 'line');
    line.append(el('b', '', fmt(r.score) + '점'), el('small', '', timeAgo(r.savedAt)));
    card.append(line);
    frag.append(card);
  }
  list.replaceChildren(frag);
  previousRecent = next;
}

// ---------- polling ----------
async function poll(force = false) {
  clearTimeout(timer);
  if (!scope || $('#board').hidden) return;
  if (busy && !force) return;
  if (document.hidden && !force) { timer = setTimeout(poll, POLL_MS); return; }
  busy = true;
  const asked = scope;
  try {
    const params = asked.type === 'class' ? {grade: asked.grade, classNo: asked.classNo} : {};
    const data = await jsonp('board', params, 12000);
    if (asked === scope) {
      lastData = data;
      lastOk = Date.now();
      render(data);
      setStatus(true);
    }
  } catch {
    if (asked === scope) setStatus(false);
  } finally {
    busy = false;
    timer = setTimeout(poll, POLL_MS);
  }
}
function setStatus(ok) {
  $('#dot').className = ok ? 'on' : 'off';
  const t = lastOk ? hms(new Date(lastOk)) : '-';
  $('#status-text').textContent = ok ? '실시간 연결됨 · 마지막 갱신 ' + t + ' · ' + POLL_MS / 1000 + '초마다 자동 갱신'
    : '연결이 잠시 늦어지고 있어요 · 마지막 갱신 ' + t + ' · 자동으로 다시 시도합니다';
}
function tickClock() {
  $('#clock').textContent = hms(new Date());
}

// ---------- tools ----------
$('#fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {}
});
document.addEventListener('fullscreenchange', () => { $('#fullscreen').textContent = document.fullscreenElement ? '창 모드' : '전체화면'; });
$('#scope-toggle').addEventListener('click', () => {
  if (scope.type === 'class') { writeScope({type: 'all'}); showBoard(); }
  else {
    const last = lastClass();
    if (last) { writeScope(last); showBoard(); } else showPicker();
  }
});
$('#change').addEventListener('click', () => {
  if (!$('#picker').hidden && scope) showBoard();
  else showPicker();
});
document.querySelector('.pick-all').addEventListener('click', () => { writeScope({type: 'all'}); showBoard(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(true); });

tickClock();
setInterval(tickClock, 1000);
if (scope) { if (scope.type === 'class') writeScope(scope); showBoard(); } else showPicker();
