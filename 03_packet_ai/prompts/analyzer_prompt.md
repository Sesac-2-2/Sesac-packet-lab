# Analyzer Prompt (문서용 사본)

`analyzer.py`의 `_build_prompt()`가 실제로 만드는 프롬프트를 사람이 읽기 좋게 정리한 것.
코드가 원본이고 이 문서는 설명용이므로, 프롬프트를 바꾸면 이 파일도 같이 갱신한다.

## 지시문

```text
다음은 네트워크 장애 사례에서 관찰된 패킷 카운트 요약이다. 이 수치와 notes만 근거로
삼아 원인을 진단하라. case_id나 파일명에서 원인을 추측하지 말 것 (Blind Fault 원칙).

절차: Observe(관찰) → Evidence Summary(증거 요약) → Hypothesis 1/2/3(원인 후보) →
추가로 확인하면 좋을 것 → Root Cause(확신이 있을 때만) → Recovery Action 순서로
한국어로 답하라. count가 null인 필드는 '관찰되지 않음'으로 취급하고 0으로 단정하지 말 것.

{packet_summary.json 전체를 JSON으로 첨부}
```

## 왜 이렇게 설계했는가

- **case_id/파일명으로 추측 금지**: 미션 HTML이 "AI에게 장애 이름을 먼저 알려준 뒤 설명만
  생성하는 경우"를 피해야 할 형태로 명시했다. 2번도 `case_id`에 원인을 암시하는 단어를
  못 쓰게 검증기(`summarize_pcap.py`)로 막고 있으므로, 3번도 같은 원칙을 프롬프트에 명시한다.
- **절차를 강제로 지정**: 미션 HTML의 AI Agent 구성 예시(Observe→Evidence→Hypothesis→
  추가확인→Root Cause→Recovery)를 그대로 프롬프트에 넣어, 모델이 곧바로 "정답"을
  한 줄로 던지지 않고 근거부터 정리하게 한다.
- **null ≠ 0 을 프롬프트에도 명시**: data_contract.md 6절의 약속을 AI도 지키게 하기 위해
  모델 입력 단계에서부터 다시 강조한다. 이걸 안 넣으면 모델이 null을 0으로 취급해
  "응답 없음이 확인됨"처럼 과확신할 위험이 있다.

## 구조적 결과는 AI가 아니라 rule_based_diagnose()가 만든다

`evidence_summary`, `hypotheses`, `recommended_checks` 같은 JSON 필드는 AI 응답을 파싱해서
만들지 않는다. `rule_based_diagnose()`가 만든 값을 그대로 쓰고, AI 호출 결과는
`ai_narrative`라는 별도 필드에 서술형 텍스트로만 붙인다.

이유: LLM 응답에서 구조화된 필드를 파싱하면 모델이 형식을 살짝 어겼을 때 전체가 깨진다.
규칙 기반 결과를 뼈대로 쓰고 AI는 "설명을 풍부하게 하는 것"까지만 맡기면, `--use-ai` 없이도
`diagnosis.json`이 항상 안정적으로 나온다 (ai_packet_assistant의 rule-based fallback
설계와 같은 이유).
