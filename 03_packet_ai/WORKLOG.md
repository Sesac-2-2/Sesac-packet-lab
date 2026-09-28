# WORKLOG — Role 3 (AI Engineer) 착수

## 무엇을 했는가

`ai_packet_assistant`(예전에 만든 개인 학습용 프로젝트)에서 재사용할 만한 부분만 가져와
`analyzer.py`를 새로 만들었다. 재사용 여부는 파일 단위로 판단했다.

| ai_packet_assistant 파일 | 재사용 여부 | 이유 |
|---|---|---|
| `ai_explainer.py`의 "rule_based 우선 + AI 실패 시 자동 폴백" 구조 | ✅ 재사용 | packet_summary.json이 없어도(API 키 없어도) 항상 diagnosis.json이 나와야 함. 이전 프로젝트에서 이미 검증된 패턴. |
| `.env`(OPENAI_API_KEY/OPENAI_MODEL) 로딩 방식 | ✅ 재사용 | 이미 쓰던 방식 그대로, 팀 내 일관성 유지. |
| `packet_parser.py` (pcap → 패킷 구조화) | ❌ 미사용 | 2번이 tshark 기반 `summarize_pcap.py`로 이미 대체함. 3번은 pcap을 직접 안 읽는다. |
| `nl_filter.py` (자연어→Wireshark 필터) | ❌ 미사용 | 이번 미션 3번 역할(원인 진단)과 관련 없음. |
| `app.py` (Streamlit UI) | ❌ 미사용(아직) | 지금은 CLI(`analyzer.py`)로 충분. `ai_report.html`이 필요해지면 그때 UI를 새로 판단. |

## 왜 이렇게 나눴는가

재사용 기준은 "이번 계약(`data_contract.md`)과 무관하게 안정적으로 통하는 설계 패턴인가"였다.
API 호출 실패 대응 구조나 환경변수 로딩처럼 **어떤 입력이든 상관없는 인프라성 코드**는 그대로
가져오고, pcap 파싱처럼 **입력 형식 자체가 이번엔 달라진 코드**는 새로 만들었다.

## rule_based_diagnose()의 판단 순서

`packet_ai_미션.html`의 "패킷 증거로 원인 후보 만들기" 표를 그대로 따랐다.
L2(ARP) → L3(ICMP) → DNS → TCP 순서로 검사하고, 먼저 막힌 계층에서 멈춘다.
(ARP가 안 됐으면 그 뒤 ICMP/DNS/TCP 결과는 확인할 수 없으므로 의미가 없음)

## 테스트

2번의 `origin/feat/2nd-part` 브랜치에 있는 `packet_summary.example.json`을
`tests/fixtures/`로 복사해서 테스트했다 (`evidence_source: "example"`이라 실제 진단에는
안 쓰고, 로직 검증 용도로만 사용).

```bash
python analyzer.py tests/fixtures/packet_summary.example.json -o /tmp/diagnosis.json
```

`feat/2nd-part`를 `jae`에 병합한 뒤, 2번이 만든 예제 4종(`02_packet_capture/examples/`:
정상/DNS 무응답/TCP RST/null 섞인 제한적 캡처) 전부에 대해 rule-based 경로를 검증함.
기대한 계층에서 정확히 멈추고, null을 0으로 오인하지 않음을 확인.

`--use-ai` 경로도 실제 OpenAI 호출로 검증함. 초기 버전은 ICMP/TCP처럼 이번 테스트에서
아예 시도되지 않은 계층(count=0)을 실패 근거로 오해해 무관한 Hypothesis를 만들어내는
문제가 있었음 → `_build_prompt()`에 "요청 카운트가 0보다 클 때만 그 계층을 실패로 본다,
첫 실패 계층에 집중한다" 규칙을 명시해 해결. 재검증 결과 DNS 무응답 사례에서 DNS 계층
내부 가설로만 좁혀짐.

## 1→2→3 파이프라인 실제 데이터 검증 (2026-09-28)

2번의 실제 캡처(`normal.pcapng`)를 `summarize_pcap.py extract`로 직접 처리해
`tests/fixtures/packet_summary_baseline.json`을 만들었다 (`evidence_source:
wireshark_capture`, 교육용 예제 아님). `validate` 통과, `packet_analysis.md`에
사람이 수동 검증한 집계값과 완전히 일치함을 확인했다. `analyzer.py`에 넣으면
`is_example: false`, 정상 판정(hypothesis 없음, root_cause: null)이 정확히 나온다.

실제 장애(fault) 캡처는 4번이 아직 case_id를 주지 않아 존재하지 않으므로,
2번의 교육용 예제 `examples/tcp_rst.json`을 `tests/fixtures/
packet_summary_fault_example.json`으로 복사해 fault 경로를 검증했다. 결과는
`evidence_source: example`, TCP/Application 계층, high 확신도로 정확히 나옴 —
`is_example` 플래그 덕분에 이 결과를 실제 진단 근거로 오인할 위험이 없음을 확인.

## 아직 안 한 것

- [ ] 실제 장애 `packet_summary.json`으로 검증 (4번의 case_id·실제 캡처 대기 중 —
      baseline은 실제 데이터로 검증 완료, fault는 예제로만 검증됨)
- [ ] `ai_report.html` (HTML 리포트 생성) — 필요 시점에 판단
- [ ] 4번(Network SRE) 착수 — 보류 중
