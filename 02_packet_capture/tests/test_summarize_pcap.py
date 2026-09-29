"""summarize_pcap.py 테스트.

주의: 여기서 만드는 .pcap은 scapy로 만든 **합성 테스트 데이터**다.
실제 실습 증거가 아니며, 임시 폴더에만 생성되고 저장소에 남지 않는다.

실행: python3 -m unittest discover -s 02_packet_capture/tests -v
필요: tshark, scapy (pip install scapy)
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "..", "summarize_pcap.py")
FIX = os.path.join(HERE, "fixtures")
sys.path.insert(0, os.path.join(HERE, ".."))
import summarize_pcap  # noqa: E402

try:
    from scapy.all import ARP, DNS, DNSQR, DNSRR, ICMP, IP, TCP, UDP, Ether, wrpcap
    HAVE_SCAPY = True
except ImportError:  # pragma: no cover
    HAVE_SCAPY = False

TSHARK = shutil.which("tshark")
PC1, PC1_MAC = "192.168.10.10", "00:10:0a:00:00:10"
GW, GW_MAC = "192.168.10.1", "00:d0:bc:00:00:0a"
SRV = "192.168.20.20"
BC = "ff:ff:ff:ff:ff:ff"


def run(*args):
    p = subprocess.run([sys.executable, TOOL, *args], capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def tshark_count(path, flt):
    out = subprocess.run([TSHARK, "-n", "-r", path, "-Y", flt, "-T", "fields", "-e", "frame.number"],
                         capture_output=True, text=True, check=True).stdout
    return len([l for l in out.splitlines() if l.strip()])


def stamp(pkts, t0=1_760_000_000.0, step=0.5):
    for i, p in enumerate(pkts):
        p.time = t0 + i * step
    return pkts


def synthetic_arp_repeat():
    """PC1이 존재하지 않는 .10.254를 8번 찾고 응답이 없음 + 관계없는 ARP 1건(잡음)."""
    pk = []
    for _ in range(8):
        pk.append(Ether(src=PC1_MAC, dst=BC) / ARP(op=1, psrc=PC1, hwsrc=PC1_MAC, pdst="192.168.10.254"))
    pk.append(Ether(src="00:10:0a:00:00:11", dst=BC) / ARP(op=1, psrc="192.168.10.11", pdst="192.168.10.12"))
    return stamp(pk)


def synthetic_full_web():
    """정상 흐름: Gateway ARP → ping 4회 → ICMP Unreachable 1건(집계 제외 대상) → DNS → TCP 3-way → RST 1건."""
    e_out = Ether(src=PC1_MAC, dst=GW_MAC)
    e_in = Ether(src=GW_MAC, dst=PC1_MAC)
    pk = [Ether(src=PC1_MAC, dst=BC) / ARP(op=1, psrc=PC1, hwsrc=PC1_MAC, pdst=GW),
          Ether(src=GW_MAC, dst=PC1_MAC) / ARP(op=2, psrc=GW, hwsrc=GW_MAC, pdst=PC1, hwdst=PC1_MAC)]
    for s in range(1, 5):
        pk.append(e_out / IP(src=PC1, dst=SRV) / ICMP(type=8, seq=s))
        pk.append(e_in / IP(src=SRV, dst=PC1) / ICMP(type=0, seq=s))
    pk.append(e_in / IP(src=GW, dst=PC1) / ICMP(type=3, code=0) / IP(src=PC1, dst="192.168.30.1") / ICMP(type=8))
    pk.append(e_out / IP(src=PC1, dst=SRV) / UDP(sport=50000, dport=53) / DNS(id=1, rd=1, qd=DNSQR(qname="www.packetlab.test")))
    pk.append(e_in / IP(src=SRV, dst=PC1) / UDP(sport=53, dport=50000) / DNS(id=1, qr=1, qd=DNSQR(qname="www.packetlab.test"),
                                                                           an=DNSRR(rrname="www.packetlab.test", rdata=SRV)))
    pk.append(e_out / IP(src=PC1, dst=SRV) / UDP(sport=50001, dport=53) / DNS(id=2, rd=1, qd=DNSQR(qname="nope.packetlab.example")))
    pk.append(e_in / IP(src=SRV, dst=PC1) / UDP(sport=53, dport=50001) / DNS(id=2, qr=1, rcode=3, qd=DNSQR(qname="nope.packetlab.example")))
    pk.append(e_out / IP(src=PC1, dst=SRV) / TCP(sport=49152, dport=80, flags="S", seq=0))
    pk.append(e_in / IP(src=SRV, dst=PC1) / TCP(sport=80, dport=49152, flags="SA", seq=0, ack=1))
    pk.append(e_out / IP(src=PC1, dst=SRV) / TCP(sport=49152, dport=80, flags="A", seq=1, ack=1))
    pk.append(e_out / IP(src=PC1, dst=SRV) / TCP(sport=49153, dport=8080, flags="S", seq=0))
    pk.append(e_in / IP(src=SRV, dst=PC1) / TCP(sport=8080, dport=49153, flags="RA", seq=0, ack=1))
    return stamp(pk)


@unittest.skipUnless(TSHARK and HAVE_SCAPY, "tshark와 scapy가 필요합니다")
class ExtractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="synthetic_")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write(self, name, pkts):
        path = os.path.join(self.tmp, name)
        wrpcap(path, pkts)
        return path

    def _extract(self, path, dst, *extra):
        code, out, err = run("extract", path, "--case-id", "SYN-01", "--source-ip", PC1, "--destination-ip", dst,
                             "--capture-point", "합성 테스트", "--test-description", "합성 테스트",
                             "--evidence-source", "example", *extra)
        self.assertEqual(code, 0, err)
        return json.loads(out)

    def test_arp_repeat_counts_next_hop(self):
        path = self._write("a.pcap", synthetic_arp_repeat())
        o = self._extract(path, SRV, "--next-hop", "192.168.10.254")
        self.assertEqual((o["arp_request_count"], o["arp_reply_count"]), (8, 0))
        self.assertEqual(o["icmp_request_count"], 0)
        # next hop을 지정하지 않으면 최종 목적지만 세므로 0
        o2 = self._extract(path, SRV)
        self.assertEqual(o2["arp_request_count"], 0)
        self.assertTrue(summarize_pcap.validate(o)["valid"])

    def test_full_flow_counts_and_definitions(self):
        path = self._write("b.pcap", synthetic_full_web())
        o = self._extract(path, SRV, "--next-hop", GW)
        expected = {"arp_request_count": 1, "arp_reply_count": 1, "icmp_request_count": 4, "icmp_reply_count": 4,
                    "dns_query_count": 2, "dns_response_count": 2, "tcp_syn_count": 2, "tcp_syn_ack_count": 1,
                    "tcp_rst_count": 1}
        for k, v in expected.items():
            self.assertEqual(o[k], v, k)
        # ICMP Unreachable은 Echo 집계에 섞이지 않고 관찰로만 남는다
        self.assertIn("ICMP type 3", o["notes"])
        self.assertIn("rcode=3", o["notes"])
        # 'tcp.flags.syn == 1' 은 SYN-ACK까지 포함 → tcp_syn_count 와 다르다
        self.assertEqual(tshark_count(path, "tcp.flags.syn == 1"), 3)

    def test_counts_match_wireshark_display_filters(self):
        """수동 검증 절차의 자동화: 도구 count == 같은 display filter의 tshark 결과."""
        for name, pkts, nh in (("c.pcap", synthetic_full_web(), GW), ("d.pcap", synthetic_arp_repeat(), "192.168.10.254")):
            path = self._write(name, pkts)
            o = self._extract(path, SRV, "--next-hop", nh)
            for field, flt in o["analysis_scope"]["field_filters"].items():
                self.assertEqual(o[field], tshark_count(path, flt), f"{name} {field}: {flt}")

    def test_time_window(self):
        path = self._write("e.pcap", synthetic_arp_repeat())
        o = self._extract(path, SRV, "--next-hop", "192.168.10.254", "--start", "0", "--end", "1.6")
        self.assertEqual(o["arp_request_count"], 4)  # 0.0, 0.5, 1.0, 1.5 초
        code, _, err = run("extract", path, "--case-id", "SYN-01", "--source-ip", PC1, "--destination-ip", SRV,
                           "--capture-point", "x", "--test-description", "x", "--start", "100")
        self.assertEqual(code, summarize_pcap.EXIT_EMPTY, err)

    def test_not_collected_becomes_null_with_reason(self):
        path = self._write("f.pcap", synthetic_arp_repeat())
        o = self._extract(path, SRV, "--not-collected", "dns_query_count=capture filter가 arp만 저장")
        self.assertIsNone(o["dns_query_count"])
        self.assertIn("dns_query_count", o["null_reasons"])
        self.assertTrue(summarize_pcap.validate(o)["valid"])

    def test_error_missing_tshark(self):
        path = self._write("g.pcap", synthetic_arp_repeat())
        code, _, err = run("extract", path, "--case-id", "X-1", "--source-ip", PC1, "--destination-ip", SRV,
                           "--capture-point", "x", "--test-description", "x", "--tshark", "/nonexistent/tshark")
        self.assertEqual(code, summarize_pcap.EXIT_NO_TSHARK, err)

    def test_error_not_a_capture(self):
        path = os.path.join(self.tmp, "not_capture.pcapng")
        with open(path, "w") as fh:
            fh.write("this is not a capture file")
        code, _, err = run("extract", path, "--case-id", "X-1", "--source-ip", PC1, "--destination-ip", SRV,
                           "--capture-point", "x", "--test-description", "x")
        self.assertEqual(code, summarize_pcap.EXIT_BAD_FILE, err)
        code, _, _ = run("extract", os.path.join(self.tmp, "missing.pcapng"), "--case-id", "X-1", "--source-ip", PC1,
                         "--destination-ip", SRV, "--capture-point", "x", "--test-description", "x")
        self.assertEqual(code, summarize_pcap.EXIT_BAD_FILE)

    def test_error_empty_capture(self):
        path = self._write("empty.pcap", [])
        code, _, err = run("extract", path, "--case-id", "X-1", "--source-ip", PC1, "--destination-ip", SRV,
                           "--capture-point", "x", "--test-description", "x")
        self.assertEqual(code, summarize_pcap.EXIT_EMPTY, err)

    def test_refuses_hint_case_id(self):
        path = self._write("h.pcap", synthetic_arp_repeat())
        code, _, err = run("extract", path, "--case-id", "FAULT-GATEWAY", "--source-ip", PC1, "--destination-ip", SRV,
                           "--capture-point", "x", "--test-description", "x")
        self.assertEqual(code, summarize_pcap.EXIT_INVALID, err)

    def test_no_overwrite_without_force(self):
        path = self._write("i.pcap", synthetic_arp_repeat())
        out = os.path.join(self.tmp, "o.json")
        with open(out, "w") as fh:
            fh.write("{}")
        code, _, _ = run("extract", path, "--case-id", "X-1", "--source-ip", PC1, "--destination-ip", SRV,
                         "--capture-point", "x", "--test-description", "x", "-o", out)
        self.assertEqual(code, summarize_pcap.EXIT_USAGE)


NODE = shutil.which("node")
ENGINE_DUMP = r"""
const E = require(process.argv[1]);
const out = [];
const cases = [[{}, 'web'], [{pc1Gateway:'192.168.10.254'}, 'ping_srv'], [{sviDown:20}, 'ping_srv'], [{webPort:'closed'}, 'web'],
               [{webPort:'filtered'}, 'web'], [{dnsService:'nxdomain'}, 'dns'], [{dnsService:'wrong_answer'}, 'web'], [{pc1Mask:16}, 'ping_srv']];
