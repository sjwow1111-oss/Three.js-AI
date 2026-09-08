# 🧊 Three.js AI Studio

프롬프트와 사진을 AI에게 보내면, AI가 **Three.js 코드로 3D 모델을 만들어 주고 브라우저에서 바로 감상**할 수 있는 웹 스튜디오입니다.

사용할 AI는 여러분이 고릅니다. 첫 화면에서 **OpenAI 호환 / Anthropic 호환 엔드포인트**와 API 키를 입력하고 모델을 선택하면 됩니다.

```
[연결 설정] ──▶ [프롬프트 + 사진] ──▶ [AI가 Three.js 코드 생성] ──▶ [샌드박스 뷰어에서 실시간 렌더]
```

## 주요 기능

| | |
|---|---|
| **자유로운 AI 연결** | OpenAI · Anthropic · OpenRouter · Groq · Together · DeepSeek · Mistral · Ollama · LM Studio · vLLM 등 호환 엔드포인트라면 무엇이든 |
| **모델 목록 자동 조회** | `GET /models`로 사용 가능한 모델을 불러와 선택 (직접 입력도 가능) |
| **프롬프트 + 사진** | 참고 사진을 최대 4장 첨부(드래그·붙여넣기). 비전 모델이면 사진의 형태·색감을 반영합니다 |
| **실시간 스트리밍** | 코드가 생성되는 과정을 그대로 보여줍니다 |
| **안전한 실행** | 생성된 코드는 `allow-same-origin` 없는 샌드박스 iframe에서만 실행되어 API 키·페이지 DOM에 접근할 수 없습니다 |
| **자동 오류 수정** | 코드가 실행 중 오류를 내면 오류 메시지를 AI에게 되돌려 한 번 자동으로 고칩니다 |
| **이어서 수정** | "지붕을 빨간색으로" 처럼 대화하듯 계속 다듬을 수 있습니다 |
| **감상 & 내보내기** | 궤도 회전·확대, 자동 회전, 와이어프레임, 그리드 토글 / **PNG 캡처**, **GLB 내보내기**, 코드 다운로드 |
| **갤러리** | 만든 작품이 썸네일과 함께 브라우저에 저장되어 언제든 다시 불러옵니다 |

## 실행 방법

빌드 도구가 필요 없습니다. 정적 파일만 서빙하면 됩니다.

```bash
git clone <this-repo>
cd Three.js-AI
npm start            # → http://localhost:5173
```

`npm start`는 의존성 없는 Node 정적 서버(`server/serve.mjs`)를 띄웁니다. Python 등 다른 정적 서버로 열어도 동작합니다.

> `file://`로 직접 열면 ES 모듈이 차단되므로 반드시 HTTP로 서빙하세요.

## 사용 방법

1. **연결 설정 화면**
   - 프리셋을 고르거나 엔드포인트를 직접 입력합니다. (`/chat/completions` 앞부분까지, 예: `https://api.openai.com/v1`)
   - API 규격을 고릅니다. 대부분의 서비스는 **OpenAI 호환**, Anthropic 공식 API만 **Anthropic 호환**입니다.
   - API 키를 넣고(로컬 Ollama 등은 비워도 됩니다) `모델 목록 불러오기` → 모델 선택 → `연결 테스트`로 확인합니다.
   - `스튜디오 열기`를 누릅니다.
2. **스튜디오**
   - 만들고 싶은 것을 한국어로 적고(예시 칩 클릭도 가능), 필요하면 참고 사진을 첨부합니다.
   - 스타일·디테일·애니메이션 여부를 고르고 **✨ 3D 모델 생성** (단축키 `Ctrl/⌘ + Enter`).
   - 완성되면 마우스로 돌려 보고, PNG·GLB로 저장하거나 `이어서 수정하기`로 계속 다듬습니다.

## API 키는 어디로 가나요?

- 키는 **브라우저에만** 존재하며, 여러분이 지정한 엔드포인트로만 전송됩니다. 별도의 서버로 수집하지 않습니다.
- `이 브라우저에 키 저장`을 켜면 `localStorage`에 저장됩니다. 공용 PC에서는 끄세요.
- 브라우저에서 직접 호출하므로 엔드포인트가 **CORS를 허용**해야 합니다.
  - OpenAI · Anthropic · OpenRouter · Groq 등은 브라우저 호출을 허용합니다. (Anthropic은 `anthropic-dangerous-direct-browser-access` 헤더를 자동으로 붙입니다.)
  - Ollama는 `OLLAMA_ORIGINS=*` 설정이 필요할 수 있습니다.
  - CORS를 막는 엔드포인트라면 **고급 설정 → 로컬 프록시 경유**를 켜세요. `npm start`로 띄운 서버의 `/api/proxy`가 요청을 중계합니다(키는 헤더로 통과만 하고 저장되지 않습니다).

## 생성 코드 규약

AI는 아래 형태의 코드만 반환하도록 지시받습니다. 코드 탭에서 그대로 확인·저장할 수 있습니다.

```js
function createModel(THREE, ctx) {
  const root = new THREE.Group();
  // ... 지오메트리 / 머티리얼 구성 ...
  return root;                        // THREE.Object3D 반환
}

function update(root, time, delta) {  // 선택: 매 프레임 애니메이션
  root.rotation.y = time * 0.2;
}
```

- 카메라 프레이밍, OrbitControls, 조명, 그림자, 렌더 루프는 뷰어가 담당합니다.
- `import`·네트워크 접근은 금지되어 있으며, 텍스처는 `CanvasTexture`로 절차적으로 만듭니다.
- 실행 환경은 three.js **r0.169**이며, 애드온 없이 코어 API만 제공됩니다.

## 프로젝트 구조

```
index.html         첫 화면(연결 설정) + 스튜디오 UI
styles.css         전체 스타일
sandbox.html       격리된 3D 뷰어(생성된 코드가 실행되는 유일한 곳)
js/
  main.js          화면 흐름·생성 파이프라인·갤러리
  providers.js     OpenAI/Anthropic 호환 어댑터(모델 목록, SSE 스트리밍)
  prompts.js       시스템 프롬프트, 수정/자동수정 프롬프트, 코드 추출
  viewer.js        샌드박스 iframe과의 postMessage 통신
  store.js         설정·API 키·갤러리 저장(localStorage)
server/serve.mjs   정적 서버 + 선택적 /api/proxy (의존성 없음)
```

## 참고

- 뷰어는 three.js를 CDN(unpkg)에서 불러옵니다. 폐쇄망이라면 `three` 패키지를 `vendor/`에 두고 `sandbox.html`의 importmap 경로만 `/vendor/three.module.js`, `/vendor/jsm/`로 바꾸면 됩니다. (`server/serve.mjs`는 이를 위해 정적 응답에 CORS 헤더를 붙입니다.)
- 3D 모델의 품질은 사용하는 모델의 코딩 실력에 크게 좌우됩니다. 코딩에 강한 상위 모델을 권장합니다.

## 라이선스

MIT
