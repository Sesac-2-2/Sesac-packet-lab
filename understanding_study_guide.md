# Packet.AI 학습 정리 — 100문제 대비 자료

`understanding_quiz.md`의 각 섹션(A~E)과 그대로 짝지어 정리했습니다.
헷갈리는 부분은 quiz 풀 때 이 문서를 열어서 찾아보세요.

---

## A. 전체 개요 & Blind Fault 원칙 (Q1~15 대비)

### 무엇을 하는 프로젝트인가
사무실 네트워크에 장애가 생겼을 때 "어디가 왜 고장났는지" 찾아내는 과정을 4명이 나눠서 연습하는 프로젝트.

### 전체 파이프라인 (누가 무엇을 주고받는가)

```
1번 network_spec.md ──┐
                      ├─▶ 2번 packet_summary.json ─▶ 3번 diagnosis.json ─▶ 4번 incident_report.html
4번 익명 case_id ──────┘
```

| 역할 | 이름 | 받는 것(입력) | 만드는 것(출력) |
|---|---|---|---|
| 1번 | Network Architect | (미션 요구사항) | `network_spec.md`, `office_network.pkt`, `topology.png` |
| 2번 | Packet Analyst | `network_spec.md` + 4번의 익명 case_id | `packet_summary.json` |
| 3번 | AI Engineer | `packet_summary.json` | `diagnosis.json` |
| 4번 | Network SRE | `diagnosis.json` | `incident_report.html` |

**주의(자주 틀리는 함정)**: 1번은 입력을 받지 않고 미션 요구사항만으로 시작한다. "1번이 packet_summary.json을 받는다"처럼 화살표 방향을 거꾸로 낸 보기는 오답이다.

### "사례(case)"란
장애 상황 하나. 파일 하나(`packet_summary.json`)에는 사례 하나만 들어간다(배열 아님, 단일 객체).

### Blind Fault(눈가림 장애) 원칙 — 가장 중요한 규칙
- **핵심**: 3번(AI)에게 진짜 원인을 미리 알려주지 않는다. 오직 관찰된 숫자(패킷 카운트)만 보고 추리하게 한다.
- **왜**: 미리 정답을 알려주면 AI가 "추리"가 아니라 "정답 받아쓰기"를 하게 되어, 실제 실력을 검증할 수 없다.
- **어떻게 지키는가**:
  - `case_id`, `capture_file`에 원인을 암시하는 단어(gateway, vlan, dns, port 등) 사용 금지 — 예: `FAULT-03`은 가능, `FAULT-GATEWAY`는 불가.
  - `packet_summary.json`에는 정답(실제 원인)이 절대 들어가지 않는다. 관찰 사실만 있다.
  - 정답 대조는 3번의 분석이 **끝난 뒤에** 4번이 따로 한다(4번의 기록과 비교).
- 2번의 검증기(`summarize_pcap.py`)가 이 규칙을 자동으로 검사한다.

### 왜 "PCAP 파일 전체를 AI에게 던지지 않는가"
핵심 특징(카운트)만 구조화해서 넘겨야 AI가 안정적이고 효율적으로 판단할 수 있기 때문. 그 구조화된 입력이 바로 `packet_summary.json`이다.

### 왜 역할을 나눴는가
실제 회사에서도 설계자 → 모니터링 담당자 → 분석/AI 담당자 → 장애 대응 담당자로 업무가 나뉘어 협업한다. 이 협업 과정 자체를 연습하는 것이 목적이다.

---

## B. 1번 Network Architect (Q16~35 대비)

### 토폴로지 그림

```
                 ┌────────────┐
                 │  L3 Switch │  (Inter-VLAN Routing, SVI 2개)
                 └─────┬──────┘
             Gi0/1 trunk│  │trunk Gi0/2
                 ┌──────┘  └──────┐
             ┌───┴────┐      ┌────┴───┐
             │ SW-A   │      │ SW-B   │   (L2 Switch, access)
             └─┬────┬─┘      └─┬───┬──┘
               │    │          │   │
             PC1  PC2        PC3  PC4  Server(DNS/Web)
           VLAN10 VLAN10   VLAN20 VLAN20  VLAN20
```

### IP/VLAN 표 (통째로 외우기)

