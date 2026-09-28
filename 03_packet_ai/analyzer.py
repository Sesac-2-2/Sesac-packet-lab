"""3번(AI Engineer): packet_summary.json(2번 산출물)을 읽어 원인 후보를 진단하고
diagnosis.json을 만든다.

흐름 (packet_ai_미션.html의 AI Agent 구성 예시를 따름):
    Observe → Evidence Summary → Hypothesis 1/2/3 → 추가 확인 제안 → Root Cause → Recovery Action

use_ai=False (기본) 이면 rule_based_diagnose()만 쓴다.
use_ai=True  이면 OpenAI를 호출해 서술형 진단을 받고, 실패하면 rule_based_diagnose()로
             자동 대체한다.
             이 "rule-based 우선 + AI 실패시 자동 폴백" 구조는 ai_packet_assistant의
             ai_explainer.py에서 그대로 가져왔다 (같은 팀, 같은 실패 대응 방식을 쓰기 위함).
"""

import argparse
import json
import os
import sys

import openai
from dotenv import load_dotenv

load_dotenv()

MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

BASE_FIELDS = [
    "case_id", "source_ip", "destination_ip",
    "arp_request_count", "arp_reply_count",
    "icmp_request_count", "icmp_reply_count",
    "dns_query_count", "tcp_syn_count", "notes",
]


