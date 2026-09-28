# 3번(AI Engineer)에게 — 2번이 넘기는 데이터 안내

> **이 문서를 읽으면 알 수 있는 것**
> 2번(Packet Analyst)이 3번에게 **무엇을, 어떤 형식으로, 어떤 뜻으로** 넘기는지 정리했습니다. 또 아직 **정해지지 않은 것**이 무엇인지도 적었습니다.
> 1번의 네트워크 명세와 2번의 실제 캡처가 아직 없는 상태라서, 3번이 입력 형식을 추측해 만들지 않도록 먼저 공유합니다.
>
> 작성: 2번 Packet Analyst · 기준: 과제 HTML과 `02_packet_capture/data_contract.md` (초안 `0.1-draft`)
> 이 문서는 3번의 분석 방식이나 코드를 정하지 않습니다. 3번이 **받는 입력**만 설명합니다.

---

## 1. 한 장 요약

```
1번 network_spec.md ─┐
                     ├─▶ 2번 캡처·분석 ─▶ packet_summary.json ─▶ 3번 diagnosis.json ─▶ 4번 복구·검증
4번 익명 case_id ─────┘                        ▲ 여기가 3번의 입력
```

- 3번이 받는 것은 **`packet_summary.json` 하나**입니다. 파일 하나에 사례(case) 하나가 들어 있습니다.
- 이 파일에는 **관찰한 사실(패킷 수, 증거 프레임)만** 있습니다. **정답(실제 장애 원인)은 없습니다.**
- 과제 HTML 예시의 **10개 필드는 이름·뜻·타입을 그대로** 씁니다. 3번이 이 10개만 읽어도 동작합니다.
- 나머지 필드는 전부 **선택**입니다. 쓰면 판단이 더 정확해지고, 몰라도 무시할 수 있습니다.

## 2. 과제 HTML 예시 그대로의 기본 형식 (반드시 들어 있음)

```json
{
  "case_id": "FAULT-03",
  "source_ip": "192.168.10.10",
  "destination_ip": "192.168.20.20",
  "arp_request_count": 8,
  "arp_reply_count": 0,
  "icmp_request_count": 0,
  "icmp_reply_count": 0,
  "dns_query_count": 0,
  "tcp_syn_count": 0,
  "notes": "Gateway ARP 반복"
}
```
(과제 HTML 5단계의 예시와 같습니다. 값은 예시입니다.)

| 필드 | 타입 | 정확한 뜻 |
|---|---|---|
| `case_id` | 문자열 | 4번이 준 **익명** 사례 ID. 원인을 암시하지 않음 |
| `source_ip` | IPv4 문자열 | 테스트를 시작한 PC |
| `destination_ip` | IPv4 문자열 | 테스트의 **최종 목적지** (Gateway가 아님) |
| `arp_request_count` | 정수 또는 null | source_ip가 보낸 ARP Request 중, 찾는 IP가 목적지나 **next hop(Gateway)**인 것 |
| `arp_reply_count` | 정수 또는 null | 위 ARP에 대한 Reply |
| `icmp_request_count` | 정수 또는 null | **ICMP Echo Request(type 8)만**. source → destination |
| `icmp_reply_count` | 정수 또는 null | **ICMP Echo Reply(type 0)만**. destination → source. ICMP Unreachable(type 3)은 여기에 **포함하지 않음** |
| `dns_query_count` | 정수 또는 null | source_ip가 보낸 DNS 질의 (어느 DNS 서버로 보냈든) |
| `tcp_syn_count` | 정수 또는 null | **SYN=1, ACK=0**인 연결 시작 요청만. SYN-ACK는 포함하지 않음 |
| `notes` | 문자열 | 관찰 사실 요약. **원인 추측은 쓰지 않음** |

## 3. 가장 중요한 약속: 0과 null은 다르다

| 값 | 뜻 | 3번이 할 일 |
|---|---|---|
| `0` | 그 구간·그 지점을 **분석했고**, 해당 패킷이 **없었다** | "관찰되지 않음"으로 사용 |
| `null` | **수집·분석을 하지 않았거나, 그 지점에서는 볼 수 없다** (이유는 `null_reasons`에 있음) | "모름"으로 다룸. **0으로 바꾸면 안 됨** |

