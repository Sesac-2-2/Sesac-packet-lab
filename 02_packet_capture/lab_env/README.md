# lab_env — 캡처용 재현 실습망 (Linux network namespace)

> **왜 필요한가**
> Packet Tracer 9.0.1.0858에는 Simulation 결과를 `.pcap`/`.pcapng`로 저장하는 메뉴가 없습니다(직접 확인함). 또 내 PC에서 Wireshark로 캡처하면 Packet Tracer 안의 가상 트래픽은 잡히지 않습니다.
> 그래서 과제와 같은 구조의 네트워크를 **Linux 안에 따로 만들어** 실제 패킷을 캡처합니다.
>
> **반드시 기록할 것**: 이 환경의 패킷은 "별도 Linux 환경에서 재현한 트래픽"입니다. Packet Tracer 내부 트래픽이라고 부르지 않습니다.
>
> **역할 경계**
> - 이 도구는 2번의 일(테스트 실행, 캡처, 상태 관찰)만 합니다.
> - 네트워크 설계는 **1번** 담당입니다. 토폴로지 값은 `topology.conf`에 따로 두었습니다. IP·Mask·Gateway·VLAN·SVI는 1번 `network_spec.md`를 반영했고, 스위치 연결·포트 이름·도메인·웹 포트는 아직 명세에 없어 **임시값**입니다.
> - 장애 적용과 복구는 **4번** 담당이라 이 도구에 넣지 않았습니다. 4번이 이 환경에 장애를 어떻게 적용할지는 팀이 정합니다.

---

## 1. 무엇을 만드나

```
                         [l3] L3SW  (bridge + SVI: vlan10 192.168.10.1 / vlan20 192.168.20.1)
                          ga │ Trunk 10,20        gb │ Trunk 10,20
                    ┌────────┘                       └────────┐
                 [swa] SW-A                                [swb] SW-B
             p1 │ VLAN10   p2 │ VLAN20          p1 │ VLAN10  p2 │ VLAN20  p24 │ VLAN20
             [pc1]          [pc3]               [pc2]        [pc4]        [srv] DNS + Web
         192.168.10.10  192.168.20.10       192.168.10.11 192.168.20.11  192.168.20.20
```

| 과제 구성 요소 | 이 환경에서 대응하는 것 | 정식 용어 |
|---|---|---|
| PC, Server | 서로 분리된 가상 호스트 | network namespace |
| 케이블 | 양 끝이 이어진 가상 랜선 | veth pair |
| L2 스위치 | VLAN을 지원하는 가상 스위치 | Linux bridge + `vlan_filtering` |
| Access Port | 포트에 VLAN 하나를 태그 없이 할당 | PVID + untagged |
| Trunk | 포트에 여러 VLAN을 태그 붙여 허용 | 802.1Q tagged |
| L3 스위치의 SVI | 브리지 위의 VLAN 인터페이스 + 라우팅 | VLAN interface + `ip_forward` |
| DNS 서버 | `dnsmasq` (`web.packetlab.example` → 192.168.20.20) | |
| Web 서버 | `python3 -m http.server 80` | |

- 주소·VLAN·포트 배치는 `topology.conf`에서 읽습니다. IP/VLAN은 1번 명세를 반영했습니다(Server = 192.168.20.20). 명세가 바뀌면 이 파일만 바꿉니다. `lab.sh`는 고치지 않아도 됩니다.
- 모든 장비는 namespace 안에만 만듭니다. VM이나 WSL의 원래 네트워크 설정은 바꾸지 않습니다. `down`으로 전부 지워집니다.
- IPv6는 namespace 안에서 끕니다. 캡처에 과제와 무관한 IPv6 패킷이 섞이지 않게 하기 위해서입니다.

## 2. 어디서 실행하나 (둘 중 하나)

| | (1) Windows의 WSL2 | (2) Mac의 Multipass Ubuntu |
|---|---|---|
| 장점 | 캡처 파일을 Windows의 Wireshark(4.6.8)로 바로 열 수 있음 | 일반 Ubuntu 커널이라 필요한 기능이 대부분 들어 있음 |
| 확인할 것 | WSL2 커널이 bridge VLAN 기능을 지원하는지 **확인되지 않음** → `check`로 판별 | 파일을 Windows로 옮기거나 Mac에서 Wireshark 사용 |

**먼저 WSL2에서 `check`를 실행합니다. "실패"가 나오면 Multipass로 갑니다.**

> 확인 결과 (2026-09-28): Windows 11의 WSL2 Ubuntu에서 `check`의 모든 항목이 OK였습니다. 이 팀의 기본 실행 위치는 **WSL2**입니다.

WSL 버전 확인은 **Windows PowerShell**에서 합니다(Ubuntu 안에서는 `wsl` 명령이 없습니다): `wsl -l -v` → VERSION이 **2**여야 합니다. 1이면 이 방식은 동작하지 않습니다.

## 3. 준비 (Ubuntu 공통)

```bash
sudo apt update
sudo apt install -y iproute2 dnsmasq-base dnsutils curl tcpdump tshark python3
# tshark 설치 중 "non-superuser capture" 질문이 나오면 아무거나 골라도 됩니다 (이 스크립트는 sudo로 캡처).
git clone -b feat/2nd-part https://github.com/Sesac-2-2/Sesac-packet-lab.git
cd Sesac-packet-lab/02_packet_capture/lab_env
chmod +x lab.sh
sudo ./lab.sh check
```

`check` 결과가 "이 환경에서 실습망을 만들 수 있습니다"면 준비가 끝났습니다.

## 4. 캡처 순서 (정상 → 장애 → 복구)

