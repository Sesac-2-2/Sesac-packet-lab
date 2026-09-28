# packet_summary.json 데이터 계약 (초안 0.1-draft)

> **이 문서는 누구를 위한 것인가**
> 3번 AI Engineer가 `packet_summary.json`을 입력으로 읽을 때, 각 값이 **무엇을 셌는지·무엇을 뜻하지 않는지**를 오해 없이 알 수 있게 하려는 문서입니다. 2번(Packet Analyst)과 3번이 이 문서를 보고 필드를 합의합니다.
> 상태: **초안**. 3번과 합의하기 전까지 `schema_version`은 `0.1-draft`입니다.

---

## 1. 한눈에 보기

```
1번 network_spec.md ─┐
                     ├─▶ 2번 캡처·분석 ─▶ packet_summary.json ─▶ 3번 diagnosis.json ─▶ 4번 복구 검증
4번 익명 장애 case_id ┘
```

- 파일 하나 = **사례 하나(단일 객체)**. 과제 HTML의 5단계 예시와 같은 형태입니다.
- 과제 HTML 예시의 10개 필드는 **이름·의미·타입을 그대로** 유지합니다. 3번이 이 10개만 읽어도 동작합니다.
- 추가 필드는 전부 **선택(optional)** 입니다. 추가 필드를 모르는 프로그램은 무시해도 됩니다.

## 2. 과제 HTML 기본 필드 (반드시 유지)

| 필드 | 타입 | 의미 (정확한 집계 기준) |
|---|---|---|
| `case_id` | string | 4번 SRE가 준 **익명** 사례 ID. 원인을 암시하는 단어 금지(예: `FAULT-03`은 가능, `FAULT-GATEWAY`는 불가). |
| `source_ip` | string (IPv4) | 테스트를 시작한 호스트의 IP. |
| `destination_ip` | string (IPv4) | 테스트의 **최종 목적지** IP. (Gateway를 거치더라도 최종 목적지를 적음) |
| `arp_request_count` | int ≥ 0 또는 null | ARP Request(`arp.opcode == 1`) 중 **보낸 쪽 IP = source_ip**, **찾는 IP ∈ `analysis_scope.arp_targets`** 인 패킷 수. |
| `arp_reply_count` | int ≥ 0 또는 null | ARP Reply(`arp.opcode == 2`) 중 **받는 쪽 IP = source_ip**, **응답한 IP ∈ `arp_targets`** 인 패킷 수. |
| `icmp_request_count` | int ≥ 0 또는 null | **ICMP Echo Request**(`icmp.type == 8`)만. source_ip → destination_ip. 다른 ICMP 유형(예: Destination Unreachable)은 섞지 않음. |
| `icmp_reply_count` | int ≥ 0 또는 null | **ICMP Echo Reply**(`icmp.type == 0`)만. destination_ip → source_ip. |
| `dns_query_count` | int ≥ 0 또는 null | DNS Query(`dns.flags.response == 0`) 중 source_ip가 **보낸** 패킷 수. DNS 서버 주소는 제한하지 않음(잘못된 DNS 서버로 보낸 질의도 셈). |
| `tcp_syn_count` | int ≥ 0 또는 null | **SYN=1, ACK=0** 인 TCP 패킷(연결 시작 요청)만. source_ip → destination_ip. **SYN-ACK는 포함하지 않음.** |
| `notes` | string | **관찰 사실**만 짧게. 원인 추측 금지. |

> ⚠ `tcp.flags.syn == 1` 필터는 SYN-ACK까지 보여 줍니다. `tcp_syn_count`는 `tcp.flags.syn == 1 && tcp.flags.ack == 0` 기준입니다.

## 3. 추가 필드 (선택, 3번과 합의 대상)