추가로, `0`도 "그 캡처 지점에서 보이지 않았다"는 뜻일 뿐입니다. "응답이 세상에 없었다"는 뜻이 아닙니다. 캡처 지점의 한계는 `limitations`에 적습니다.

## 4. 추가 필드 (선택, 합의 대상)

| 필드 | 뜻 |
|---|---|
| `schema_version` | 현재 `"0.1-draft"`. 없으면 기본 10개 필드 형식 |
| `evidence_source` | `"wireshark_capture"`(실제 캡처) / `"packet_tracer_simulation"`(PT 관찰) / `"example"`(교육용 예제 — **진단에 쓰지 말 것**) |
| `capture_file`, `capture_point`, `test_description` | 어느 파일, 어느 위치, 어떤 명령으로 얻었는지 |
| `analysis_scope` | 시간 구간, 필터, ARP를 셀 대상 IP(`arp_targets`), 집계 기준(패킷 수, 재전송 포함 여부) |
| `dns_response_count` | source_ip가 받은 DNS 응답 수 (오류 응답 포함) |
| `tcp_syn_ack_count`, `tcp_rst_count` | 서버가 보낸 SYN-ACK / RST 수 |
| `evidence` | 근거 패킷 목록: 프레임 번호, 시각, 프로토콜, 관찰 내용 |
| `limitations` | 이 캡처로 **알 수 없는 것** (예: "서버 쪽 캡처 없음 → 요청이 서버에 도착했는지 모름") |
| `null_reasons` | null인 필드별 이유 |

**추가 필드가 판단에 주는 차이 (예)**
- `tcp_syn_count > 0`이고 `tcp_rst_count > 0`이면 서버까지는 도달한 것입니다. `tcp_rst_count == 0`이고 SYN-ACK도 0이면 응답이 없는 것입니다. 기본 10개 필드만으로는 이 둘을 구분할 수 없습니다.
- `dns_query_count > 0`이고 `dns_response_count == 0`이면 무응답입니다. 응답이 있는데 오류라면 `evidence`에 `rcode`가 적혀 있습니다.
- `analysis_scope.arp_targets`와 `evidence`의 ARP 관찰을 보면, PC가 **어떤 IP를 찾았는지** 알 수 있습니다. 예를 들어 Gateway 주소가 잘못되었는지 판단할 때 결정적인 근거가 됩니다.

## 5. 3번 쪽에서 지켜 주었으면 하는 것 (과제 요구와 연결)

과제 HTML은 "AI에게 장애 이름을 먼저 알려준 뒤 설명만 생성하는 경우"를 피해야 할 형태로 적고 있습니다. 그래서 2번 데이터는 다음을 지킵니다.
- `case_id`, 파일명에 원인을 암시하는 단어가 없습니다. 2번의 검증기가 이런 단어를 막습니다.
- 정답 대조는 분석이 끝난 뒤, 4번의 기록과 **별도로** 합니다. `packet_summary.json`에는 정답이 들어가지 않습니다.

3번이 입력을 다룰 때 부탁드리는 것:
- `evidence_source == "example"`인 파일은 실제 진단 입력으로 쓰지 말아 주세요.
- `null`을 0으로 바꾸지 말아 주세요.
- 한 지점 캡처라면(`limitations` 참고) "패킷이 도달하지 않았다"고 단정하지 말아 주세요.

## 6. 과제 HTML이 3번에게 요구하는 것 (원문 요약 — 2번의 설계가 아님)

맞춰 보시라고 과제 HTML의 내용만 옮깁니다. 구현 방식은 3번이 정합니다.
- 3번의 할 일: 패킷 요약 입력 정의, AI Prompt 설계, 원인 후보 생성, 근거·조치 출력, JSON/HTML 결과 생성
- 산출물 예시: `analyzer.py`, `prompt.md`, `diagnosis.json`, `ai_report.html`
- 판단 순서: 근거 → 가설 → 추가 확인 → 결론. 과제에는 "Observe → Evidence Summary → Hypothesis 1/2/3 → 추가 확인 명령 제안 → Evidence 재확인 → Root Cause → Recovery Action" 흐름이 예시로 있습니다.
- "PCAP 전체를 무작정 LLM에 던지지 않고, 핵심 특징을 구조화해 넘긴다" → 그 구조화된 입력이 `packet_summary.json`입니다.

