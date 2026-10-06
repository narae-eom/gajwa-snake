/**
 * 가좌중학교 스네이크 게임 - 점수 기록/리더보드 백엔드 (Google Apps Script, Sheet-bound)
 *
 * 배포 방식: 이 스크립트는 특정 Google Sheet에 바인딩되어 실행되는 "Container-bound script"입니다.
 * Firebase 등 별도 백엔드를 쓰지 않고, Apps Script Web App + Google Sheet만으로 동작합니다.
 *
 * ============================================================================
 * 사용 방법 (요약, 자세한 내용은 README.md 참고)
 * ============================================================================
 * 1. Google Sheet를 하나 만들고, 확장프로그램 > Apps Script 로 이 파일을 붙여넣습니다.
 * 2. Apps Script 편집기에서 setUp 함수를 선택하고 '실행' 버튼을 눌러 최초 1회 실행합니다.
 *    (권한 승인 팝업이 뜨면 이 스크립트의 소유자 계정으로 승인합니다.)
 * 3. 배포 > 새 배포 > 유형: 웹 앱
 *    - 실행 계정: 나 (소유자 계정)
 *    - 액세스 권한이 있는 사용자: 전체
 *    배포 후 나오는 /exec URL을 프론트엔드 설정(appsScriptUrl)에 넣습니다.
 * 4. 코드를 수정한 뒤에는 '새 배포'가 아니라 기존 배포를 '관리 > 편집 > 새 버전'으로 업데이트해야
 *    동일 URL에 변경사항이 반영됩니다.
 *
 * ============================================================================
 * API 계약 (프론트엔드와 합의된 contract)
 * ============================================================================
 * 모든 응답은 JSONP입니다 (크로스 도메인: GitHub Pages 프론트 → Apps Script 백엔드).
 * 요청: GET .../exec?action=...&callback=__gajwaCb_xxxx&...
 * 응답 바디: "__gajwaCb_xxxx(<JSON>)"  (Content-Type: text/javascript)
 *
 * callback 파라미터는 반드시 /^__gajwaCb_[A-Za-z0-9_]+$/ 형태여야 하며,
 * 그렇지 않으면 콜백을 실행하지 않고 에러만 반환합니다(스크립트 삽입 방지).
 *
 * --- action=leaderboard ---
 *   파라미터: grade(선택, 1~3), classNo(선택, 1~30) - 둘 다 주면 해당 반만, 둘 다 없으면 전교
 *   성공 응답:
 *     {
 *       ok: true,
 *       entries: [ { rank, studentId, name, grade, classNo, score, savedAt }, ... ],
 *       updatedAt: "ISO8601",
 *       revision: <number>
 *     }
 *   - entries는 "학생별 최고 점수" 1건만 집계한 뒤 점수 내림차순으로 정렬합니다.
 *   - 순위는 경쟁 순위(동점자는 같은 순위, 다음 순위는 건너뜀: 1,1,3,4,4,6 ...).
 *   - rank <= 10 인 모든 사람을 포함합니다. 동점으로 10위가 여러 명이면 10명을 넘길 수 있습니다
 *     (예: 공동 10위가 4명이면 총 13명이 나올 수 있음). "10등까지" 요구사항을 '정확히 10행'이
 *     아니라 '순위값 10 이하 전체'로 해석합니다.
 *   - 실패 시: { ok:false, error:"CODE", message:"..." }
 *
 * --- action=status ---
 *   파라미터: runId (필수)
 *   성공 응답: { ok:true, found:true, savedAt:"ISO8601" } 또는 { ok:true, found:false }
 *   - 전체 레코드를 노출하지 않고 "이 runId가 저장되었는지"만 알려주는 최소 정보만 반환합니다.
 *   - 실패 시: { ok:false, error:"CODE", message:"..." }
 *
 * --- action=health ---
 *   성공 응답: { ok:true, time:"ISO8601" }
 *
 * --- POST (점수 제출) ---
 *   프론트엔드는 CORS preflight를 피하기 위해 "hidden HTML form + iframe" 방식으로
 *   application/x-www-form-urlencoded POST를 보냅니다 (fetch 기반 정상 CORS가 아님을 전제로 설계).
 *   본문 필드: payload=<JSON 문자열을 URL 인코딩한 것>
 *   payload JSON 형태:
 *     {
 *       runId: "<crypto.randomUUID() 형식의 UUID v4>",
 *       studentId: "학번 문자열 (앞자리 0 보존)",
 *       name: "이름",
 *       grade: 1|2|3,
 *       classNo: 1~30,
 *       score: 0~251 정수,
 *       elapsedMs: 정수(ms),
 *       ticks: 정수,
 *       endedBy: "collision" | "win",
 *       version: "1.0.0"
 *     }
 *   응답: HtmlService 페이지 (iframe 안에서 렌더링되는 용도).
 *     - X-Frame-Options 를 ALLOWALL로 설정하여 어떤 origin의 iframe에서도 로드 가능하게 합니다.
 *     - 이것은 "정상적인 fetch 기반 CORS POST"가 아니라 의도적인 우회 경로입니다. 프론트엔드는
 *       이 페이지의 내용을 직접 읽지 못하므로(크로스 오리진 iframe), 저장 성공 여부 확인은
 *       반드시 이후 action=status 의 JSONP 폴링으로 재확인해야 합니다.
 *
 * ============================================================================
 * 보안/한계에 대한 명시적 메모
 * ============================================================================
 * - 이 웹앱은 "익명 접근 가능한 공개 링크"로 배포됩니다. 로그인 없이 누구나 studentId/name/grade/
 *   classNo를 자유 입력해 제출할 수 있으므로, 신원 위조(다른 학생 이름으로 제출) 및 스코어 남용
 *   (같은 사람이 여러 번 제출해 최고점만 올리는 것은 사양상 허용됨)을 막지 못합니다.
 *   이는 사용자가 명시적으로 승인한 설계 범위입니다 (별도 인증/백엔드 없음).
 * - API는 요청에 따라 실명/학번/점수를 "마스킹 없이" 그대로 반환합니다. 이것도 명시적으로
 *   요청된 사양입니다 (교내용, 전체 공개 랭킹).
 * - Sheet 자체는 비공개(소유자만 편집 가능)이지만, 이 Apps Script 웹앱은 그 비공개 시트의
 *   데이터를 가공해 "공개 API"로 노출합니다. 즉 "시트는 비공개, 웹앱은 공개"라는 구조이며
 *   웹앱을 통해 누구나 전체 랭킹(개인정보 포함)을 조회할 수 있습니다.
 * - Apps Script 실행 할당량(quota), 동시 실행 제한, ScriptLock 대기 시간 초과 등으로 트래픽이
 *   몰리면 일시적으로 제출/조회가 실패할 수 있습니다. 프론트엔드는 상태 폴링으로 재시도해야 합니다.
 * - 레코드는 자동 만료/삭제되지 않습니다. 운영자가 필요 시 직접 시트에서 수동으로 정리해야 합니다.
 * - 중단된(완료되지 않은) 게임은 저장 대상이 아닙니다(endedBy가 collision/win일 때만 제출 가능한
 *   값으로 간주하고 서버에서도 그 외 값은 거부합니다).
 */