| 장비 | VLAN | IP | Gateway |
|---|---|---|---|
| PC1 | 10 (개발팀) | 192.168.10.10 | 192.168.10.1 |
| PC2 | 10 (개발팀) | 192.168.10.11 | 192.168.10.1 |
| PC3 | 20 (운영팀) | 192.168.20.10 | 192.168.20.1 |
| PC4 | 20 (운영팀) | 192.168.20.11 | 192.168.20.1 |
| Server(DNS/Web) | 20 (운영팀) | **192.168.20.20** | 192.168.20.1 |
| L3 Switch VLAN10 SVI | 10 | 192.168.10.1 | - |
| L3 Switch VLAN20 SVI | 20 | 192.168.20.1 | - |

- Gateway 규칙: **각 VLAN 대역의 .1**
- Server가 VLAN20에 있는 이유: 미션에 별도 VLAN 지정이 없어서, 운영팀이 관리한다고 가정하고 배치했다(임의 결정, 문서에 명시).

### 장비 역할 구분 (자주 헷갈림)

| 장비 | 역할 | 비유 |
|---|---|---|
| L2 Switch (SW-A, SW-B) | **같은 VLAN 안**에서 PC들을 연결 | 같은 층 안의 우편함 정리함 |
| L3 Switch | **VLAN 사이**를 라우팅(Inter-VLAN Routing) | 층과 층을 잇는 엘리베이터/관리실 |
| SVI | 스위치에 설정된 VLAN용 가상 인터페이스, 그 VLAN의 게이트웨이 역할 | 각 층의 관리실 주소 |
| Gateway | 다른 네트워크(다른 층)로 나가려면 먼저 물어보는 주소 | 관리실에 먼저 물어보고 나가는 것 |

### 포트 모드
- PC가 꽂힌 포트(SW-A Fa0/1~2, SW-B Fa0/1~3): **Access 모드**, 자기 VLAN 전용
- 스위치끼리/L3 Switch로 가는 포트(Gi0/1, Gi0/2): **Trunk 모드**, VLAN10·20 둘 다 허용

### 검증 기준 (Role 1 완료 조건)
1. PC1 → PC2 ping 성공 (같은 VLAN, 같은 스위치 안 통신 확인)
2. PC1 → PC3 ping 성공 (**다른 VLAN**, L3 Switch를 거쳐야 함 → Inter-VLAN Routing 확인)
3. PC1 → Server(192.168.20.20) ping 성공
4. `show vlan brief` (SW-A, SW-B): 포트가 의도한 VLAN에 배정됐는지 확인
5. `show ip interface brief` (L3 Switch): VLAN10/20 SVI가 모두 up/up인지 확인

("DNS 오류 응답 rcode 5 확인"은 1번의 검증 기준이 아니라 **2번**이 실제 캡처 중 발견한 것 — Q35 함정)

### 1번이 2번에게 넘기는 것
`network_spec.md`, `office_network.pkt`(Packet Tracer 파일), `topology.png`. (`diagnosis.json`은 3번의 결과물이므로 포함 안 됨)

---

## C. 2번 Packet Analyst (Q36~65 대비) — 가장 분량이 많은 파트

### 사용 도구
Wireshark / tshark (실제로 오가는 패킷을 들여다보는 도구). `summarize_pcap.py`가 tshark를 호출해서 `.pcapng` → `packet_summary.json`으로 변환·검증한다.

### 기본 10개 필드 (과제 HTML 그대로, 3번이 이것만 읽어도 동작)

| 필드 | 뜻 | 집계 기준 |
|---|---|---|
| `case_id` | 4번이 준 익명 ID | 원인 암시 단어 금지 |
| `source_ip` | 테스트 시작 PC | |
| `destination_ip` | **최종 목적지** (Gateway 아님, Gateway를 거치더라도) | |
| `arp_request_count` | ARP Request(opcode 1) 수 | source_ip가 보낸 것, 찾는 IP가 `arp_targets`에 있는 것만 |
| `arp_reply_count` | ARP Reply(opcode 2) 수 | source_ip가 받은 것 |
| `icmp_request_count` | **ICMP Echo Request(type 8)만** | 다른 ICMP 유형(예: type 3 Destination Unreachable)은 섞지 않음 |
| `icmp_reply_count` | **ICMP Echo Reply(type 0)만** | 위와 동일 원칙 |
| `dns_query_count` | source_ip가 **보낸** DNS 질의 수 | 어느 DNS 서버로 보냈든 상관없이 셈 |
| `tcp_syn_count` | **SYN=1, ACK=0**인 연결 시작 요청만 | SYN-ACK는 포함 안 됨(중요!) |
| `notes` | 관찰 사실 요약 | **원인 추측 절대 금지** |

