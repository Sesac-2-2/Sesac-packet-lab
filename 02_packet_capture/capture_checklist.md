# 캡처 체크리스트 (정상 · 장애 · 복구 공통)

> **왜 필요한가** — 정상과 장애를 비교하려면 **같은 조건**에서 캡처해야 합니다. 조건이 다르면 차이가 장애 때문인지 조건 때문인지 알 수 없습니다.
> 미확인 값은 `<SERVER_IP>`, `<DNS_IP>`, `<INTERFACE>`처럼 남겨 둡니다. 추측해서 채우지 않습니다.

---

## A. 캡처 전

- [ ] 오늘 할 상태를 정했다: Baseline / Fault(`case_id`) / Recovered
- [ ] 실행 위치(테스트를 치는 PC)와 캡처 위치(Wireshark를 켠 NIC)를 적었다
- [ ] 캡처 인터페이스 `<INTERFACE>`가 맞다 (테스트 PC의 실습망 NIC)
- [ ] Capture filter를 쓸지 정했다 — **기본은 쓰지 않음**. 쓴다면 무엇이 저장되지 않는지 적었다. 저장되지 않은 항목은 나중에 JSON에서 0이 아니라 null이 된다.
- [ ] 캐시 조건을 정했다 (아래 D절). 정상·장애·복구에서 똑같이 한다.
- [ ] 테스트 목록과 순서를 Baseline과 같게 준비했다
- [ ] 장애 캡처라면: 4번에게 받은 것은 `case_id`와 증상뿐이다 (원인·변경 설정은 묻지 않았다)

## B. 캡처 중

- [ ] **캡처를 먼저 시작**한 뒤 테스트를 실행했다 (반대로 하면 첫 ARP/DNS를 놓친다)
- [ ] 테스트마다 시작 시각(시:분:초)을 적었다
- [ ] 명령이 끝난 뒤에도 충분히 기다렸다: ping·ARP는 5초 이상, DNS·TCP는 재전송까지 보도록 10초 이상
- [ ] 테스트 사이에 간격을 두었다 (구간을 나누기 쉽게)
- [ ] 명령 결과 화면(ping, nslookup, 브라우저 오류)을 캡처하거나 복사했다

## C. 캡처 후

- [ ] 파일명: `normal.pcapng` / `fault_<case_id>.pcapng` / `recovered_<case_id>.pcapng` — **원인이 드러나는 이름 금지**
- [ ] `packet_analysis.md`에 테스트·시각·캡처 지점·필터·캐시 조건을 적었다
- [ ] 중요한 프레임 번호와 시각을 적었다
- [ ] `summarize_pcap.py extract`로 JSON을 만들고 `validate`로 검사했다
- [ ] `summarize_pcap.py filters`의 필터로 Wireshark에서 수동 집계를 확인했다
- [ ] 실제 캡처 파일을 저장소에 올리기 전에 개인정보·외부 트래픽이 없는지 확인했다

## D. 캐시 — 일부 패킷이 안 보이는 흔한 이유

| 캐시 | 있으면 | 영향 |
|---|---|---|
| ARP 캐시 | PC가 이미 MAC을 알아 ARP를 보내지 않음 | ARP가 안 보여도 장애가 아닐 수 있음 |
| DNS 캐시 | PC가 이미 IP를 알아 DNS를 묻지 않음 | DNS Query가 안 보여도 장애가 아닐 수 있음 |
| 기존 TCP 연결 / 브라우저 캐시 | 새 SYN 없이 기존 연결을 재사용하거나, 요청 자체를 보내지 않음 | SYN·HTTP가 안 보일 수 있음 |

**원칙**: 정상·장애·복구에서 **같은 방법으로** 캐시를 비우거나, 같은 방법으로 그대로 둡니다. 어느 쪽을 택했는지 기록합니다.

**캐시 비우기 명령** — 실습 OS와 버전을 확인한 뒤 사용합니다. 아래는 흔히 쓰는 명령이며, 버전·권한에 따라 다를 수 있습니다. 실행 전 해당 환경에서 동작을 확인하세요.

| 환경 | ARP 캐시 | DNS 캐시 |
|---|---|---|
| Windows (관리자 권한) | `arp -d *` 또는 `netsh interface ip delete arpcache` | `ipconfig /flushdns` |
| macOS | `sudo arp -a -d` | `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder` |
| Linux | `sudo ip neigh flush all` | systemd-resolved 사용 시 `resolvectl flush-caches` |
| Packet Tracer PC | Command Prompt의 `arp -d` 지원 여부 **확인 필요** | 확인 필요 |

브라우저는 시크릿 창을 쓰거나 캐시를 비우고, 기존 탭을 닫은 뒤 테스트합니다.

## E. Baseline 테스트 6종

각 테스트는 "실행 위치 → 캡처 위치 → 보낼 트래픽 → 명령 → 필터 → 정상이라면 보여야 하는 흐름 → 남길 증거" 순서로 적었습니다.
장비 이름·주소는 `network_spec.md`를 받은 뒤 채웁니다.