| 필드 | 타입 | 의미 |
|---|---|---|
| `schema_version` | string | 현재 `"0.1-draft"`. 없으면 "과제 HTML 기본 형식"으로 간주. |
| `capture_file` | string 또는 null | 근거 캡처 파일명(예: `fault_FAULT-03.pcapng`). Packet Tracer 관찰이면 `.pkt` 또는 null. |
| `evidence_source` | `"wireshark_capture"` \| `"packet_tracer_simulation"` \| `"example"` | 증거의 출처. `example`은 교육용 예제. |
| `capture_point` | string | 어디서 캡처했는지(예: `PC1 NIC (SW-A Fa0/1 access port)`). |
| `test_description` | string | 실행한 테스트(예: `ping -n 4 <SERVER_IP>`, 시작 시각 포함). |
| `analysis_scope` | object | 아래 4절. 무엇을·언제·어떤 기준으로 셌는지. |
| `dns_response_count` | int ≥ 0 또는 null | DNS Response(`dns.flags.response == 1`) 중 source_ip가 **받은** 패킷 수. 오류 응답(NXDOMAIN 등)도 포함 → 오류 여부는 `evidence`에 기록. |
| `tcp_syn_ack_count` | int ≥ 0 또는 null | SYN=1, ACK=1. destination_ip → source_ip. |
| `tcp_rst_count` | int ≥ 0 또는 null | RST=1. destination_ip → source_ip. |
| `evidence` | array | 근거가 된 개별 패킷/이벤트. 아래 5절. |
| `limitations` | array of string | 이 캡처로 **알 수 없는 것**. 예: "서버 쪽 캡처 없음 → 요청이 서버에 도달했는지 모름". |
| `null_reasons` | object | null인 count 필드마다 이유. 예: `{"dns_query_count": "capture filter가 icmp만 저장"}` |

## 4. `analysis_scope` 구조

```json
{
  "time_window": { "start": "2026-10-05T10:02:00+09:00", "end": "2026-10-05T10:02:30+09:00" },
  "display_filter": "ip.addr == 192.168.10.10 || arp",
  "target_flow": "PC1 → Server ICMP Echo",
  "arp_targets": ["192.168.20.20", "192.168.10.1"],
  "count_basis": { "unit": "packets", "retransmissions_included": true },
  "field_filters": { "arp_request_count": "arp.opcode == 1 && arp.src.proto_ipv4 == 192.168.10.10 && ..." }
}
```

- `arp_targets`: ARP를 셀 대상 IP 목록. **최종 목적지 + 실제 next hop(Gateway)** 을 넣습니다. 다른 Subnet으로 보낼 때 PC는 서버가 아니라 Gateway의 MAC을 찾기 때문입니다.
- `count_basis.unit`: `packets`(패킷 수) 또는 `transactions`(고유 요청 수). `summarize_pcap.py`는 항상 `packets`.
- `retransmissions_included`: 재전송을 포함했는지. `packets` 기준이면 `true`(같은 요청을 3번 보내면 3).
- `field_filters`: 각 count를 Wireshark에서 **똑같이 다시 셀 수 있는 display filter**. 사람이 수동 검증할 때 씁니다.

## 5. `evidence` 항목

```json
{ "ref_type": "frame", "frame_number": 12, "time": "2026-10-05T10:02:03.114+09:00",
  "protocol": "ARP", "observation": "Who has 192.168.10.254? Tell 192.168.10.10 (Reply 없음)" }
```

- `ref_type`: `"frame"`(Wireshark 프레임 번호) 또는 `"pt_event"`(Packet Tracer Simulation 이벤트) 또는 `"example_event"`(교육용).
- `frame`이면 `frame_number` 필수, `pt_event`이면 `event_id` 필수(예: Event List의 순번·시각).
- `observation`에는 **본 것**만 씁니다. "Gateway 설정 오류로 보임" 같은 해석은 `packet_analysis.md`의 "원인 후보" 칸에 씁니다.

## 6. 0과 null의 차이 (가장 중요)

| 값 | 뜻 | 예 |
|---|---|---|
| `0` | 관찰 가능한 범위를 **분석했고**, 해당 패킷이 **없었다** | PC1 NIC 캡처 30초 동안 ARP Reply 없음 → `arp_reply_count: 0` |
| `null` + 이유 | **수집하지 않았거나, 분석하지 않았거나, 그 지점에서는 볼 수 없다** | capture filter로 DNS를 저장하지 않음 → `dns_query_count: null`, `null_reasons.dns_query_count: "capture filter 'icmp'"` |
| 숫자 + `limitations` | 셌지만 해석 범위에 한계가 있다 | PC1 쪽에서 `icmp_reply_count: 0` + "서버 쪽 캡처 없음 → 요청이 서버에 도착했는지 모름" |

