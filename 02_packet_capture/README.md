# 02_packet_capture — 2번 Packet Analyst

> **한 줄 요약**
> 정상일 때와 장애일 때의 패킷을 같은 조건으로 캡처해 비교합니다. 그 결과를 **관찰한 사실만 담은** `packet_summary.json`으로 만들어 3번(AI Engineer)에게 넘깁니다.

이 폴더의 문서는 **처음 보는 팀원이 읽고 이해하기 쉽게** 쓰는 것을 원칙으로 합니다. 작성자가 설명하기 편한 순서보다 듣는 사람이 따라오기 쉬운 순서를 우선합니다. 한 문장에 한 가지 내용만 담고, 용어는 처음 나올 때 풀어 씁니다.

---

## 1. 내 역할과 팀 흐름

```
1번 network_spec.md ──┐
                      ├─▶ 2번 캡처·비교·분석 ──▶ packet_summary.json ──▶ 3번 diagnosis.json ──▶ 4번 복구 검증
4번 익명 case_id·증상 ─┘                                                        ▲
                                                           복구 후 같은 테스트 반복 ┘ (2번이 패킷 변화 기록)
```

| 구분 | 내용 |
|---|---|
| 받는 것 | 1번의 `network_spec.md`(주소·VLAN·서버), 4번의 익명 장애 `case_id`와 증상 |
| 하는 일 | 정상·장애 캡처, ARP/ICMP/DNS/TCP 분석, 정상과 비교, 필터 정의 |
| 넘기는 것 | 실제 캡처(`.pcapng`), `packet_analysis.md`, `packet_summary.json` |
| 하지 않는 것 | 네트워크 설계(1번), AI 진단 구현(3번), 장애 주입·복구·Dashboard(4번) |

**완료 기준**
- [x] 정상 Baseline 캡처 1건 이상 (`normal.pcapng`, `normal_srv.pcapng`)
- [ ] 장애 캡처 1건 이상 (`fault_<case_id>.pcapng`), 원인을 모르는 상태에서 분석
- [ ] 정상과 비교한 분석 기록 (`packet_analysis.md`)
- [ ] 3번이 실제 입력으로 쓰는 `packet_summary.json` (데이터 계약 통과)
- [ ] 복구 후 같은 테스트를 반복한 비교 1건 이상
- [ ] 팀원이 "증거 → 해석 → 추가 확인"을 자기 말로 설명할 수 있는지 점검

## 2. 파일 구조

과제 HTML이 예시로 든 파일과, 이번에 추가한 보조 자료를 구분했습니다.

| 파일 | 구분 | 상태 |
|---|---|---|
| `normal.pcapng` | 과제 예시 | ✅ 정상 Baseline, PC1 NIC (59 frames, 2026-09-29, 1번 명세 배치, 재현 실습망) |
| `normal_srv.pcapng` | 추가 | ✅ 정상 Baseline, Server NIC (32 frames, 같은 시각) |
| `fault_<case_id>.pcapng` | 과제 예시 (`fault_*.pcapng`) | ⏳ 실제 캡처 후 생성 (현재 없음) |
| `recovered_<case_id>.pcapng` | 추가 | ⏳ 복구 후 캡처를 확보한 경우 |
| `packet_analysis.md` | 과제 예시 | 템플릿 작성됨, 실제 내용 대기 |
| `packet_summary_<case_id>.json` | 추가 (3번과 합의) | ⏳ 사례별 실제 분석 결과. 사례마다 1개 |
| `packet_summary.json` | 과제 예시 (Pipeline 전달 파일) | ⏳ 대표 사례 1건의 사본 (대표 사례는 팀이 정함) |
| `README.md` | 추가 | 이 문서 |
| `capture_checklist.md` | 추가 | 캡처 전후 체크리스트 |
| `wireshark_filters.md` | 추가 | 필터·확인 필드·한계 |
| `data_contract.md` | 추가 | `packet_summary.json` 필드 정의 (3번과 합의용 초안) |
| `handoff_to_3_ai_engineer.md` | 추가 | 3번에게 전달하는 입력 데이터 안내와 합의 요청 |
| `handoff_to_4_sre.md` | 추가 | 4번에게 장애 사례 정보와 재현 실습망 장애 적용 방식 합의 요청 |
| `packet_summary.example.json` | 추가 | **교육용 예제** (실제 증거 아님) |
| `summarize_pcap.py` | 추가 | `.pcapng` → `packet_summary.json` 추출·검증 도구 |
| `tests/` | 추가 | 도구·웹앱 테스트 (합성 데이터는 실행 중에만 생성) |
| `learning_lab/` | 추가 | 팀원 교육용 인터랙티브 웹앱 |
| `lab_env/` | 추가 | 실제 `.pcapng`를 얻기 위한 캡처용 재현 실습망 (Linux). 테스트·캡처·관찰만 제공. 토폴로지는 1번 명세 전 임시값, 장애 적용은 4번 담당이라 제외 |