### 추가(선택) 필드 — 합의 후 "전부 사용"하기로 함

| 필드 | 뜻 |
|---|---|
| `schema_version` | 현재 `"0.1-draft"` |
| `evidence_source` | `wireshark_capture`(실제 캡처) / `packet_tracer_simulation`(PT 관찰) / `example`(교육용, **실제 진단에 쓰면 안 됨**) |
| `analysis_scope` | 무엇을·언제·어떤 기준으로 셌는지. `arp_targets`(ARP 셀 대상 IP 목록) 포함 |
| `dns_response_count` | source_ip가 **받은** DNS 응답 수 (오류 응답도 포함, 오류 여부는 `evidence`에 기록) |
| `tcp_syn_ack_count` | SYN=1,ACK=1 (서버가 보낸 응답) |
| `tcp_rst_count` | RST=1 (서버가 보낸 거부) |
| `evidence` | 근거 패킷 목록(프레임 번호, 관찰 내용) |
| `limitations` | 이 캡처로 **알 수 없는 것** (예: "서버 쪽 캡처 없음") |
| `null_reasons` | null인 필드마다 그 이유 |

### ⭐ 가장 중요한 규칙: 0 vs null

| 값 | 뜻 |
|---|---|
| `0` | **관찰했는데** 그 패킷이 없었다 (확인 완료, 부재 확인) |
| `null` | **관찰/분석을 아예 안 했다** (모름 — 반드시 `null_reasons`에 이유가 있어야 함) |

- `0`을 "패킷이 세상에 존재하지 않는다"로 확대 해석하면 안 된다 — "그 캡처 지점에서는 안 보였다"는 뜻일 뿐.
- null을 절대 0으로 바꾸면 안 된다.

### 왜 `arp_targets`에 목적지뿐 아니라 Gateway(next hop)도 넣는가
다른 서브넷(다른 VLAN)으로 보낼 때 PC는 목적지의 MAC이 아니라 **Gateway의 MAC**을 찾기 때문. 그래서 Gateway 주소도 ARP 집계 대상에 포함해야 한다.

### 실제 정상(Baseline) 캡처에서 배운 것 (실제 데이터, 2026-09-28)
- **정상 상태에서도 DNS 오류 응답(rcode 5 Refused)이 1건 나온다.** 이유: 웹 접속 시 클라이언트가 A와 AAAA(IPv6)를 함께 묻는데, 랩 환경 DNS 서버가 AAAA를 거부하기 때문. A 응답은 정상이고 웹 접속도 성공한다.
  → **"오류 응답이 있다 = 장애다"라고 바로 판단하면 안 된다.** rcode와 질의 유형(A/AAAA)을 함께 봐야 한다.
- 캐시 때문에 ARP가 안 보이는 경우가 정상 상태에서도 있다(이미 Gateway MAC을 알고 있으면 ARP를 다시 안 함).
- 실제 Baseline 집계값(목적지=서버 192.168.20.20): ARP 1/1, ICMP 4/4, DNS 3/3(그중 1건 rcode 5), TCP SYN 1, SYN-ACK 1, RST 0.

### evidence_source == "example" 규칙
- `notes`에 반드시 `[교육용 예제]` 표시가 있어야 한다.
- 3번은 이 데이터를 **실제 진단 근거로 쓰면 안 된다.**

### 여러 사례 저장 방식 (합의됨)
- 사례별 파일: `packet_summary_<case_id>.json` (전체 사례가 이 형식으로 존재)
- 대표 사례 사본: `packet_summary.json` (과제 HTML 파일명 유지용, 내용은 위 파일과 동일)
- 배열로 묶은 파일은 쓰지 않는다.

### 검증기(`summarize_pcap.py validate`)가 막는 대표 오류들
- 기본 10개 필드 누락, `case_id` 빈 문자열, IP 형식 오류
- count가 음수/실수/문자열인 경우 (0 이상의 정수 또는 null만 허용)
- null인데 `null_reasons`에 이유가 없는 경우
- `case_id`/`capture_file`에 원인 암시 단어(gateway, vlan, dns, port 등) 포함 → Blind Fault 오염
- `evidence_source == example`인데 `[교육용 예제]` 표시가 없음(또는 반대)
- (경고만) `schema_version` 없음, `analysis_scope` 없음, `limitations` 없음

