# 교육용 예제 packet_summary JSON

> 모두 `evidence_source: "example"`인 **교육용 예제**입니다. 실제 캡처가 아니며, 실제 진단 입력으로 쓰지 않습니다.
> 값은 `learning_lab/js/engine.js`(교육용 모델)가 계산한 것이고, `generate_examples.js`로 다시 만들 수 있습니다. 손으로 넣은 숫자는 없습니다.
> 3번(AI Engineer)이 진단 로직의 분기를 테스트할 수 있도록 요청받아 만들었습니다.

| 파일 | case_id | 패턴 | 핵심 값 |
|---|---|---|---|
| `../packet_summary.example.json` | EDU-EX-01 | Gateway ARP 무응답 | ARP 8/0, ICMP 0/0 |
| `normal.json` | EDU-EX-02 | 정상 (다른 VLAN 서버 ping) | ARP 1/1, ICMP 4/4 |
| `dns_no_response.json` | EDU-EX-03 | DNS 무응답 | DNS Query 3 / Response 0 |
| `tcp_rst.json` | EDU-EX-04 | 서버 도달, 포트 거부 | TCP SYN 1 / SYN-ACK 0 / RST 1 |
| `limited_capture_nulls.json` | EDU-EX-05 | 제한적 캡처 (DNS·TCP 미수집) | ICMP 4/0, DNS·TCP = null + `null_reasons`, 서버 쪽 캡처 없음 `limitations` |

**EDU-EX-01의 `192.168.10.254`에 대해**
설계상의 Gateway는 `192.168.10.1`입니다. EDU-EX-01은 **"PC1의 Gateway가 잘못 설정된 장애"를 관찰한 예제**라서, PC1이 실제로 ARP로 찾은 잘못된 주소(`.254`)가 `arp_targets`에 들어 있습니다. `arp_targets`는 "설계값"이 아니라 "이 캡처에서 PC가 실제로 찾은 next hop"을 기록하는 필드입니다.

주소는 1번 `network_spec.md`의 IP/VLAN 표를 따릅니다 (Server 192.168.20.20). 명세가 바뀌면 `node examples/generate_examples.js`로 다시 생성합니다.