`0`은 "관찰 구간에 보이지 않았다"는 뜻이지 "응답이 세상에 존재하지 않았다"는 뜻이 아닙니다. 다른 지점에서 보면 존재할 수 있습니다.

## 7. 검증 규칙 (validator가 확인하는 것)

`summarize_pcap.py validate <file>`와 학습 웹앱의 JSON 불러오기가 **같은 규칙**을 씁니다.

**오류 (Error, 사용 불가)**
1. 기본 10개 필드 중 하나라도 없음.
2. `case_id`가 빈 문자열이거나 문자열이 아님.
3. `source_ip`/`destination_ip`가 IPv4 형식이 아님.
4. count 필드가 음이 아닌 정수도 null도 아님(예: `"8"`, `-1`, `2.5`).
5. count가 null인데 `null_reasons`에 그 필드의 이유가 없음.
6. `schema_version`이 있는데 지원 버전(`0.1-draft`)이 아님.
7. `evidence_source`가 허용값이 아님.
8. `evidence_source == "example"`인데 `notes`에 `[교육용 예제]` 표시가 없음 / 실제 출처인데 `[교육용 예제]` 표시가 있음.
9. `evidence` 항목에 `observation`이 없거나, `frame`인데 `frame_number`가 없거나, `pt_event`인데 `event_id`가 없음.
10. `case_id` 또는 `capture_file`에 원인을 암시하는 단어(gateway, vlan, trunk, svi, dns, mask, subnet, port, web, http 등)가 들어 있음 → Blind Fault 입력 오염.
11. `analysis_scope.count_basis.unit`이 `packets`/`transactions`가 아님.

**경고 (Warning, 사용 가능하지만 확인 필요)**
- `schema_version` 없음 → 기본 형식으로 처리.
- 알 수 없는 추가 필드.
- `analysis_scope` 없음 → 무엇을 셌는지 3번이 알 수 없음.
- `limitations` 없음.
- `tcp_syn_count`가 있고 `tcp_syn_ack_count`가 없음 → 응답 유무를 판단하기 어려움.

## 8. 3번(AI Engineer)이 읽는 방법 제안

1. 먼저 `evidence_source`를 확인합니다. `example`이면 실제 진단에 쓰지 않습니다.
2. 기본 10개 필드로 증상 패턴을 봅니다(예: ARP Request > 0, Reply = 0).
3. null이면 "모름"으로 다룹니다. **null을 0으로 바꾸지 마세요.**
4. `limitations`를 가설의 확신도에 반영합니다(한 지점 캡처면 "도달하지 않았다" 단정 금지).
5. `evidence[].observation`을 근거 문장으로 인용하고, 프레임 번호를 함께 보여 줍니다.
6. 이 파일에는 **정답(실제 원인)이 없습니다.** 정답 대조는 분석이 끝난 뒤 4번의 `incident_cases.md`와 따로 비교합니다.

## 9. 여러 사례를 담는 방법 (합의: 2026-09-28)

두 가지를 **함께** 씁니다. 두 파일 모두 이 문서의 **단일 객체 형식**입니다(배열 아님).

| 파일 | 내용 | 이유 |
|---|---|---|
| `packet_summary_<case_id>.json` | 사례 하나당 파일 하나. 모든 사례가 이 형식으로 존재 | 3번 제안. `diagnosis.json`도 사례 1개당 1개로 대응 |
| `packet_summary.json` | 대표 사례 1건의 사본 (내용이 같은 `packet_summary_<case_id>.json`이 반드시 있음) | 과제 HTML의 Pipeline 파일명을 그대로 유지 |

- 대표 사례는 발표·Pipeline 시연에 쓰는 사례입니다. 어느 사례로 할지는 ⏳ 팀이 정하면 여기에 적습니다.
- 대표 사례를 바꿀 때는 `packet_summary.json`을 해당 사례 파일의 사본으로 덮어씁니다. 두 파일의 내용이 달라지면 안 됩니다.
- 묶음 파일(`{"cases": [...]}`)은 쓰지 않습니다. 사례가 아주 많아지면 그때 다시 논의합니다.

## 10. 예제 파일

- `packet_summary.example.json`: 교육용 예제(`evidence_source: "example"`). 실제 증거가 아닙니다.
- `packet_summary.json`: **실제 캡처 분석 후에만** 생성합니다. 현재 저장소에는 없습니다(증거 대기 중).