### 2번이 3번에게 미리 handoff 문서를 준 이유
1번·2번의 실제 데이터가 아직 없는 상태에서 3번이 입력 형식을 마음대로 추측해서 만들지 않도록, 무엇을 어떤 형식으로 받게 될지 미리 공유하기 위해서.

---

## D. 3번 AI Engineer (Q66~90 대비)

### 입출력
`packet_summary.json`(입력) → `diagnosis.json`(출력)

### 규칙 기반(rule-based) 진단 — 계층 검사 순서
**ARP → ICMP → DNS → TCP** 순서로만 검사하고, **막힌 첫 계층에서 멈춘다.**
(이유: 앞 계층이 이미 실패했다면 그 뒤 계층 결과는 확인할 방법 자체가 없어 의미가 없다. 예: ARP가 안 됐으면 ICMP도 당연히 안 감)

| 조건 | 판단 | 원인 후보 예시 |
|---|---|---|
| ARP Request>0, Reply=0 | L2(ARP) 실패, confidence: medium | Gateway IP 오설정, VLAN 오설정, SVI Down, 대상 장비 다운 |
| (ARP 성공) ICMP Request>0, Reply=0 | L3(ICMP) 실패, confidence: medium | Inter-VLAN Routing 미설정, 목적지 다운, 경로 차단 |
| (ARP/ICMP 성공) DNS Query>0, Response=0/null | DNS 실패 | DNS 서버 오설정, 서비스 중단, 경로 차단 |
| TCP SYN>0, **RST>0** | 서버까지 도달, 포트 거부 → confidence: **high**, root_cause 확정 | 서버 포트 서비스 중단, 방화벽 명시적 차단 |
| TCP SYN>0, SYN-ACK도 RST도 없음 | 응답 자체 없음 → confidence: **low** | 서버 다운, 방화벽 무응답 차단(DROP), 경로 중간 차단 |

**중요**: 어떤 계층을 "실패"로 보려면 그 계층의 **요청 카운트가 0보다 커야** 한다. 요청 카운트 자체가 0(또는 null)이면 "이번 테스트에서 시도 안 함"이지 "실패"가 아니다.

### AI 기반(--use-ai) 진단
- 기본값은 `--use-ai` 없이 **규칙 기반만** 사용.
- `--use-ai`를 켜면 OpenAI를 호출해서 서술형 설명(`ai_narrative`)을 추가로 받는다.
- **AI 호출이 실패하면(키 없음, 네트워크 오류 등) 자동으로 규칙 기반 결과로 대체(fallback)**되고, 실패 이유가 `ai_error`에 기록된다.
- 이렇게 만든 이유: API 키가 없어도, 호출이 실패해도 `diagnosis.json`이 항상 안정적으로 나오게 하기 위해서 (이전 개인 프로젝트 `ai_packet_assistant`의 검증된 패턴을 재사용).

### 구조화된 필드는 어디서 오는가
`evidence_summary`, `hypotheses`, `recommended_checks` 같은 JSON 필드는 **AI를 쓰든 안 쓰든 항상 `rule_based_diagnose()`가 만든다.** AI 응답은 파싱하지 않고, `ai_narrative`라는 별도 필드에 서술형 텍스트로만 붙인다.
- 이유: LLM 응답에서 구조화된 필드를 직접 파싱하면, 모델이 형식을 살짝 어겼을 때 전체 JSON이 깨질 위험이 있다. 뼈대는 규칙 기반으로 항상 안정적으로 유지한다.

### 프롬프트에 Blind Fault 원칙 반영
AI에게도 "case_id나 파일명에서 원인을 추측하지 말 것"을 명시적으로 지시한다.
null 필드는 "관찰되지 않음(모름)"으로 취급하고 0으로 단정하지 말라고도 지시한다.

### 실제 발견된 프롬프트 버그와 수정 (중요 — 실제 있었던 일)
- **문제**: 초기 프롬프트는 AI가 "이번 테스트에서 아예 시도하지 않은 계층(count=0)"까지 실패 증거로 오해해서, 관련 없는 Hypothesis를 추가로 만들어냈다. (예: DNS 무응답 사례인데 ICMP/TCP가 0인 것도 "장애"로 해석)
- **수정**: 프롬프트에 "요청 카운트가 0보다 크면서 응답이 없을 때만 그 계층을 실패로 본다. 첫 실패 계층 하나에 집중하고, 그 뒤 계층은 별도 가설로 만들지 말라"는 규칙을 명시적으로 추가.
- 수정 후 재검증: DNS 무응답 사례에서 DNS 계층 내부 세부 가설로만 정확히 좁혀짐.

