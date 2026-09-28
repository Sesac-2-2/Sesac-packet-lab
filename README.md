# Packet.AI — 사내 네트워크 장애 진단 프로젝트

`packet_ai_미션.html` 미션 브리핑을 기반으로 진행하는 4인 협업 프로젝트입니다.

```text
1. Network Architect  → network_spec.md
2. Packet Analyst     → packet_summary.json
3. AI Engineer        → diagnosis.json
4. Network SRE        → incident_report.html
```

각 역할의 결과물이 다음 역할의 입력이 되도록 연결합니다. 자세한 역할 설명과 전체 미션 배경은
`packet_ai_미션.html`을 참고하세요.

## 폴더 구조

```text
packet-ai-project/
├── 01_network_design/     현재 작업 중 (Role 1: Network Architect)
│   ├── network_spec.md    최종 네트워크 설계 스펙 (다음 역할에게 넘길 산출물)
│   ├── WORKLOG.md          무엇을 왜 했는지 기록한 작업 로그
│   └── configs/            Packet Tracer CLI에 그대로 붙여넣을 설정 스크립트 (주석 포함)
├── 02_packet_capture/      (예정) Role 2
├── 03_packet_ai/           (예정) Role 3 — ai_packet_assistant의 발전형이 여기 들어갈 예정
├── 04_incident_response/   (예정) Role 4
└── docs/
```

## 진행 상태

- [x] Role 1 착수 — 설계 문서/설정 스크립트 작성
- [ ] Role 1 완료 — Packet Tracer에서 실제로 구성하고 `office_network.pkt`, `topology.png` 저장
- [ ] Role 2 시작
