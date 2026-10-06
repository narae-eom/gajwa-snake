# 가좌중학교 스네이크 게임 — Apps Script 백엔드

Firebase나 별도 서버 없이, **Google Sheet에 바인딩된 Apps Script 웹앱** 하나로
점수 저장과 리더보드 조회(JSONP)를 제공합니다. GitHub Pages에 올라가는 프론트엔드는
오직 이 웹앱의 `/exec` URL 하나만 알면 됩니다.

파일: `Code.gs` (단일 파일, 이 디렉터리 안에만 존재. 프론트엔드/배포는 건드리지 않음)

## 1. 배포 절차

1. **Google Sheet 생성**
   새 Google Sheet를 하나 만듭니다 (예: "스네이크 게임 기록").

2. **Apps Script 붙여넣기**
   해당 시트에서 `확장 프로그램 > Apps Script`를 열고, 기본 생성된 `Code.gs`
   내용을 전부 지우고 이 저장소의 `apps-script/Code.gs` 내용을 그대로 붙여넣습니다.

3. **최초 1회 수동 실행: `setUp`**
   - Apps Script 편집기 상단의 함수 선택 드롭다운에서 `setUp`을 고르고 **실행**을 누릅니다.
   - 처음 실행하면 권한 승인 팝업이 뜹니다. 이 스크립트를 소유/관리할 계정으로 승인하세요.
   - `setUp()`은 다음을 수행합니다:
     - `게임기록` 시트를 생성(또는 재사용)하고 헤더
       `runId, studentId, name, grade, classNo, score, elapsedMs, ticks, endedBy, version, savedAt`
       를 설정합니다.
     - 데이터 영역 서식을 전부 "일반 텍스트"로 고정합니다 (학번 앞자리 0 보존, 수식 오해석 방지).
     - 교사가 보기 편한 `TOP10` 시트(전교 기준, 공동 순위 포함)를 생성/재구성합니다.
     - 현재 스프레드시트 ID를 `PropertiesService`(스크립트 속성)에 저장합니다.
       **코드에는 어떤 계정 정보나 시트 ID도 하드코딩되어 있지 않습니다.**
   - 코드를 수정해서 재배포한 뒤에도, 시트/시트ID 자체가 바뀌지 않았다면 `setUp`을
     다시 실행할 필요는 없습니다. 다만 안전하게 다시 실행해도 기존 데이터는 보존됩니다
     (헤더/서식만 재설정, 기록 행은 그대로 둠).

4. **웹 앱으로 배포**
   - 편집기 우측 상단 `배포 > 새 배포`
   - 유형: **웹 앱**
   - 설명: 원하는 대로 (예: "v1")
   - **실행 계정**: 나 (= 소유자 계정으로 실행. 학생 계정이 아니라 관리자 계정이어야 시트
     편집 권한이 유지됩니다)
   - **액세스 권한이 있는 사용자**: **전체 (Anyone)**
     (익명 학생이 로그인 없이 점수를 제출/조회할 수 있어야 하므로 필수입니다)
   - 배포를 누르면 `https://script.google.com/macros/s/XXXX/exec` 형태의 URL이 나옵니다.
     이 URL을 복사해 프론트엔드 설정의 `appsScriptUrl`에 넣습니다 (프론트엔드 코드/배포는
     이 작업 범위 밖입니다. README에만 기록).

5. **코드 수정 후 재배포**
   - `Code.gs`를 고친 뒤에는 `배포 > 새 배포`를 새로 만들지 말고, 기존 배포를
     `배포 관리 (Manage deployments) > 연필 아이콘 > 버전: 새 버전 > 배포`로 업데이트하세요.
   - 그래야 이미 프론트엔드에 박아놓은 동일한 `/exec` URL이 새 코드로 동작합니다.
     새 배포를 만들면 URL이 바뀌어 프론트엔드도 같이 바꿔야 합니다.

6. **비밀 정보 없음**
   - 이 저장소/코드 어디에도 계정 자격 증명, API 키, 하드코딩된 스프레드시트 ID가
     없습니다. 스프레드시트 ID는 `setUp()` 실행 시 그 스크립트가 바인딩된 시트에서
     자동으로 읽어 스크립트 속성에 저장됩니다.

## 2. API 계약

모든 통신은 **GitHub Pages(다른 오리진) ↔ Apps Script** 간 크로스 도메인이므로,
조회는 JSONP, 제출은 hidden form + iframe POST 방식을 씁니다 (아래 3절 참고).

### 2.1 GET (JSONP)

```
GET {appsScriptUrl}?action=<action>&callback=<callbackName>&...
```