### E1. 같은 VLAN·같은 Subnet의 PC 간 통신
- 실행: `<PC_A>` → 대상 `<PC_B_IP>` (같은 VLAN)
- 캡처: `<PC_A>`의 NIC. 가능하면 `<PC_B>`의 NIC도 함께.
- 명령: Windows `ping -n 4 <PC_B_IP>` / macOS·Linux `ping -c 4 <PC_B_IP>`
- 필터: `arp || icmp`
- 정상 흐름: (캐시가 비어 있다면) ARP Request "Who has `<PC_B_IP>`?" → ARP Reply → ICMP Echo Request/Reply 4쌍. **Gateway를 거치지 않는다.**
- 증거: ARP 대상 IP, Reply를 보낸 MAC, Echo Request/Reply 프레임 번호

### E2. PC와 Gateway 간 통신
- 실행: `<PC_A>` → `<GATEWAY_IP>`
- 캡처: `<PC_A>` NIC
- 명령: `ping -n 4 <GATEWAY_IP>` (macOS·Linux는 `-c 4`)
- 필터: `arp || icmp`
- 정상 흐름: ARP "Who has `<GATEWAY_IP>`?" → Reply(Gateway MAC) → Echo 4쌍
- 증거: Gateway MAC (이후 다른 네트워크로 가는 프레임의 도착 MAC과 같아야 함)

### E3. 서로 다른 VLAN 간 통신
- 실행: `<PC_A>`(VLAN 10) → `<PC_C_IP>`(VLAN 20)
- 캡처: `<PC_A>` NIC. 가능하면 `<PC_C>` NIC도 함께.
- 명령: `ping -n 4 <PC_C_IP>`
- 필터: `arp || icmp`
- 정상 흐름: PC_A는 **Gateway의 MAC**을 찾는다(PC_C의 MAC이 아님) → Echo Request의 도착 MAC = Gateway, 도착 IP = PC_C → Reply
- 증거: 첫 Echo Request의 `eth.dst`와 `ip.dst`. 반대편 캡처가 있으면 같은 패킷의 `eth.src`가 L3 장비 MAC으로 바뀐 것.

### E4. PC와 서버 IP 간 통신
- 실행: `<PC_A>` → `<SERVER_IP>`
- 캡처: `<PC_A>` NIC (가능하면 서버 NIC도)
- 명령: `ping -n 4 <SERVER_IP>`
- 필터: `icmp && ip.addr == <SERVER_IP>`
- 정상 흐름: E3과 같음 (서버가 다른 VLAN이라면 Gateway 경유)
- 증거: Echo Request/Reply 수, 응답 시간

### E5. DNS 이름 조회
- 실행: `<PC_A>`에서 `<DOMAIN>` 조회
- 캡처: `<PC_A>` NIC
- 명령: `nslookup <DOMAIN>` (모든 OS), Linux·macOS는 `dig <DOMAIN>`도 가능
- 필터: `dns`
- 정상 흐름: DNS Query(목적지 `<DNS_IP>`, UDP 53) → Response(`rcode` 0, A 레코드 = `<SERVER_IP>`)
- 증거: Query의 목적지 IP, Response의 `dns.flags.rcode`, `dns.a`
- 주의: `nslookup`은 먼저 DNS 서버 자신의 이름을 역방향 조회(PTR)할 수 있습니다. A 레코드 질의와 구분하세요.

### E6. 서버 TCP/Web 연결
- 실행: `<PC_A>`에서 `http://<DOMAIN>:<WEB_PORT>/`
- 캡처: `<PC_A>` NIC
- 명령: 브라우저, 또는 `curl -v http://<DOMAIN>:<WEB_PORT>/` (Windows 10 이상에는 curl이 포함된 경우가 많음 — 확인 필요)
- 필터: `tcp.port == <WEB_PORT>`, 연결 시작만: `tcp.flags.syn == 1 && tcp.flags.ack == 0`
- 정상 흐름: (필요하면 DNS) → SYN → SYN-ACK → ACK → HTTP GET → 200 OK
- 증거: SYN/SYN-ACK 프레임 번호, HTTP 응답 코드
- 주의: HTTPS(443)라면 HTTP 내용은 암호화되어 `http` 필터에 보이지 않습니다. 이때는 TCP 연결과 TLS 핸드셰이크까지만 관찰합니다.

## F. 장애·복구 캡처에서 추가로 지킬 것

- 정상과 **같은 테스트·같은 캡처 지점·같은 필터·같은 관찰 시간·같은 캐시 조건**
- 한 지점만 캡처했다면 "반대편에 도착하지 않았다"고 쓰지 않습니다. "이 지점에서 응답이 보이지 않았다"라고 씁니다.
- Access Port에서 캡처한 프레임에는 원래 VLAN 태그가 없습니다. 태그가 없다는 사실을 VLAN 장애의 증거로 쓰지 않습니다.
- 복구 설정의 작성과 실행은 4번(SRE)이 합니다. 2번은 복구 후 같은 테스트를 반복해 패킷 변화를 기록합니다.
- 실제 공유 네트워크의 설정을 바꿔야 한다면 4번과 먼저 조율합니다.