for (const [cfg, t] of cases) {
  const sim = E.simulate(cfg, t);
  const ev = E.eventsAt(sim.events, 'PC1');
  const dst = E.TESTS[t].target === E.DOMAIN ? '192.168.20.20' : E.TESTS[t].target;
  const targets = [dst].concat(ev.filter(e => e.kind === 'arp_request' && e.srcIp === '192.168.10.10').map(e => e.dstIp));
  out.push({cfg, t, dst, targets: [...new Set(targets)], counts: E.summarize(sim.events, 'PC1', '192.168.10.10', dst, targets), events: ev});
}
console.log(JSON.stringify(out));
"""


def events_to_packets(events):
    """교육용 모델 이벤트 → scapy 패킷 (합성 테스트 데이터)."""
    pk = []
    for i, e in enumerate(events):
        eth = Ether(src=e["srcMac"], dst=e["dstMac"])
        k = e["kind"]
        if k == "arp_request":
            p = eth / ARP(op=1, psrc=e["srcIp"], hwsrc=e["srcMac"], pdst=e["dstIp"])
        elif k == "arp_reply":
            p = eth / ARP(op=2, psrc=e["srcIp"], hwsrc=e["srcMac"], pdst=e["dstIp"], hwdst=e["dstMac"])
        else:
            ip = IP(src=e["srcIp"], dst=e["dstIp"])
            f = e["fields"]
            if k == "icmp_echo_request":
                p = eth / ip / ICMP(type=8, seq=int(f["icmp.seq"]))
            elif k == "icmp_echo_reply":
                p = eth / ip / ICMP(type=0, seq=int(f["icmp.seq"]))
            elif k == "icmp_unreach":
                p = eth / ip / ICMP(type=3, code=0) / IP(src=e["dstIp"], dst="192.168.20.20") / ICMP(type=8)
            elif k == "dns_query":
                p = eth / ip / UDP(sport=50000, dport=53) / DNS(id=0x1a2b, rd=1, qd=DNSQR(qname=f["dns.qry.name"]))
            elif k == "dns_response":
                p = eth / ip / UDP(sport=53, dport=50000) / DNS(id=0x1a2b, qr=1, qd=DNSQR(qname=f["dns.qry.name"]),
                                                                 an=DNSRR(rrname=f["dns.qry.name"], rdata=f["dns.a"]))
            elif k == "dns_error":
                p = eth / ip / UDP(sport=53, dport=50000) / DNS(id=0x1a2b, qr=1, rcode=3, qd=DNSQR(qname=f["dns.qry.name"]))
            elif k == "tcp_syn":
                p = eth / ip / TCP(sport=49152, dport=80, flags="S")
            elif k == "tcp_syn_ack":
                p = eth / ip / TCP(sport=80, dport=49152, flags="SA")
            elif k == "tcp_ack":
                p = eth / ip / TCP(sport=49152, dport=80, flags="A")
            elif k == "tcp_rst":
                p = eth / ip / TCP(sport=80, dport=49152, flags="RA")
            elif k == "http_request":
                p = eth / ip / TCP(sport=49152, dport=80, flags="PA") / b"GET / HTTP/1.1\r\nHost: www.packetlab.test\r\n\r\n"
            elif k == "http_response":
                p = eth / ip / TCP(sport=80, dport=49152, flags="PA") / b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"
            else:
                raise AssertionError(k)
        p.time = 1_760_000_000.0 + float(e["t"])
        pk.append(p)
    return pk


@unittest.skipUnless(TSHARK and HAVE_SCAPY and NODE, "tshark, scapy, node가 필요합니다")
class EngineParityTests(unittest.TestCase):
    """학습 웹앱의 집계(engine.summarize)와 실제 도구(summarize_pcap.py)가 같은 기준인지 확인."""

    def test_engine_and_tool_count_the_same(self):
        engine = os.path.join(HERE, "..", "learning_lab", "js", "engine.js")
        dump = json.loads(subprocess.run([NODE, "-e", ENGINE_DUMP, engine], capture_output=True, text=True, check=True).stdout)
        tmp = tempfile.mkdtemp(prefix="synthetic_parity_")
        try:
            for i, case in enumerate(dump):
                path = os.path.join(tmp, f"p{i}.pcap")
                wrpcap(path, events_to_packets(case["events"]))
                args = ["extract", path, "--case-id", f"PAR-{i}", "--source-ip", "192.168.10.10", "--destination-ip", case["dst"],
                        "--capture-point", "합성", "--test-description", "합성", "--evidence-source", "example"]
                for t in case["targets"][1:]:
                    args += ["--next-hop", t]
                code, out, err = run(*args)
                self.assertEqual(code, 0, err)
                got = json.loads(out)
                for k, v in case["counts"].items():
                    self.assertEqual(got[k], v, f"{case['cfg']} {case['t']} {k}")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class ValidatorFixtureTests(unittest.TestCase):
    """fixtures/*.json 을 Python 검증기로 검사. 같은 fixture를 JS 검증기(test_learning_lab.js)도 검사한다."""

    def test_fixtures(self):
        with open(os.path.join(FIX, "expected.json"), encoding="utf-8") as fh:
            expected = json.load(fh)
        for name, exp in expected.items():
            with open(os.path.join(FIX, name), encoding="utf-8") as fh:
                res = summarize_pcap.validate(json.load(fh))
            self.assertEqual(res["valid"], exp["valid"], f"{name}: {res['errors']}")
            got = sorted({e["field"] for e in res["errors"]})
            self.assertEqual(got, sorted(exp["error_fields"]), name)

    def test_example_file_is_valid_and_marked(self):
        with open(os.path.join(HERE, "..", "packet_summary.example.json"), encoding="utf-8") as fh:
            obj = json.load(fh)
        res = summarize_pcap.validate(obj)
        self.assertTrue(res["valid"], res["errors"])
        self.assertEqual(obj["evidence_source"], "example")

    def test_real_summary_not_fabricated(self):
        """실제 캡처 전에는 packet_summary.json 이 없어야 한다. 있다면 example 이 아니어야 한다."""
        path = os.path.join(HERE, "..", "packet_summary.json")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                obj = json.load(fh)
            self.assertNotEqual(obj.get("evidence_source"), "example")
            self.assertTrue(summarize_pcap.validate(obj)["valid"])


if __name__ == "__main__":
    unittest.main()
