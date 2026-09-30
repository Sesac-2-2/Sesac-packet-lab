# Packet Tracer 장애 재현 절차 — 4번 Network SRE

> 작성일: 2026-09-29 · 대상: Packet Tracer 9.0.1.0858, 1번의 `office_network.pkt`
> **모든 명령과 절차는 Packet Tracer에서 실행해 보지 않았다(미검증).** 이 문서를 만든 작업 환경에는 Packet Tracer가 없다. 처음 실행할 때 각 절의 "검증 기록" 칸을 채운다.

## 0. 이 문서의 위치

| 항목 | 내용 |
|---|---|
| 과제 근거 | 과제 HTML 마무리 기준 "Packet Tracer: 설정을 바꾸었을 때 어떤 증상이 나타나는지도 재현할 수 있는가", 발표 흐름 "2분 — Packet Tracer + Wireshark 증거 제시" |
| 용도 | 시연과 재현 확인. **Blind 분석용이 아니다.** 설정을 바꾸는 사람이 원인을 알게 된다 |
| 증거 종류 | Simulation 이벤트(Event List). `.pcapng`가 아니다. 2번 JSON에 넣을 때는 `evidence_source: "packet_tracer_simulation"`, 프레임 번호 대신 Simulation 이벤트 식별자를 쓴다 (`data_contract.md`) |
| `.pcapng` | 재현 실습망(`fault.sh`)에서만 만든다. 두 환경의 결과를 한 사례의 같은 증거로 섞지 않는다 |
| 설정 근거 | 1번 `01_network_design/configs/sw_a.txt`, `l3_switch.txt`, `network_spec.md` (jae 브랜치) |

장비 이름은 1번 명세를 따른다: **SW-A** (재현 실습망의 SW1), **SW-B** (SW2), **L3 Switch** (MLS1).

### 1번 설정에서 확인한 사실 (재현 실습망과 다른 점)

- SW-A와 SW-B의 Gi0/1은 `switchport mode trunk`만 설정되어 있고 허용 VLAN 목록이 없다. IOS 기본값으로 **모든 VLAN(1–4094)이 허용**된다. 허용 목록 `10,20`은 L3 Switch 쪽 Gi0/1·Gi0/2에만 있다. 재현 실습망(`topology.conf`)은 양쪽 모두 10, 20만 허용한다.
- SW-A의 VLAN 데이터베이스에는 VLAN 10만 있다. VLAN 20은 없다.
- Server의 DNS 레코드(`www.packetlab.test`)와 HTTP 서비스 설정은 1번 문서에 절차가 없다. DNS·Web 장애 재현 전에 Server의 Services 탭에서 정상 상태를 먼저 확인한다.

## 1. 공통 절차 (장애 1건마다)

1. `office_network.pkt`를 **복사본**으로 연다. 원본은 정상 Baseline으로 남긴다.
2. 정상 상태에서 테스트를 한 번 실행해 결과를 기록한다(2절의 테스트).
3. 3절에서 장애 1개만 적용한다.
4. Simulation 모드로 바꾸고 Edit Filters에서 ARP, ICMP, DNS, TCP, HTTP만 켠다.
5. PC1에서 같은 테스트를 실행하고 Event List를 기록한다. 스크린샷 파일명에 원인을 쓰지 않는다(예: `pt_FAULT-01_event_list.png`).
6. 복구 절차를 실행하고 같은 테스트를 반복한다.
7. 결과는 `recovery_log.md` 3절 "Packet Tracer 쪽 복구"에 기록한다.

ARP 캐시: PT PC의 Command Prompt에서 `arp -d`로 비운 뒤 테스트한다. 비우지 않으면 ARP 단계가 보이지 않을 수 있다.

## 2. PC1 테스트 (재현 실습망 테스트 6종과 대응)

| # | 재현 실습망 (`lab.sh test`) | Packet Tracer PC1 |
|---|---|---|
| 1 | `ping 192.168.10.11` | Desktop > Command Prompt: `ping 192.168.10.11` |
| 2 | `ping 192.168.10.1` | `ping 192.168.10.1` |
| 3 | `ping 192.168.20.10` | `ping 192.168.20.10` |
| 4 | `ping 192.168.20.20` | `ping 192.168.20.20` |
| 5 | `dig www.packetlab.test A` | `nslookup www.packetlab.test` (PT 지원 여부 미확인) |
| 6 | `curl http://www.packetlab.test/` | Desktop > Web Browser: `http://www.packetlab.test` |

## 3. 시나리오별 적용·확인·복구

각 절의 "과제 표 기재 증상"은 과제 HTML 권장 장애 시나리오 표를 옮긴 것이다. 실제 관찰 결과가 아니며, 같은 증상이 나온다고 가정하지 않는다.

---

### 3-1. Default Gateway 오류 (`fault.sh`: `gateway`) — 과제 장애 A / F01

| 구분 | 절차 |
|---|---|
| 적용 | PC1 > Desktop > IP Configuration > Default Gateway `192.168.10.1` → `192.168.10.254` (GUI) |
| 확인 | PC1 Command Prompt: `ipconfig` |
| 복구 | Default Gateway를 `192.168.10.1`로 되돌림 |
| 과제 표 기재 증상 | 다른 Subnet ping이 되지 않음 / 잘못된 Gateway IP에 ARP 반복 |
| 검증 기록 | <미실행> |

### 3-2. Access VLAN 오류 (`access_vlan`) — 과제 장애 B / F02