### diagnosis.json 필드 정리

| 필드 | 뜻 |
|---|---|
| `is_example` | 이 진단이 교육용 예제 입력으로 만들어졌는지 여부 |
| `evidence_summary` | 카운트를 사람이 읽는 문장으로 바꾼 목록 |
| `hypotheses` | 원인 후보들(layer, description, possible_causes, confidence) |
| `recommended_checks` | 추가로 확인하면 좋을 것 |
| `root_cause` | **확신이 있을 때만** 채움, 아니면 null |
| `recovery_action` | **3번은 항상 null로 둔다** — 실제 복구 방법을 정하는 건 4번의 몫 |
| `limitations_considered` | 고려한 한계(예제 여부, 캡처 지점 한계 등) |
| `generated_by` | `rule_based` 또는 `openai:<모델명>` |

**diagnosis.json에는 실제 정답(진짜 주입된 장애 원인)이 들어있지 않다** — 그건 4번만 알고 있다.

### `ai_packet_assistant`(이전 개인 프로젝트)에서 재사용한 것
- ✅ 재사용: "규칙 기반 우선 + AI 실패시 자동 폴백" 구조, `.env` 로딩 방식
- ❌ 미사용: pcap 파싱 코드(2번이 이미 다르게 처리함), 자연어→Wireshark 필터 변환, Streamlit UI

### analyzer.py가 입력을 읽을 때 하는 최소 확인
과제 HTML 기본 10개 필드가 존재하는지만 다시 확인한다. 상세 검증(형식, 규칙 위반 등)은 **2번의 `validate`가 이미 책임진다** — 3번이 중복으로 다 하지 않는다.

---

## E. 4번 Network SRE (Q91~100 대비)

### 입출력
`diagnosis.json`(입력) → `incident_report.html`(출력)

### 역할
- 실제로 어떤 장애를 몰래 심었는지(**진짜 정답**)를 아는 유일한 사람.
- 3번에게는 Blind Fault 원칙에 따라 미리 알려주지 않는다.
- 3번의 진단이 끝난 뒤, 진단 결과(`hypotheses`, `root_cause` 등)와 실제 원인을 **따로 비교**한다.
- 실제로 장비 설정을 점검·복구하고, 복구 후 재검증(같은 테스트를 다시 실행해 정상 확인)까지 한다.
- 최종적으로 "진단이 실제 원인과 얼마나 맞았는지 + 어떻게 복구했는지 + 검증 결과"를 담은 `incident_report.html`을 작성한다.

### 4번이 하지 않는 일 (함정 주의)
`packet_summary.json`의 count 필드를 직접 고쳐서 답을 맞추는 것처럼 데이터를 조작하는 행위는 4번의 역할이 아니다 — 그건 전체 실험의 신뢰성(Blind Fault)을 깨뜨리는 행동이다.

### 이 역할의 의미
설계(1번) → 관찰(2번) → 추리(3번)의 결과를 **현실의 조치와 검증**으로 마무리 짓는 역할. 이 프로젝트 전체가 배우려는 핵심은 "관찰된 증거만으로 논리적으로 원인을 추리하고 검증하는 능력, 그리고 AI를 그 과정에 안전하게 결합하는 방법"이다.

---

## 빠른 자가 점검 체크리스트

- [ ] 4단계 파이프라인 순서(1→2→3→4)와 각 역할의 입출력 파일명을 안 보고 말할 수 있다
- [ ] Blind Fault 원칙이 무엇이고 왜 필요한지 설명할 수 있다
- [ ] VLAN10/20의 IP 대역과 Gateway 규칙을 기억한다
- [ ] "0"과 "null"의 차이를 예시와 함께 설명할 수 있다
- [ ] rule_based_diagnose()의 계층 검사 순서(ARP→ICMP→DNS→TCP)와 "멈추는 이유"를 설명할 수 있다
- [ ] TCP RST와 무응답의 confidence 차이(high vs low)와 그 이유를 안다
- [ ] AI 경로가 실패해도 diagnosis.json이 항상 나오는 이유를 설명할 수 있다
