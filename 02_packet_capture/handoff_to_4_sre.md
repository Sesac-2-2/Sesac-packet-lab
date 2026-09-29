# 4번(Network SRE)에게 — 2번이 장애 캡처를 위해 필요한 것

> **이 문서를 읽으면 알 수 있는 것**
> 2번(Packet Analyst)이 장애 패킷을 캡처하려면 4번에게 **무엇을, 어떤 형식으로** 받아야 하는지 정리했습니다. 또 **실제 캡처는 Packet Tracer가 아니라 별도의 Linux 재현 실습망에서 한다**는 점과, 그 때문에 **4번과 함께 정해야 할 것**이 무엇인지도 적었습니다.
>
> 작성: 2번 Packet Analyst · 작성일: 2026-09-29 · 브랜치 `feat/2nd-part`
> 이 문서는 4번의 장애 시나리오를 정하지 않습니다. **어떤 장애를 몇 개, 어떤 순서로 낼지는 모두 4번이 정합니다.** 2번은 캡처에 필요한 입력과 환경 정보만 드립니다.

---

## 0. 한 장 요약

| 항목 | 내용 |
|---|---|
| 2번이 4번에게 받고 싶은 것 | 장애 사례마다 **익명 `case_id` + 사용자 입장의 증상** (원인은 비공개) |
| 가장 중요한 사실 | 실제 `.pcapng` 캡처는 **WSL2 안의 Linux 재현 실습망**(`02_packet_capture/lab_env/`)에서 합니다. Packet Tracer에 장애를 넣으면 2번은 그 패킷을 캡처할 수 없습니다 |
| 4번과 함께 정할 것 | 이 재현 실습망에 **누가, 어떻게 장애를 적용할지** (Blind 분석이 유지되는 방식으로) |
| 2번이 4번에게 넘기는 것 | 사례별 캡처 파일, `packet_summary_<case_id>.json`, 분석 기록, 복구 후 비교 결과 |
| 지금 준비된 것 | 정상 Baseline 캡처 완료 (`normal.pcapng`, `normal_srv.pcapng`, 1번 명세 배치) |

---

## 1. 왜 이 문서를 보내나

### 1-1. Packet Tracer만으로는 실제 캡처 파일을 만들 수 없습니다

- 과제는 정상·장애 `.pcapng` 파일을 요구합니다. 과제 HTML의 역할 분담에는 `normal.pcapng`, `fault_*.pcapng`가 2번 산출물로 나옵니다.
- 그런데 사용하는 **Packet Tracer 9.0.1.0858에는 Simulation 결과를 `.pcap`/`.pcapng`로 저장하는 메뉴가 없습니다.** 2번이 직접 확인했습니다.
- 또 내 PC에서 Wireshark를 켜도 **Packet Tracer 안의 가상 PC·스위치 사이 트래픽은 잡히지 않습니다.** 그 트래픽은 PC의 실제 네트워크 카드를 지나지 않기 때문입니다.

### 1-2. 그래서 같은 구조를 Linux 안에 따로 만들었습니다

- 1번의 `network_spec.md`와 `packet_analyst_handoff.md`에 적힌 구조(주소, VLAN, 포트 연결, 도메인)를 그대로 Linux 안에 재현했습니다.
- 이 환경을 **재현 실습망**이라고 부릅니다. Windows 11의 WSL2(Ubuntu) 안에서 동작합니다.
- 이 환경에서 캡처한 패킷은 문서와 JSON에 **"별도 Linux 재현 환경에서 캡처. Packet Tracer 내부 트래픽 아님"**이라고 표시합니다.

### 1-3. 그래서 4번과 맞춰야 할 것이 생겼습니다

- 4번이 Packet Tracer 파일에만 장애를 넣으면, 2번은 그 장애의 `.pcapng`를 만들 수 없습니다.
- 캡처가 필요한 장애는 **재현 실습망에도 같은 성격의 장애가 적용되어야** 합니다.
- Packet Tracer에서의 장애 재현(Simulation 관찰, 설정 화면)은 그대로 4번의 작업으로 두면 됩니다. 두 환경을 모두 쓰는 것이 과제 흐름과 맞습니다. 과제 HTML도 "Packet Tracer + Wireshark 증거 제시"를 발표 흐름에 넣고 있습니다.