```bash
cd Sesac-packet-lab/02_packet_capture/lab_env
# 캡처 파일은 기본으로 02_packet_capture/에 저장됩니다 (OUT_DIR 지정 불필요)

# 1) 정상 Baseline — up 직후는 모든 ARP 캐시가 비어 있음
sudo ./lab.sh down; sudo ./lab.sh up
sudo ./lab.sh capture start pc1 normal.pcapng
sudo ./lab.sh capture start srv normal_srv.pcapng     # 필요하면 다른 지점도 동시에
sudo ./lab.sh test all                  # 각 테스트 시작·끝 시각이 출력됨 → 기록
sudo ./lab.sh capture stop all

# 2) 장애 — 4번이 장애를 적용한 뒤 (방법은 팀 합의). 2번은 원인을 모르는 상태로 같은 순서를 반복
sudo ./lab.sh flush                     # 정상 캡처와 캐시 조건을 맞춤
sudo ./lab.sh capture start pc1 fault_<case_id>.pcapng
sudo ./lab.sh test all
sudo ./lab.sh capture stop all

# 3) JSON 만들기 (Linux에서 바로 가능. tshark 설치됨)
cd ..
python3 summarize_pcap.py extract fault_<case_id>.pcapng --case-id <case_id> \
  --source-ip 192.168.10.10 --destination-ip 192.168.20.20 --next-hop 192.168.10.1 \
  --capture-point "PC1 NIC (재현 실습망 pc1 eth0, swa p1 Access VLAN 10)" \
  --test-description "<시각> ping -c 4 192.168.20.20" --start <초> --end <초> \
  --limitation "별도 Linux 재현 환경(network namespace)에서 캡처. Packet Tracer 내부 트래픽 아님" \
  -o packet_summary_<case_id>.json

# 4) 복구 후 — 4번이 복구한 뒤 같은 순서 반복
sudo ./lab.sh flush
sudo ./lab.sh capture start pc1 recovered_<case_id>.pcapng
sudo ./lab.sh test all
sudo ./lab.sh capture stop all
```

- 정상·장애·복구의 캐시 조건을 같게 하려고 매번 `flush`로 ARP 캐시를 비웁니다.
- 캡처 지점 목록: `sudo ./lab.sh capture list`

**캡처 파일을 Windows에서 열기**
- WSL2: 파일 탐색기 주소창에 `\\wsl$\Ubuntu\home\<사용자>\Sesac-packet-lab\02_packet_capture`를 입력하거나, WSL에서 `explorer.exe .`을 실행합니다.
- Multipass (Mac): `multipass list`로 VM 이름을 확인한 뒤 `multipass transfer <VM_NAME>:/home/ubuntu/Sesac-packet-lab/02_packet_capture/normal.pcapng .`로 가져옵니다.

## 5. 장애 적용 (4번 담당 — 이 도구에 없음)

- 장애를 적용하고 복구하는 기능은 이 도구에 없습니다. 4번(SRE)의 역할이기 때문입니다.
- Blind 분석을 지키려면 원인을 아는 사람(4번)이 장애를 적용하고, 2번은 `case_id`와 증상만 받아 캡처합니다.
- 4번이 이 재현 환경을 쓸지, 쓴다면 어떻게 적용할지는 팀이 정합니다. 결정되면 이 절에 적습니다.

## 6. 상태 확인 — Cisco IOS 명령과의 대응

`sudo ./lab.sh status`가 아래를 한 번에 보여 줍니다.

| Cisco IOS / Windows | 이 환경 |
|---|---|
| `ipconfig /all` | `ip -n pc1 -br addr`, `ip -n pc1 route`, `/etc/netns/pc1/resolv.conf` |
| `show vlan brief` | `ip netns exec swa bridge vlan show` (PVID = Access VLAN) |
| `show interfaces trunk` | `ip netns exec l3 bridge vlan show` |
| `show ip interface brief` | `ip -n l3 -br addr show type vlan` |
| 서버 서비스 상태 | `ip netns exec srv ss -ltnu` |

## 7. 이 환경의 한계 (분석 문서에 함께 적기)

- 장비가 Cisco가 아니라 Linux입니다. 패킷(ARP, ICMP, DNS, TCP, HTTP)은 같은 표준이지만, 아래 세부 동작은 Cisco나 Packet Tracer와 다를 수 있습니다.
  - ping 재시도와 ARP 재전송 횟수·간격 (Linux `ping`은 Windows `ping`과 다름)
  - 경로가 없을 때 라우터가 ICMP Unreachable을 보내는지
  - DNS 서비스가 멈췄을 때 서버가 ICMP Port Unreachable을 돌려보내는 동작 (Linux는 보통 돌려보냄)
- STP, EtherChannel, 포트 보안 등은 만들지 않았습니다(과제 분석 대상 아님).
- 실행 검증 (2026-09-28, Windows 11 WSL2 Ubuntu): `check` 전 항목 OK, `up` 성공, `test all` 6종 모두 정상
  (ping 4/4 ×4, 같은 VLAN TTL 64 / 다른 VLAN TTL 63, DNS NOERROR A=192.168.20.20, HTTP 200). `status`의 VLAN·Trunk·SVI 구성도 설계와 같음.
- `capture`: 처음에는 `dumpcap`이 결과 파일을 열 때 `Permission denied`가 났습니다. 캡처 데이터를 표준 출력으로 받아 스크립트가 저장하도록 고친 뒤, 정상 Baseline 캡처에 성공했습니다(2026-09-28 17:51, PC1 58 frames / Server 31 frames).
- `topology.conf` 분리·장애 기능 삭제 후의 새 버전도 WSL2에서 `up`·`test all` 6종이 같은 결과로 정상 동작함을 확인했습니다 (2026-09-28 17:37).