- `callback`은 반드시 `/^__gajwaCb_[A-Za-z0-9_]+$/` 패턴을 만족해야 합니다.
  아니면 서버는 콜백을 실행하지 않고 평문 에러만 돌려줍니다 (스크립트 삽입 방지).
- 응답 `Content-Type`은 `text/javascript`이며 바디는 `callbackName({...JSON...});` 형태입니다.
- 응답 JSON 문자열 내부의 `<`, `>`, U+2028, U+2029는 전부 `\uXXXX`로 이스케이프되어
  `</script>` 조기 종료나 JS 줄바꿈 토큰 문제를 방지합니다.

#### `action=leaderboard`

파라미터(둘 다 선택):
- `grade`: 1~3
- `classNo`: 1~30

둘 다 주면 "해당 학년/반"만, 둘 다 생략하면 "전교" 기준으로 집계합니다.
(하나만 주는 경우는 유효성 검사를 통과하면 해당 값만 필터링하고 나머지는 전체로 취급합니다.)

성공 응답:

```json
{
  "ok": true,
  "entries": [
    { "rank": 1, "studentId": "10203", "name": "홍길동", "grade": 1, "classNo": 2, "score": 180, "savedAt": "2025-01-01T00:00:00.000Z" }
  ],
  "updatedAt": "2025-01-01T00:00:05.000Z",
  "revision": 42
}
```

핵심 규칙:
- **학생별 최고 점수 1건만** 집계 대상입니다 (같은 학생이 여러 번 플레이해도 최고 점수만 랭킹에 반영).
- 순위는 **경쟁 순위(동점 처리)** 입니다: 점수가 같으면 같은 순위를 받고, 다음 순위는 그만큼
  건너뜁니다. 예: 점수 100,100,90 → 순위 1,1,3.
- **`rank <= 10`인 모든 사람**을 반환합니다. "10등까지 보여달라"는 요구사항을 "정확히 10행"이
  아니라 "순위값이 10 이하인 모든 사람"으로 해석했습니다. 따라서 공동 10위가 여러 명이면
  응답 `entries` 길이가 10을 넘을 수 있습니다 (예: 공동 10위가 4명이면 총 13명).
- 실패 시: `{ "ok": false, "error": "INVALID_GRADE", "message": "..." }` 형태.

읽기 성능/실시간성:
- 서버는 같은 필터 조건(grade/classNo 조합)에 대해 **최대 3초** 캐시를 사용합니다
  (`PropertiesService`에 revision/캐시 저장, 새 제출이 있으면 revision이 올라가며 캐시가
  의미상 최신 데이터로 갱신됩니다).
- 프론트엔드는 **5초 주기 폴링**으로 "근실시간" 갱신을 구현하는 것을 전제로 설계되었습니다.

#### `action=board` (1.1.0, 랭킹 보드용)

`?action=board&callback=__gajwaCb_x` (전교) 또는 `&grade=1&classNo=2` (반). 시트를 한 번 읽어 다음을 반환합니다.

```json
{ "ok": true, "scope": {"grade": 1, "classNo": 2},
  "entries": [{"rank":1,"studentId":"10203","name":"…","grade":1,"classNo":2,"score":12,"savedAt":"…"}],
  "participants": 23, "plays": 81,
  "classStats": [{"grade":1,"classNo":2,"participants":23,"average":8.4,"top":12}],
  "recent": [{"studentId":"10203","name":"…","grade":1,"classNo":2,"score":5,"savedAt":"…"}],
  "updatedAt": "…", "revision": 12 }
```

- entries: 범위 내 개인 최고점 TOP 10(동순위, 10위 동점자 모두 포함)
- classStats: 전교 모든 반의 참여 인원·개인 최고점 평균·최고점 (반 대항전)
- recent: 전교 최근 저장 5건
- 리비전 기반 최대 3초 캐시를 사용합니다.

#### 학번 검증 (1.1.0)

제출 시 `studentId`는 5자리(학년1+반2+번호2)여야 하며, 학년·반은 서버가 학번에서 계산합니다. 클라이언트가 보낸 학년·반이 학번과 다르면 `ID_CLASS_MISMATCH`로 거부합니다.

#### `action=status`

파라미터: `runId` (필수, UUID v4 형식)

성공 응답 (저장됨):
```json
{ "ok": true, "found": true, "savedAt": "2025-01-01T00:00:00.000Z" }
```

성공 응답 (아직 저장 안 됨 / 못찾음):
```json
{ "ok": true, "found": false }
```

실패 응답:
```json
{ "ok": false, "error": "INVALID_RUN_ID", "message": "..." }
```