---

## 2. 4번에게 요청하는 것

### 2-1. 장애 사례마다 알려 주었으면 하는 것

| 항목 | 예시 | 필수 | 설명 |
|---|---|---|---|
| `case_id` | `FAULT-01` | ✅ | 익명 ID. 3절 규칙을 따름 |
| 증상 | "PC1에서 웹페이지가 안 열린다. 같은 팀 PC2와는 파일 공유가 된다." | ✅ | **사용자가 말할 법한 현상만.** 원인이나 바꾼 설정은 쓰지 않음 |
| 증상이 보이는 PC | PC1 | ✅ | 2번이 테스트를 시작할 PC. 지금 재현 실습망의 테스트는 PC1에서 시작합니다(7절) |
| 장애 적용 시각 | 2026-09-30 14:00 | ✅ | 2번이 캡처를 시작할 시점을 맞추기 위해 |
| 복구 완료 시각 | 2026-09-30 14:40 | 복구 후 | 복구 후 캡처(`recovered_<case_id>.pcapng`)를 위해 |

**보내지 말아 주었으면 하는 것 (분석이 끝나기 전까지)**
- 실제 원인, 바꾼 설정, 사용한 명령
- 원인을 떠올리게 하는 힌트 (예: "Gateway 쪽 문제 같다", "DNS 서버를 건드렸다")
- 원인이 드러나는 파일명 (예: `fault_gateway.pcapng`)

### 2-2. 사례 요청 형식 (복사해서 쓰시면 됩니다)

```markdown
### FAULT-01
- 증상: 
- 증상이 보이는 PC: PC1
- 장애 적용 시각: 
- 비고: (재현 실습망 적용 여부 등)
```

---

## 3. `case_id` 규칙

- 형식: `FAULT-01`, `FAULT-02` … 처럼 **번호만** 씁니다.
- 원인을 암시하는 단어는 쓰지 않습니다. 2번의 검증 도구(`summarize_pcap.py validate`)는 `case_id`나 캡처 파일명에 아래 단어가 있으면 **입력을 거부합니다.**
  - `gateway`, `gw`, `vlan`, `trunk`, `svi`, `dns`, `mask`, `subnet`, `port`, `web`, `http`, `tcp`, `arp`, `icmp`
- 이유: 과제 HTML은 "AI에게 장애 이름을 먼저 알려준 뒤 설명만 생성하는 경우"를 피해야 할 형태로 적고 있습니다. `case_id`와 파일명도 3번 AI에 들어가는 입력의 일부이기 때문입니다.
- 참고: 과제 HTML 표의 `F01`~`F06`은 "권장 장애 시나리오"의 예시 번호입니다. 팀의 실제 사례 번호와 연결된 정답표가 아닙니다. 실제 번호와 사례의 대응은 4번이 정합니다.

---

## 4. 장애를 재현 실습망에 적용하는 방식 — 함께 정해야 합니다

재현 실습망은 **사용자(2번) PC의 WSL2 안**에 있습니다. 그래서 장애를 적용하는 사람과 방식에 따라 Blind 분석이 유지되는지가 달라집니다.

| 방식 | 어떻게 | 장점 | 단점 |
|---|---|---|---|
| **A. 4번이 2번 PC에서 직접 적용** | 4번이 2번 PC 앞에서(또는 화면 공유 원격 제어로) 설정을 바꾼다. 2번은 그동안 화면을 보지 않는다 | Blind가 가장 확실하게 유지됨. 설정이 정확함 | 같은 시간에 모여야 함 |
| **B. 4번이 자기 PC에 같은 재현 실습망을 만들어 적용** | 4번이 저장소의 `lab_env/`를 자기 WSL2/Linux에서 실행한다. 장애를 적용한 뒤 2번이 지정한 명령으로 캡처해 **캡처 파일만** 2번에게 넘긴다 | 따로 작업 가능. Blind 유지 | 4번 PC에 WSL2(또는 Ubuntu VM)와 설치 작업이 필요함. 캡처를 4번이 실행하게 됨 |
| **C. 4번이 적용 명령을 파일로 보내고 2번이 실행** | 4번이 장애 적용 명령을 스크립트로 만들어 보내면, 2번은 내용을 보지 않고 실행한다 | 따로 작업 가능 | **Blind가 약해짐.** 2번이 파일을 열어 보거나 실행 출력에서 원인을 알 수 있음. 권장하지 않음 |