// ============================================================================
// 상수
// ============================================================================

var SHEET_NAME = '게임기록';
var TOP10_SHEET_NAME = 'TOP10';
var HEADER = ['runId', 'studentId', 'name', 'grade', 'classNo', 'score', 'elapsedMs', 'ticks', 'endedBy', 'version', 'savedAt'];

var PROP_REVISION = 'LEADERBOARD_REVISION';
var PROP_CACHE_AT = 'LEADERBOARD_CACHE_AT';
var PROP_CACHE_KEY = 'LEADERBOARD_CACHE_KEY';
var PROP_CACHE_VAL = 'LEADERBOARD_CACHE_VAL';

var CACHE_TTL_MS = 3000; // 리더보드 읽기 캐시 최대 3초
var LOCK_WAIT_MS = 10000;

var SCORE_MIN = 0, SCORE_MAX = 251;
var GRADE_MIN = 1, GRADE_MAX = 3;
var CLASS_MIN = 1, CLASS_MAX = 30;
var ELAPSED_MS_MAX = 1000 * 60 * 60; // 1시간 상한 (여유있게)
var TICKS_MAX = 1000000; // 넉넉한 상한
var VALID_ENDED_BY = ['collision', 'win'];
var VALID_VERSION_RE = /^\d+\.\d+\.\d+$/;

