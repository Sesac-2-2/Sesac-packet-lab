/* 교육용 예제 packet_summary JSON 생성기
 * 값은 모두 learning_lab/js/engine.js(교육용 모델)가 계산한다. 손으로 숫자를 넣지 않는다.
 * 실행: node 02_packet_capture/examples/generate_examples.js
 */
'use strict';
const fs = require('fs'), path = require('path');
const E = require('../learning_lab/js/engine.js'), S = require('../learning_lab/js/schema.js');
const PC1 = '192.168.10.10', SRV = '192.168.20.20', GW = '192.168.10.1';

const CASES = [
  { file: '../packet_summary.example.json', id: 'EDU-EX-01', cfg: { pc1Gateway: '192.168.10.254' }, test: 'ping_srv', dst: SRV,
    what: 'Gateway ARP 무응답 (PC1의 Gateway가 잘못 설정된 경우의 관찰)',
    extraLimits: ['PC1 NIC 한 지점만 관찰 → ARP Request가 어디까지 전달됐는지 모름', 'ARP Reply 부재만으로 원인을 확정할 수 없음'] },
  { file: 'normal.json', id: 'EDU-EX-02', cfg: {}, test: 'ping_srv', dst: SRV,
    what: '정상: 다른 VLAN 서버로 ping' },
  { file: 'dns_no_response.json', id: 'EDU-EX-03', cfg: { dnsService: 'no_response' }, test: 'dns', dst: SRV,
    what: 'DNS 질의에 응답 없음' },
  { file: 'tcp_rst.json', id: 'EDU-EX-04', cfg: { webPort: 'closed' }, test: 'web', dst: SRV,
    what: 'TCP SYN에 RST 응답' },
  { file: 'limited_capture_nulls.json', id: 'EDU-EX-05', cfg: { trunkBAllowed: [10] }, test: 'ping_srv', dst: SRV,
    what: 'capture filter로 DNS·TCP 미수집 (null) + 단일 지점 한계',
    nulls: { dns_query_count: 'capture filter "arp or icmp"로 저장해 DNS를 수집하지 않음', dns_response_count: 'capture filter "arp or icmp"로 저장해 DNS를 수집하지 않음',
      tcp_syn_count: 'capture filter "arp or icmp"로 저장해 TCP를 수집하지 않음', tcp_syn_ack_count: 'capture filter "arp or icmp"로 저장해 TCP를 수집하지 않음', tcp_rst_count: 'capture filter "arp or icmp"로 저장해 TCP를 수집하지 않음' },
    extraLimits: ['서버 쪽 캡처 없음 → Echo Request가 서버에 도착했는지 이 파일만으로는 모름'] }
];

for (const c of CASES) {
  const sim = E.simulate(c.cfg, c.test);
  const seen = E.eventsAt(sim.events, 'PC1');
  // ARP 대상 = 최종 목적지 + 캡처에서 PC1이 실제로 찾은 IP(next hop)
  const targets = [...new Set([c.dst].concat(seen.filter(e => e.kind === 'arp_request' && e.srcIp === PC1).map(e => e.dstIp)))];
  const n = E.summarize(sim.events, 'PC1', PC1, c.dst, targets);
  for (const k of Object.keys(c.nulls || {})) n[k] = null;
  const f = (k) => n[k] === null ? '미수집' : n[k];
  const o = {
    case_id: c.id, source_ip: PC1, destination_ip: c.dst,
    arp_request_count: n.arp_request_count, arp_reply_count: n.arp_reply_count,
    icmp_request_count: n.icmp_request_count, icmp_reply_count: n.icmp_reply_count,
    dns_query_count: n.dns_query_count, tcp_syn_count: n.tcp_syn_count,
    notes: `${S.EXAMPLE_MARK} 관찰 구간 집계: ARP Request ${f('arp_request_count')} / Reply ${f('arp_reply_count')}, ICMP Echo Request ${f('icmp_request_count')} / Reply ${f('icmp_reply_count')}, DNS Query ${f('dns_query_count')} / Response ${f('dns_response_count')}, TCP SYN ${f('tcp_syn_count')} / SYN-ACK ${f('tcp_syn_ack_count')} / RST ${f('tcp_rst_count')}`,
    schema_version: '0.1-draft', capture_file: null, evidence_source: 'example',
    capture_point: E.CAPTURE_POINTS.PC1 + ' — 교육용 모델',
    test_description: `[교육용] ${E.TESTS[c.test].cmd} (교육용 예제 주소, 설계 Gateway ${GW})`,
    analysis_scope: {
      time_window: { start: 'EXAMPLE+0.000s', end: 'EXAMPLE+' + (seen.length ? seen[seen.length - 1].t.toFixed(3) : '0.000') + 's' },
      display_filter: c.nulls ? 'arp || icmp (capture filter: arp or icmp)' : 'arp || icmp || dns || tcp',
      target_flow: `${PC1} → ${c.dst}`, arp_targets: targets,
      count_basis: { unit: 'packets', retransmissions_included: true }
    },
    dns_response_count: n.dns_response_count, tcp_syn_ack_count: n.tcp_syn_ack_count, tcp_rst_count: n.tcp_rst_count,
    evidence: seen.filter(e => !c.nulls || e.proto === 'ARP' || e.proto === 'ICMP').slice(0, 8)
      .map(e => ({ ref_type: 'example_event', event_id: 'EX-' + e.no, time: 'EXAMPLE+' + e.t.toFixed(3) + 's', protocol: e.proto, observation: e.info })),
    limitations: ['[교육용] 교육용 모델이 만든 값이며 실제 캡처가 아님', '단일 캡처 지점(PC1 NIC)의 관찰'].concat(c.extraLimits || []),
    null_reasons: c.nulls || {}
  };
  const v = S.validate(o);
  if (!v.valid) { console.error(c.file, v.errors); process.exit(1); }
  fs.writeFileSync(path.join(__dirname, c.file), JSON.stringify(o, null, 2) + '\n');
  console.log(`${c.file.padEnd(28)} ${c.id}  ${c.what}  | ARP ${f('arp_request_count')}/${f('arp_reply_count')} ICMP ${f('icmp_request_count')}/${f('icmp_reply_count')} DNS ${f('dns_query_count')}/${f('dns_response_count')} TCP SYN ${f('tcp_syn_count')} SYN-ACK ${f('tcp_syn_ack_count')} RST ${f('tcp_rst_count')}`);
}