- 2번의 제안은 **A**입니다. 다만 결정은 4번과 팀이 합니다.
- B를 고르면 2번이 캡처 명령과 절차를 따로 정리해 드리겠습니다.
- 어느 방식이든, **장애를 적용한 뒤 2번에게 "적용 완료"만 알려 주면 됩니다.**

### 4-1. Blind를 지키기 위해 2번이 스스로 지키는 것

- 분석 결과를 제출하기 전에는 `sudo ./lab.sh status`를 **실행하지 않습니다.** 이 명령은 PC 설정, 스위치 VLAN, Trunk, SVI, 서버 서비스 상태를 모두 보여 주므로 원인이 바로 드러납니다.
- 과제 흐름대로 패킷을 먼저 관찰합니다. 장비 상태 확인은 남은 원인 후보를 구분하는 단계에서 필요할 때만 합니다. 이때는 4번에게 먼저 알립니다.
- 분석을 제출한 뒤에만 4번에게 실제 원인을 받아 대조합니다. 대조 결과는 `packet_analysis.md`의 "분석 후 정답 대조" 칸에 **따로** 기록합니다. `packet_summary_<case_id>.json`에는 정답을 넣지 않습니다.

---

## 5. 한 사례의 진행 순서 (타임라인)

```
[4번] 장애 적용 (방식 A/B 중 합의한 것)
   │  "FAULT-01 적용 완료, 증상: …" 전달
   ▼
[2번] ARP 캐시 비우기 → 캡처 시작 → 테스트 6종 실행 → 캡처 종료
   │  fault_FAULT-01.pcapng (+ 필요하면 다른 지점 캡처)
   ▼
[2번] 정상 Baseline과 비교 → 관찰 → 원인 후보 → 추가 확인
   │  packet_analysis.md 기록, packet_summary_FAULT-01.json 생성
   │  → 3번에게 JSON 전달 (3번이 diagnosis.json 생성)
   ▼
[2번] 분석 제출 → [4번] 실제 원인 공개 → 2번이 대조 기록
   ▼
[4번] 복구 (복구 설정·기록은 4번 담당: recovery_log.md)
   │  "FAULT-01 복구 완료" 전달
   ▼
[2번] 같은 테스트 반복 캡처 → recovered_FAULT-01.pcapng
   │  Baseline / Fault / Recovered 비교 결과를 4번에게 전달
   ▼
[4번] 복구 검증·Incident Report에 활용
```

- 한 번에 **장애 하나만** 걸려 있어야 비교가 정확합니다. 다음 사례로 넘어가기 전에 이전 장애가 복구되었는지 알려 주세요.
- 재현 실습망은 `sudo ./lab.sh down && sudo ./lab.sh up`을 실행하면 **1번 명세 기준 정상 상태로 새로 만들어집니다.** 복구를 확인하는 수단으로 쓸 수 있습니다. 다만 복구 작업과 기록 자체는 4번 담당입니다.

---

## 6. 재현 실습망의 구조 (1번 명세 기준)

```
                       MLS1 (L3 스위치, SVI: Vlan10 192.168.10.1 / Vlan20 192.168.20.1)
                     Gi0/1 │ Trunk                      Gi0/2 │ Trunk
                     Gi0/1 │                            Gi0/1 │
                          SW1                                SW2
             Fa0/1 │ VLAN10   Fa0/2 │ VLAN10     Fa0/1 │ VLAN20  Fa0/2 │ VLAN20  Fa0/3 │ VLAN20
                  PC1            PC2                 PC3           PC4            Server (DNS + Web)
           192.168.10.10  192.168.10.11       192.168.20.10  192.168.20.11   192.168.20.20
```