**과제 예시와 다르게 조정한 것 (이유 포함)**
- 과제 HTML 예시의 `fault_gateway.pcapng`, `fault_vlan.pcapng`처럼 **원인이 드러나는 파일명은 쓰지 않습니다.** 대신 `fault_<case_id>.pcapng`를 씁니다. 과제는 "AI에게 장애 이름을 먼저 알려주지 말 것"을 요구합니다. 파일명도 AI 입력의 일부이기 때문입니다. 과제 HTML도 폴더 구조가 "예시"이며 바꿔도 된다고 밝히고 있습니다.
- 가짜 캡처 파일이나 빈 캡처 파일은 만들지 않았습니다. 완료된 것처럼 채운 `packet_summary.json`도 만들지 않았습니다. 실제 증거가 생기기 전까지는 "대기 중"입니다.

## 3. 실제 작업 순서 (정상 1건 → 장애 1건 → 비교 → JSON 전달)

1. **정보 받기** — 아래 5절 체크리스트를 1번·4번에게 받습니다.
2. **정상 캡처** — `capture_checklist.md`에 따라 캡처를 먼저 시작합니다. 그다음 6가지 Baseline 테스트를 실행하고, 시각을 적고, `normal.pcapng`로 저장합니다.
3. **장애 캡처** — 4번이 준 `case_id`와 증상만 가지고 시작합니다(원인은 묻지 않음). 정상과 **같은 테스트·같은 캡처 지점·같은 필터·같은 캐시 조건**으로 캡처해 `fault_<case_id>.pcapng`로 저장합니다.
4. **비교** — `wireshark_filters.md`의 필터로 정상과 장애를 나란히 봅니다. `packet_analysis.md`에 "실행한 테스트 → 관찰한 패킷 → 정상과 차이 → 원인 후보 → 필요한 추가 증거" 순서로 적습니다.
5. **JSON 만들기**
   ```bash
   python3 summarize_pcap.py extract fault_<case_id>.pcapng --case-id <case_id> \
       --source-ip <PC_IP> --destination-ip <SERVER_IP> --next-hop <GATEWAY_IP> \
       --capture-point "<캡처 위치>" --test-description "<시각> <실행한 명령>" \
       --start <초> --end <초> -o packet_summary_<case_id>.json
   python3 summarize_pcap.py validate packet_summary_<case_id>.json
   # 대표 사례라면 과제 HTML의 파일명으로도 복사
   cp packet_summary_<case_id>.json packet_summary.json
   ```
   - **Windows 11**: `python3` 대신 `py`를 씁니다. PowerShell에서 여러 줄로 나눌 때는 `\` 대신 줄 끝에 `` ` ``(백틱)을 씁니다. `tshark`가 PATH에 없어도 Windows 설치 정보에서 Wireshark 위치(예: `E:\Program\Wireshark`)를 찾아 씁니다. 못 찾으면 `--tshark "E:\Program\Wireshark\tshark.exe"`로 지정합니다.
   - 재현 실습망(Linux)에서 캡처했다면 Linux 안에서 바로 실행해도 됩니다(`tshark` 설치됨).
   - `--start/--end`는 캡처 시작 기준 초입니다(Wireshark의 Time 열). 테스트한 구간만 셉니다.
   - 저장하지 않은 프로토콜이 있으면 `--not-collected dns_query_count="capture filter가 icmp만 저장"`처럼 null과 이유로 남깁니다.
6. **수동 검증** — `python3 summarize_pcap.py filters --source-ip ... --destination-ip ... --next-hop ...`가 각 숫자의 display filter를 출력합니다. Wireshark에 같은 필터를 넣고, 같은 시간 구간에서 아래 상태줄의 "Displayed" 개수가 JSON 값과 같은지 확인합니다. 결과는 `packet_analysis.md`의 "집계 검증" 칸에 적습니다.
7. **전달** — `packet_summary.json`을 커밋하고 3번에게 알립니다. `evidence_source`, `limitations`, null의 의미를 함께 전합니다.
8. **복구 후** — 4번이 복구하면 같은 테스트를 반복합니다. `recovered_<case_id>.pcapng`로 저장하고 Baseline / Fault / Recovered를 비교합니다.