var CALLBACK_RE = /^__gajwaCb_[A-Za-z0-9_]+$/;
var UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// ============================================================================
// setUp: 최초 1회, 편집기에서 수동 실행
// ============================================================================

/**
 * 최초 설정. Apps Script 편집기에서 이 함수를 선택해 직접 실행하세요.
 * - 바인딩된 스프레드시트에 기록용 시트와 TOP10 요약 시트를 생성/정비합니다.
 * - 스프레드시트 ID를 PropertiesService에 저장해 doGet/doPost에서 재사용합니다.
 *   (하드코딩된 스프레드시트 ID나 계정 정보를 코드에 넣지 않기 위함입니다.)
 */
function setUp() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('setUp()은 이 스크립트가 바인딩된 스프레드시트의 컨테이너에서 실행해야 합니다.');
  }

  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());

  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  // 헤더 세팅
  sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  sheet.setFrozenRows(1);

  // 모든 데이터 열을 일반 텍스트 서식으로 지정 (수식 자동 해석 방지, studentId 앞자리 0 보존)
  var maxRows = Math.max(sheet.getMaxRows(), 1000);
  if (sheet.getMaxRows() < maxRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), maxRows - sheet.getMaxRows());
  }
  sheet.getRange(1, 1, maxRows, HEADER.length).setNumberFormat('@STRING@');

  // TOP10 시트 (교사용, 읽기 편한 요약 뷰)
  var top10 = ss.getSheetByName(TOP10_SHEET_NAME);
  if (!top10) {
    top10 = ss.insertSheet(TOP10_SHEET_NAME);
  }
  top10.clear();
  top10.getRange(1, 1, 1, 6).setValues([['rank', 'grade', 'classNo', 'studentId', 'name', 'score']]);
  top10.setFrozenRows(1);
  var top10Rows = Math.max(top10.getMaxRows(), 200);
  if (top10.getMaxRows() < top10Rows) {
    top10.insertRowsAfter(top10.getMaxRows(), top10Rows - top10.getMaxRows());
  }
  top10.getRange(1, 1, top10Rows, 6).setNumberFormat('@STRING@');

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP_REVISION)) {
    props.setProperty(PROP_REVISION, '0');
  }

  rebuildTop10Sheet_();

  Logger.log('setUp 완료. 스프레드시트 ID: ' + ss.getId());
}

// ============================================================================
// 스프레드시트/시트 접근 헬퍼
// ============================================================================

function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      // fall through
    }
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    props.setProperty('SPREADSHEET_ID', active.getId());
    return active;
  }
  throw new Error('스프레드시트를 찾을 수 없습니다. setUp()을 먼저 실행하세요.');
}

function getRecordsSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error("'" + SHEET_NAME + "' 시트가 없습니다. setUp()을 먼저 실행하세요.");
  }
  return sheet;
}

// ============================================================================
// doGet: JSONP 엔드포인트 (leaderboard / status / health)
// ============================================================================

function doGet(e) {
  var params = (e && e.parameter) || {};
  var callback = params.callback;

  if (!callback || !CALLBACK_RE.test(callback)) {
    // 유효하지 않은 콜백명은 실행하지 않고, 평문 에러만 반환 (스크립트 삽입 방지)
    return ContentService
      .createTextOutput('invalid callback')
      .setMimeType(ContentService.MimeType.TEXT);
  }

  var action = params.action;
  var result;

  try {
    if (action === 'leaderboard') {
      result = handleLeaderboard_(params);
    } else if (action === 'status') {
      result = handleStatus_(params);
    } else if (action === 'health') {
      result = { ok: true, time: new Date().toISOString() };
    } else {
      result = { ok: false, error: 'UNKNOWN_ACTION', message: 'action 파라미터가 올바르지 않습니다.' };
    }
  } catch (err) {
    result = { ok: false, error: 'INTERNAL_ERROR', message: String(err && err.message ? err.message : err) };
  }

  return buildJsonpResponse_(callback, result);
}