def load_summary(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    # 2번의 summarize_pcap.py validate가 이미 상세 검증을 하므로, 여기서는
    # "3번이 최소한 동작은 해야 하는" 필수 필드 존재 여부만 다시 확인한다.
    missing = [f for f in BASE_FIELDS if f not in data]
    if missing:
        raise ValueError(f"packet_summary.json에 필수 필드가 없습니다: {missing}")

    return data


def _is_example(data):
    return data.get("evidence_source") == "example"


def _fmt(value, label):
    """count 필드를 사람이 읽는 문장으로 바꾼다. null은 '모름'으로 표시하고
    0으로 바꾸지 않는다 (data_contract.md 6절 약속)."""
    if value is None:
        return f"{label}: 관찰 안 됨(모름)"
    return f"{label}: {value}건"


def rule_based_diagnose(data):
    """미션 HTML '패킷 증거로 원인 후보 만들기' 표의 L2(ARP) → L3(ICMP) → DNS → TCP
    순서를 그대로 따른다. 상위 계층이 이미 실패했다면 하위 계층 결과는 의미가 없으므로
    (예: ARP가 안 됐으면 ICMP도 당연히 안 됨) 실패를 발견한 첫 단계에서 멈춘다."""

    arp_req = data.get("arp_request_count")
    arp_rep = data.get("arp_reply_count")
    icmp_req = data.get("icmp_request_count")
    icmp_rep = data.get("icmp_reply_count")
    dns_q = data.get("dns_query_count")
    dns_r = data.get("dns_response_count")
    tcp_syn = data.get("tcp_syn_count")
    tcp_synack = data.get("tcp_syn_ack_count")
    tcp_rst = data.get("tcp_rst_count")

    evidence_summary = [
        _fmt(arp_req, "ARP Request"), _fmt(arp_rep, "ARP Reply"),
        _fmt(icmp_req, "ICMP Echo Request"), _fmt(icmp_rep, "ICMP Echo Reply"),
        _fmt(dns_q, "DNS Query"), _fmt(dns_r, "DNS Response"),
        _fmt(tcp_syn, "TCP SYN"), _fmt(tcp_synack, "TCP SYN-ACK"), _fmt(tcp_rst, "TCP RST"),
    ]

    hypotheses = []
    recommended_checks = []
    root_cause = None

    if arp_req is not None and arp_req > 0 and arp_rep == 0:
        hypotheses.append({
            "id": 1,
            "layer": "L2 (ARP)",
            "description": "ARP Request는 나갔지만 Reply가 없다 — 찾는 IP(Gateway 또는 목적지)가 "
                            "응답하지 않는다.",
            "possible_causes": ["Gateway IP 오설정", "VLAN 오설정", "SVI Down", "대상 장비 다운"],
            "confidence": "medium",
        })
        recommended_checks += [
            "PC의 ipconfig로 실제 설정된 Gateway 주소 확인",
            "analysis_scope.arp_targets에 어떤 IP를 찾았는지 확인",
            "L3 Switch에서 show vlan brief / show ip interface brief 확인",
        ]

    elif icmp_req is not None and icmp_req > 0 and icmp_rep == 0:
        hypotheses.append({
            "id": 1,
            "layer": "L3 (ICMP)",
            "description": "ARP까지는 성공했지만(Gateway MAC 확보) ICMP Reply가 없다 — "
                            "라우팅 또는 목적지 자체 문제로 보인다.",
            "possible_causes": ["Inter-VLAN Routing 미설정", "목적지 장비 다운", "중간 경로 차단"],
            "confidence": "medium",
        })
        recommended_checks += [
            "L3 Switch에서 show ip route 확인",
            "목적지 장비의 전원/인터페이스 상태 확인",
        ]

    elif dns_q is not None and dns_q > 0 and (dns_r == 0 or dns_r is None):
        hypotheses.append({
            "id": 1,
            "layer": "DNS",
            "description": "IP 통신(ARP/ICMP)은 정상인데 DNS 질의에 대한 응답이 없다.",
            "possible_causes": ["DNS 서버 IP 오설정", "DNS 서비스 중단", "DNS 서버로 가는 경로 차단"],
            "confidence": "medium" if dns_r == 0 else "low",
        })
        recommended_checks += ["PC의 DNS 서버 설정값 확인", "DNS 서버 서비스 상태 확인"]

    elif tcp_syn is not None and tcp_syn > 0:
        if tcp_rst is not None and tcp_rst > 0:
            hypotheses.append({
                "id": 1,
                "layer": "TCP/Application",
                "description": "SYN을 보냈고 서버가 RST로 응답했다 — 서버까지는 도달했지만 "
                                "해당 포트의 서비스가 꺼져 있거나 거부한다.",
                "possible_causes": ["Server의 해당 포트 서비스 중단", "방화벽의 명시적 차단(RST)"],
                "confidence": "high",
            })
            root_cause = "Server TCP Port 서비스 중단 (SYN 도달, RST 응답으로 서버 도달은 확인됨)"
            recommended_checks += ["Server에서 해당 포트 서비스(예: 웹 서버) 실행 여부 확인"]
        elif not tcp_synack:
            hypotheses.append({
                "id": 1,
                "layer": "TCP/Application",
                "description": "SYN을 보냈지만 SYN-ACK도 RST도 없다 — 응답 자체가 없다. "
                                "서버가 다운됐거나 방화벽이 조용히 버리고 있을 수 있다.",
                "possible_causes": ["Server 다운", "방화벽의 무응답 차단(DROP)", "경로 중간 차단"],
                "confidence": "low",
            })
            recommended_checks += [
                "Server 쪽에서 직접 캡처해 SYN 도달 여부 확인 (현재 캡처는 한 지점뿐)",
                "중간 장비(L3 Switch 등) ACL/방화벽 설정 확인",
            ]

    if not hypotheses:
        hypotheses.append({
            "id": 1,
            "layer": "-",
            "description": "제공된 카운트만으로는 뚜렷한 실패 지점이 보이지 않는다.",
            "possible_causes": [],
            "confidence": "low",
        })
        recommended_checks.append("더 넓은 시간 구간 또는 다른 캡처 지점에서 재확인 필요")

    limitations = list(data.get("limitations") or [])
    if _is_example(data):
        limitations.insert(0, "[교육용 예제] 이 입력은 evidence_source=example이라 실제 진단 근거로 쓸 수 없다.")

    return {
        "case_id": data.get("case_id"),
        "evidence_source": data.get("evidence_source"),
        "is_example": _is_example(data),
        "evidence_summary": evidence_summary,
        "hypotheses": hypotheses,
        "recommended_checks": recommended_checks,
        "root_cause": root_cause,
        "recovery_action": None,
        "limitations_considered": limitations,
        "generated_by": "rule_based",
    }


def _build_prompt(data):
    return (
        "다음은 네트워크 장애 사례에서 관찰된 패킷 카운트 요약이다. 이 수치와 notes만 근거로 "
        "삼아 원인을 진단하라. case_id나 파일명에서 원인을 추측하지 말 것 (Blind Fault 원칙).\n\n"
        "절차: Observe(관찰) → Evidence Summary(증거 요약) → Hypothesis 1/2/3(원인 후보) → "
        "추가로 확인하면 좋을 것 → Root Cause(확신이 있을 때만) → Recovery Action 순서로 "
        "한국어로 답하라. count가 null인 필드는 '관찰되지 않음'으로 취급하고 0으로 단정하지 말 것.\n\n"
        "계층은 ARP → ICMP → DNS → TCP 순서로만 검토할 것. 각 계층은 그 계층의 요청 "
        "카운트(arp_request_count/icmp_request_count/dns_query_count/tcp_syn_count)가 "
        "0보다 크면서 그에 대응하는 응답이 없거나 0일 때만 '실패'로 본다. 요청 카운트 자체가 "
        "0이거나 null인 계층은 이번 테스트에서 애초에 시도되지 않은 것이니 실패 근거로 쓰지 "
        "말 것. 더 앞선 계층에서 이미 실패 지점을 찾았다면 그 뒤 계층은 결과를 알 수 없으므로 "
        "별도의 Hypothesis로 만들지 말고, 발견한 첫 실패 계층 하나에 집중할 것.\n\n"
        f"{json.dumps(data, ensure_ascii=False, indent=2)}"
    )


def ai_diagnose(data, api_key=None):
    client = openai.OpenAI(api_key=api_key) if api_key else openai.OpenAI()
    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": _build_prompt(data)}],
    )
    text = response.choices[0].message.content or ""

    result = rule_based_diagnose(data)  # 구조화된 필드(evidence_summary 등)는 규칙 기반 결과를 그대로 쓰고
    result["ai_narrative"] = text        # AI의 서술형 진단만 추가한다 — JSON 구조가 항상 안정적으로 나오게 하기 위함
    result["generated_by"] = f"openai:{MODEL}"
    return result


