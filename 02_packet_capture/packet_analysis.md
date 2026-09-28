# packet_analysis.md — 증거 기반 분석 기록

> **상태: Baseline(정상) 기록 완료 (2026-09-28). 장애 사례는 4번의 익명 case_id 대기 중.**
> 장애 사례 블록은 빈 템플릿입니다. 실제 캡처를 한 뒤에만 채웁니다.
> 수행하지 않은 캡처나 분석을 완료된 것처럼 적지 않습니다.
>
> **읽는 사람을 위한 약속**
> - 각 사례는 **실행한 테스트 → 관찰한 패킷 → 정상과 차이 → 가능한 원인 후보 → 필요한 추가 증거** 순서로 씁니다.
> - "관찰한 사실"과 "해석(원인 후보)"은 서로 다른 칸에 씁니다. 사실 칸에는 추측을 넣지 않습니다.
> - "보이지 않았다"는 "이 지점·이 구간에서 보이지 않았다"라는 뜻입니다. "존재하지 않았다"와 구분합니다.

---

## 0. 환경 정보

| 항목 | 값 |
|---|---|
| 네트워크 명세 | 1번 `network_spec.md`의 IP/VLAN 표 (2026-09-28 수령). 스위치 연결·포트·도메인·웹 포트는 명세에 없어 임시값 (`lab_env/topology.conf`) |
| 실습 OS | Windows 11 + WSL2 Ubuntu (커널 `6.18.33.2-microsoft-standard-WSL2`, 캡처 파일 헤더 기준) |
| 캡처 도구 | Dumpcap (Wireshark) 4.6.4 (WSL 안) / 분석: Windows Wireshark 4.6.8, tshark |
| Packet Tracer | 9.0.1.0858 — pcap 저장 기능 없음 |
| 캡처 환경 | **별도 Linux 재현 환경** (`lab_env/`, network namespace). Packet Tracer 내부 트래픽이 아님 |
| Packet Tracer와의 차이 | 장비가 Cisco IOS가 아니라 Linux(bridge, VLAN 인터페이스, dnsmasq, python http.server). 표준 프로토콜 패킷은 같지만 재전송 횟수, ARP 확인 방식, 서버 응답(예: HTTP/1.0, AAAA 거부)은 다를 수 있음 |

---

## 1. Baseline (정상)

| 항목 | 값 |
|---|---|
| 캡처 파일 | `normal.pcapng` (PC1 NIC, 58 frames, SHA-256 `a551969c…2b14b`) / `normal_srv.pcapng` (Server NIC, 31 frames, SHA-256 `7d7487a1…bf11`) |
| 캡처 지점 | PC1 NIC (swa p1, Access VLAN 10) / Server NIC (swb p24, Access VLAN 20) |
| 캡처 시각 | PC1: 2026-09-28 17:50:57.205 ~ 17:51:24.539 (27.3초) / Server: 17:51:09.353 ~ 17:51:24.539 |
| Capture filter | 없음 (전부 저장) |
| 캐시 조건 | `lab.sh down && up`으로 새로 만든 직후 = 모든 ARP 캐시 비어 있음. PC에는 DNS 캐시 없음 |
| 외부 트래픽 | 없음 (두 파일 모두 실습망 주소만 존재) |

| # | 테스트 | 명령 (PC1에서) | 시각 | 결과 | PC1 NIC 프레임 | 관찰 |
|---|---|---|---|---|---|---|
| E1 | 같은 VLAN PC | `ping -c 4 192.168.10.11` | 17:50:57 | 4/4 | 1–10 | ARP로 PC2 MAC을 찾음(1–2) → Echo 4쌍(3–10), TTL 64 |
| E2 | Gateway | `ping -c 4 192.168.10.1` | 17:51:03 | 4/4 | 13–22 | ARP로 Gateway MAC(`d2:50:36:6e:e3:fa`)을 찾음(13–14) → Echo 4쌍, TTL 64 |
| E3 | 다른 VLAN PC | `ping -c 4 192.168.20.10` | 17:51:09 | 4/4 | 25–32 | **ARP 없음**. 도착 MAC = Gateway, 도착 IP = PC3. Reply TTL 63 |
| E4 | 서버 IP | `ping -c 4 192.168.20.20` | 17:51:15 | 4/4 | 33–40 | ARP 없음. Echo 4쌍, Reply TTL 63 |
| E5 | DNS | `dig web.packetlab.example A` | 17:51:21 | NOERROR, A = 192.168.20.20 | 41–42 | Query → `192.168.20.20`, Response rcode 0 |
| E6 | Web | `curl http://web.packetlab.example/` | 17:51:24 | HTTP 200 | 43–58 | DNS A·AAAA 질의(43–46) → SYN/SYN-ACK/ACK(47–49) → GET(50) → 200 OK(52–54) → FIN(56–58) |

