# iamTrans 개발 계획

영→한 몰입형(immersive) 웹페이지 번역 크롬 확장. 엔진 3종(Chrome 내장 / DeepL / Claude) 선택,
코드·수식·개발 UI 회피, "대체" / "병렬(원문+번역)" 표시 모드.

## 1. 기존 도구 조사

| 도구 | 엔진 | 표시 모드 | 코드/수식 회피 | 비고 |
|---|---|---|---|---|
| Immersive Translate* | Google, DeepL, OpenAI, Claude 등 다수 | 병렬(기본) / 번역만 | 사이트별 규칙 | 독점·프리미엄(AlternativeTo 기준) |
| Read Frog | AI 20+ (Vercel AI SDK), Google/MS/DeepLX | 병렬 / 번역만, 모드 전환 시 재번역 없이 갱신 | 문서화 안 됨 | GPL-3.0, WXT + TS |
| KISS Translator | Google, MS, DeepL, OpenAI, Claude, Gemini, **Chrome 내장 AI** 등 | 병렬 / 번역만(원문 숨김) | 셀렉터 규칙(번역 대상·제외 영역·원문 유지), 사이트별 규칙 구독 | GPL-3.0 |
| Google 번역(크롬 기본)* | Google | 대체만 | `translate="no"`, `.notranslate` 존중 | |
| DeepL 확장* | DeepL | 대체 | — | |

\* 표시 행은 이번 조사에서 1차 출처를 직접 확인하지 못한 일반 지식 기반 내용. Read Frog·KISS는 GitHub README 확인.

설계 선택 (조사 + 판단):
- **블록 단위 번역** (p, li, h1–h6, td …). 텍스트 노드 단위는 문맥이 끊김.
- **뷰포트 진입 시에만 번역** (IntersectionObserver). 유료 API 비용 통제용.
- **병렬 모드 = 원문 블록 안에 번역 요소 추가**, 대체 모드 = 원문을 CSS로 숨김 → 모드 전환은 재요청 없이 클래스 토글.
- **제외 셀렉터**: `translate="no"`, `.notranslate` 같은 웹 표준 신호 + 코드/수식/에디터 셀렉터.

## 2. 엔진별 사실 확인

- **Chrome Translator API** (Chrome 138+ 데스크톱): 전역 `Translator`. Web Worker 불가 → MV3 서비스워커에서 못 씀.
  모델 다운로드에는 사용자 제스처 필요, 그리고 사이트별로 처음 `create()` 할 때까지 모든 언어쌍이 `downloadable`로 보고됨.
  → 팝업 클릭에서 모델 다운로드(진행률 표시), 실제 번역은 콘텐츠 스크립트. 페이지에서 `create()`가
  `NotAllowedError`면 페이지 우하단 토스트의 "시작" 버튼 클릭(페이지 내 제스처)으로 재시도. en, ko 지원. 일반 텍스트만 받음.
- **DeepL**: Free 키(`:fx`로 끝남 — 공식 문서 미확인 관례) → `api-free.deepl.com`, Pro → `api.deepl.com`. `tag_handling=html` 에서
  `translate="no"` 요소는 번역 제외 → 인라인 코드 자리표시자를 `<span translate="no">` 로 보호.
- **Claude**: 서비스워커에서 `fetch` (빌드 단계 없는 확장이라 SDK 대신 raw HTTP). 브라우저 직접 호출 헤더
  `anthropic-dangerous-direct-browser-access: true`, 구조화 출력(`output_config.format` json_schema)으로
  `{"t": [...]}` 배열을 강제. 모델은 설정에서 변경 가능, 기본 `claude-opus-5-5`.
  대량 페이지 번역 비용이 부담되면 `claude-haiku-5-5` 로 바꾸면 됨(사용자 선택).

## 3. 용어 해석 (틀리면 알려주세요)

- **집중형** = Immersive(몰입형) 번역. 페이지 레이아웃을 유지한 채 본문 블록 단위로 번역을 끼워 넣는 방식.
  "본문만 번역(사이드바·내비 제외)"이라는 뜻이었다면 Phase 2의 본문 감지로 추가.
- **개발 인터페이스** = 코드 에디터·터미널·콘솔 류: CodeMirror, Monaco, Ace, xterm.js, `contenteditable`, 폼 입력.

## 4. 회피 규칙

전체 스킵(블록째 안 건드림):
`pre, script, style, textarea, input, select, button, svg, canvas, iframe, math, .katex, mjx-container, .MathJax,
.CodeMirror, .cm-editor, .monaco-editor, .ace_editor, .xterm, [contenteditable], [role=textbox], [translate=no], .notranslate`

블록째 스킵(대화형 요소를 포함한 블록도): `input, select, button, textarea, iframe, video` 등 — 복제하면 죽은 컨트롤이 생기므로.

인라인 보존(문장은 번역, 그 조각은 원형 유지): `code, kbd, samp, var, img, svg` 및 인라인 수식 →
`⟦0⟧` 자리표시자로 바꿔 보내고 결과에서 원래 노드 복제로 복원. 엔진이 자리표시자를 잃으면 문장 끝에 덧붙임.

휴리스틱 스킵: 영문자 2자 미만, 한글이 영문보다 많음, 코드 기호(`{}[];=<>$\|`) 3개 이상이고 비율 5% 초과.

## 5. 구조 (빌드 없음, 바닐라 MV3)

```
manifest.json   권한: storage, host_permissions(api.deepl.com, api-free.deepl.com, api.anthropic.com)
lib.js          순수 함수(자리표시자, 휴리스틱, DeepL HTML 변환) — content/background/test 공용
content.js      블록 수집 → 뷰포트 큐 → 배치 번역 → 렌더, MutationObserver로 SPA 대응
content.css     병렬/대체 스타일
background.js   DeepL / Claude 호출 (API 키는 여기서만 읽음)
popup.html/js   엔진·모드·키·모델 설정, 번역/원문 버튼, Chrome 모델 다운로드
test.js         node test.js — lib.js 단위 검사
```

## 6. 단계

- **Phase 1 (이번에 구현)**: 위 구조 전체. 수동 실행(팝업 버튼), 영→한 고정.
- **Phase 2**: 단축키(`commands`), 사이트별 자동 번역 / 제외 목록, 본문 감지(집중 모드), 원문 언어 자동 감지(LanguageDetector).
- **Phase 3**: 사이트별 셀렉터 규칙, 용어집, 번역 캐시 영속화(storage), Shadow DOM·iframe.

## 7. 알려진 한계 (Phase 1)

- 리프 블록만 번역: 자식 블록이 있는 div의 직접 텍스트는 건너뜀.
- 문장 안 서식(링크·굵게·색상 span 등)은 짝 자리표시자 `⟦n⟧…⟦/n⟧`로 보내 번역문에 복원(DeepL은 실제 태그로 변환).
  엔진이 짝을 잃으면 해당 서식만 일반 글자가 됨 — Chrome 내장 번역에서 가장 가능성 높음(미검증).
- 번역 실패 시 해당 실행을 멈추고 토스트로 알림, 실패한 블록은 원문 유지. 자동 재시도 없음(다시 "번역" 클릭).
- Chrome 내장 번역이 콘텐츠 스크립트에서 노출되는지 공식 문서에 명시 없음 → 실제 브라우저에서 확인 필요.

## 출처
- https://developer.chrome.com/docs/ai/translator-api
- https://developers.deepl.com/docs/xml-and-html-handling/html
- https://github.com/fishjar/kiss-translator
- https://github.com/mengxi-ream/read-frog
- https://immersivetranslate.com/en