function buildJsonpResponse_(callback, obj) {
  var json = JSON.stringify(obj);
  // JS 콘텍스트 삽입 안전화: <, >, U+2028(line separator), U+2029 이스케이프
  json = json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  var body = callback + '(' + json + ');';
  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// ----------------------------------------------------------------------------
// leaderboard
// ----------------------------------------------------------------------------

function handleLeaderboard_(params) {
  var gradeRaw = params.grade;
  var classNoRaw = params.classNo;

  var grade = null, classNo = null;
  if (gradeRaw !== undefined && gradeRaw !== null && gradeRaw !== '') {
    grade = Number(gradeRaw);
    if (!isInt_(grade) || grade < GRADE_MIN || grade > GRADE_MAX) {
      return { ok: false, error: 'INVALID_GRADE', message: 'grade는 1~3 사이 정수여야 합니다.' };
    }
  }
  if (classNoRaw !== undefined && classNoRaw !== null && classNoRaw !== '') {
    classNo = Number(classNoRaw);
    if (!isInt_(classNo) || classNo < CLASS_MIN || classNo > CLASS_MAX) {
      return { ok: false, error: 'INVALID_CLASSNO', message: 'classNo는 1~30 사이 정수여야 합니다.' };
    }
  }

  var cacheKey = 'lb:' + (grade === null ? '*' : grade) + ':' + (classNo === null ? '*' : classNo);
  var cached = readLeaderboardCache_(cacheKey);
  if (cached) {
    if (params.studentId && /^[0-9]{1,12}$/.test(String(params.studentId))) cached.personalBest = personalBest_(String(params.studentId), Number(params.studentGrade), Number(params.studentClass));
    return cached;
  }

  var entries = computeLeaderboard_(grade, classNo);
  var revision = getRevision_();
  var result = {
    ok: true,
    entries: entries,
    updatedAt: new Date().toISOString(),
    revision: revision
  };

  writeLeaderboardCache_(cacheKey, result);
  if (params.studentId && /^[0-9]{1,12}$/.test(String(params.studentId))) result.personalBest = personalBest_(String(params.studentId), Number(params.studentGrade), Number(params.studentClass));
  return result;
}

/**
 * 전체 기록에서 "학생별 최고 점수 1건"만 골라 점수 내림차순 정렬 후,
 * 경쟁 순위(동점 처리: 1,1,3,4,4,6...)를 매기고 rank<=10 인 항목만 반환합니다.
 * (동점으로 10위가 여러 명이면 10명을 넘겨서 반환될 수 있습니다.)
 */
function computeLeaderboard_(grade, classNo) {
  var sheet = getRecordsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  var numRows = lastRow - 1;
  var values = sheet.getRange(2, 1, numRows, HEADER.length).getValues();

  // studentId -> best record
  var bestByStudent = {};

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var rRunId = row[0];
    var rStudentId = String(row[1]);
    var rName = row[2];
    var rGrade = Number(row[3]);
    var rClassNo = Number(row[4]);
    var rScore = Number(row[5]);
    var rSavedAt = row[10];

    if (!rRunId) continue; // 빈 행 스킵
    if (grade !== null && rGrade !== grade) continue;
    if (classNo !== null && rClassNo !== classNo) continue;

    var identityKey = rGrade + ':' + rClassNo + ':' + rStudentId;
    var existing = bestByStudent[identityKey];
    if (!existing || rScore > existing.score) {
      bestByStudent[identityKey] = {
        studentId: rStudentId,
        name: rName,
        grade: rGrade,
        classNo: rClassNo,
        score: rScore,
        savedAt: toIsoString_(rSavedAt)
      };
    }
  }

  var list = Object.keys(bestByStudent).map(function (k) { return bestByStudent[k]; });
  list.sort(function (a, b) { return b.score - a.score || String(a.savedAt).localeCompare(String(b.savedAt)) || String(a.studentId).localeCompare(String(b.studentId)); });

  // 경쟁 순위 부여
  var ranked = [];
  var prevScore = null;
  var prevRank = 0;
  for (var idx = 0; idx < list.length; idx++) {
    var item = list[idx];
    var rank;
    if (prevScore !== null && item.score === prevScore) {
      rank = prevRank;
    } else {
      rank = idx + 1;
    }
    prevScore = item.score;
    prevRank = rank;

    if (rank > 10) break; // 리스트는 점수 내림차순이므로 10 초과 순위가 나오면 이후도 전부 10 초과
    ranked.push({
      rank: rank,
      studentId: item.studentId,
      name: item.name,
      grade: item.grade,
      classNo: item.classNo,
      score: item.score,
      savedAt: item.savedAt
    });
  }

  return ranked;
}

