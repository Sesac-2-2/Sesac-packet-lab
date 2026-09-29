# 04_incident_response — 4번 Network SRE

> 작성일: 2026-09-29 · 브랜치 `feat/4th-part` (기반: `feat/2nd-part`)
> 팀 정책 변경으로 4번 역할을 2번 담당자가 함께 맡는다. 이 폴더는 4번 범위만 다룬다.

## 1. 4번이 하는 일과 산출물

근거: 과제 HTML(저장소 루트 `packet_ai_미션.html`) 원문 (2026-09-29 대조). 4번 카드의 할 일 5개와 "개별 작업 기록 예시" 파일 3개를 따른다. 과제는 이 파일들을 **예시**로 제시한다(의무 파일명 아님).

| 과제 4번 할 일 (원문) | 이 폴더의 파일 | 상태 |
|---|---|---|
| 장애 시나리오 설계, 원인을 숨긴 장애 준비 | `fault.sh` (재현 실습망), `packet_tracer_faults.md` (Packet Tracer), `incident_cases.md` 1~2절 | 도구·절차 완료 · 두 환경 모두 실행 검증 전 |
| 복구 전/후 검증 | `fault.sh recover` / `verify`, `recovery_log.md` | 도구 완료 · 기록 대기 |
| Incident Report | `incident_cases.md` 3절 (사례별 보고) | 양식 완료 · 내용 대기 |
| 최종 Dashboard (Incident Report 화면 겸함) | `dashboard.html` + `incidents/incident_<case_id>.json` (`fault.sh export`) | 완료 · 실제 데이터 대기 |

**파일명 두 가지가 과제 HTML 안에 함께 있다.** 4번 카드는 `incident_cases.md`, `recovery_log.md`, `dashboard.html`을, "조원 간 공유 Pipeline" 그림은 4번 출력을 `incident_report.html`로 적는다. 루트 `README.md`(jae 브랜치)는 Pipeline 그림을 따랐다. **결정 (2026-09-29):** `incident_report.html`을 따로 만들지 않고 `dashboard.html`이 Pipeline 그림의 4번 출력(Incident Report 화면)을 겸한다. 사례별 Incident Report 원문은 `incident_cases.md` 3절에 둔다.

## 2. 파이프라인에서의 위치

```
1번 network_spec.md ─┐
                     ▼
4번 fault.sh apply ──► 2번 캡처·분석 ──► packet_summary_<case_id>.json ──► 3번 analyzer.py ──► diagnosis.json
   (익명 case_id)                                                                                  │
        ▲                                                                                           ▼
        └── 4번 reveal → recover → verify → export ◄── 2번 recovered 캡처 비교 ◄── 4번 incident_cases.md
                                               │
                                               ▼
                      dashboard.html ← packet_summary(Baseline/Fault/Recovered) + diagnosis + incident_<case_id>.json
```

## 3. Blind 분석 — 역할 겸임에 따른 위험

과제는 분석 담당자가 원인을 모르는 상태(Blind Fault)를 요구한다. 2번과 4번을 한 사람이 맡으면 장애를 건 사람이 분석하게 되어 Blind가 깨진다. `fault.sh`는 두 방식을 제공한다.

| 방식 | 명령 | Blind 수준 |
|---|---|---|
| **팀원 적용** (권장) | 다른 팀원이 `apply FAULT-01 --scenario <이름>` 실행 | 유지됨. `handoff_to_4_sre.md` 4절의 방식 A와 같음 |
| **무작위 적용** | 분석 담당자 본인이 `apply FAULT-01` 실행. 매번 7종 전체에서 무작위로 고르고(중복 가능) 화면에 출력하지 않음 | 약함. 7개 후보 중 무엇인지 모를 뿐, `/root/.packetlab_faults/`를 열면 정답이 보임 |

- 어떤 방식을 썼는지 `incident_cases.md`의 "적용 방식" 칸에 반드시 적는다. 무작위 방식은 발표·보고서에 "자체 적용, 약한 Blind"로 명시한다.
- 무작위 적용은 중복을 허용한다. 이미 쓴 시나리오를 빼고 고르면, 앞 사례의 정답이 공개될 때마다 남은 후보가 줄어 Blind가 더 약해지기 때문이다.
- Packet Tracer 재현(`packet_tracer_faults.md`)은 설정을 바꾸는 사람이 원인을 알게 되므로 Blind 분석에 쓰지 않는다. 시연·재현 확인용이다.
- **미결정:** 두 방식 중 무엇을 쓸지는 정하지 않았다(담당자 답변: 선호 없음).

## 4. 실행 순서 (사례 1건)

재현 실습망은 `02_packet_capture/lab_env/`에 있다. WSL2 Ubuntu에서 실행한다.