def diagnose(data, use_ai=False, api_key=None):
    if not use_ai:
        return rule_based_diagnose(data)
    try:
        return ai_diagnose(data, api_key=api_key)
    except Exception as e:
        result = rule_based_diagnose(data)
        result["ai_error"] = f"AI 호출 실패, 규칙 기반 결과로 대체함: {e}"
        return result


def main():
    parser = argparse.ArgumentParser(description="packet_summary.json -> diagnosis.json")
    parser.add_argument("input", nargs="?", default="packet_summary.json",
                         help="packet_summary.json 경로 (기본: 현재 폴더의 packet_summary.json)")
    parser.add_argument("--case", help="packet_summary_<case_id>.json 을 대신 읽는다")
    parser.add_argument("--use-ai", action="store_true", help="OpenAI로 서술형 진단 추가")
    parser.add_argument("--api-key", default=None)
    parser.add_argument("-o", "--output", default="diagnosis.json")
    args = parser.parse_args()

    input_path = f"packet_summary_{args.case}.json" if args.case else args.input

    try:
        data = load_summary(input_path)
    except FileNotFoundError:
        print(f"파일을 찾을 수 없습니다: {input_path}", file=sys.stderr)
        sys.exit(1)

    result = diagnose(data, use_ai=args.use_ai, api_key=args.api_key)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"{args.output} 생성됨 (case_id={result.get('case_id')}, generated_by={result.get('generated_by')})")


if __name__ == "__main__":
    main()
