#!/usr/bin/env python3
"""Packet.AI 2번 Packet Analyst — 실제 캡처(.pcapng) 요약 추출 · JSON 검증 도구

용도
  extract : 실제 .pcapng를 tshark로 읽어 packet_summary.json(단일 사례 객체)을 만든다.
  validate: packet_summary.json이 data_contract.md 규칙을 지키는지 검사한다.
  filters : 각 count를 Wireshark에서 똑같이 다시 셀 수 있는 display filter를 출력한다.

왜 tshark인가
  - Wireshark와 같은 해석 엔진(dissector)을 쓰므로, 도구 결과와 Wireshark 화면의
    수동 확인 결과를 같은 display filter로 1:1 비교할 수 있다.
  - Python 패킷 라이브러리(scapy 등)는 DNS/TCP 필드 해석이 Wireshark와 달라질 수 있다.

주의
  - 이 도구는 원인을 판단하지 않는다. 관찰된 패킷 수와 프레임 번호만 뽑는다.
  - 결과 JSON의 notes/evidence는 관찰 사실만 담는다. 해석은 packet_analysis.md에 쓴다.

예시
  python3 summarize_pcap.py extract fault_FAULT-03.pcapng --case-id FAULT-03 \\
      --source-ip 192.168.10.10 --destination-ip 192.168.20.20 --next-hop 192.168.10.1 \\
      --capture-point "PC1 NIC (SW-A Fa0/1)" --test-description "10:02:00 ping -n 4 192.168.20.20" \\
      -o packet_summary.json
  python3 summarize_pcap.py validate packet_summary.json

Windows 11
  - python3 대신 py 를 쓴다:  py summarize_pcap.py extract ...
  - tshark가 PATH에 없어도 Windows 설치 정보(레지스트리)의 Wireshark 설치 위치와
    C:\\Program Files\\Wireshark 를 차례로 찾는다. 그래도 못 찾으면 --tshark 로 경로를 준다.
  - PowerShell에서 줄을 나눌 때는 \\ 대신 ` (백틱)을 쓴다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys

SCHEMA_VERSION = "0.1-draft"
SUPPORTED_VERSIONS = ["0.1-draft"]
EXAMPLE_MARK = "[교육용 예제]"
BASE_FIELDS = ["case_id", "source_ip", "destination_ip", "arp_request_count", "arp_reply_count",
               "icmp_request_count", "icmp_reply_count", "dns_query_count", "tcp_syn_count", "notes"]
BASE_COUNTS = ["arp_request_count", "arp_reply_count", "icmp_request_count", "icmp_reply_count",
               "dns_query_count", "tcp_syn_count"]
EXTRA_COUNTS = ["dns_response_count", "tcp_syn_ack_count", "tcp_rst_count"]
ALL_COUNTS = BASE_COUNTS + EXTRA_COUNTS
EXTRA_FIELDS = ["schema_version", "capture_file", "evidence_source", "capture_point", "test_description",
                "analysis_scope", "dns_response_count", "tcp_syn_ack_count", "tcp_rst_count", "evidence",
                "limitations", "null_reasons"]
EVIDENCE_SOURCES = ["wireshark_capture", "packet_tracer_simulation", "example"]
REF_TYPES = ["frame", "pt_event", "example_event"]
HINT_WORDS = ["gateway", "gw", "vlan", "trunk", "svi", "dns", "mask", "subnet", "port", "web", "http", "tcp", "arp", "icmp"]

EXIT_USAGE, EXIT_NO_TSHARK, EXIT_BAD_FILE, EXIT_EMPTY, EXIT_INVALID = 1, 2, 3, 4, 5

TSHARK_FIELDS = ["frame.number", "frame.time_epoch", "frame.time_relative", "arp.opcode",
                 "arp.src.proto_ipv4", "arp.dst.proto_ipv4", "ip.src", "ip.dst", "icmp.type", "icmp.code",
                 "dns.flags.response", "dns.flags.rcode", "dns.qry.name", "dns.a",
                 "tcp.flags.syn", "tcp.flags.ack", "tcp.flags.reset", "tcp.srcport", "tcp.dstport"]


# ---------------------------------------------------------------- validation
def _is_ipv4(v) -> bool:
    if not isinstance(v, str):
        return False
    parts = v.split(".")
    return len(parts) == 4 and all(re.fullmatch(r"\d{1,3}", p) and int(p) <= 255 and str(int(p)) == p for p in parts)


def _is_count(v) -> bool:
    return v is None or (isinstance(v, int) and not isinstance(v, bool) and v >= 0)


def _hint_words(v) -> list[str]:
    if not isinstance(v, str):
        return []
    tokens = re.split(r"[^a-z0-9]+", v.lower())
    return [w for w in HINT_WORDS if w in tokens]


def validate(obj) -> dict:
    """data_contract.md 7절 규칙. learning_lab/js/schema.js 와 같은 규칙이다."""
    errors: list[dict] = []
    warnings: list[dict] = []

    def err(f, m):
        errors.append({"field": f, "message": m})

    def warn(f, m):
        warnings.append({"field": f, "message": m})

    if not isinstance(obj, dict):
        err("(root)", "최상위가 배열입니다. 과제 형식은 사례 하나를 담은 단일 객체입니다 (여러 사례 형식은 아직 합의 전)."
            if isinstance(obj, list) else "최상위가 JSON 객체가 아닙니다.")
        return {"errors": errors, "warnings": warnings, "valid": False}

    for f in BASE_FIELDS:
        if f not in obj:
            err(f, "필수 필드가 없습니다 (과제 HTML 기본 필드).")
    if "case_id" in obj and (not isinstance(obj["case_id"], str) or not obj["case_id"].strip()):
        err("case_id", "비어 있지 않은 문자열이어야 합니다.")
    for f in ("source_ip", "destination_ip"):
        if f in obj and not _is_ipv4(obj[f]):
            err(f, f"IPv4 주소 형식(예: 192.168.10.10)이어야 합니다. 지금 값: {json.dumps(obj[f], ensure_ascii=False)}")
    if "notes" in obj and not isinstance(obj["notes"], str):
        err("notes", "문자열이어야 합니다.")

    null_reasons = obj.get("null_reasons", {})
    if "null_reasons" in obj and not isinstance(null_reasons, dict):
        err("null_reasons", "객체여야 합니다 (예: {\"dns_query_count\": \"capture filter가 icmp만 저장\"}).")
        null_reasons = {}
    for f in ALL_COUNTS:
        if f not in obj:
            continue
        v = obj[f]
        if not _is_count(v):
            err(f, f"0 이상의 정수 또는 null이어야 합니다. 지금 값: {json.dumps(v, ensure_ascii=False)}")
        elif v is None and not (isinstance(null_reasons.get(f), str) and null_reasons.get(f).strip()):
            err(f, f"null이면 null_reasons.{f}에 이유가 있어야 합니다 (미수집·미분석·관찰 불가를 0과 구분하기 위해).")

    if "schema_version" in obj:
        if obj["schema_version"] not in SUPPORTED_VERSIONS:
            err("schema_version", f"지원하지 않는 버전입니다: {json.dumps(obj['schema_version'])} (지원: {', '.join(SUPPORTED_VERSIONS)})")
    else:
        warn("schema_version", "없습니다. 과제 HTML 기본 형식으로 처리합니다.")

    src = obj.get("evidence_source")
    if "evidence_source" in obj and src not in EVIDENCE_SOURCES:
        err("evidence_source", f"허용값이 아닙니다: {json.dumps(src)} (허용: {', '.join(EVIDENCE_SOURCES)})")
    if isinstance(obj.get("notes"), str):
        marked = EXAMPLE_MARK in obj["notes"]
        if src == "example" and not marked:
            err("notes", f"교육용 예제(evidence_source = example)는 notes에 \"{EXAMPLE_MARK}\" 표시가 있어야 합니다.")
        if src and src != "example" and marked:
            err("notes", f"실제 증거(evidence_source = {src})인데 \"{EXAMPLE_MARK}\" 표시가 있습니다.")
        if "evidence_source" not in obj and marked:
            warn("evidence_source", "notes에 교육용 표시가 있습니다. evidence_source: \"example\"을 함께 적어 주세요.")

    for f in ("case_id", "capture_file"):
        h = _hint_words(obj.get(f))
        if h:
            err(f, f"원인을 암시하는 단어({', '.join(h)})가 있습니다. Blind Fault 입력이 오염됩니다. 익명 ID(예: FAULT-03)를 쓰세요.")

    if "evidence" in obj:
        ev = obj["evidence"]
        if not isinstance(ev, list):
            err("evidence", "배열이어야 합니다.")
        else:
            for i, e in enumerate(ev):
                f = f"evidence[{i}]"
                if not isinstance(e, dict):
                    err(f, "객체여야 합니다.")
                    continue
                if not (isinstance(e.get("observation"), str) and e["observation"].strip()):
                    err(f + ".observation", "관찰 내용(문자열)이 필요합니다.")
                if e.get("ref_type") not in REF_TYPES:
                    err(f + ".ref_type", "허용값: " + ", ".join(REF_TYPES))
                fn = e.get("frame_number")
                if e.get("ref_type") == "frame" and not (isinstance(fn, int) and not isinstance(fn, bool) and fn >= 1):
                    err(f + ".frame_number", "ref_type이 frame이면 1 이상의 정수 frame_number가 필요합니다.")
                if e.get("ref_type") == "pt_event" and not (isinstance(e.get("event_id"), str) and e["event_id"].strip()):
                    err(f + ".event_id", "ref_type이 pt_event이면 event_id(문자열)가 필요합니다.")
                if src == "wireshark_capture" and e.get("ref_type") and e.get("ref_type") != "frame":
                    warn(f + ".ref_type", "Wireshark 캡처 증거인데 ref_type이 frame이 아닙니다.")

    if "limitations" in obj:
        lim = obj["limitations"]
        if not isinstance(lim, list) or not all(isinstance(x, str) for x in lim):
            err("limitations", "문자열 배열이어야 합니다.")
    else:
        warn("limitations", "없습니다. 이 캡처로 알 수 없는 것을 적어 두면 3번이 과신하지 않습니다.")

    if "analysis_scope" in obj:
        sc = obj["analysis_scope"]
        if not isinstance(sc, dict):
            err("analysis_scope", "객체여야 합니다.")
        else:
            if "count_basis" in sc:
                cb = sc["count_basis"]
                if not isinstance(cb, dict):
                    err("analysis_scope.count_basis", "객체여야 합니다.")
                else:
                    if cb.get("unit") not in ("packets", "transactions"):
                        err("analysis_scope.count_basis.unit", "packets 또는 transactions 이어야 합니다.")
                    if not isinstance(cb.get("retransmissions_included"), bool):
                        err("analysis_scope.count_basis.retransmissions_included", "true/false 여야 합니다.")
            else:
                warn("analysis_scope.count_basis", "없습니다. 패킷 수인지 고유 요청 수인지 알 수 없습니다.")
            if "arp_targets" in sc and not (isinstance(sc["arp_targets"], list) and all(_is_ipv4(x) for x in sc["arp_targets"])):
                err("analysis_scope.arp_targets", "IPv4 문자열 배열이어야 합니다.")
    else:
        warn("analysis_scope", "없습니다. 어떤 구간·필터·기준으로 셌는지 3번이 알 수 없습니다.")

    syn = obj.get("tcp_syn_count")
    if isinstance(syn, int) and not isinstance(syn, bool) and syn > 0 and "tcp_syn_ack_count" not in obj:
        warn("tcp_syn_ack_count", "SYN은 있는데 SYN-ACK 집계가 없습니다. 응답 유무를 판단하기 어렵습니다.")

    for k in obj:
        if k not in BASE_FIELDS and k not in EXTRA_FIELDS:
            warn(k, "계약에 없는 필드입니다. 3번 프로그램은 무시할 수 있습니다.")

    return {"errors": errors, "warnings": warnings, "valid": not errors}


# ---------------------------------------------------------------- filters
def field_filters(src: str, dst: str, arp_targets: list[str]) -> dict:
    """각 count의 정의를 Wireshark display filter로 표현. 수동 검증에 그대로 쓴다."""
    tgt_dst = " || ".join(f"arp.dst.proto_ipv4 == {t}" for t in arp_targets)
    tgt_src = " || ".join(f"arp.src.proto_ipv4 == {t}" for t in arp_targets)
    return {
        "arp_request_count": f"arp.opcode == 1 && arp.src.proto_ipv4 == {src} && ({tgt_dst})",
        "arp_reply_count": f"arp.opcode == 2 && arp.dst.proto_ipv4 == {src} && ({tgt_src})",
        "icmp_request_count": f"icmp.type == 8 && ip.src == {src} && ip.dst == {dst}",
        "icmp_reply_count": f"icmp.type == 0 && ip.src == {dst} && ip.dst == {src}",
        "dns_query_count": f"dns.flags.response == 0 && ip.src == {src}",
        "dns_response_count": f"dns.flags.response == 1 && ip.dst == {src}",
        "tcp_syn_count": f"tcp.flags.syn == 1 && tcp.flags.ack == 0 && ip.src == {src} && ip.dst == {dst}",
        "tcp_syn_ack_count": f"tcp.flags.syn == 1 && tcp.flags.ack == 1 && ip.src == {dst} && ip.dst == {src}",
        "tcp_rst_count": f"tcp.flags.reset == 1 && ip.src == {dst} && ip.dst == {src}",
    }


# ---------------------------------------------------------------- extraction
class ToolError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


def _flag(v: str) -> bool:
    return v.strip().lower() in ("1", "true")


def read_packets(tshark: str, path: str) -> list[dict]:
    if not os.path.isfile(path):
        raise ToolError(EXIT_BAD_FILE, f"파일이 없습니다: {path}")
    cmd = [tshark, "-n", "-r", path, "-T", "fields", "-E", "separator=\t", "-E", "occurrence=f"]
    for f in TSHARK_FIELDS:
        cmd += ["-e", f]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        msg = (proc.stderr or "").strip().splitlines()
        raise ToolError(EXIT_BAD_FILE, "tshark가 이 파일을 캡처 파일로 읽지 못했습니다: " + (msg[-1] if msg else f"exit {proc.returncode}"))
    rows = []
    for line in proc.stdout.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        parts += [""] * (len(TSHARK_FIELDS) - len(parts))
        rows.append(dict(zip(TSHARK_FIELDS, parts)))
    return rows


def _iso(epoch: str, tz) -> str:
    return dt.datetime.fromtimestamp(float(epoch), tz).isoformat(timespec="milliseconds")


def summarize(rows: list[dict], src: str, dst: str, arp_targets: list[str], start: float | None, end: float | None,
              tz, max_evidence: int = 3) -> tuple[dict, list[dict], list[str], int]:
    counts = {k: 0 for k in ALL_COUNTS}
    evidence: list[dict] = []
    per_kind: dict[str, int] = {}
    extra_obs: list[str] = []
    in_window = 0

    def add_ev(kind: str, r: dict, proto: str, obs: str):
        per_kind[kind] = per_kind.get(kind, 0) + 1
        if per_kind[kind] <= max_evidence:
            evidence.append({"ref_type": "frame", "frame_number": int(r["frame.number"]),
                             "time": _iso(r["frame.time_epoch"], tz), "protocol": proto, "observation": obs})

    for r in rows:
        rel = float(r["frame.time_relative"] or 0)
        if (start is not None and rel < start) or (end is not None and rel > end):
            continue
        in_window += 1
        op = r["arp.opcode"]
        if op == "1" and r["arp.src.proto_ipv4"] == src and r["arp.dst.proto_ipv4"] in arp_targets:
            counts["arp_request_count"] += 1
            add_ev("arp_req", r, "ARP", f"Who has {r['arp.dst.proto_ipv4']}? Tell {src}")
        elif op == "2" and r["arp.dst.proto_ipv4"] == src and r["arp.src.proto_ipv4"] in arp_targets:
            counts["arp_reply_count"] += 1
            add_ev("arp_rep", r, "ARP", f"{r['arp.src.proto_ipv4']} is at (ARP Reply)")
        ipsrc, ipdst = r["ip.src"], r["ip.dst"]
        it = r["icmp.type"]
        if it == "8" and ipsrc == src and ipdst == dst:
            counts["icmp_request_count"] += 1
            add_ev("icmp_req", r, "ICMP", f"Echo Request {src} → {dst}")
        elif it == "0" and ipsrc == dst and ipdst == src:
            counts["icmp_reply_count"] += 1
            add_ev("icmp_rep", r, "ICMP", f"Echo Reply {dst} → {src}")
        elif it and it not in ("8", "0") and ipdst == src:
            add_ev("icmp_other", r, "ICMP", f"ICMP type {it} code {r['icmp.code']} from {ipsrc} (Echo 집계에 포함하지 않음)")
            if per_kind["icmp_other"] == 1:
                extra_obs.append(f"ICMP type {it}(Echo 아님) 수신 {ipsrc} → {src}")
        resp = r["dns.flags.response"]
        if resp != "":
            if not _flag(resp) and ipsrc == src:
                counts["dns_query_count"] += 1
                add_ev("dns_q", r, "DNS", f"DNS Query {r['dns.qry.name']} → {ipdst}")
            elif _flag(resp) and ipdst == src:
                counts["dns_response_count"] += 1
                rcode = r["dns.flags.rcode"] or "?"
                ans = r["dns.a"] or "없음"
                add_ev("dns_r", r, "DNS", f"DNS Response {r['dns.qry.name']} rcode={rcode} A={ans} from {ipsrc}")
                if rcode not in ("0", "?"):
                    extra_obs.append(f"DNS 오류 응답 rcode={rcode} (프레임 {r['frame.number']})")
        if r["tcp.flags.syn"] != "":
            syn, ack, rst = _flag(r["tcp.flags.syn"]), _flag(r["tcp.flags.ack"]), _flag(r["tcp.flags.reset"])
            if syn and not ack and ipsrc == src and ipdst == dst:
                counts["tcp_syn_count"] += 1
                add_ev("syn", r, "TCP", f"SYN {src}:{r['tcp.srcport']} → {dst}:{r['tcp.dstport']}")
            elif syn and ack and ipsrc == dst and ipdst == src:
                counts["tcp_syn_ack_count"] += 1
                add_ev("synack", r, "TCP", f"SYN-ACK {dst}:{r['tcp.srcport']} → {src}")
            if rst and ipsrc == dst and ipdst == src:
                counts["tcp_rst_count"] += 1
                add_ev("rst", r, "TCP", f"RST {dst}:{r['tcp.srcport']} → {src}")
    return counts, evidence, extra_obs, in_window


def build_notes(c: dict, extra: list[str], example: bool) -> str:
    parts = [
        f"ARP Request {c['arp_request_count']} / Reply {c['arp_reply_count']}",
        f"ICMP Echo Request {c['icmp_request_count']} / Reply {c['icmp_reply_count']}",
        f"DNS Query {c['dns_query_count']} / Response {c['dns_response_count']}",
        f"TCP SYN {c['tcp_syn_count']} / SYN-ACK {c['tcp_syn_ack_count']} / RST {c['tcp_rst_count']}",
    ]
    txt = "관찰 구간 집계: " + ", ".join(parts)
    if extra:
        txt += ". 추가 관찰: " + "; ".join(extra)
    txt = txt.replace("null", "미수집")
    return (EXAMPLE_MARK + " " + txt) if example else txt


WINDOWS_TSHARK = [r"C:\Program Files\Wireshark\tshark.exe", r"C:\Program Files (x86)\Wireshark\tshark.exe"]


def _windows_registry_tshark() -> list[str]:
    """Windows 설치 정보(레지스트리)의 Wireshark InstallLocation에서 tshark.exe 후보를 찾는다.
    예: Wireshark를 E:\\Program\\Wireshark 처럼 기본 위치가 아닌 곳에 설치한 경우."""
    try:
        import winreg  # Windows 전용
    except ImportError:
        return []
    found = []
    for sub in (r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"):
        try:
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, sub)
        except OSError:
            continue
        for i in range(winreg.QueryInfoKey(key)[0]):
            try:
                sk = winreg.OpenKey(key, winreg.EnumKey(key, i))
                if "wireshark" in str(winreg.QueryValueEx(sk, "DisplayName")[0]).lower():
                    found.append(os.path.join(winreg.QueryValueEx(sk, "InstallLocation")[0], "tshark.exe"))
            except OSError:
                continue
    return found


def find_tshark(explicit: str | None) -> str | None:
    """--tshark > PATH > Windows 설치 정보(레지스트리) > Windows 기본 설치 경로 순서로 찾는다."""
    if explicit:
        return explicit if (os.path.isfile(explicit) or shutil.which(explicit)) else None
    found = shutil.which("tshark")
    if found:
        return found
    for cand in _windows_registry_tshark() + WINDOWS_TSHARK:
        if os.path.isfile(cand):
            return cand
    return None


def cmd_extract(a) -> int:
    tshark = find_tshark(a.tshark)
    if not tshark:
        raise ToolError(EXIT_NO_TSHARK, "tshark를 찾을 수 없습니다. Wireshark 설치 시 TShark 구성요소를 포함하거나, "
                        "--tshark 로 경로를 지정하세요 (Windows 예: \"C:\\Program Files\\Wireshark\\tshark.exe\").")
    for name in ("source_ip", "destination_ip"):
        if not _is_ipv4(getattr(a, name)):
            raise ToolError(EXIT_USAGE, f"--{name.replace('_', '-')} 값이 IPv4 형식이 아닙니다.")
    for ip in a.next_hop:
        if not _is_ipv4(ip):
            raise ToolError(EXIT_USAGE, f"--next-hop 값이 IPv4 형식이 아닙니다: {ip}")
    null_map: dict[str, str] = {}
    for item in a.not_collected:
        if "=" not in item:
            raise ToolError(EXIT_USAGE, "--not-collected 는 FIELD=이유 형식입니다 (예: dns_query_count=capture filter가 icmp만 저장).")
        k, reason = item.split("=", 1)
        if k not in ALL_COUNTS or not reason.strip():
            raise ToolError(EXIT_USAGE, f"--not-collected 필드가 잘못됐습니다: {k} (가능: {', '.join(ALL_COUNTS)})")
        null_map[k] = reason.strip()

    rows = read_packets(tshark, a.pcap)
    if not rows:
        raise ToolError(EXIT_EMPTY, "캡처 파일에 프레임이 하나도 없습니다. 캡처를 시작한 뒤 테스트를 실행했는지, 올바른 인터페이스였는지 확인하세요.")
    tz = dt.datetime.now().astimezone().tzinfo
    arp_targets = list(dict.fromkeys([a.destination_ip] + a.next_hop))
    counts, evidence, extra, in_window = summarize(rows, a.source_ip, a.destination_ip, arp_targets, a.start, a.end, tz, a.max_evidence)
    if in_window == 0:
        raise ToolError(EXIT_EMPTY, "지정한 시간 구간(--start/--end)에 프레임이 없습니다. 0건과 '구간에 아무것도 없음'은 다르므로 JSON을 만들지 않습니다.")
    for k in null_map:
        counts[k] = None

    win_rows = [r for r in rows if (a.start is None or float(r["frame.time_relative"] or 0) >= a.start)
                and (a.end is None or float(r["frame.time_relative"] or 0) <= a.end)]
    example = a.evidence_source == "example"
    limitations = list(a.limitation)
    limitations.append(f"단일 캡처 지점({a.capture_point})의 관찰이다. 다른 지점에서 패킷이 도달했는지는 이 파일만으로 알 수 없다.")
    limitations.append("count 0은 이 지점·이 구간에서 보이지 않았다는 뜻이며, 응답이 존재하지 않았다는 뜻은 아니다.")
    if example:
        limitations.insert(0, "[교육용] 실제 실습 캡처가 아닌 합성·예제 데이터")

    out = {
        "case_id": a.case_id,
        "source_ip": a.source_ip,
        "destination_ip": a.destination_ip,
        "arp_request_count": counts["arp_request_count"],
        "arp_reply_count": counts["arp_reply_count"],
        "icmp_request_count": counts["icmp_request_count"],
        "icmp_reply_count": counts["icmp_reply_count"],
        "dns_query_count": counts["dns_query_count"],
        "tcp_syn_count": counts["tcp_syn_count"],
        "notes": build_notes({k: ("null" if v is None else v) for k, v in counts.items()}, extra, example),
        "schema_version": SCHEMA_VERSION,
        "capture_file": os.path.basename(a.pcap),
        "evidence_source": a.evidence_source,
        "capture_point": a.capture_point,
        "test_description": a.test_description,
        "analysis_scope": {
            "time_window": {
                "start": _iso(win_rows[0]["frame.time_epoch"], tz),
                "end": _iso(win_rows[-1]["frame.time_epoch"], tz),
                "relative_seconds": [a.start, a.end],
            },
            "display_filter": "(전체 프레임 읽은 뒤 field_filters 기준으로 집계)",
            "target_flow": f"{a.source_ip} → {a.destination_ip}",
            "arp_targets": arp_targets,
            "count_basis": {"unit": "packets", "retransmissions_included": True},
            "field_filters": field_filters(a.source_ip, a.destination_ip, arp_targets),
        },
        "dns_response_count": counts["dns_response_count"],
        "tcp_syn_ack_count": counts["tcp_syn_ack_count"],
        "tcp_rst_count": counts["tcp_rst_count"],
        "evidence": evidence,
        "limitations": limitations,
        "null_reasons": null_map,
    }
    res = validate(out)
    if not res["valid"]:
        for e in res["errors"]:
            print(f"[오류] {e['field']}: {e['message']}", file=sys.stderr)
        raise ToolError(EXIT_INVALID, "생성한 JSON이 데이터 계약을 통과하지 못해 저장하지 않았습니다.")
    text = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    if a.output:
        if os.path.exists(a.output) and not a.force:
            raise ToolError(EXIT_USAGE, f"{a.output} 이 이미 있습니다. 덮어쓰려면 --force 를 붙이세요.")
        with open(a.output, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"저장: {a.output}  (범위 내 프레임 {in_window}개)", file=sys.stderr)
    else:
        sys.stdout.write(text)
    for w in res["warnings"]:
        print(f"[경고] {w['field']}: {w['message']}", file=sys.stderr)
    return 0


def cmd_validate(a) -> int:
    try:
        with open(a.json_file, encoding="utf-8") as fh:
            obj = json.load(fh)
    except FileNotFoundError:
        raise ToolError(EXIT_BAD_FILE, f"파일이 없습니다: {a.json_file}")
    except json.JSONDecodeError as e:
        raise ToolError(EXIT_INVALID, f"JSON 문법 오류: {e.msg} (줄 {e.lineno}, 칸 {e.colno})")
    res = validate(obj)
    if a.json_output:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        for e in res["errors"]:
            print(f"[오류] {e['field']}: {e['message']}")
        for w in res["warnings"]:
            print(f"[경고] {w['field']}: {w['message']}")
        print("결과: " + ("통과" if res["valid"] else "실패") + f" (오류 {len(res['errors'])}, 경고 {len(res['warnings'])})")
    return 0 if res["valid"] else EXIT_INVALID


def cmd_filters(a) -> int:
    targets = list(dict.fromkeys([a.destination_ip] + a.next_hop))
    for k, v in field_filters(a.source_ip, a.destination_ip, targets).items():
        print(f"{k:20s} {v}")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Packet.AI 2번: .pcapng → packet_summary.json 추출 / 검증")
    sub = p.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("extract", help="실제 캡처에서 packet_summary.json 생성")
    e.add_argument("pcap", help="입력 .pcapng/.pcap 경로")
    e.add_argument("--case-id", required=True, help="SRE가 준 익명 case_id (원인 암시 금지)")
    e.add_argument("--source-ip", required=True)
    e.add_argument("--destination-ip", required=True, help="최종 목적지 IP")
    e.add_argument("--next-hop", action="append", default=[], help="ARP 집계에 포함할 next hop IP (예: PC의 Default Gateway). 여러 번 지정 가능")
    e.add_argument("--capture-point", required=True, help='캡처 위치 (예: "PC1 NIC (SW-A Fa0/1)")')
    e.add_argument("--test-description", required=True, help='실행한 테스트와 시각 (예: "10:02:00 ping -n 4 <SERVER_IP>")')
    e.add_argument("--start", type=float, help="분석 시작 (캡처 시작 기준 초, frame.time_relative)")
    e.add_argument("--end", type=float, help="분석 끝 (캡처 시작 기준 초)")
    e.add_argument("--evidence-source", default="wireshark_capture", choices=["wireshark_capture", "example"],
                   help="example은 합성·교육용 데이터일 때만")
    e.add_argument("--not-collected", action="append", default=[], metavar="FIELD=이유",
                   help="수집·분석하지 않은 count를 null로 표시 (예: dns_query_count=capture filter가 icmp만 저장)")
    e.add_argument("--limitation", action="append", default=[], help="추가 한계 문장")
    e.add_argument("--max-evidence", type=int, default=3, help="유형별 evidence 최대 개수 (기본 3)")
    e.add_argument("--tshark", help='tshark 실행 파일 경로 (예: "E:\\Program\\Wireshark\\tshark.exe")')
    e.add_argument("-o", "--output", help="저장 경로 (없으면 표준출력)")
    e.add_argument("--force", action="store_true", help="기존 출력 파일 덮어쓰기 허용")
    e.set_defaults(func=cmd_extract)

    v = sub.add_parser("validate", help="packet_summary.json 검증")
    v.add_argument("json_file")
    v.add_argument("--json-output", action="store_true", help="결과를 JSON으로 출력")
    v.set_defaults(func=cmd_validate)

    f = sub.add_parser("filters", help="각 count의 Wireshark display filter 출력 (수동 검증용)")
    f.add_argument("--source-ip", required=True)
    f.add_argument("--destination-ip", required=True)
    f.add_argument("--next-hop", action="append", default=[])
    f.set_defaults(func=cmd_filters)

    a = p.parse_args(argv)
    try:
        return a.func(a)
    except ToolError as te:
        print(f"[중단] {te}", file=sys.stderr)
        return te.code


if __name__ == "__main__":
    sys.exit(main())