| 항목 | 값 | 출처 |
|---|---|---|
| VLAN | 10 = DEV_TEAM, 20 = OPS_TEAM | 1번 명세 |
| Gateway | VLAN10 = 192.168.10.1, VLAN20 = 192.168.20.1 (MLS1 SVI) | 1번 명세 |
| Server | 192.168.20.20, DNS 서버 겸 Web 서버 | 1번 명세 |
| 도메인 / 웹 | `www.packetlab.test` / HTTP TCP 80 | 1번 명세 |
| Trunk 허용 VLAN | 두 Trunk 모두 10, 20 | ⚠ **임시값** (1번 명세에 없음, 1번에게 확인 중) |

**4번이 장애를 설계할 때 알아 두면 좋은 점 (사실 정보)**
- SW1에는 VLAN 10 장비만, SW2에는 VLAN 20 장비만 있습니다. 그래서 **PC1↔PC2 통신은 SW1 안에서 끝나고 Trunk와 MLS1을 지나지 않습니다.**
- PC에는 DNS 캐시가 없습니다. ARP 캐시는 2번이 캡처 전에 비웁니다.

---

## 7. 2번이 실행하는 테스트와 캡처 지점

장애마다 **정상 Baseline과 똑같은 테스트**를 반복합니다. 그래야 정상과 장애를 비교할 수 있습니다. 4번이 장애를 설계할 때 "이 테스트로 증상이 보이는가"를 판단하는 데 참고하세요.

| # | 테스트 (PC1에서 실행) | 확인하는 것 |
|---|---|---|
| 1 | `ping 192.168.10.11` (PC2) | 같은 VLAN·같은 스위치 통신 |
| 2 | `ping 192.168.10.1` (Gateway) | PC1 ↔ MLS1 Vlan10 SVI |
| 3 | `ping 192.168.20.10` (PC3) | 다른 VLAN 통신 (Inter-VLAN 라우팅) |
| 4 | `ping 192.168.20.20` (Server) | 서버까지 IP 통신 |
| 5 | `dig www.packetlab.test A` | DNS 이름 조회 |
| 6 | `curl http://www.packetlab.test/` | TCP 연결 + HTTP 응답 |

| 캡처 지점 이름 | 위치 | 비고 |
|---|---|---|
| `pc1` | PC1 NIC (SW1 Fa0/1) | 기본 캡처 지점 |
| `pc2`, `pc3`, `pc4` | 각 PC NIC | 필요할 때 추가 |
| `srv` | Server NIC (SW2 Fa0/3) | "서버까지 도착했는가"를 확인할 때 |
| `trunk-sw1`, `trunk-sw2` | MLS1 ↔ SW1 / SW2 Trunk | 802.1Q VLAN 태그가 보이는 지점 |

- 지금 테스트는 **PC1에서만** 시작합니다. 다른 PC에서 증상이 보이는 장애라면 2-1절의 "증상이 보이는 PC"에 적어 주세요. 2번이 테스트 시작 위치를 추가하겠습니다.
- 여러 지점을 동시에 캡처할 수 있습니다. 한 지점만 보면 원인이 여러 개로 남는 경우가 있기 때문입니다.

---

## 8. 참고: 재현 실습망에서 설정이 있는 곳

4번이 방식 A나 B로 장애를 적용할 때 필요한 **환경 정보**입니다. Packet Tracer(Cisco IOS)의 설정이 이 환경에서는 어디에 있는지 대응시킨 것입니다. **어떤 설정을 바꿀지는 4번이 정합니다.**

모든 장비는 Linux의 **network namespace**(서로 분리된 가상 장비) 안에 있습니다. 명령은 `sudo ip netns exec <장비> <명령>` 또는 `sudo ip -n <장비> <명령>` 형식입니다. 장비 이름은 `pc1`, `pc2`, `pc3`, `pc4`, `srv`, `sw1`, `sw2`, `mls1`입니다.

