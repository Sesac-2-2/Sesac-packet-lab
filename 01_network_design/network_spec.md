# Network Spec — PacketLab 사내망 (Role 1 산출물)

이 문서는 2번(Packet Analyst)이 "정상 패킷"을 캡처할 때 기준으로 삼을 네트워크 설계 스펙이다.

## 1. 토폴로지

```text
                 ┌────────────┐
                 │  L3 Switch │  (Inter-VLAN Routing)
                 └─────┬──────┘
             Gi0/1 trunk│  │trunk Gi0/2
                 ┌──────┘  └──────┐
             ┌───┴────┐      ┌────┴───┐
             │ SW-A   │      │ SW-B   │   (L2 Switch, access)
             │ (2960) │      │ (2960) │
             └─┬────┬─┘      └─┬───┬──┘
               │    │          │   │
             PC1  PC2        PC3  PC4  Server(DNS/Web)
           VLAN10 VLAN10   VLAN20 VLAN20  VLAN20
```

- SW-A: VLAN10(개발팀) 전용 Access 스위치
- SW-B: VLAN20(운영팀) 전용 Access 스위치, Server도 여기 연결
- L3 Switch: VLAN10/VLAN20 사이를 라우팅하는 Gateway 역할 (SVI 2개)

## 2. IP / VLAN 설계

| 장비 | VLAN | IP | Subnet Mask | Gateway |
|---|---|---|---|---|
| PC1 | 10 (DEV_TEAM) | 192.168.10.10 | 255.255.255.0 | 192.168.10.1 |
| PC2 | 10 (DEV_TEAM) | 192.168.10.11 | 255.255.255.0 | 192.168.10.1 |
| PC3 | 20 (OPS_TEAM) | 192.168.20.10 | 255.255.255.0 | 192.168.20.1 |
| PC4 | 20 (OPS_TEAM) | 192.168.20.11 | 255.255.255.0 | 192.168.20.1 |
| Server (DNS/Web) | 20 (OPS_TEAM) | 192.168.20.20 | 255.255.255.0 | 192.168.20.1 |
| L3 Switch VLAN10 SVI | 10 | 192.168.10.1 | 255.255.255.0 | - |
| L3 Switch VLAN20 SVI | 20 | 192.168.20.1 | 255.255.255.0 | - |

왜 이렇게 나눴는가:
- 미션 요구사항이 VLAN10=개발팀/192.168.10.0/24, VLAN20=운영팀/192.168.20.0/24, Gateway=각 VLAN의 .1로
  고정되어 있어 그대로 따랐다.
- Server는 미션 요구사항에 별도 VLAN이 정의되어 있지 않아, 서버를 운영팀이 관리한다고 가정하고
  VLAN20에 배치했다. (2번/3번이 장애 시나리오를 만들 때 "Server가 어느 VLAN에 있는지"가
  DNS/TCP 장애 분석의 전제가 되므로 여기 명시해둔다.)

## 3. 포트 매핑

| 장비 | 포트 | 연결 대상 | 모드 |
|---|---|---|---|
| SW-A | Fa0/1 | PC1 | Access, VLAN10 |
| SW-A | Fa0/2 | PC2 | Access, VLAN10 |
| SW-A | Gi0/1 | L3 Switch Gi0/1 | Trunk (VLAN10,20 허용) |
| SW-B | Fa0/1 | PC3 | Access, VLAN20 |
| SW-B | Fa0/2 | PC4 | Access, VLAN20 |
| SW-B | Fa0/3 | Server | Access, VLAN20 |
| SW-B | Gi0/1 | L3 Switch Gi0/2 | Trunk (VLAN10,20 허용) |
| L3 Switch | Gi0/1 | SW-A Gi0/1 | Trunk (VLAN10,20 허용) |
| L3 Switch | Gi0/2 | SW-B Gi0/1 | Trunk (VLAN10,20 허용) |

## 4. 검증 기준 (이걸 통과해야 Role 1 완료)

- [ ] PC1 → PC2 ping 성공 (같은 VLAN, 같은 Switch 내부 통신)
- [ ] PC1 → PC3 ping 성공 (다른 VLAN, L3 Switch를 거쳐야 함 — Inter-VLAN Routing 확인)
- [ ] PC1 → Server(192.168.20.20) ping 성공
- [ ] `show vlan brief` (SW-A, SW-B) 에서 포트가 의도한 VLAN에 정확히 배정되어 있는지 확인
- [ ] `show ip interface brief` (L3 Switch) 에서 VLAN10/VLAN20 SVI가 모두 up/up 인지 확인

## 5. 다음 역할(2번 Packet Analyst)에게 전달할 것

- 이 문서 (`network_spec.md`)
- `office_network.pkt` (Packet Tracer 저장 파일)
- `topology.png` (토폴로지 캡처 이미지)

2번은 이 정보를 기준으로 "정상 상태"의 ARP/ICMP/DNS/TCP 패킷을 캡처해 비교 기준으로 삼는다.
