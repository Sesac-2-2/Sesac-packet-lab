# Wireshark 필터 가이드

> **이 문서의 목적** — 어떤 필터로, 어떤 필드를 보고, 그 필드가 무엇을 말해 주고 **무엇은 말해 주지 않는지** 정리합니다.
> 필터는 "보이게 하는 도구"일 뿐입니다. 필터에 안 보인다고 패킷이 없었다는 뜻은 아닙니다.

---

## 1. Display filter와 Capture filter

| | Display filter (보기 필터) | Capture filter (저장 필터) |
|---|---|---|
| 언제 | 캡처한 뒤, 볼 때 | 캡처하기 전, 저장할 때 |
| 문법 | Wireshark 필드 문법 (`ip.addr == 10.0.0.1`) | BPF 문법 (`host 10.0.0.1`) |
| 되돌릴 수 있나 | 예. 원본은 그대로 | 아니요. 저장 안 된 패킷은 영영 없음 |
| JSON 기록 | 필터를 `analysis_scope.display_filter`에 적음 | 저장 안 된 항목은 count를 **null**로, 이유는 `null_reasons`에 |

**기본 방침**: Capture filter는 쓰지 않고 전부 저장합니다. 볼 때 Display filter로 좁힙니다.

## 2. 과제 권장 필터 6개 — 용도와 한계

| 필터 | 용도 | 확인할 필드 | 한계 |
|---|---|---|---|
| `arp` | MAC을 찾는 과정 보기 | `arp.opcode`(1 요청/2 응답), `arp.dst.proto_ipv4`(찾는 IP) | Reply가 없어도 **원인은 여러 개**. 캐시가 있으면 아예 안 보임. 브로드캐스트는 같은 VLAN 안에서만 보임 |
| `icmp` | ping 요청·응답 | `icmp.type`(8 Echo Request, 0 Echo Reply, 3 Unreachable), `ip.src/ip.dst` | type 3 같은 다른 ICMP도 함께 나옴 → Echo와 나눠 세야 함. 방화벽이 ICMP만 막을 수 있음 |
| `dns` | 이름 → IP 조회 | `dns.flags.response`, `dns.flags.rcode`, `dns.qry.name`, `dns.a`, 질의의 `ip.dst` | 캐시가 있으면 안 보임. DoH·DoT(암호화 DNS)는 `dns` 필터에 안 잡힘 |
| `tcp` | TCP 전체 | `tcp.flags.*`, `tcp.port`, `tcp.analysis.retransmission` | 양이 많음 → 포트·주소로 좁혀서 봄 |
| `tcp.flags.syn == 1` | 연결 시도 보기 | `tcp.flags.ack` | **SYN-ACK도 포함됨**. 초기 SYN만 세려면 아래 3절 필터를 씀 |
| `http` | 웹 요청·응답 내용 | `http.request.method`, `http.response.code` | HTTPS는 암호화되어 **보이지 않음**. 기본 포트가 아니면 인식 못 할 수 있음 |

## 3. 정확히 세기 위한 필터 (packet_summary.json 기준)

아래 필터는 `data_contract.md`의 정의와 같습니다. `summarize_pcap.py filters` 명령이 주소를 채워서 출력해 줍니다.

| JSON 필드 | Display filter |
|---|---|
| `arp_request_count` | `arp.opcode == 1 && arp.src.proto_ipv4 == <SRC> && (arp.dst.proto_ipv4 == <DST> \|\| arp.dst.proto_ipv4 == <NEXT_HOP>)` |
| `arp_reply_count` | `arp.opcode == 2 && arp.dst.proto_ipv4 == <SRC> && (arp.src.proto_ipv4 == <DST> \|\| arp.src.proto_ipv4 == <NEXT_HOP>)` |
| `icmp_request_count` | `icmp.type == 8 && ip.src == <SRC> && ip.dst == <DST>` |
| `icmp_reply_count` | `icmp.type == 0 && ip.src == <DST> && ip.dst == <SRC>` |
| `dns_query_count` | `dns.flags.response == 0 && ip.src == <SRC>` |
| `dns_response_count` | `dns.flags.response == 1 && ip.dst == <SRC>` |
| `tcp_syn_count` | `tcp.flags.syn == 1 && tcp.flags.ack == 0 && ip.src == <SRC> && ip.dst == <DST>` |
| `tcp_syn_ack_count` | `tcp.flags.syn == 1 && tcp.flags.ack == 1 && ip.src == <DST> && ip.dst == <SRC>` |
| `tcp_rst_count` | `tcp.flags.reset == 1 && ip.src == <DST> && ip.dst == <SRC>` |

**수동 검증 방법**
1. Wireshark에서 `View > Time Display Format`을 "Seconds Since Beginning of Capture"로 둡니다.
2. 위 필터에 `&& frame.time_relative >= <START> && frame.time_relative <= <END>`를 붙입니다.
3. 창 아래 상태줄의 **Displayed** 숫자를 JSON 값과 비교합니다.
4. 결과(일치/불일치, 불일치 이유)를 `packet_analysis.md`의 "집계 검증" 칸에 적습니다.

## 4. 상황별 추가 필터

| 알고 싶은 것 | 필터 |
|---|---|
| 특정 PC와 관련된 모든 것 | `ip.addr == <IP> \|\| arp.src.proto_ipv4 == <IP> \|\| arp.dst.proto_ipv4 == <IP>` |
| ARP가 누구를 찾는지 한눈에 | `arp.opcode == 1` → Info 열 "Who has ...?" |
| 응답 없는 DNS | `dns.flags.response == 0` 후 `dns.response_in` 없는 질의 확인 (Wireshark가 짝을 찾으면 표시) |
| DNS 오류 응답만 | `dns.flags.rcode != 0` |
| TCP 재전송 | `tcp.analysis.retransmission` |
| 연결 거절 | `tcp.flags.reset == 1` |
| ICMP 도달 불가 | `icmp.type == 3` |
| 브로드캐스트 전체 | `eth.dst == ff:ff:ff:ff:ff:ff` |

## 5. 해석할 때 흔한 오해

- **"ARP Reply가 없다 → VLAN 오류"** ✕ — 먼저 ARP가 **찾는 IP**가 맞는 next hop인지 봅니다. 잘못된 Gateway, SVI down, VLAN 오류, Trunk 누락이 한 지점에서는 모두 비슷하게 보입니다.
- **"SYN 재전송 → 서비스 중단"** ✕ — 경로 문제나 방화벽도 같은 모습을 만듭니다. RST가 왔는지, 같은 서버로 ping이 되는지, 서버 쪽 캡처가 있는지 봅니다.
- **"DNS 응답 없음 → DNS 서버 장애"** ✕ — 질의가 **어느 IP로** 갔는지 먼저 봅니다. PC의 DNS 설정이 틀렸을 수 있습니다.
- **"VLAN 태그가 안 보인다 → VLAN 장애"** ✕ — Access Port 캡처에는 원래 태그가 없습니다.
- **"이 지점에서 응답이 안 보였다 → 응답이 없었다"** ✕ — 응답은 다른 경로로 갔거나, 캡처 구간 밖이었을 수 있습니다.
- **"`tcp.flags.syn == 1`의 개수 = 연결 시도 수"** ✕ — SYN-ACK가 섞여 있습니다.
- **"`icmp`의 응답 수 = Echo Reply 수"** ✕ — Unreachable(type 3)이 섞여 있을 수 있습니다.