// ----------------------------------------------------------------------------
// status
// ----------------------------------------------------------------------------

function handleStatus_(params) {
  var runId = params.runId;
  if (!runId || !UUID_RE.test(runId)) {
    return { ok: false, error: 'INVALID_RUN_ID', message: 'runId 형식이 올바르지 않습니다.' };
  }

  var found = findRecordByRunId_(runId);
  if (found) {
    return { ok: true, found: true, savedAt: toIsoString_(found.savedAt) };
  }
  return { ok: true, found: false };
}

function findRecordByRunId_(runId) {
  var sheet = getRecordsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var numRows = lastRow - 1;
  var runIds = sheet.getRange(2, 1, numRows, 1).getValues();
  for (var i = 0; i < runIds.length; i++) {
    if (String(runIds[i][0]) === runId) {
      var savedAt = sheet.getRange(2 + i, HEADER.length, 1, 1).getValue();
      return { savedAt: savedAt };
    }
  }
  return null;
}

// ============================================================================
// doPost: 점수 제출 (hidden form + iframe 방식, application/x-www-form-urlencoded)
// ============================================================================

function doPost(e) {
  var params = (e && e.parameter) || {};
  var payloadRaw = params.payload;

  var outcome;
  try {
    outcome = handleSubmit_(payloadRaw);
  } catch (err) {
    outcome = { ok: false, error: 'INTERNAL_ERROR', message: String(err && err.message ? err.message : err) };
  }

  return buildSavedStatusPage_(outcome);
}

function buildSavedStatusPage_(outcome) {
  // iframe 안에 로드될 용도의 "해롭지 않은" 저장 상태 페이지.
  // 프론트엔드(다른 오리진)는 이 내용을 직접 읽을 수 없으므로(크로스 오리진 iframe),
  // 실제 저장 확인은 action=status JSONP 폴링으로 해야 합니다. 이 페이지는 단지
  // 사람이 직접 열었을 때 상태를 볼 수 있게 하는 보조 용도입니다.
  var safeJson = JSON.stringify(outcome)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>저장 상태</title></head>' +
    '<body><pre id="result">' + htmlEscape_(JSON.stringify(outcome, null, 2)) + '</pre>' +
    '<script>try{window.__gajwaSubmitResult = ' + safeJson + ';}catch(e){}</script>' +
    '</body></html>';

  var output = HtmlService.createHtmlOutput(html);
  // 어떤 origin의 iframe에서도 로드 가능하게 함 (의도적으로 X-Frame-Options 제한 해제).
  // 이는 fetch 기반 정상 CORS 응답이 아니라, hidden iframe form POST 전용 우회 경로입니다.
  output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return output;
}

function htmlEscape_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 제출 처리의 핵심 로직. ScriptLock으로 동시성을 제어하고,
 * 동일 runId 재제출(폴링 중 재시도 등)은 멱등하게 처리합니다(이미 저장되어 있으면 그대로 성공 응답).
 */