### 1-1. 관찰한 사실 (정상 상태에서 이미 보이는 것)

1. **E3·E4에는 ARP가 없다.** E2에서 Gateway의 MAC을 이미 알아냈기 때문이다(프레임 13–14). 캐시가 있으면 ARP는 보이지 않는다. 장애 분석에서 "ARP가 없다"를 이상으로 보면 안 되는 이유다.
2. **라우터를 지나면 TTL이 1 줄고 MAC이 바뀐다. IP는 그대로다.**
   - 같은 Echo Request를 두 지점에서 비교했다. PC1 NIC 프레임 33은 출발 MAC이 PC1 `ae:92:29:32:74:75`, 도착 MAC이 Gateway `d2:50:36:6e:e3:fa`, TTL 64다.
   - Server NIC 프레임 4는 출발 MAC이 Gateway `d2:50:36:6e:e3:fa`, 도착 MAC이 Server `1e:0c:f6:09:98:5b`, TTL 63이다.
   - IP는 두 지점 모두 `192.168.10.10 → 192.168.20.20`이다(NAT 없음).
3. **정상 상태에도 DNS 오류 응답이 1건 있다.** E6에서 curl이 A와 AAAA(IPv6 주소)를 함께 물었다(43–44). AAAA 질의에는 `Refused`(rcode 5)가 왔다(46). A 질의는 정상 응답했고(45) 웹 접속도 성공했다. 따라서 **장애 캡처에서 rcode 5가 보여도 곧바로 DNS 장애로 볼 수 없다.** 이 1건은 정상 기준선에 포함된다.
4. **요청하지 않은 ARP가 있다.** 프레임 11–12는 PC2가, 23–24는 Gateway가 PC1의 MAC을 확인하는 ARP다. 둘 다 브로드캐스트가 아니라 PC1 MAC을 직접 향한 unicast다. (해석: Linux가 이웃 장비가 아직 살아 있는지 확인하는 동작으로 보인다. 장애와 무관.)
5. **Server NIC에는 PC1↔PC2(같은 VLAN 10) 통신이 하나도 없다(0 frames).** 반면 L3SW가 PC3을 찾는 ARP 브로드캐스트(Server 프레임 1, "Who has 192.168.20.10?")는 보인다. VLAN 20의 브로드캐스트는 Server까지 오고, VLAN 10의 통신은 오지 않는다. 캡처 지점이 보여 주는 범위를 확인한 것이다.
6. 웹 서버 응답은 `HTTP/1.0 200 OK`다. 재현 환경의 웹 서버(python http.server)의 특성이다.

### 1-2. 집계 검증 (도구 ↔ Wireshark display filter)

`summarize_pcap.py extract normal.pcapng --source-ip 192.168.10.10 --destination-ip 192.168.20.20 --next-hop 192.168.10.1` (캡처 전체 구간)

| 필드 | summarize_pcap.py | Wireshark filter 결과 | 프레임 | 일치 |
|---|---|---|---|---|
| arp_request_count | 1 | 1 | 13 | ✅ |
| arp_reply_count | 1 | 1 | 14 | ✅ |
| icmp_request_count | 4 | 4 | 33, 35, 37, 39 | ✅ |
| icmp_reply_count | 4 | 4 | 34, 36, 38, 40 | ✅ |
| dns_query_count | 3 | 3 | 41, 43, 44 | ✅ |
| dns_response_count | 3 | 3 | 42, 45, 46 (46 = rcode 5) | ✅ |
| tcp_syn_count | 1 | 1 | 47 | ✅ |
| tcp_syn_ack_count | 1 | 1 | 48 | ✅ |
| tcp_rst_count | 0 | 0 | — | ✅ |

