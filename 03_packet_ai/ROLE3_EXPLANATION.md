# 3번(AI Engineer) 역할 설명 — 무엇을, 왜 했는가

이 문서는 발표·질의응답용으로, "이걸 왜 이렇게 만들었나"를 설명할 수 있도록
작업 항목별로 정리한 것이다. 기술적인 작업 이력은 `WORKLOG.md`를 참고.

## 이 역할을 한 줄로 요약하면

2번(Packet Analyst)이 만든 **패킷 관찰 요약**(`packet_summary.json`)을 받아서,
**정답을 미리 알지 못한 상태**로 관찰된 숫자만 근거 삼아 원인 후보와 확인 방법을
제안하는 진단 결과(`diagnosis.json`)를 만드는 역할. AI를 쓰되, AI 없이도 항상
동작하고 AI가 있어도 엉뚱한 소리를 안 하게 "가드레일"을 씌우는 게 핵심이다.

---

## 작업 1. 패킷 요약 입력 정의

**무엇을 했는가**
입력 형식을 내가 새로 정의하지 않고, 2번이 만든 데이터 계약(`data_contract.md`)과
handoff 문서(`handoff_to_3_ai_engineer.md`)를 그대로 따랐다. 과제 HTML의 기본
10개 필드(`case_id`, `source_ip`, `destination_ip`, `arp_request_count`,
`arp_reply_count`, `icmp_request_count`, `icmp_reply_count`, `dns_query_count`,
`tcp_syn_count`, `notes`)는 최소 요구사항으로 두고, 2번이 제안한 확장 필드
(`evidence_source`, `dns_response_count`, `tcp_syn_ack_count`, `tcp_rst_count`,
`limitations`, `null_reasons` 등)는 전부 쓰기로 2번과 합의했다.

`analyzer.py`의 `load_summary()`는 기본 10개 필드가 있는지만 다시 확인한다.
형식이 계약을 지키는지에 대한 상세 검증(IP 형식, count 타입, Blind Fault 오염
단어 등)은 2번의 `summarize_pcap.py validate`가 이미 하므로 중복해서 만들지
않았다.

**왜 이렇게 했는가**
- 1번(설계)·2번(캡처)의 실제 데이터가 아직 없는 시점에 입력 형식을 내 마음대로
  추측해서 만들면, 나중에 2번의 실제 데이터와 안 맞을 위험이 크다. 그래서 2번이
  먼저 제안한 계약을 그대로 받아들이고, 팀 문서(handoff)에 합의 내용을 남겼다.
- 검증을 중복으로 만들지 않은 이유: 검증 로직을 두 군데서 다르게 관리하면 나중에
  기준이 어긋난다. "형식이 맞는지"는 2번의 책임, "최소한 동작하는지"만 3번이
  다시 본다.

**가장 중요하게 지킨 규칙: 0과 null은 다르다**
- `0` = 관찰했는데 없었다 (확인됨)
- `null` = 애초에 관찰/분석을 안 했다 (모름)
- `null`을 `0`으로 바꾸면 "관찰 안 한 것"을 "확인된 실패"로 오해하게 되므로,
  코드 전체에서 이 구분을 유지했다 (`_fmt()` 함수가 `None`을 "모름"으로 표시).

관련 파일: `analyzer.py`(`BASE_FIELDS`, `load_summary()`), `02_packet_capture/data_contract.md`

---

## 작업 2. AI Prompt 설계

**무엇을 했는가**
`_build_prompt()` 함수(문서 사본: `prompts/analyzer_prompt.md`)에서 다음을
지시문으로 넣었다.

1. **Blind Fault 원칙 강제**: "case_id나 파일명에서 원인을 추측하지 말 것"을
   AI에게도 명시적으로 지시.
2. **절차 강제**: 미션 HTML의 AI Agent 구성 예시(Observe → Evidence Summary →
   Hypothesis 1/2/3 → 추가 확인 제안 → Root Cause → Recovery Action)를 그대로
   프롬프트에 넣어서, 모델이 근거 없이 결론부터 던지지 않게 했다.
3. **null ≠ 0 재강조**: count가 null인 필드는 "관찰되지 않음"으로 취급하고
   0으로 단정하지 말라고 모델 입력 단계에서도 다시 명시.
4. **계층 순서 + "시도 안 한 계층은 실패가 아니다" 규칙** (아래 참고)

**왜 이렇게 했는가**
- 미션 요구사항이 "AI에게 장애 이름을 먼저 알려준 뒤 설명만 생성하는 방식"을
  피해야 할 형태로 명시했기 때문에, 프롬프트 설계 단계부터 Blind Fault를
  코드가 아니라 텍스트로도 강제할 필요가 있었다.
- 절차를 강제하지 않으면 LLM이 "정답 한 줄"만 던지는 경향이 있어서, 근거부터
  정리하도록 순서를 못박았다.

