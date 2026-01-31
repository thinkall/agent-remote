<div align="center">

# Agent Remote

[English](./README.md) | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md) | **[한국어](./README.ko.md)**

**어디서든 AI 코딩 에이전트에 연결하세요**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-Supported-green.svg)](https://opencode.ai)
[![Copilot CLI](https://img.shields.io/badge/Copilot%20CLI-Supported-purple.svg)](https://docs.github.com/copilot/concepts/agents/about-copilot-cli)

*강력한 워크스테이션에서 AI 코딩 에이전트를 실행하고, 태블릿, 스마트폰 또는 모든 브라우저에서 접속하세요 — 인터넷을 통해서도 가능합니다.*

**OpenCode, GitHub Copilot CLI 등을 지원합니다!**

</div>

---

## 왜 Agent Remote인가요?

OpenCode, GitHub Copilot CLI, Claude Code 등의 AI 코딩 에이전트는 다음 조건을 갖춘 머신에서 실행해야 합니다:
- 코드베이스와 개발 환경에 대한 접근
- 적절한 API 키와 구성
- 충분한 컴퓨팅 파워

하지만 **소파에서 스마트폰으로**, **iPad로 페어 프로그래밍을**, 또는 **세계 어디서나 개발 머신에 접속**하고 싶다면 어떻게 해야 할까요?

**Agent Remote**는 CLI 기반 AI 코딩 에이전트를 위한 범용 웹 인터페이스를 제공하여, 브라우저가 있는 모든 기기에서 접속할 수 있습니다.

### 지원되는 에이전트

| 에이전트 | 상태 | 설명 |
|---------|------|------|
| **OpenCode** | ✅ 지원됨 | opencode.ai의 오픈소스 AI 코딩 에이전트 |
| **GitHub Copilot CLI** | ✅ 지원됨 | GitHub 공식 AI 코딩 에이전트 (Copilot 구독 필요) |
| **Claude Code** | 🔜 예정 | Anthropic의 Claude 기반 코딩 에이전트 |
| **Gemini CLI** | 🔜 예정 | Google의 Gemini 기반 코딩 에이전트 |

### 핵심 기능

| 기능 | 설명 |
|------|------|
| **모든 단말에서 원격 접속** | 스마트폰, 태블릿, 노트북 등 브라우저가 있는 모든 기기에서 깔끔한 웹 UI로 OpenCode 접속 |
| **원클릭 공개 터널** | Cloudflare Tunnel로 원클릭으로 인터넷 접속 활성화 — 포트 포워딩이나 VPN 불필요 |
| **LAN 접속** | 로컬 네트워크의 모든 기기에서 즉시 접속 가능 |
| **QR 코드 연결** | 모바일 기기에서 스캔으로 연결 — URL 입력 불필요 |
| **기본적으로 안전** | 세션마다 랜덤 6자리 접속 코드 사용 |
| **실시간 스트리밍** | Server-Sent Events를 통한 실시간 메시지 스트리밍 |
| **전체 기능 지원** | 모든 OpenCode 기능이 웹 UI에서 원활하게 작동 |

---

## 빠른 시작

### 사전 요구사항

- [Bun](https://bun.sh) (권장) 또는 Node.js 18+
- [OpenCode CLI](https://opencode.ai) 설치됨

### 설치

```bash
# 저장소 클론
git clone https://github.com/thinkall/agent-remote.git
cd opencode-remote

# 의존성 설치
bun install

# 애플리케이션 시작
bun run start
```

### 실행 과정

1. 랜덤 **6자리 접속 코드**가 생성되어 터미널에 표시
2. OpenCode 서버가 포트 `4096`에서 시작
3. 웹 UI가 포트 `5174`에서 시작
4. `http://localhost:5174`를 열고 접속 코드 입력

```
============================================================
Starting OpenCode Remote
============================================================

Access Code: 847291

Starting OpenCode Server...
Starting Web UI...

============================================================
All services started!
Web UI: http://localhost:5174
Use code: 847291
============================================================
```

---

## 원격 접속 가이드

### 방법 1: LAN 접속 (동일 네트워크)

로컬 네트워크의 모든 기기에서 접속:

1. 머신의 IP 주소 확인 (원격 접속 페이지에 표시됨)
2. 다른 기기에서 `http://<IP주소>:5174` 열기
3. 6자리 접속 코드 입력

**또는 원격 접속 페이지에 표시된 QR 코드 스캔.**

### 방법 2: 공개 인터넷 접속

Cloudflare Tunnel로 전 세계 어디서나 접속:

1. `cloudflared` 설치 (`bun run setup` 실행으로 가이드 설치)
2. 웹 UI에서 **설정** → **원격 접속**으로 이동
3. **"공개 접속"** 토글 켜기
4. 생성된 `*.trycloudflare.com` URL 공유

**포트 포워딩 불필요, 방화벽 변경 불필요, VPN 불필요.**

```
┌──────────────────────────────────────────────────────────┐
│                    당신의 스마트폰/태블릿                  │
│                          ↓                                │
│              https://xyz.trycloudflare.com                │
│                          ↓                                │
│                  Cloudflare 네트워크                      │
│                          ↓                                │
│              당신의 워크스테이션 (OpenCode)                │
└──────────────────────────────────────────────────────────┘
```

---

## 사용 사례

### 어디서나 작업
강력한 데스크톱에서 OpenCode를 실행하고, 카페에서 노트북으로 제어.

### 모바일 코딩 어시스턴트
종이나 화이트보드에서 코드를 리뷰하면서 스마트폰으로 AI 도움 받기.

### 페어 프로그래밍
동료와 공개 URL을 공유하여 실시간 협업.

### 홈 서버 설정
홈 서버에서 실행하고, 집안 어느 기기에서나 접속.

---

## 보안

OpenCode Remote는 여러 보안 레이어를 사용합니다:

| 레이어 | 보호 |
|--------|------|
| **접속 코드** | 세션마다 랜덤 6자리 코드 필요 |
| **토큰 인증** | 로그인 후 JWT 유사 토큰을 localStorage에 저장 |
| **HTTPS** | 공개 터널은 Cloudflare를 통해 자동으로 HTTPS 사용 |
| **임시 URL** | 터널을 시작할 때마다 공개 URL 변경 |

**모범 사례:**
- 접속 코드를 공개적으로 공유하지 마세요
- 사용하지 않을 때는 공개 터널 비활성화
- 개인 사용만 — 다중 사용자 시나리오를 위해 설계되지 않음

---

## 개발

### 명령어

```bash
# 모든 것 시작 (OpenCode 서버 + 웹 UI)
bun run start

# 개발 모드 (웹 UI만, OpenCode 서버 수동 시작 필요)
bun run dev

# 선택적 의존성 설치 (cloudflared 등)
bun run setup

# 프로덕션 빌드
bun run build

# 타입 체크
bunx tsc --noEmit
```

### 프로젝트 구조

```
opencode-remote/
├── src/
│   ├── pages/           # 페이지 컴포넌트 (Chat, Login, Settings, RemoteAccess)
│   ├── components/      # UI 컴포넌트
│   ├── lib/             # 코어 라이브러리 (API 클라이언트, 인증, i18n)
│   ├── stores/          # 상태 관리
│   └── types/           # TypeScript 타입 정의
├── scripts/
│   ├── start.ts         # 시작 스크립트
│   └── setup.ts         # 의존성 설정
└── vite.config.ts       # Vite 설정 (인증 미들웨어 포함)
```

---

## 기술 스택

| 카테고리 | 기술 |
|----------|------|
| 프레임워크 | SolidJS |
| 빌드 도구 | Vite |
| 스타일링 | Tailwind CSS |
| 언어 | TypeScript |
| 패키지 매니저 | Bun |
| 터널 | Cloudflare Tunnel |

---

## 문제 해결

### OpenCode CLI를 찾을 수 없음

```bash
# 설정 스크립트 실행으로 가이드 설치
bun run setup

# 또는 수동 설치:
# macOS/Linux
curl -fsSL https://opencode.ai/install.sh | bash

# Windows
irm https://opencode.ai/install.ps1 | iex
```

### 포트가 이미 사용 중

```bash
# 포트 5174를 사용하는 프로세스 종료
lsof -ti:5174 | xargs kill -9

# 또는 vite.config.ts에서 포트 변경
```

### 공개 터널이 작동하지 않음

1. `cloudflared`가 설치되어 있는지 확인: `bun run setup`
2. 인터넷 연결 확인
3. 원격 접속 페이지에서 터널 재시작 시도

---

## 기여

기여를 환영합니다! PR을 제출하기 전에 기여 가이드라인을 읽어주세요.

### 코드 스타일
- TypeScript 엄격 모드
- SolidJS 리액티브 패턴
- 스타일링에 Tailwind 사용

### 커밋 규칙
- `feat:` 새 기능
- `fix:` 버그 수정
- `docs:` 문서
- `refactor:` 코드 리팩토링

---

## 라이선스

[MIT](LICENSE)

---

## 링크

- [OpenCode](https://opencode.ai) — AI 코딩 에이전트
- [문서](https://opencode.ai/docs) — OpenCode 문서
- [이슈](https://github.com/thinkall/agent-remote/issues) — 버그 신고 또는 기능 요청

---

<div align="center">

**[OpenCode](https://opencode.ai)와 [SolidJS](https://solidjs.com)로 제작**

</div>