```bash
cd 02_packet_capture/lab_env && sudo ./lab.sh up          # 1번 명세 기준 정상 상태
cd ../../04_incident_response
sudo ./fault.sh apply FAULT-01                             # [4번] 장애 적용 (원인 출력 안 함)

cd ../02_packet_capture/lab_env                            # [2번] 캡처·분석 — status는 실행하지 않음
sudo ./lab.sh flush
sudo ./lab.sh capture start pc1 fault_FAULT-01.pcapng
sudo ./lab.sh test all
sudo ./lab.sh capture stop
#   → packet_analysis.md 기록, packet_summary_FAULT-01.json 생성, 3번 analyzer.py 실행

cd ../../04_incident_response
sudo ./fault.sh reveal FAULT-01                            # [4번] 분석 제출 후 정답 공개 → incident_cases.md 대조 기록
sudo ./fault.sh recover FAULT-01                           # [4번] 복구 → recovery_log.md 기록
sudo ./fault.sh verify FAULT-01                            # [4번] 설정이 1번 명세와 같은지 확인, 결과를 사례에 기록

cd ../02_packet_capture/lab_env                            # [2번] 같은 테스트로 복구 후 캡처
sudo ./lab.sh flush
sudo ./lab.sh capture start pc1 recovered_FAULT-01.pcapng
sudo ./lab.sh test all
sudo ./lab.sh capture stop
#   → packet_summary(recovered) 생성, recovery_log.md 4절 비교표

cd ../../04_incident_response                              # [4번] AI 진단과 실제 원인 일치 판정 후 Dashboard용 파일 생성
sudo ./fault.sh export FAULT-01 --ai-match match --note "diagnosis 1순위 가설 계층이 실제 원인과 같음"
#   → incidents/incident_FAULT-01.json. dashboard.html에서 packet_summary 3종 + diagnosis.json과 함께 불러온다
```

- 한 번에 장애 하나만 걸린다. 이전 사례를 복구하기 전에는 `apply`가 거부된다.
- `reveal` 전에는 `recover`, `verify`(사례 기록), `export`가 거부된다(원인이 드러나므로). `recover`만 `--force`로 강제할 수 있다.
- `--ai-match`는 사람이 판정한다(`match` / `partial` / `mismatch` / `unchecked`). `unchecked`가 아니면 `--note`에 근거를 적어야 한다.
- `lab.sh down && up`으로 실습망을 새로 만들면 모든 장애가 사라진다. 이때는 `sudo ./fault.sh close FAULT-01`로 기록만 닫는다.

## 5. 지원 시나리오

`./fault.sh scenarios`로 확인한다. 과제 수행 단계 3의 장애 A~F 6종과, 권장 장애 시나리오 표(F01~F06)에만 있는 SVI Down을 합쳤다. 반대로 Subnet Mask 오류는 단계 3에만 있고 권장 표에는 없다. **이 7종을 과제의 공식 장애 목록으로 보지 않는다.** 실제로 몇 건을 쓸지는 미결정이다.

| 이름 | 장애 | 재현 실습망에서 바꾸는 값 |
|---|---|---|
| `gateway` | Default Gateway 오류 | PC1 기본 경로 192.168.10.1 → 192.168.10.254 |
| `access_vlan` | Access VLAN 오류 | SW1 Fa0/1(PC1) Access VLAN 10 → 20 |
| `trunk_vlan` | Trunk 허용 VLAN 누락 | SW1 Gi0/1 허용 VLAN에서 10 제거 |
| `svi_down` | SVI Down | MLS1 Vlan10 SVI down |
| `dns_server` | DNS Server 설정 오류 | PC1 DNS Server 192.168.20.20 → 192.168.20.99 |
| `subnet_mask` | Subnet Mask 오류 | PC1 /24 → /16 |
| `web_port` | Server TCP Port 서비스 중단 | Server TCP/80 웹 서비스 중지 |

- 장애 대상은 모두 PC1 쪽이다. 2번의 테스트 6종이 PC1에서 시작하기 때문이다(`handoff_to_4_sre.md` 7절).
- `.254`, `.99`, `/16`은 **4번이 정한 값**이다(1번 명세에 없음). `fault.sh` 상단 상수에서 바꾼다.
- 이 시나리오가 만드는 패킷은 실행 전에는 알 수 없다. 특정 설정 오류가 항상 같은 패킷을 만든다고 기록하지 않는다.

## 6. 검증 상태