이 엔드포인트는 **일부러 최소 정보만** 돌려줍니다 (해당 runId의 저장 여부와 시각만).
전체 레코드나 다른 사람의 점수를 흘리지 않습니다. 용도는 다음 3절에서 설명하는
"POST 결과를 fetch로 직접 못 읽을 때의 폴링 확인"입니다.

#### `action=health`

```json
{ "ok": true, "time": "2025-01-01T00:00:00.000Z" }
```

### 2.2 POST (점수 제출) — 왜 일반 fetch CORS가 아닌가

Apps Script 웹앱은 커스텀 `Access-Control-Allow-Origin` 헤더를 프론트엔드가 원하는 대로
자유롭게 설정할 수 없습니다. 그래서 이 백엔드는 **일반적인 fetch 기반 CORS POST를
흉내내지 않습니다.** 대신:

1. 프론트엔드가 보이지 않는(hidden) HTML `<form>`을 만들어 `target`을 숨겨진 `<iframe>`으로 지정하고,
   `method="POST"`, `enctype="application/x-www-form-urlencoded"`로 제출합니다.
2. 폼 필드는 하나: `payload` = 아래 JSON을 `JSON.stringify` 후 URL-encode한 문자열.
3. 서버(`doPost`)는 저장을 시도한 뒤, **iframe 안에서 로드되는 용도의 HtmlService 페이지**를
   반환합니다. 이 페이지는 `X-Frame-Options`를 `ALLOWALL`로 설정해 어떤 origin의 iframe에서도
   막히지 않고 로드됩니다.
4. **중요:** 프론트엔드 JS는 크로스 오리진 iframe의 응답 내용을 직접 읽을 수 없습니다
   (브라우저의 same-origin policy). 그래서 "저장됐다"는 확정 신호는 이 HTML 응답에서 얻는 게
   아니라, **제출 후 `action=status&runId=...`를 JSONP로 폴링**해서 `found:true`가 뜨는 걸
   확인하는 방식으로 설계되어 있습니다.

`payload` JSON 스키마:

```json
{
  "runId": "crypto.randomUUID()로 만든 UUID v4 문자열",
  "studentId": "학번 문자열 (예: '0103', 숫자만, 앞자리 0 보존)",
  "name": "학생 이름",
  "grade": 1,
  "classNo": 3,
  "score": 180,
  "elapsedMs": 123456,
  "ticks": 2500,
  "endedBy": "collision",
  "version": "1.0.0"
}
```

서버 검증 규칙 (`validateSubmission_`):

| 필드 | 규칙 |
|---|---|
| `runId` | `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` (UUID v4 형태) |
| `studentId` | 숫자로만 구성된 문자열, 1~20자. 앞자리 0은 문자열로 보존됨 |
| `name` | 1~30자, 유니코드 NFC로 정규화해서 저장 |
| `grade` | 정수 1~3 |
| `classNo` | 정수 1~30 |
| `score` | 정수 0~251 |
| `elapsedMs` | 정수, 0 ~ 1시간(ms) 이내 |
| `ticks` | 정수, 0 ~ 1,000,000 이내 |
| `endedBy` | `"collision"` 또는 `"win"` 만 허용 (중단/새로고침 등 비정상 종료는 서버가 거부 — **중단된 게임은 저장되지 않음**) |
| `version` | `major.minor.patch` 형식 (예: `1.0.0`) |

검증 실패 시 `{ "ok": false, "error": "INVALID_*", "message": "..." }` 형태로
HTML 응답 안에 담겨 돌아오며(사람이 직접 열면 보임), 프론트엔드는 이후 `status` 폴링
결과(`found:false` 지속)로 실패를 추정해야 합니다.

**동시성 / 중복 제출(멱등성):**
- 서버는 `LockService.getScriptLock()`으로 저장 구간을 직렬화합니다 (최대 10초 대기,
  실패 시 `LOCK_TIMEOUT` 에러).
- 같은 `runId`로 여러 번 제출되면(예: 네트워크 불확실로 프론트엔드가 재시도) **중복 저장하지
  않고** 이미 저장된 기록을 그대로 성공 처리합니다 (`duplicate: true`). 이는 "POST 성공 여부가
  불확실할 때 상태 폴링 + 같은 runId로 안전하게 재시도"하는 흐름을 지원하기 위함입니다.

**저장 시 자동 처리:**
- `게임기록` 시트 맨 아래에 한 행 추가 (`savedAt`은 서버 시각 ISO8601).
- 리더보드 캐시 무효화를 위한 `revision` 값 1 증가.
- 교사용 `TOP10` 시트를 전교 기준으로 재구성 (순위/학년/반/학번/이름/점수, 동점 포함).

## 3. 시트 구조

### `게임기록` (원본 기록, 추가만 함)

