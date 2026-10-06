import {parseStudentId} from './engine.mjs';

export const cfg = window.GAJWA_CONFIG || {};
export const $ = selector => document.querySelector(selector);
const PROFILE_KEY = 'gajwa-snake-profile';

// Profile lives only in this browser tab session, so shared school laptops do not keep the previous student.
export function loadProfile() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(PROFILE_KEY) || 'null');
    const parsed = raw && parseStudentId(raw.studentId);
    if (!parsed || typeof raw.name !== 'string' || !raw.name.trim()) return null;
    return {...parsed, name: raw.name.trim().normalize('NFC').slice(0, 20)};
  } catch {
    return null;
  }
}

export function saveProfile(profile) {
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify({studentId: profile.studentId, name: profile.name}));
}

export function clearProfile() {
  sessionStorage.removeItem(PROFILE_KEY);
}

export function studentLabel(p, {withGrade = true} = {}) {
  const parsed = parseStudentId(p.studentId);
  const number = parsed ? ' ' + parsed.number + '번' : '';
  return (withGrade ? p.grade + '학년 ' : '') + p.classNo + '반' + number;
}

let sequence = 0;
export function jsonp(action, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!cfg.appsScriptUrl) {
      reject(new Error('시트 연결 준비 중'));
      return;
    }
    const callback = '__gajwaCb_' + Date.now() + '_' + sequence++;
    const script = document.createElement('script');
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      script.remove();
      delete window[callback];
    };
    window[callback] = data => {
      cleanup();
      if (data?.ok) resolve(data);
      else reject(new Error(data?.message || '연결 오류'));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('응답 시간 초과'));
    }, timeoutMs);
    script.onerror = () => {
      cleanup();
      reject(new Error('시트 연결 실패'));
    };
    const url = new URL(cfg.appsScriptUrl);
    url.search = new URLSearchParams({action, ...params, callback, t: String(Date.now())}).toString();
    script.src = url.href;
    script.referrerPolicy = 'no-referrer';
    document.head.appendChild(script);
  });
}

export function classesPerGrade(stats = []) {
  const base = cfg.classesPerGrade || {1: 5, 2: 5, 3: 5};
  const result = {};
  for (const grade of [1, 2, 3]) {
    const set = new Set();
    for (let c = 1; c <= Number(base[grade] || 0); c++) set.add(c);
    for (const s of stats) if (Number(s.grade) === grade) set.add(Number(s.classNo));
    result[grade] = [...set].sort((a, b) => a - b);
  }
  return result;
}