function handleSubmit_(payloadRaw) {
  if (!payloadRaw) {
    return { ok: false, error: 'MISSING_PAYLOAD', message: 'payload 파라미터가 없습니다.' };
  }

  var data;
  try {
    data = JSON.parse(payloadRaw);
  } catch (e) {
    return { ok: false, error: 'INVALID_JSON', message: 'payload JSON 파싱에 실패했습니다.' };
  }

  var validation = validateSubmission_(data);
  if (!validation.ok) {
    return validation;
  }
  var clean = validation.value;

  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    acquired = lock.tryLock(LOCK_WAIT_MS);
    if (!acquired) {
      return { ok: false, error: 'LOCK_TIMEOUT', message: '다른 요청을 처리 중입니다. 잠시 후 다시 시도하세요.' };
    }

    // 멱등성: 동일 runId가 이미 저장되어 있으면 중복 저장하지 않고 성공으로 간주.
    var existing = findRecordByRunId_(clean.runId);
    if (existing) {
      return { ok: true, runId: clean.runId, savedAt: toIsoString_(existing.savedAt), duplicate: true };
    }

    var sheet = getRecordsSheet_();
    var savedAt = new Date();
    var row = [
      clean.runId,
      clean.studentId,
      clean.name,
      clean.grade,
      clean.classNo,
      clean.score,
      clean.elapsedMs,
      clean.ticks,
      clean.endedBy,
      clean.version,
      savedAt.toISOString()
    ];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);

    bumpRevision_();
    rebuildTop10Sheet_();

    return { ok: true, runId: clean.runId, savedAt: savedAt.toISOString(), duplicate: false };
  } finally {
    if (acquired) {
      lock.releaseLock();
    }
  }
}

// ============================================================================
// 입력 검증
// ============================================================================

function validateSubmission_(data) {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'INVALID_PAYLOAD', message: 'payload가 올바른 객체가 아닙니다.' };
  }

  // runId: crypto.randomUUID() 형식
  if (typeof data.runId !== 'string' || !UUID_RE.test(data.runId)) {
    return { ok: false, error: 'INVALID_RUN_ID', message: 'runId는 UUID v4 형식의 문자열이어야 합니다.' };
  }

  // studentId: 문자열로 취급, 앞자리 0 보존. 숫자만 허용(학번), 1~20자 정도로 제한.
  if (typeof data.studentId !== 'string' && typeof data.studentId !== 'number') {
    return { ok: false, error: 'INVALID_STUDENT_ID', message: 'studentId가 없습니다.' };
  }
  var studentId = String(data.studentId).trim();
  if (studentId.length < 1 || studentId.length > 20 || !/^[0-9]+$/.test(studentId)) {
    return { ok: false, error: 'INVALID_STUDENT_ID', message: 'studentId는 숫자로만 구성된 문자열이어야 합니다(앞자리 0 보존).' };
  }

  // name: 문자열, NFC 정규화, 길이 제한, 공백만 금지
  if (typeof data.name !== 'string') {
    return { ok: false, error: 'INVALID_NAME', message: 'name이 없습니다.' };
  }
  var name = data.name.normalize('NFC').trim();
  if (name.length < 1 || name.length > 30) {
    return { ok: false, error: 'INVALID_NAME', message: 'name 길이가 올바르지 않습니다.' };
  }

  // grade
  var grade = Number(data.grade);
  if (!isInt_(grade) || grade < GRADE_MIN || grade > GRADE_MAX) {
    return { ok: false, error: 'INVALID_GRADE', message: 'grade는 1~3 사이 정수여야 합니다.' };
  }

  // classNo
  var classNo = Number(data.classNo);
  if (!isInt_(classNo) || classNo < CLASS_MIN || classNo > CLASS_MAX) {
    return { ok: false, error: 'INVALID_CLASSNO', message: 'classNo는 1~30 사이 정수여야 합니다.' };
  }

  // score
  var score = Number(data.score);
  if (!isInt_(score) || score < SCORE_MIN || score > SCORE_MAX) {
    return { ok: false, error: 'INVALID_SCORE', message: 'score는 0~251 사이 정수여야 합니다.' };
  }

  // elapsedMs
  var elapsedMs = Number(data.elapsedMs);
  if (!isInt_(elapsedMs) || elapsedMs < 0 || elapsedMs > ELAPSED_MS_MAX) {
    return { ok: false, error: 'INVALID_ELAPSED_MS', message: 'elapsedMs 값이 올바르지 않습니다.' };
  }

  // ticks
  var ticks = Number(data.ticks);
  if (!isInt_(ticks) || ticks < 0 || ticks > TICKS_MAX) {
    return { ok: false, error: 'INVALID_TICKS', message: 'ticks 값이 올바르지 않습니다.' };
  }

  // endedBy: collision | win만 허용 (중단된 게임은 저장 대상 아님)
  if (typeof data.endedBy !== 'string' || VALID_ENDED_BY.indexOf(data.endedBy) === -1) {
    return { ok: false, error: 'INVALID_ENDED_BY', message: "endedBy는 'collision' 또는 'win'이어야 합니다." };
  }

  // version
  if (typeof data.version !== 'string' || !VALID_VERSION_RE.test(data.version)) {
    return { ok: false, error: 'INVALID_VERSION', message: 'version 형식이 올바르지 않습니다 (예: 1.0.0).' };
  }

  return {
    ok: true,
    value: {
      runId: data.runId,
      studentId: sanitizeSheetCell_(studentId),
      name: sanitizeSheetCell_(name),
      grade: grade,
      classNo: classNo,
      score: score,
      elapsedMs: elapsedMs,
      ticks: ticks,
      endedBy: data.endedBy,
      version: data.version
    }
  };
}