**실제로 있었던 문제와 수정 (중요한 실전 경험)**
처음 만든 프롬프트로 DNS 무응답 사례를 테스트했더니, AI가 이번 테스트에서
아예 시도하지 않은 계층(ICMP=0, TCP=0)까지 "실패 후보"로 해석해서 관련 없는
Hypothesis 2, 3(TCP 연결 실패, ICMP 무응답)을 추가로 만들어냈다. `count=0`은
"이 테스트에서 그 계층을 확인하지 않았다"는 뜻인데, AI가 이를 "확인했는데
실패했다"로 오해한 것이다.

그래서 프롬프트에 다음 규칙을 명시적으로 추가했다:
> "요청 카운트(arp_request_count 등)가 0보다 크면서 그에 대응하는 응답이
> 없거나 0일 때만 그 계층을 '실패'로 본다. 더 앞선 계층에서 이미 실패 지점을
> 찾았다면 그 뒤 계층은 별도의 Hypothesis로 만들지 말고, 첫 실패 계층 하나에
> 집중할 것."

수정 후 같은 사례로 재검증하니 DNS 계층 내부 세부 가설로만 정확히 좁혀졌다.
이건 "규칙 기반 코드가 이미 따르는 로직(첫 실패 계층에서 멈춘다)을 AI에게도
같은 방식으로 명시해야 한다"는 걸 실제로 겪으면서 배운 것이다.

관련 파일: `analyzer.py`(`_build_prompt()`), `prompts/analyzer_prompt.md`

---

## 작업 3. 원인 후보 생성

**무엇을 했는가**
`rule_based_diagnose()` 함수가 미션 HTML의 "패킷 증거로 원인 후보 만들기" 표를
그대로 코드로 옮겼다. 계층 순서는 **ARP(L2) → ICMP(L3) → DNS → TCP**이고,
**막힌 첫 계층에서 멈춘다.**

| 조건 | 결과 |
|---|---|
| ARP Request>0, Reply=0 | L2 실패 — Gateway IP 오설정 / VLAN 오설정 / SVI Down / 장비 다운, confidence: medium |
| (ARP 성공) ICMP Request>0, Reply=0 | L3 실패 — Inter-VLAN Routing 미설정 / 목적지 다운 / 경로 차단, confidence: medium |
| (ARP/ICMP 성공) DNS Query>0, Response=0 또는 null | DNS 실패 — DNS 서버 오설정 / 서비스 중단 / 경로 차단 |
| TCP SYN>0, RST>0 | 서버까지 도달, 포트 서비스 거부 — confidence: **high**, root_cause 확정 |
| TCP SYN>0, SYN-ACK도 RST도 없음 | 응답 자체 없음 — confidence: **low** (원인 폭이 넓어서) |

**왜 이 순서, 왜 여기서 멈추는가**
상위 계층이 실패했다면 그 아래 계층 결과는 확인할 방법 자체가 없다. 예를 들어
ARP가 안 됐다는 건 상대 MAC 주소도 모른다는 뜻이라, 애초에 ICMP를 보낼 수조차
없다. 그러니 ICMP 결과가 어떻든 의미가 없다 — 그래서 "첫 실패 계층 하나"에
집중하고 그 아래는 언급하지 않는다.

**confidence를 다르게 준 이유**
TCP RST는 "서버가 실제로 응답했다"는 확실한 증거이므로 high, 반면 SYN을
보냈는데 아무 응답도 없는 경우는 서버 다운/방화벽 DROP/경로 차단 등 원인이
너무 다양해서 low로 뒀다. 근거의 확실성 정도를 confidence에 그대로 반영했다.

관련 파일: `analyzer.py`(`rule_based_diagnose()`)

---

## 작업 4. 근거/조치 출력

**무엇을 했는가**
`diagnosis.json`에 다음 필드로 "근거"와 "다음에 할 일"을 분리해서 출력한다.

| 필드 | 역할 |
|---|---|
| `evidence_summary` | 카운트를 사람이 읽는 문장으로 정리 (`_fmt()`가 null은 "관찰 안 됨(모름)"으로 표기) |
| `hypotheses[].description` / `possible_causes` | 원인 후보와 그 후보를 뒷받침하는 관찰 |
| `recommended_checks` | 다음에 확인해보면 좋은 것 (예: "PC의 ipconfig로 Gateway 주소 확인") |
| `root_cause` | **확신이 있을 때만** 채움 (TCP RST 케이스처럼), 그 외엔 `null` |
| `recovery_action` | **항상 `null`** — 실제 복구 방법을 정하는 건 4번(SRE)의 몫이지 3번이 정하는 게 아님 |
| `limitations_considered` | 이 진단이 가진 한계 (예제 데이터 여부, 단일 캡처 지점 등) |

**왜 이렇게 나눴는가**
"이렇게 생각한다(가설)"와 "이렇게 하면 좋겠다(확인/조치)"를 같은 문장에 섞으면
나중에 4번이 무엇이 관찰 근거이고 무엇이 제안인지 구분하기 어렵다. 그래서
근거(evidence_summary)-후보(hypotheses)-확인(recommended_checks)-조치
(recovery_action)를 필드 단위로 분리했다. `recovery_action`을 3번이 채우지
않는 이유는 역할 경계 때문이다: 3번은 "패킷만 보고 추리하는" 역할이고, 실제
설정을 어떻게 고칠지는 현장을 다루는 4번의 책임이다.