```
SW-A> enable
SW-A# configure terminal
SW-A(config)# interface fastEthernet 0/1
SW-A(config-if)# switchport access vlan 20
SW-A(config-if)# end
SW-A# show vlan brief
```

- SW-A에는 VLAN 20이 없으므로, IOS는 이 명령에서 VLAN 20을 자동 생성한다는 메시지를 낸다. PT 9.0.1에서도 같은지는 미확인이다. 생성되지 않으면 `vlan 20`을 먼저 만든다.
- **복구:** `interface fastEthernet 0/1` → `switchport access vlan 10`. 자동 생성된 VLAN 20은 `no vlan 20`으로 지워 1번 설정과 같게 맞춘다.
- 과제 표 기재 증상: 같은 팀 PC 일부와 통신이 되지 않음 / ARP Broadcast가 상대 VLAN에 도달하지 않음
- 검증 기록: <미실행>

### 3-3. Trunk 허용 VLAN 누락 (`trunk_vlan`) — 과제 장애 C / F03

```
SW-A# configure terminal
SW-A(config)# interface gigabitEthernet 0/1
SW-A(config-if)# switchport trunk allowed vlan remove 10
SW-A(config-if)# end
SW-A# show interfaces trunk
```

- 1번 설정에서 SW-A Gi0/1은 모든 VLAN을 허용하므로, 이 명령 뒤 허용 목록은 `1-9,11-4094`가 된다.
- **복구:** `switchport trunk allowed vlan all`. 1번 설정은 허용 목록을 따로 지정하지 않았으므로 `all`이 원래 상태다. `add 10`으로 복구하면 `show running-config`에 허용 목록 줄이 남아 원본과 달라진다.
- 과제 표 기재 증상: 다른 Switch의 특정 VLAN만 통신이 되지 않음 / 한 VLAN의 Frame만 반대편으로 전달 안 됨
- 검증 기록: <미실행>

### 3-4. SVI Down (`svi_down`) — 과제 권장 표 F04

```
L3Switch# configure terminal
L3Switch(config)# interface vlan 10
L3Switch(config-if)# shutdown
L3Switch(config-if)# end
L3Switch# show ip interface brief
```

- **복구:** `interface vlan 10` → `no shutdown`
- 과제 표 기재 증상: VLAN 내부 통신은 되지만 Inter-VLAN 통신이 되지 않음 / Gateway ARP 응답 부재 가능
- 검증 기록: <미실행>

### 3-5. DNS Server 설정 오류 (`dns_server`) — 과제 장애 D / F05

| 구분 | 절차 |
|---|---|
| 적용 | PC1 > Desktop > IP Configuration > DNS Server `192.168.20.20` → `192.168.20.99` (GUI) |
| 확인 | PC1 `ipconfig /all` (PT 지원 여부 미확인. 안 되면 IP Configuration 화면 캡처) |
| 복구 | DNS Server를 `192.168.20.20`으로 되돌림 |
| 과제 표 기재 증상 | IP 접속은 되지만 도메인 조회가 되지 않음 / DNS Query 반복·응답 없음 |
| 검증 기록 | <미실행> |

### 3-6. Subnet Mask 오류 (`subnet_mask`) — 과제 장애 E

| 구분 | 절차 |
|---|---|
| 적용 | PC1 > Desktop > IP Configuration > Subnet Mask `255.255.255.0` → `255.255.0.0` (GUI) |
| 확인 | PC1 `ipconfig` |
| 복구 | Subnet Mask를 `255.255.255.0`으로 되돌림 |
| 과제 표 기재 증상 | 과제 권장 표에 없음 |
| 검증 기록 | <미실행> |

- 이 설정에서 PC1은 192.168.20.x를 같은 Subnet으로 판단한다. 이것은 IP 판단 규칙에서 나온 예상이며, PT에서 관찰한 결과가 아니다.

### 3-7. Server TCP Port 서비스 중단 (`web_port`) — 과제 장애 F / F06

| 구분 | 절차 |
|---|---|
| 적용 | Server > Services > HTTP > HTTP **Off** (GUI. CLI 없음) |
| 확인 | Server > Services > HTTP 화면 |
| 복구 | HTTP **On** |
| 과제 표 기재 증상 | ping은 되지만 HTTP 연결이 되지 않음 / SYN 반복 또는 RST |
| 검증 기록 | <미실행> |

- PT 서버가 꺼진 포트에 RST를 보내는지, 무응답인지는 미확인이다. 재현 실습망(Linux)은 보통 RST를 보낸다(`handoff_to_4_sre.md` 9절). 두 환경의 차이를 기록한다.

## 4. 재현 실습망과 대응표

| 시나리오 | 재현 실습망 (`fault.sh`) | Packet Tracer |
|---|---|---|
| `gateway` | `ip -n pc1 route replace default via 192.168.10.254` | PC1 IP Configuration Gateway |
| `access_vlan` | `bridge vlan` (sw1 fa0_1 PVID 20) | SW-A Fa0/1 `switchport access vlan 20` |
| `trunk_vlan` | `bridge vlan del` (sw1 gi0_1 vid 10) | SW-A Gi0/1 `switchport trunk allowed vlan remove 10` |
| `svi_down` | `ip -n mls1 link set vlan10 down` | L3 Switch `interface vlan 10` / `shutdown` |
| `dns_server` | pc1 `resolv.conf` → 192.168.20.99 | PC1 IP Configuration DNS Server |
| `subnet_mask` | pc1 주소 /16 | PC1 IP Configuration Subnet Mask |
| `web_port` | srv `http.server` 중지 | Server Services HTTP Off |