## 4. Packet Tracer 관찰과 Wireshark 캡처는 다른 증거다

- Packet Tracer의 **Simulation 모드 이벤트**는 시뮬레이터가 보여 주는 재현입니다. Wireshark `.pcapng`와 같은 파일이 아닙니다.
- 사용 버전 **Packet Tracer 9.0.1.0858에는 Simulation 결과를 `.pcap`/`.pcapng`로 저장하는 메뉴가 없습니다** (직접 확인).
- **내 PC(Windows 11)에서 Wireshark로 캡처하면 내 PC의 실제 NIC를 지나는 패킷만 잡힙니다.** Packet Tracer 안의 가상 트래픽은 잡히지 않습니다.
- 그래서 실제 `.pcapng`는 **`lab_env/`의 재현 실습망**(Linux network namespace로 만든 같은 구조의 네트워크)에서 캡처합니다. 실행 위치는 Windows의 WSL2, 또는 Mac의 Multipass Ubuntu입니다. 자세한 방법은 `lab_env/README.md`에 있습니다.
- 따라서 증거는 두 종류가 됩니다. 섞지 않고 각각 출처를 적습니다.
  - Packet Tracer Simulation 관찰 → `evidence_source: "packet_tracer_simulation"`, `event_id`로 기록
  - 재현 실습망 캡처 → `evidence_source: "wireshark_capture"`, `limitations`에 "별도 Linux 재현 환경, Packet Tracer 내부 트래픽 아님"을 적음
- Packet Tracer 증거는 `evidence_source: "packet_tracer_simulation"`으로 적습니다. 프레임 번호 대신 Event List의 이벤트 식별자를 `event_id`로 씁니다.
- 실제 `.pcapng`는 **허가된 별도 실습 환경**(실제 PC·VM)에서 확보합니다. 그 환경의 패킷을 "Packet Tracer 내부 트래픽"이라고 부르지 않습니다. 두 환경의 구조가 다르면 차이와 재현 가능한 범위를 `packet_analysis.md`에 적습니다.

## 5. 1번·4번에게 받을 정보 (체크리스트)

**1번 Network Architect에게**
- [ ] `network_spec.md`, `topology.png`, `office_network.pkt`
- [ ] 각 PC의 IP·Mask·Gateway·DNS, 연결된 스위치와 포트
- [ ] 서버 IP `<SERVER_IP>`, DNS 서버 IP `<DNS_IP>`, 도메인 `<DOMAIN>`, 웹 포트 `<WEB_PORT>`
- [ ] Trunk 구간과 허용 VLAN, SVI 주소
- [ ] 캡처할 수 있는 위치(어느 PC/VM, 어느 포트)

**4번 Network SRE에게**
- [ ] 익명 `case_id`와 사용자 관점의 증상 (원인·변경한 설정은 받지 않음)
- [ ] 장애 적용 시각과 복구 시각 (캡처 구간을 맞추기 위해)
- [ ] 실제 공유 네트워크를 바꿔야 할 때 조율 방법

**3번 AI Engineer와 합의**
- [ ] `data_contract.md`의 필드 (기본 10개 + 추가 필드)
- [ ] 여러 사례를 담는 방법 (사례별 파일 또는 묶음 파일) — 합의 전까지 단일 객체 유지

## 6. 아직 확인하지 못한 환경 정보

아래 값은 실제 환경을 모르는 상태라 추정하지 않았습니다. 받는 대로 채웁니다.

| 항목 | 값 |
|---|---|
| 실습 OS와 버전 | Windows 11 (최신 업데이트) ✅ |
| Wireshark | 4.6.8 x64, 설치 위치 `E:\Program\Wireshark`, `tshark.exe` 포함 ✅ |
| Packet Tracer 버전 | 9.0.1.0858 ✅ / pcap 내보내기 메뉴 없음 ✅ |
| 캡처 환경 | `lab_env/` 재현 실습망 — Windows WSL2 (Ubuntu, VERSION 2)에서 `check`·`up`·`test all` 정상 동작 확인 ✅ (2026-09-28, Linux 쪽 tshark 4.6.4) |
| 서버 IP / DNS IP / 도메인 / 포트 | 192.168.20.20 / 192.168.20.20 / `www.packetlab.test` / HTTP TCP 80 ✅ (1번 명세) |
| 포트 연결 | SW1: PC1 Fa0/1, PC2 Fa0/2 · SW2: PC3 Fa0/1, PC4 Fa0/2, Server Fa0/3 · SW1 Gi0/1↔MLS1 Gi0/1, SW2 Gi0/1↔MLS1 Gi0/2 ✅ (1번 명세) / Trunk 허용 VLAN ⏳ 명세에 없음 |
| 익명 장애 사례 형식 | ⏳ 4번 작업 완료 후 |
| JSON 필드 합의 | ⏳ 3번 작업 완료 후 |
| PR | 팀 작업이 모두 끝난 뒤 동시에 `main`으로 PR 예정. 리뷰어 미정 |

