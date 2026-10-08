// 운영 설정. classesPerGrade: 학년별 반 수(랭킹 보드의 반 선택·반 대항전에 사용). 기록이 있는 반은 자동으로 추가됩니다.
window.GAJWA_CONFIG = Object.freeze({
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbzfeO4Dcs7GG55ki64MPdGf-UyXn73Nf1BIwr6LWq0HFqsfAMOvbyrDiOUeAB3GwmCF/exec",
  pollMs: 5000,
  boardPollMs: 3000,
  classesPerGrade: {1: 4, 2: 5, 3: 5},
  version: "1.2.0"
});