---

## 작업 5. JSON/HTML 결과 생성

**JSON(`diagnosis.json`) — 구현 완료**

실제 예시 (교육용 fault 예제 `tests/fixtures/packet_summary_fault_example.json`
을 규칙 기반으로 진단한 결과):

```json
{
  "case_id": "EDU-EX-04",
  "evidence_source": "example",
  "is_example": true,
  "evidence_summary": [
    "ARP Request: 1건", "ARP Reply: 1건",
    "ICMP Echo Request: 0건", "ICMP Echo Reply: 0건",
    "DNS Query: 1건", "DNS Response: 1건",
    "TCP SYN: 1건", "TCP SYN-ACK: 0건", "TCP RST: 1건"
  ],
  "hypotheses": [
    {
      "id": 1,
      "layer": "TCP/Application",
      "description": "SYN을 보냈고 서버가 RST로 응답했다 — 서버까지는 도달했지만 해당 포트의 서비스가 꺼져 있거나 거부한다.",
      "possible_causes": ["Server의 해당 포트 서비스 중단", "방화벽의 명시적 차단(RST)"],
      "confidence": "high"
    }
  ],
  "recommended_checks": ["Server에서 해당 포트 서비스(예: 웹 서버) 실행 여부 확인"],
  "root_cause": "Server TCP Port 서비스 중단 (SYN 도달, RST 응답으로 서버 도달은 확인됨)",
  "recovery_action": null,
  "limitations_considered": [
    "[교육용 예제] 이 입력은 evidence_source=example이라 실제 진단 근거로 쓸 수 없다.",
    "[교육용] 교육용 모델이 만든 값이며 실제 캡처가 아님",
    "단일 캡처 지점(PC1 NIC)의 관찰"
  ],
  "generated_by": "rule_based"
}
```

`--use-ai`를 켜면 위 구조는 그대로 두고 `ai_narrative` 필드에 서술형 설명이
추가되며, `generated_by`가 `"openai:gpt-4o-mini"`로 바뀐다.

**HTML(`ai_report.html`) — 아직 미구현**

솔직하게 밝히면, `ai_report.html`은 아직 만들지 않았다. `WORKLOG.md`에도
"필요 시점에 판단"으로 남겨뒀다. 이유:

- 지금까지는 CLI(`analyzer.py`)로 `diagnosis.json`을 만드는 것만으로 다음
  역할(4번)에게 필요한 정보가 전달된다. 4번이 필요로 하는 건 구조화된 JSON이지
  보기 좋은 HTML이 아니다.
- 미션 HTML은 `ai_report.html`을 "산출물 예시"로 언급했을 뿐 필수로 강제하진
  않아서, 실제로 발표·공유용으로 필요한 시점이 오면(예: 4번이 결과를 취합해
  보여줄 때) 그때 `diagnosis.json`을 입력으로 받는 간단한 렌더러를 추가하는
  쪽으로 판단을 미뤄뒀다. 지금 미리 만들면 형식이 확정되지 않은 상태에서 만드는
  것이라 나중에 다시 고칠 가능성이 높다(Simplicity First: 필요할 때 만든다).

---

## 개별 작업 기록 — 파일별 정리

| 파일 | 상태 | 역할 |
|---|---|---|
| `analyzer.py` | ✅ 구현 완료 | 입력 로드(`load_summary`) → 규칙 기반 진단(`rule_based_diagnose`) → (선택) AI 진단(`ai_diagnose`) → `diagnosis.json` 저장까지의 전체 파이프라인. CLI로 실행 (`--use-ai`, `--case`, `-o` 옵션) |
| `prompts/analyzer_prompt.md` | ✅ 구현 완료 | `_build_prompt()`가 실제로 만드는 프롬프트의 사람이 읽는 사본 + 설계 이유 기록. 코드가 원본이므로 프롬프트를 바꾸면 이 문서도 같이 갱신 |
| `diagnosis.json` | ✅ 구현 완료 (사례마다 매번 생성) | 위 "작업 5" 예시 참고. 정답(진짜 원인)은 들어있지 않고, 근거·가설·확인사항만 있음 |
| `ai_report.html` | ⏳ 미구현 | 필요 시점(4번과의 협의 이후)에 판단하기로 보류 |

## 지금까지 검증한 것 (요약)

- 2번의 실제 정상(Baseline) 캡처(`normal.pcapng`)를 실제로 처리해서 만든
  `packet_summary.json`을 `analyzer.py`에 넣었을 때, 정상 판정(`root_cause: null`)이
  정확히 나옴을 확인 (`tests/fixtures/packet_summary_baseline.json`).
- 2번이 만든 교육용 fault 예제 4종(정상/DNS 무응답/TCP RST/null 섞인 제한적
  캡처) 전부에서 기대한 계층에 정확히 멈추는 것을 확인.
- `--use-ai` 경로를 실제 OpenAI 호출로 검증하고, 프롬프트 버그(작업 2 참고)를
  발견·수정함.
- 아직 검증하지 못한 것: 실제 장애(fault) 캡처 — 4번이 아직 case_id를 배정하지
  않아 존재하지 않음.