## 7. 학습 웹앱 (learning_lab/)

팀원이 패킷 흐름을 이해하도록 돕는 **교육용 보조 자료**입니다. 실제 캡처와 분석을 대체하지 않습니다.

**실행 방법**
- 가장 간단한 방법: `learning_lab/index.html`을 브라우저로 엽니다. 설치나 서버가 필요 없습니다. 외부 API, 로그인, 인터넷 연결 없이도 동작합니다.
- 또는 이 폴더에서 `python3 -m http.server 8000`을 실행하고 `http://localhost:8000/learning_lab/`을 엽니다.

**학습 흐름**: 시작하기 → 정상 패킷 따라가기(A·B·C) → 정상·장애 비교 → 설정 변경 실험 → Blind Fault 조사 → 실제 증거 읽기 → JSON 전달 → 이해 확인

| 화면 | 행동 → 화면 변화 → 배우는 것 |
|---|---|
| 정상 A·B·C | 예측 질문에 답함 → "다음 패킷 ▶"을 누를 때마다 토폴로지에 경로가 표시되고 설명이 바뀜 → 같은 네트워크/다른 네트워크/웹 접속에 필요한 주소와 단계 |
| 캐시 조절 | ARP·DNS 캐시를 켬 → 해당 패킷이 사라지고 개수가 줄어듦 → "보이지 않음 ≠ 장애" |
| 정상·장애 비교 | 사례·장애 설정·캡처 지점 선택 → 양쪽을 같은 단계로 넘기고 첫 차이를 표시 → 관찰 사실과 원인 후보의 구분, 한 지점 관찰의 한계 |
| 설정 변경 실험실 | 설정 하나 변경 → 예측 → 실행 → 모델이 실제로 계산한 패킷과 판단 순서가 나옴 → 설정과 패킷의 인과 |
| Blind Fault | 증상만 보고 검사를 고름 → 고른 검사의 결과만 공개됨 → 증거로 후보를 좁히고, 복수 후보를 인정하고, 구분할 검사를 찾는 법 |
| 실제 증거 읽기 | 프로토콜 카드 읽기 → 필터·필드·흔한 오해·기록 예시 → Wireshark에서 무엇을 볼지 |
| JSON 전달 | `packet_summary.json` 불러오기 → 검증 결과와 요약 표시, 증거를 누르면 관련 필드 강조 → 0·null·판단 불가의 차이 |
| 이해 확인 | 내 말로 쓰기 → 모범 설명·점검 항목과 비교 (자동 채점 없음) |

**구현된 사례**
- 정상 흐름 3개: 같은 Subnet ping, 다른 Subnet 서버 ping, 도메인으로 웹 접속
- 비교 사례 7개: 잘못된 Gateway, Access VLAN 오류, Trunk VLAN 누락, SVI Down(Vlan10/Vlan20), DNS(무응답·NXDOMAIN·잘못된 DNS 서버 주소·잘못된 응답), TCP(RST·무응답), Subnet Mask
- 실험실 설정 8개: Gateway, Mask, Access VLAN, Trunk 허용 VLAN, SVI, PC DNS 서버 주소, 서버 DNS 응답, Web 포트
- Blind 사건 7개 (교육용, 실제 과제 사례와 무관)

**모델의 범위와 단순화** — 웹앱의 "단순화 가정 보기"에 전부 적혀 있습니다. 예를 들어 테스트는 PC1에서만 시작합니다. NAT·ACL·STP는 다루지 않습니다. 재전송 횟수는 고정값입니다. 라우터 Unreachable 동작은 가정입니다.

**하지 않는 것** — 브라우저에서 `.pcapng`를 직접 분석하지 않습니다. 실제 캡처는 `summarize_pcap.py`로 JSON을 만든 뒤 웹앱에서 불러옵니다. 웹앱의 Blind 정답은 브라우저 코드에 들어 있으므로 시험 도구가 아닙니다. 실제 SRE 정답은 웹앱과 JSON 어디에도 넣지 않습니다.

## 8. 발표용 짧은 시연 순서 (약 2분)

