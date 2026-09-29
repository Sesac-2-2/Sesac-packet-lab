# Packet Analyst 전달 정보

## 1. PC / Server 포트 연결 정보

| 장비 | 연결되는 스위치 | 스위치 포트 | 장비 포트 | VLAN |
|---|---|---|---|---:|
| PC1 | SW1 | Fa0/1 | Fa0 | 10 |
| PC2 | SW1 | Fa0/2 | Fa0 | 10 |
| PC3 | SW2 | Fa0/1 | Fa0 | 20 |
| PC4 | SW2 | Fa0/2 | Fa0 | 20 |
| Server | SW2 | Fa0/3 | Fa0 | 20 |

추가로 스위치 간 연결은 아래와 같습니다.

```text
SW1 Gi0/1  <->  MLS1 Gi0/1
SW2 Gi0/1  <->  MLS1 Gi0/2
```

## 2. Server 정보

| 항목 | 값 |
|---|---|
| Server IP | `192.168.20.20` |
| VLAN | `20 (OPS_TEAM)` |
| Default Gateway | `192.168.20.1` |
| DNS Server | `192.168.20.20` |
| Domain | `www.packetlab.test` |
| Web Protocol | `HTTP` |
| Web Port | `TCP/80` |

## 3. 참고

`www.packetlab.test`, `HTTP TCP/80` 기준으로 진행하겠습니다.

현재 정상 설계 기준 Gateway는 아래와 같습니다.

```text
VLAN10 Gateway = 192.168.10.1
VLAN20 Gateway = 192.168.20.1
```
