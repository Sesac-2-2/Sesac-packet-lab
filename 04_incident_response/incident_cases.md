# Incident Cases — 4번 Network SRE

> 사례 목록과 사례별 Incident Report. 실제 값은 사례를 진행한 뒤에만 채운다. 아직 진행한 사례는 없다.
> `packet_summary_<case_id>.json`과 3번 AI 입력에는 이 문서의 2절(정답)을 넣지 않는다.

## 1. 공개 사례 목록 (분석 담당자에게 전달하는 내용)

`handoff_to_4_sre.md` 2-1절 형식을 따른다. 원인·바꾼 설정·힌트는 쓰지 않는다.

| case_id | 증상 (사용자 입장) | 증상이 보이는 PC | 장애 적용 시각 | 복구 완료 시각 |
|---|---|---|---|---|
| FAULT-01 | <미정> | PC1 | <미정> | <미정> |

증상 작성 규칙:
- 사용자가 말할 법한 현상만 쓴다. 예: "PC1에서 사내 웹페이지가 열리지 않는다."
- "Gateway", "VLAN", "DNS", "포트" 등 원인 계층을 떠올리게 하는 단어를 쓰지 않는다.
- 무작위 적용(`fault.sh apply` 단독)에서는 적용한 사람도 원인을 모르므로 증상을 직접 쓰지 않는다. 공통 문구 "PC1 사용자가 일부 네트워크 서비스가 동작하지 않는다고 신고했다"를 쓴다.

## 2. 분석 후 정답 대조 (분석 제출 후에만 작성)

`sudo ./fault.sh reveal <case_id>` 출력으로 채운다.

| case_id | 적용 방식 | 실제 원인 | 변경 내용 | 분석 제출 시각 | 공개 시각 | 2번 원인 후보에 포함? | 3번 diagnosis 1순위 |
|---|---|---|---|---|---|---|---|
| FAULT-01 | <팀원 적용 / 무작위 적용> | | | | | <예/아니오> | |

적용 방식이 "무작위 적용"이면 이 사례는 약한 Blind임을 발표와 보고서에 명시한다.

## 3. Incident Report (사례별)

아래 양식을 사례마다 복사한다. 각 칸은 출처 파일을 함께 적는다. 관찰 사실과 해석을 섞지 않는다.

---

### FAULT-01 Incident Report

| 항목 | 내용 | 출처 |
|---|---|---|
| 신고 증상 | | 1절 |
| 영향 범위 | <예: PC1의 어떤 테스트가 실패했는가> | `packet_analysis.md` |
| 탐지 방법 | 2번의 테스트 6종 + PC1 캡처 | `fault_FAULT-01.pcapng` |
| 핵심 패킷 증거 | <프레임 번호·시각·관찰 내용> | `packet_summary_FAULT-01.json` evidence |
| AI 진단 | <hypotheses, recommended_checks 요약> | `diagnosis.json` |
| 실제 원인 | | 2절 |
| 조치 | | `recovery_log.md` |
| 복구 검증 (설정) | `fault.sh verify` 결과 | `recovery_log.md` |
| 복구 검증 (패킷) | Baseline / Fault / Recovered 비교 | `recovery_log.md` 4절 |
| 분석 과정 평가 | 원인이 2번 후보에 있었는가, 3번 진단이 맞았는가, 어떤 증거가 결정적이었는가 | |
| 재발 방지 | | |
| 한계 | 캡처 지점, 재현 실습망과 Packet Tracer의 차이 (`handoff_to_4_sre.md` 9절) | |

---