팀 발표 전체가 5~8분이므로, 2번 파트는 짧게 진행합니다. 웹앱의 "발표용 짧은 경로"에 각 단계의 대사가 있습니다.

1. (30초) 정상 흐름 B — "다른 네트워크로 갈 때 PC는 서버가 아니라 Gateway의 MAC을 찾습니다."
2. (30초) 비교 — "같은 테스트를 장애에서 다시 하면, 처음 달라지는 곳은 ARP입니다. 답이 없고, 찾는 주소가 다릅니다."
3. (30초) 다른 캡처 지점 — "한 지점만 보면 헷갈립니다. 다른 지점을 함께 봐야 원인을 좁힐 수 있습니다."
4. (30초) JSON — "본 것만 숫자로 넘깁니다. 못 본 것은 null과 이유로 적습니다. 정답은 넣지 않습니다."

실제 발표에서는 **실제 캡처(Wireshark 화면)와 실제 `packet_summary.json`을 우선**합니다. 웹앱은 이를 설명하는 보조 자료로 씁니다.

## 9. 팀원 이해 점검 방법 (사용성 확인 절차)

UI를 만들었다고 해서 팀원이 이해했다는 보장은 없습니다. 아래 절차로 **실제 사람이** 확인합니다.

1. 프로젝트를 처음 보는 팀원 1명에게 사전 설명 없이 `learning_lab/index.html`을 엽니다.
2. "정상 패킷 따라가기 B"를 끝까지 진행하게 합니다. 막히는 곳과 질문을 그대로 적습니다.
3. Blind 사건 하나를 조사하게 합니다.
4. 끝난 뒤 1분 동안 이렇게 말하게 합니다. "무엇이 보였고(관찰), 그래서 무엇일 수 있고(해석·후보), 무엇을 더 확인하겠다(추가 확인)."
5. 설명에서 관찰과 추측이 섞였는지, 캡처 지점의 한계를 말했는지 기록합니다.
6. 막힌 곳을 고치고 다른 팀원으로 반복합니다.

**현재 상태: 아직 수행하지 않음.**

## 10. 테스트

```bash
# 웹앱 모델·검증기·콘텐츠 (Node 필요)
node tests/test_learning_lab.js
# 추출 도구·검증기·웹앱↔도구 집계 일치 (tshark, scapy 필요. 합성 캡처는 임시 폴더에만 생성)
python3 -m unittest discover -s tests -v
```

## 11. 과제 준수 점검

| 항목 | 현재 상태 |
|---|---|
| 실제 정상·장애 증거가 있는가 | 정상 ✅ (`normal.pcapng`, `normal_srv.pcapng`, 재현 실습망) / 장애 ⏳ 4번의 익명 사례 대기 |
| 패킷을 먼저 관찰했는가 | 절차에 반영 (장애 분석은 증상과 캡처부터 시작) |
| AI에 정답을 먼저 알려주지 않았는가 | 익명 `case_id`, 원인 암시 파일명 금지, 검증기에서 차단 |
| 내 출력이 다음 담당자의 입력으로 연결되는가 | `data_contract.md` 초안 작성, 3번과 합의 대기 |
| 역할을 침범한 기능이 없는가 | AI 진단·장애 주입·복구·Dashboard 구현 없음. 웹앱의 설정 변경은 교육용 모델 안에서만. `lab_env/`의 토폴로지 값은 1번 명세를 받기 전까지의 임시값(`topology.conf`)이며 1번 명세로 교체 예정 |

## 12. 브랜치·커밋 규칙 (2번 작업)

- 작업 브랜치: `feat/2nd-part`. `main`에는 직접 푸시하지 않습니다. 팀 작업이 모두 끝난 뒤 PR로 합칩니다.
- 커밋 메시지: [Conventional Commits](https://www.conventionalcommits.org/) 형식 `type(scope): 내용`
  - type: `feat`(기능), `fix`(버그 수정), `docs`(문서), `refactor`(동작 변화 없는 구조 변경), `test`(테스트), `chore`(기타)
  - scope: `lab_env`, `learning_lab`, `summarize`, `analysis`, `handoff`, `examples`, `capture` 중 하나
  - 커밋 하나에는 type 하나만 씁니다. 성격이 다른 변경은 나눠서 커밋합니다.
  - 예: `feat(capture): 1번 명세 배치로 정상 Baseline 재캡처`
- 2026-09-29 이전 커밋 중 이 규칙과 다른 메시지는 기록을 다시 쓰지 않고 그대로 둡니다. 일부 커밋이 이미 다른 팀원 브랜치(`jae`)에 병합되어 있어서입니다.