| Packet Tracer / IOS에서 | 재현 실습망에서 확인하는 명령 | 설정이 있는 곳 |
|---|---|---|
| PC의 IP·Mask (`ipconfig`) | `sudo ip -n pc1 -br addr` | 호스트 `eth0`의 주소 |
| PC의 Default Gateway | `sudo ip -n pc1 route` | 호스트의 `default via` 경로 |
| PC의 DNS 서버 | `cat /etc/netns/pc1/resolv.conf` | 호스트별 `resolv.conf` |
| `show vlan brief` (Access VLAN) | `sudo ip netns exec sw1 bridge vlan show` | 스위치 포트의 PVID |
| `show interfaces trunk` | `sudo ip netns exec mls1 bridge vlan show` | Trunk 포트의 허용 VLAN 목록 |
| `show ip interface brief` (SVI) | `sudo ip -n mls1 -br addr show type vlan` | MLS1의 `vlan10`, `vlan20` 인터페이스 |
| 서버 서비스 상태 | `sudo ip netns exec srv ss -ltnu` | DNS: `dnsmasq` / Web: `python3 -m http.server 80` |

- 설정을 바꾸는 명령은 Linux `ip`, `bridge` 명령의 일반 사용법을 따릅니다. 4번이 방식 A/B를 정하면, 필요할 때 2번이 이 환경의 구조를 더 설명하겠습니다.
- `sudo ./lab.sh down && sudo ./lab.sh up`은 모든 설정을 1번 명세 기준 정상 상태로 되돌립니다.

---

## 9. 이 환경의 한계 — 증상이 Packet Tracer와 다를 수 있는 점

장비가 Cisco가 아니라 Linux입니다. 패킷(ARP, ICMP, DNS, TCP, HTTP)은 같은 표준 규약을 따르지만, 아래 세부 동작은 Packet Tracer와 다를 수 있습니다. Incident Report에 Packet Tracer와 재현 실습망의 증상을 함께 적을 때 참고해 주세요.

| 항목 | 재현 실습망에서 확인된 동작 | Packet Tracer와의 차이 가능성 |
|---|---|---|
| ping | Linux `ping`(4회, 1초 간격) | Windows/PT PC는 메시지 형식과 재시도 방식이 다름 |
| 웹 서버 응답 | `HTTP/1.0 200 OK` (python http.server) | PT 서버는 형식이 다를 수 있음 |
| 정상 상태의 DNS | curl이 A와 AAAA(IPv6)를 함께 묻고, **AAAA에는 `Refused`(rcode 5)가 옴**. A 응답은 정상이며 웹 접속도 성공 | **정상 상태에서도 오류 응답 1건이 보입니다.** 장애 판단에서 제외해야 함 |
| 라우터가 목적지를 모를 때 | Linux 라우팅 동작을 따름 (ICMP Unreachable을 보낼 수 있음) | Cisco 장비와 다를 수 있음 |
| 서비스가 멈춘 포트 | Linux는 보통 TCP면 RST, UDP면 ICMP Port Unreachable로 응답 | 방화벽이나 장비 설정에 따라 무응답일 수도 있음 |

---

## 10. 2번이 4번에게 넘기는 것

| 파일 | 내용 | 시점 |
|---|---|---|
| `fault_<case_id>.pcapng` | 장애 상태 실제 캡처 | 장애 캡처 후 |
| `recovered_<case_id>.pcapng` | 복구 후 같은 테스트 캡처 | 복구 후 |
| `packet_summary_<case_id>.json` | 관찰한 숫자와 증거만 담은 요약 (3번 입력) | 분석 후 |
| `packet_analysis.md`의 사례 절 | 테스트 → 관찰 → 정상과 차이 → 원인 후보 → 추가 확인 → 복구 후 증거 | 분석 후·복구 후 |
| Baseline / Fault / Recovered 비교표 | 같은 테스트의 정상·장애·복구 상태 비교 | 복구 후 |