## 7. 아직 정해지지 않은 것 (정직하게)

| 항목 | 상태 |
|---|---|
| 실제 `packet_summary.json` | ⏳ 없음. 실제 캡처 후 생성. 지금 저장소에는 **교육용 예제**(`packet_summary.example.json`)만 있음 |
| 실제 주소·서버·도메인 | ⏳ 1번의 `network_spec.md` 대기. 위 예시의 주소는 과제 HTML 기준 값이므로, **3번 코드에 주소를 고정하지 않는 것을 권합니다** |
| 캡처 환경 | Packet Tracer 9.0.1에는 pcap 저장 기능이 없어, 같은 구조를 Linux에 재현해 캡처할 예정. 그래서 `limitations`에 "별도 재현 환경" 표시가 들어갈 수 있음 |
| 여러 사례를 담는 방법 | ⏳ 합의 필요. 후보 (A) 사례별 파일 `packet_summary_<case_id>.json` (B) 묶음 파일 `{"schema_version": ..., "cases": [...]}`. 합의 전까지는 **단일 객체**를 유지 |
| 추가 필드 채택 여부 | ⏳ 합의 필요 |

## 8. 3번에게 요청 — 답을 주시면 2번이 맞춥니다

1. 기본 10개 필드 외에 **어떤 추가 필드를 쓰실 건가요?** (전부 / 일부 / 안 씀)
2. **여러 사례**를 (A) 사례별 파일과 (B) 묶음 파일 중 어느 방식으로 받으시겠어요?
3. 3번 프로그램이 이미 **다른 입력 형식**으로 만들어지고 있다면, 그 형식(필드 이름·타입)을 알려 주세요. 과제 HTML의 10개 필드와 충돌하는 부분을 함께 조정하겠습니다.
4. `null`을 처리할 수 있나요? 안 된다면 대안(예: `-1` 금지, 필드 생략)을 정해야 합니다.
5. 테스트용으로 **교육용 예제 JSON**이 더 필요한가요? 정상, 장애 유형별 등 필요한 사례를 알려 주세요.

## 9. 파일 위치 (브랜치 `feat/2nd-part`)

| 파일 | 내용 |
|---|---|
| `02_packet_capture/data_contract.md` | 필드 정의·검증 규칙 전체 (이 문서의 원본) |
| `02_packet_capture/packet_summary.example.json` | 교육용 예제 (`evidence_source: "example"`) |
| `02_packet_capture/summarize_pcap.py validate <파일>` | JSON이 계약을 지키는지 검사하는 명령. 3번 쪽에서도 입력 검사에 쓸 수 있음 |
| `02_packet_capture/packet_summary.json` | ⏳ 실제 분석 후 생성 |

## 10. 3번 답변 반영 (2026-09-28)

| 항목 | 결과 |
|---|---|
| 추가 필드 | 전부 사용 ✅ |
| null | "모름"으로 유지, 0으로 치환하지 않음 ✅ |
| 여러 사례 | ✅ 둘 다 사용: 사례별 `packet_summary_<case_id>.json` + 과제 HTML 이름 `packet_summary.json`(대표 사례 1건의 사본, 대표 사례는 팀이 정함). 둘 다 단일 객체 |
| 기존 `ai_packet_assistant` | 패킷 1개 단위 설명용이라 이 계약과 충돌 없음 ✅ |
| 추가 예제 4종 | `02_packet_capture/examples/`에 추가 ✅ (정상, DNS 무응답, TCP RST, null 섞인 제한적 캡처) |
| EDU-EX-01의 `.254` | 설계 Gateway가 아니라 "Gateway 오설정 장애"에서 PC가 찾은 **관찰값**. 설계 Gateway는 `.1` (자세한 설명: `examples/README.md`) |