function isInt_(n) {
  return typeof n === 'number' && isFinite(n) && Math.floor(n) === n;
}

/**
 * Google Sheets에서 =, +, -, @ 로 시작하는 문자열은 수식으로 해석될 수 있어,
 * 앞에 어포스트로피(') 를 붙여 리터럴 텍스트로 강제합니다.
 * (셀 서식도 setUp에서 '@STRING@'(일반 텍스트)로 지정해 이중으로 방지합니다.)
 */
function sanitizeSheetCell_(s) {
  if (typeof s !== 'string') return s;
  if (/^[=+\-@]/.test(s)) {
    return "'" + s;
  }
  return s;
}

function toIsoString_(v) {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v) {
    var d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString();
    return v;
  }
  return null;
}

// ============================================================================
// 리비전 / 캐시 (ScriptProperties 기반, 쓰기 시 무효화)
// ============================================================================

function getRevision_() {
  var v = PropertiesService.getScriptProperties().getProperty(PROP_REVISION);
  return v ? Number(v) : 0;
}

function bumpRevision_() {
  var props = PropertiesService.getScriptProperties();
  var next = getRevision_() + 1;
  props.setProperty(PROP_REVISION, String(next));
  return next;
}

function readLeaderboardCache_(key) {
  var text = CacheService.getScriptCache().get(key);
  if (!text) return null;
  try {
    var cached = JSON.parse(text);
    if (Date.now()-cached.at > CACHE_TTL_MS || cached.value.revision !== getRevision_()) return null;
    return cached.value;
  } catch (e) { return null; }
}

function writeLeaderboardCache_(key, value) {
  var text = JSON.stringify({at:Date.now(), value:value});
  if (text.length < 60000) CacheService.getScriptCache().put(key, text, 3);
}

function personalBest_(studentId, grade, classNo) {
  var sheet = getRecordsSheet_();
  if (sheet.getLastRow() < 2) return 0;
  var values = sheet.getRange(2, 1, sheet.getLastRow()-1, HEADER.length).getValues();
  var best = 0;
  values.forEach(function(row){ if(String(row[1])===studentId && Number(row[3])===grade && Number(row[4])===classNo) best=Math.max(best,Number(row[5])||0); });
  return best;
}

/** Teacher-only maintenance after deleting records. */
function refreshTeacherRanking() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { bumpRevision_(); rebuildTop10Sheet_(); } finally { lock.releaseLock(); }
}

// ============================================================================
// TOP10 교사용 시트 재구성 (전교 기준, 제출 성공 시마다 재생성)
// ============================================================================

function rebuildTop10Sheet_() {
  var ss = getSpreadsheet_();
  var top10 = ss.getSheetByName(TOP10_SHEET_NAME);
  if (!top10) return; // setUp 미실행 시 조용히 스킵

  var entries = computeLeaderboard_(null, null);

  var lastRow = top10.getLastRow();
  if (lastRow > 1) {
    top10.getRange(2, 1, lastRow - 1, 6).clearContent();
  }

  if (entries.length === 0) return;

  var rows = entries.map(function (e) {
    return [e.rank, e.grade, e.classNo, sanitizeSheetCell_(e.studentId), sanitizeSheetCell_(e.name), e.score];
  });
  top10.getRange(2, 1, rows.length, 6).setValues(rows);
}