| 항목 | 결과 |
|---|---|
| `bash -n`, `shellcheck -x` | 통과 |
| `DRY_RUN=1`로 7개 시나리오 apply/recover 명령 출력 확인, 무작위 선택, case_id 규칙, 중복·순서 거부 | 통과 |
| **실제 재현 실습망에서 apply → 테스트 → recover → verify** | **미실행.** 작업 환경의 커널이 bridge `vlan_filtering`을 지원하지 않아 `lab.sh up`이 실패했다. WSL2에서 직접 실행해야 한다 |
| `DRY_RUN=1`로 `export`: 공개 전 거부, `--ai-match` 근거 누락 거부, JSON 생성, 20회 무작위 적용에서 중복 선택 확인 | 통과 (`verify` 결과는 실습망 없이 만들 수 없어 수동으로 넣은 값으로 export 확인) |
| `dashboard.html` (jsdom) | 2번 실제 Baseline JSON + 3번 `analyzer.py` rule-based 결과 + 교육용 예제 JSON 표시, 잘못된 입력 3종(배열 최상위·깨진 JSON·음수 count) 오류 표시, JSON 문자열의 HTML 미실행, 초기화 확인 | 통과 |
| `dashboard.html` 진행 단계 (jsdom) | 정답 공개 전: 1~3단계만 완료, 4단계 "정답 공개 전 (Blind)". incident JSON + Recovered 요약을 더하면 5단계 모두 완료, 실제 원인·설정 검증 표 표시. `revealed_at` 없는 incident JSON 거부 | 통과. Fault 요약은 교육용 예제를 case_id만 바꿔 썼다. 실제 브라우저·모바일 화면은 미확인 |
| `packet_tracer_faults.md` | **미실행.** 작업 환경에 Packet Tracer가 없다 |

WSL2에서 먼저 확인할 것: 각 시나리오를 `--scenario`로 적용 → `sudo ./lab.sh test all` → `recover` → `verify`가 "다름 0"인지. 결과를 이 표에 기록한다.

## 7. 1번 명세와 대조한 결과

- `topology.conf`는 Trunk 허용 VLAN(10, 20)을 "임시값, 1번 명세에 없음"으로 표시한다. 그러나 `01_network_design/network_spec.md`(jae 브랜치) 3절 포트 매핑에 **"Trunk (VLAN10,20 허용)"이 명시되어 있다.** 2번 파일이라 이 브랜치에서는 고치지 않았다.
- 단, 1번의 실제 설정 스크립트는 명세와 다르다. `configs/sw_a.txt`, `sw_b.txt`의 Gi0/1은 허용 목록 없이 `switchport mode trunk`만 있어 **모든 VLAN을 허용**한다. `10,20` 제한은 `l3_switch.txt`의 Gi0/1·Gi0/2에만 있다. 1번에게 어느 쪽이 의도인지 확인이 필요하다. Trunk 장애의 Packet Tracer 복구 명령은 설정 스크립트 기준으로 썼다(`packet_tracer_faults.md` 3-3).
- `network_spec.md`는 스위치 이름을 SW-A/SW-B/L3 Switch로, `packet_analyst_handoff.md`와 `topology.conf`는 SW1/SW2/MLS1로 쓴다. 이 폴더는 실습망과 같은 SW1/SW2/MLS1을 쓴다.

## 8. 2번 문서(handoff_to_4_sre.md 12절) 질문에 대한 답

| # | 질문 | 답 |
|---|---|---|
| 1 | 적용 방식 A/B/C | 미결정. `fault.sh`는 A(팀원 적용)와 자체 무작위 적용을 지원. B는 다른 팀원 PC에 실습망을 만들면 같은 명령으로 가능. C(명령 파일 전달)는 지원하지 않음 |
| 2 | 사례 수, 첫 진행 시각 | 미결정 |
| 3 | PC1 외 PC에서 보이는 사례 | 없음. 모든 시나리오가 PC1 테스트로 관찰되도록 설계 |
| 4 | Packet Tracer에서도 재현하는가 | 재현한다. 절차는 `packet_tracer_faults.md`. 시연·재현 확인용이며 Blind 분석과 `.pcapng`는 재현 실습망에서 한다 |
| 5 | 복구 후 비교 결과 형식 | `recovery_log.md` 4절 표 형식으로 받음 |
| 6 | 발표용 대표 사례 | 미결정 |

## 9. 과제 항목 대조 (packet_ai_미션.html)

