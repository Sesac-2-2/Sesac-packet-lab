# WORKLOG — Role 1 (Network Architect)

각 단계마다 "무엇을 했는가 / 왜 했는가 / 어떻게 확인하는가"를 기록한다.
발표나 질문에서 "이거 왜 이렇게 했어요?"에 바로 답할 수 있는 게 목적이다.

---

## STEP 1.1 토폴로지 결정

**무엇을 하는가**
PC 4대, L2 Switch 2대, L3 Switch 1대, Server 1대로 이루어진 2-VLAN 구조를 그린다.
(`network_spec.md` 1절 참고)

**왜 하는가**
장비를 Packet Tracer에 배치하기 전에 먼저 그림으로 확정해두면, 중간에 "포트를 어디에 꽂아야
하지?" 같은 시행착오를 줄일 수 있다. 또 2번(Packet Analyst)이 나중에 "정상 상태가 이거였구나"를
알아야 하므로 문서로 남겨야 한다.

**확인할 것**
`network_spec.md`의 토폴로지 그림과 실제 Packet Tracer 화면이 일치하는가.

---

## STEP 1.2 IP / VLAN 설계

**무엇을 하는가**
미션에서 고정된 VLAN10=192.168.10.0/24(개발팀), VLAN20=192.168.20.0/24(운영팀), Gateway=.1을
그대로 받아, PC/Server 개별 IP를 배정한다. (`network_spec.md` 2절)

**왜 하는가**
IP를 미리 표로 정리해두지 않으면 Packet Tracer에서 PC 4대 + Server 1대에 설정할 때 겹치거나
빠뜨리기 쉽다. 표로 만들어두면 설정하면서 체크하고, 나중에 장애 상황(예: Subnet Mask 오류)을
만들 때도 "원래 정답이 뭐였는지" 비교 기준이 된다.

**확인할 것**
IP가 서로 중복되지 않는가, Subnet Mask가 모두 /24로 일치하는가.

---

## STEP 1.3 VLAN / Trunk 구성

**무엇을 하는가**
SW-A, SW-B, L3 Switch에 VLAN 10/20을 생성하고, PC/Server가 연결되는 포트는 Access,
스위치-스위치 및 스위치-L3스위치 연결 포트는 Trunk로 설정한다. (`configs/` 폴더의 스크립트 사용)

**왜 하는가**
Access 포트는 "이 포트는 무조건 이 VLAN 소속"이라고 고정하는 것이고, Trunk 포트는 "여러 VLAN의
트래픽이 태그를 달고 한 케이블로 같이 지나간다"는 뜻이다. SW-A와 L3 Switch 사이에는 VLAN10과
VLAN20 트래픽이 모두 지나가야 하므로(PC1이 Server랑 통신하려면 결국 그 링크를 타고 나가야 함)
Access가 아니라 Trunk로 묶어야 한다. 만약 여기서 Trunk 허용 VLAN 목록에 20을 빠뜨리면, 그게
바로 미션에서 말하는 "장애 C: Trunk에서 특정 VLAN 누락" 상황이 된다 — 즉 이 단계를 정확히
이해해야 나중에 4번이 만드는 장애 시나리오도 이해할 수 있다.

**확인할 것**
`show vlan brief`로 포트별 VLAN 소속 확인, `show interfaces trunk`로 Trunk 링크에 VLAN10/20이
모두 허용되어 있는지 확인.

---

## STEP 1.4 L3 Switch Inter-VLAN Routing 구성

**무엇을 하는가**
L3 Switch에서 `ip routing`을 켜고, VLAN10/VLAN20 각각에 대해 SVI(Switched Virtual Interface)를
만들어 192.168.10.1 / 192.168.20.1을 부여한다.

**왜 하는가**
Switch는 기본적으로 L2 장비라서 같은 VLAN 안에서만 통신을 전달할 수 있다. 서로 다른 VLAN
(다른 네트워크 대역) 사이를 연결하려면 L3(라우팅) 기능이 필요하고, 그 라우팅의 "출입구"가
Gateway다. PC1이 PC3(다른 VLAN)에게 ping을 보내면, PC1은 먼저 자신의 Gateway인
192.168.10.1로 보내고, L3 Switch가 그걸 192.168.20.0/24로 라우팅해준다.

**확인할 것**
`show ip interface brief`에서 Vlan10, Vlan20 인터페이스가 모두 `up / up` 상태인가.

---

## STEP 1.5 PC / Server IP 설정

**무엇을 하는가**
Packet Tracer에서 각 PC와 Server의 Desktop > IP Configuration에 `network_spec.md` 표대로
IP/Subnet Mask/Gateway를 입력한다. (이건 CLI가 아니라 PT의 GUI 작업이라 스크립트로 못 남기고
직접 해야 한다.)

**왜 하는가**
스위치/라우터 설정만으로는 통신이 안 된다. 각 PC가 "내 IP는 무엇이고, 다른 네트워크로 나갈 때는
어디로 가야 하는지(Gateway)"를 알아야 실제 패킷이 만들어진다.

**확인할 것**
IP Configuration 창에 오타 없이 들어갔는지, Gateway가 자기 VLAN의 SVI와 일치하는지.

---

## STEP 1.6 Baseline 검증 (Ping 테스트)

**무엇을 하는가**
`network_spec.md` 4절의 체크리스트대로 PC1→PC2, PC1→PC3, PC1→Server ping을 순서대로 실행한다.

**왜 하는가**
설정을 다 마쳤다고 실제로 통신이 되는 건 아니다. 같은 VLAN 통신(PC1→PC2)과 다른 VLAN 통신
(PC1→PC3)을 각각 테스트해야 "L2만 되는지 / L3 라우팅까지 되는지"를 구분해서 확인할 수 있다.
이 Baseline이 성공해야 2번이 "정상 상태의 패킷"을 캡처할 수 있는 전제가 만들어진다.

**확인할 것**
ping 4개 모두 `Reply from ...` 로 성공하는가. 실패하면 STEP 1.3(VLAN/Trunk) 또는 STEP 1.4
(SVI)로 돌아가서 원인을 찾는다.

---

## 다음 할 일

- [ ] Packet Tracer에서 실제로 구성
- [ ] `office_network.pkt` 저장
- [ ] 토폴로지 화면을 캡처해 `topology.png`로 저장
- [ ] 이 WORKLOG와 `network_spec.md`를 2번(Packet Analyst)에게 전달