- 과제 HTML의 7단계 "복구 및 검증"에 나오는 "정상 패킷과 비교", "장애 후 ping/DNS/TCP 재검증"의 패킷 근거로 쓸 수 있습니다.
- 과제 HTML은 "모든 개인 결과물이 팀 Pipeline에서 사용되었다"를 마무리 기준으로 두고 있습니다. 2번의 비교 결과가 4번의 `recovery_log.md`, Incident Report에서 쓰이면 이 기준을 채웁니다.

---

## 11. 과제 HTML이 4번에게 요구하는 것 (원문 요약 — 2번의 설계가 아님)

맞춰 보시라고 과제 HTML의 내용만 옮깁니다. 진행 방식은 4번이 정합니다.

- 4번의 할 일: 장애 시나리오 설계, **원인을 숨긴 장애 상황 준비**, 복구 전/후 검증, Incident Report, 최종 Dashboard
- 산출물 예시: `incident_cases.md`, `recovery_log.md`, `dashboard.html`
- 3단계: "4번 담당자가 네트워크 설정의 일부를 변경해 장애 상황을 만든다. 다른 조원들은 원인을 바로 전달받기보다, 증상과 패킷을 관찰하면서 가능한 원인을 하나씩 좁혀본다."
- 과제 HTML이 예로 든 장애: Default Gateway 오류, 잘못된 VLAN 할당, Trunk에서 특정 VLAN 누락, DNS Server 설정 오류, Subnet Mask 오류, Server TCP Port 서비스 중단. 권장 시나리오 표에는 SVI Down도 있습니다. **이 중 무엇을 실제 사례로 쓸지는 4번이 정합니다.**
- 발표 흐름(5~8분): "1분 — Blind Fault 발생", "2분 — Packet Tracer + Wireshark 증거 제시", "1분 — 수정/복구", "1분 — 복구 후 패킷 비교 및 회고"

---

## 12. 4번에게 답을 부탁드리는 질문

1. 재현 실습망에 장애를 적용하는 방식을 **A, B, C 중 무엇으로** 할까요? (2번 제안: A)
2. 장애 사례는 **몇 개**이고, 첫 사례는 **언제** 진행할 수 있나요?
3. 증상이 **PC1이 아닌 다른 PC**에서 보이는 사례가 있나요? 있다면 2번이 테스트 시작 위치를 추가하겠습니다.
4. Packet Tracer에서도 같은 장애를 재현하나요? 그렇다면 2번은 Packet Tracer Simulation 관찰도 따로 기록하겠습니다(`evidence_source: packet_tracer_simulation`).
5. 복구 후 비교 결과를 어떤 형식으로 받으면 `recovery_log.md`와 Incident Report에 쓰기 편한가요? (표, 스크린샷, 캡처 파일 등)
6. 발표 때 보여 줄 **대표 사례**를 정해 주세요. 2번은 그 사례를 과제 HTML의 파일명 `packet_summary.json`으로도 둡니다.

---

## 13. 파일 위치 (브랜치 `feat/2nd-part`)

| 파일 | 내용 |
|---|---|
| `02_packet_capture/lab_env/README.md` | 재현 실습망 설치·실행 방법 전체 |
| `02_packet_capture/lab_env/lab.sh` | 실습망 만들기·테스트·캡처 스크립트 (장애 적용 기능은 없음 — 4번 담당) |
| `02_packet_capture/lab_env/topology.conf` | 주소·VLAN·포트 배치 (1번 명세 반영) |
| `02_packet_capture/normal.pcapng`, `normal_srv.pcapng` | 정상 Baseline 실제 캡처 |
| `02_packet_capture/packet_analysis.md` | Baseline 분석 기록, 장애 사례 기록 양식 |
| `02_packet_capture/capture_checklist.md` | 캡처 전후 체크리스트 |
| `02_packet_capture/data_contract.md` | `packet_summary.json` 필드 정의 |
| `02_packet_capture/handoff_to_3_ai_engineer.md` | 3번에게 보낸 문서 (참고) |
