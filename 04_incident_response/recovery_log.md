# Recovery Log — 4번 Network SRE

> 사례별 복구 작업과 검증 기록. 아직 진행한 사례는 없다.
> 복구 작업과 기록은 4번 범위다. 복구 후 캡처와 패킷 비교는 2번이 만들어 4번에게 넘긴다.

## 1. 기록 규칙

- 복구 명령은 `sudo ./fault.sh recover <case_id>` 출력을 그대로 옮긴다.
- 복구 판정은 두 가지를 모두 본다. 설정 검증(`fault.sh verify`)만으로 복구 완료라고 쓰지 않는다.
  1. 설정 검증: `verify`의 "다름 0"
  2. 패킷 검증: 2번의 `recovered_<case_id>.pcapng`가 Baseline과 같은 흐름을 보이는지
- Baseline은 `02_packet_capture/normal.pcapng`(1번 명세 배치로 재캡처한 것)이다.
- 테스트, 캡처 지점(pc1), ARP 캐시 조건(`lab.sh flush` 후 시작)은 Baseline과 같게 맞춘다.

과제 HTML 단계 7 체크리스트와 이 문서의 대응:

| 과제 단계 7 항목 | 기록 위치 |
|---|---|
| 장애 전 증거 저장 | `02_packet_capture/normal.pcapng`, `fault_<case_id>.pcapng` (2번) |
| 수정 명령/설정 기록 | 2절 "실행한 복구 명령", "되돌린 설정" |
| 장애 후 ping/DNS/TCP 재검증 | `recovered_<case_id>.pcapng` (2번), 4절 |
| 정상 패킷과 비교 | 4절 |
| AI 진단이 실제 원인과 일치했는지 확인 | `incident_cases.md` 2절·3절 |

## 2. 사례별 기록

---

### FAULT-01

| 항목 | 내용 |
|---|---|
| 장애 적용 | <시각> · 방식 <팀원 적용 / 무작위 적용> |
| 정답 공개 | <시각> |
| 복구 시작 / 완료 | <시각> / <시각> |
| 실행한 복구 명령 | `sudo ./fault.sh recover FAULT-01` |
| 되돌린 설정 | <recover 출력의 "되돌린 내용"> |
| `fault.sh verify` 결과 | <정상 n · 다름 n> |
| 복구 후 캡처 | `recovered_FAULT-01.pcapng` (2번) |
| 패킷 검증 결과 | <4절 표 요약> |
| 판정 | <복구 완료 / 미완료 — 이유> |

---

## 3. Packet Tracer 쪽 복구 (재현하는 경우에만)

Packet Tracer에서도 같은 장애를 재현했는지는 미결정이다. 재현했다면 IOS 명령과 `show` 결과 스크린샷 위치를 여기에 적는다. 재현 실습망 결과와 섞지 않는다.

## 4. Baseline / Fault / Recovered 비교표 (2번이 채움)

같은 테스트 6종의 결과. 값은 `packet_summary` JSON과 `packet_analysis.md`에서 옮긴다. 수집하지 않은 값은 비워 두지 말고 `null(이유)`로 적는다.

| 테스트 | Baseline | Fault | Recovered | 차이 요약 |
|---|---|---|---|---|
| 1. ping PC2 (192.168.10.11) | | | | |
| 2. ping Gateway (192.168.10.1) | | | | |
| 3. ping PC3 (192.168.20.10) | | | | |
| 4. ping Server (192.168.20.20) | | | | |
| 5. DNS `www.packetlab.test` A | | | | |
| 6. HTTP `http://www.packetlab.test/` | | | | |

| 집계 필드 (`data_contract.md` 정의) | Baseline | Fault | Recovered |
|---|---|---|---|
| arp_request_count / arp_reply_count | | | |
| icmp_request_count / icmp_reply_count | | | |
| dns_query_count / dns_response_count | | | |
| tcp_syn_count / tcp_syn_ack_count / tcp_rst_count | | | |