| 과제 항목 | 대응 | 상태 |
|---|---|---|
| 4번 할 일: 장애 시나리오 설계 | `fault.sh` 7종, `packet_tracer_faults.md` | 완료 (실행 검증 전) |
| 4번 할 일: 원인을 숨긴 장애 상황 준비 | `apply`는 원인 미출력, 정답은 저장소 밖, `reveal` 전 `recover`·`verify`·`export` 거부 | 완료. 역할 겸임으로 Blind 방식 미결정 (3절) |
| 4번 할 일: 복구 전/후 검증 | `recover` → `verify` + 2번 Recovered 캡처 비교 | 도구 완료 · 기록 대기 |
| 4번 할 일: Incident Report | `incident_cases.md` 3절, `dashboard.html` | 양식 완료 · 내용 대기 |
| 4번 할 일: 최종 Dashboard | `dashboard.html` | 완료 · 실제 데이터 대기 |
| 단계 3: 4번이 설정 일부를 바꿔 장애를 만들고, 다른 조원은 증상과 패킷으로 원인을 좁힘 | 3·4절 | 완료. 다른 조원이 분석하지 않으면 Blind가 약해짐 |
| 단계 7: 장애 전 증거 저장 / 수정 명령 기록 / ping·DNS·TCP 재검증 / 정상 패킷과 비교 / AI 진단과 실제 원인 일치 확인 | `recovery_log.md` 1절 대응표, `export --ai-match` | 양식·도구 완료 · 기록 대기 |
| 마무리 기준 "Packet Tracer: 설정을 바꾸었을 때 증상을 재현" | `packet_tracer_faults.md` | 절차 완료 · PT 실행 전 |
| 마무리 기준 "장애 기록: 증상 → 관찰한 증거 → 생각한 원인 → 조치 → 복구 확인" | `incident_cases.md` 3절 순서 | 완료 |
| 마무리 체크 "장애 복구 전/후를 패킷으로 비교했다" | `recovery_log.md` 4절, Dashboard Baseline/Fault/Recovered 표 | 도구 완료 · 캡처 대기 |
| 마무리 체크 "여러 종류의 장애 상황을 재현해 비교해보았다" | 사례 수 미결정 | **미결정** |
| 마무리 체크 "최종 Demo에서 장애 발생→분석→AI진단→복구를 보여준다" | Dashboard 사례별 5단계 표시, 10절 시연 순서 | 완료 · 실제 데이터 대기 |
| 마무리 체크 "모든 개인 결과물이 팀 Pipeline에서 사용되었다" | Dashboard가 2번 `packet_summary`, 3번 `diagnosis`, 4번 `incident`를 함께 읽음. 1번 명세는 `topology.conf`·`verify` 기준값으로 사용 | 연결 완료 · 실제 사례 대기 |
| 피할 형태 "AI에게 장애 이름을 먼저 알려준 뒤 설명만 생성" | case_id `FAULT-NN`만 사용, 정답은 export 파일에만, export는 reveal 후에만 | 완료 |
| 개인 작업 정리 항목 (역할, 만든 파일, 판단 근거, 전달한 데이터, 받은 데이터와 연결, 해결한 장애 1건 이상) | 11절 | "해결한 장애"는 사례 진행 후 작성 |

## 10. 발표 시연 순서 (4번 담당 구간)

과제 발표 흐름 중 4번이 맡는 구간이다. 시간은 과제 HTML 기준.

| 과제 구간 | 4번이 보여 줄 것 |
|---|---|
| 1분 — Blind Fault 발생 | `sudo ./fault.sh apply FAULT-NN` 실행 화면(원인 미출력). Dashboard에 incident 파일 없이 packet_summary만 불러와 4단계 "정답 공개 전 (Blind)" 표시 |
| 1분 — 수정/복구 | `reveal` → `recover` → `verify FAULT-NN` 결과. Packet Tracer에서는 `packet_tracer_faults.md`의 복구 명령 |
| 1분 — 복구 후 패킷 비교 및 회고 | `export` 후 Dashboard에 incident 파일과 Recovered 요약을 추가해 5단계 완료, Baseline/Fault/Recovered 표, AI 일치 판정 |

## 11. 개인 작업 정리 (과제 "각자 작업을 정리할 때 포함하면 좋은 내용")

| 항목 | 내용 |
|---|---|
| 맡은 역할 | 4번 Network SRE (2번 Packet Analyst 겸임, 팀 정책 변경) |
| 만든 파일 | `fault.sh`, `packet_tracer_faults.md`, `incident_cases.md`, `recovery_log.md`, `dashboard.html`, `incidents/` |
| 판단 근거 | 과제 HTML 4번 카드·단계 3·단계 7·마무리 기준, 1번 `network_spec.md`·설정 스크립트, 2번 `handoff_to_4_sre.md` |
| 다음 팀원에게 전달한 데이터 | 2번에게 익명 `case_id`와 증상, 장애 적용·복구 시각. 팀 전체에 Dashboard |
| 받은 데이터와 연결 | 1번 명세 → 장애 값·`verify` 기준. 2번 `packet_summary` → Dashboard 비교표. 3번 `diagnosis.json` → AI 일치 판정 |
| 해결한 장애 1건 이상 | <사례 진행 후 작성> |