| 열 | 설명 |
|---|---|
| `runId` | 클라이언트가 생성한 UUID. 중복 제출 방지 키 |
| `studentId` | 학번 (문자열, 앞자리 0 보존) |
| `name` | 이름 (NFC 정규화) |
| `grade` | 학년 1~3 |
| `classNo` | 반 1~30 |
| `score` | 점수 0~251 |
| `elapsedMs` | 플레이 시간(ms) |
| `ticks` | 게임 틱 수 |
| `endedBy` | `collision` 또는 `win` |
| `version` | 게임 클라이언트 버전 |
| `savedAt` | 서버 저장 시각(ISO8601, UTC) |

- **레코드는 자동으로 만료/삭제되지 않습니다.** 정리가 필요하면 운영자가 시트에서
  직접 수동으로 지워야 합니다.
- **중단된 게임(포기/새로고침/탭 닫기 등)은 저장 대상이 아닙니다.** `endedBy`가
  `collision`/`win`이 아니면 서버가 거부합니다.
- 모든 텍스트 열은 `@STRING@`(일반 텍스트) 서식으로 고정되어 있고, `=`, `+`, `-`, `@`로
  시작하는 `studentId`/`name` 값은 저장 전에 앞에 `'`(어포스트로피)를 붙여 Google Sheets가
  수식으로 해석하지 못하게 합니다(수식 삽입/CSV 인젝션 방지).

### `TOP10` (교사용 요약, 매 제출마다 통째로 재생성)

| 열 | 설명 |
|---|---|
| `rank` | 전교 기준 경쟁 순위 (동점 포함, 10 이하 전부) |
| `grade` | 학년 |
| `classNo` | 반 |
| `studentId` | 학번 |
| `name` | 이름 |
| `score` | 최고 점수 |

이 시트는 참고/열람용입니다. 실제 API가 돌려주는 리더보드 계산 로직과 동일한 함수
(`computeLeaderboard_`)를 재사용하므로 항상 API와 일치합니다.

## 4. 보안 및 한계 (명시적으로 인지하고 설계한 범위)

- **익명 접근이므로 신원 위조를 막지 못합니다.** 로그인이나 학교 인증 없이 누구나
  임의의 `studentId`/`name`/`grade`/`classNo`로 점수를 제출할 수 있습니다. 다른 학생
  이름으로 제출하는 것을 서버가 구분할 방법이 없습니다. 이는 "Firebase/별도 백엔드 없이
  Sheet-bound Apps Script만 사용"이라는 사용자의 명시적 설계 결정에 따른 trade-off입니다.
- **같은 사람의 여러 번 제출 중 최고점만 랭킹에 반영됩니다.** 즉, 여러 번 시도해서
  점수를 올리는 것은 사양상 정상 동작이며 막지 않습니다(어뷰징 방지 기능 없음).
- **시트는 비공개, 그러나 웹앱 API는 전체 실명/학번/점수를 마스킹 없이 공개로 반환합니다.**
  이는 교내 전용 사용을 전제로 사용자가 명시적으로 요청한 사양입니다. 외부에 URL이
  유출되면 전체 랭킹(개인정보 포함)을 누구나 볼 수 있다는 점을 운영자가 인지해야 합니다.
- **`status` 엔드포인트는 전체 레코드를 노출하지 않도록 최소 정보**(`found`, `savedAt`)만
  반환하게 의도적으로 제한했습니다.
- **Apps Script 자체의 실행/쿼터 한계**가 있습니다: 동시 실행 수, 일일 트리거/URL fetch
  쿼터, `LockService` 대기시간(10초) 초과 시 `LOCK_TIMEOUT` 에러 등. 트래픽이 몰리면
  일시적으로 제출/조회가 실패할 수 있으며, 프론트엔드는 상태 폴링 기반 재시도로
  이를 완화해야 합니다.
- **POST 응답은 정상적인 fetch 기반 CORS가 아닙니다.** hidden iframe 트릭이므로
  프론트엔드 JS가 POST 응답 바디를 직접 읽을 수 없습니다. "저장 성공"의 유일한 신뢰
  가능한 확인 방법은 `action=status` JSONP 폴링입니다.
- **리더보드 캐시는 최대 3초**이므로, 그 사이에 발생한 아주 최근 제출은 다음 캐시
  갱신 전까지 반영이 늦어질 수 있습니다(요청된 "5초 근실시간 폴링" 과 함께 사용하면
  체감상 큰 지연은 없습니다).
- **코드/저장소에 비밀 정보 없음**: 계정 자격 증명이나 스프레드시트 ID가 하드코딩되어
  있지 않습니다. `setUp()` 실행 시 스크립트 속성에 자동 저장되는 방식입니다.