- 이 집계는 목적지를 서버(`192.168.20.20`)로 둔 기준입니다. 그래서 E1(PC2), E2(Gateway), E3(PC3)의 ICMP는 세지 않습니다.
- Wireshark 필터는 `summarize_pcap.py filters --source-ip 192.168.10.10 --destination-ip 192.168.20.20 --next-hop 192.168.10.1`의 출력과 같습니다.

## 2. 장애 사례 템플릿

> 사례마다 이 블록을 복사해서 씁니다. 제목과 파일명에 원인을 쓰지 않습니다.

### 사례 `<case_id>`

**2-1. 받은 정보**
- 증상 (4번이 준 그대로): `<증상>`
- 받은 시각: `<시각>`
- 원인·변경 설정: 받지 않음 (분석 후 별도 대조)

**2-2. 환경과 캡처**
| 항목 | 값 |
|---|---|
| 캡처 출처 | `wireshark_capture` / `packet_tracer_simulation` |
| 캡처 파일 | `fault_<case_id>.pcapng` |
| 캡처 지점 | |
| 추가 캡처 지점 | `<없으면 "없음">` |
| 관찰 구간 | `<시작> ~ <끝>` (캡처 기준 `<초> ~ <초>`) |
| 필터 | |
| 캐시 조건 | Baseline과 같음 / 다름(이유) |

**2-3. 실행한 테스트와 관찰한 패킷 (사실만)**
| 테스트 | 시각 | 프레임 번호 | 관찰한 것 |
|---|---|---|---|
| | | | |

**2-4. 정상 대비 차이**
- 첫 차이: 정상에서는 `<무엇>`이 보였다. 장애에서는 `<무엇>`이 보였다 / 보이지 않았다. (프레임 `<번호>`)
- 그 밖의 차이:

**2-5. 원인 후보 (해석 — 확정 아님)**
| 후보 | 이 후보를 지지하는 관찰 | 이 후보와 맞지 않는 관찰 |
|---|---|---|
| | | |

**2-6. 배제하지 못한 가능성**
- `<예: 한 지점만 캡처해서 서버 쪽 도달 여부를 모름>`

**2-7. 추가 확인 (후보를 구분할 검사)**
| 검사 | 후보 A라면 | 후보 B라면 | 결과 |
|---|---|---|---|
| | | | |

**2-8. 집계 검증 (도구 ↔ Wireshark 수동)**
| 필드 | summarize_pcap.py | Wireshark Displayed | 일치 |
|---|---|---|---|
| arp_request_count | | | |
| arp_reply_count | | | |
| icmp_request_count | | | |
| icmp_reply_count | | | |
| dns_query_count | | | |
| tcp_syn_count | | | |

**2-9. 복구 후 증거**
| 항목 | 값 |
|---|---|
| 복구 캡처 | `recovered_<case_id>.pcapng` |
| 같은 테스트 반복 결과 | |
| Baseline / Fault / Recovered 비교 | |

**2-10. 다음 담당자에게 전달한 내용**
- 3번에게: `packet_summary.json` (커밋 `<hash>`), 특히 `<주의할 null·한계>`
- 4번에게: `<복구 검증에 쓴 패킷 근거>`

**2-11. 분석 후 정답 대조 (분석을 마친 뒤에만 작성)**
- 4번의 실제 원인: `<분석 제출 후 받음>`
- 내 원인 후보와의 관계:
- 이 증거가 팀의 복구 검증에 어떻게 기여했는가:

---

## 3. Baseline / Fault / Recovered 요약

| case_id | 테스트 | Baseline | Fault | Recovered | 판단 |
|---|---|---|---|---|---|
| | | | | | |
