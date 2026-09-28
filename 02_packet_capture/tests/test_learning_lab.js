/* learning_lab 모델·검증기·콘텐츠 테스트
 * 실행: node 02_packet_capture/tests/test_learning_lab.js
 * 외부 패키지 없이 Node 내장 assert만 쓴다.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const LAB = path.join(__dirname, '..', 'learning_lab', 'js');
const E = require(path.join(LAB, 'engine.js'));
const S = require(path.join(LAB, 'schema.js'));
const C = require(path.join(LAB, 'content.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n     ')); }
}
const kinds = (evs) => evs.map((e) => e.kind);
const at = (sim, cp) => E.eventsAt(sim.events, cp || 'PC1');

// ---------------------------------------------------------------- 정상 흐름 순서
test('정상 같은 Subnet ping: ARP(PC2) → Echo 4쌍, Gateway를 거치지 않음', () => {
  const r = E.simulate({}, 'ping_pc2');
  assert.deepStrictEqual(kinds(r.events).slice(0, 4), ['arp_request', 'arp_reply', 'icmp_echo_request', 'icmp_echo_reply']);
  assert.strictEqual(r.events[0].dstIp, '192.168.10.11');
  assert.ok(r.events.every((e) => !/^SVI/.test(e.from) && !/^SVI/.test(e.to)), 'SVI가 관여하면 안 됨');
  assert.ok(r.outcome.success);
  // ARP 브로드캐스트는 VLAN 20의 PC3에 보이지 않는다
  assert.ok(!r.events[0].visibleAt.includes('PC3'));
  assert.ok(r.events[0].visibleAt.includes('PC2'));
});

test('정상 다른 Subnet ping: Gateway MAC을 찾고, 라우터 전후 MAC은 바뀌고 IP는 유지 (NAT 없음)', () => {
  const r = E.simulate({}, 'ping_srv');
  assert.strictEqual(r.events[0].kind, 'arp_request');
  assert.strictEqual(r.events[0].dstIp, '192.168.10.1');
  const legs = r.events.filter((e) => e.kind === 'icmp_echo_request').slice(0, 2);
  assert.strictEqual(legs.length, 2);
  assert.notStrictEqual(legs[0].dstMac, legs[1].dstMac);
  assert.notStrictEqual(legs[0].srcMac, legs[1].srcMac);
  assert.strictEqual(legs[0].srcIp, legs[1].srcIp);
  assert.strictEqual(legs[0].dstIp, legs[1].dstIp);
  assert.ok(legs[1].routedLeg);
  assert.ok(r.outcome.success);
});

test('정상 웹 접속: ARP → DNS Query/Response → SYN/SYN-ACK/ACK → HTTP GET/200 (PC1 지점)', () => {
  const r = E.simulate({}, 'web');
  assert.deepStrictEqual(kinds(at(r)), ['arp_request', 'arp_reply', 'dns_query', 'dns_response', 'tcp_syn', 'tcp_syn_ack', 'tcp_ack', 'http_request', 'http_response']);
  assert.ok(r.outcome.success);
});

test('모든 정상 테스트가 성공', () => {
  Object.keys(E.TESTS).forEach((t) => assert.ok(E.simulate({}, t).outcome.success, t));
});

// ---------------------------------------------------------------- 캐시
test('ARP 캐시가 있으면 ARP가 사라지고, 패킷 수만 줄어든다', () => {
  const cold = E.simulate({}, 'ping_srv'), warm = E.simulate({}, 'ping_srv', { caches: { arp: true } });
  assert.ok(!warm.events.some((e) => e.proto === 'ARP'));
  assert.ok(warm.events.length < cold.events.length);
  assert.ok(warm.outcome.success);
});
test('DNS 캐시가 있으면 DNS Query가 없다', () => {
  const warm = E.simulate({}, 'web', { caches: { arp: true, dns: true } });
  assert.ok(!warm.events.some((e) => e.proto === 'DNS'));
  assert.ok(warm.outcome.success);
});
test('캐시는 장애를 숨기지 않는다 (잘못된 Gateway + ARP 캐시 있음 → 여전히 ARP 반복)', () => {
  const r = E.simulate({ pc1Gateway: '192.168.10.254' }, 'ping_srv', { caches: { arp: true } });
  assert.ok(r.events.some((e) => e.kind === 'arp_request' && e.dstIp === '192.168.10.254'));
  assert.ok(!r.outcome.success);
});

// ---------------------------------------------------------------- 설정 변경이 결과를 실제로 바꾼다
test('실험실의 모든 비정상 설정값이 적어도 한 테스트의 패킷을 바꾼다', () => {
  Object.keys(E.CONFIG_OPTIONS).forEach((k) => {
    E.CONFIG_OPTIONS[k].options.slice(1).forEach((op) => {
      const cfg = {}; cfg[k] = op[0];
      const changed = Object.keys(E.TESTS).some((t) =>
        Object.keys(E.CAPTURE_POINTS).some((cp) => E.signature(at(E.simulate(cfg, t), cp)) !== E.signature(at(E.simulate({}, t), cp))));
      assert.ok(changed, k + '=' + op[0]);
    });
  });
});

// ---------------------------------------------------------------- SYN / SYN-ACK / RST
test('Web 닫힘 → SYN 1, RST 1, SYN-ACK 0 / Web 폐기 → SYN 3(재전송), 응답 0', () => {
  const closed = E.summarize(E.simulate({ webPort: 'closed' }, 'web').events, 'PC1', '192.168.10.10', '192.168.20.100');
  assert.deepStrictEqual([closed.tcp_syn_count, closed.tcp_syn_ack_count, closed.tcp_rst_count], [1, 0, 1]);
  const filt = E.summarize(E.simulate({ webPort: 'filtered' }, 'web').events, 'PC1', '192.168.10.10', '192.168.20.100');
  assert.deepStrictEqual([filt.tcp_syn_count, filt.tcp_syn_ack_count, filt.tcp_rst_count], [3, 0, 0]);
  const ok = E.summarize(E.simulate({}, 'web').events, 'PC1', '192.168.10.10', '192.168.20.100');
  assert.deepStrictEqual([ok.tcp_syn_count, ok.tcp_syn_ack_count, ok.tcp_rst_count], [1, 1, 0], 'SYN-ACK는 tcp_syn_count에 들어가지 않음');
});

// ---------------------------------------------------------------- DNS 응답 유형
test('DNS 무응답 / 오류(NXDOMAIN) / 잘못된 응답 / 잘못된 DNS 서버 주소가 서로 다르게 보인다', () => {
  const nr = at(E.simulate({ dnsService: 'no_response' }, 'dns'));
  assert.strictEqual(nr.filter((e) => e.kind === 'dns_query').length, 3);
  assert.strictEqual(nr.filter((e) => /^dns_(response|error)$/.test(e.kind)).length, 0);
  const nx = at(E.simulate({ dnsService: 'nxdomain' }, 'dns'));
  assert.ok(nx.some((e) => e.kind === 'dns_error' && /3/.test(e.fields['dns.flags.rcode'])));
  const wr = E.simulate({ dnsService: 'wrong_answer' }, 'web');
  assert.ok(at(wr).some((e) => e.kind === 'dns_response' && e.fields['dns.a'] === '192.168.20.200'));
  assert.ok(at(wr).some((e) => e.kind === 'tcp_syn' && e.dstIp === '192.168.20.200'));
  const pd = at(E.simulate({ pc1Dns: '192.168.20.53' }, 'dns'));
  assert.ok(pd.filter((e) => e.kind === 'dns_query').every((e) => e.dstIp === '192.168.20.53'));
  const sigs = [nr, nx, pd].map(E.signature);
  assert.strictEqual(new Set(sigs).size, 3);
});

// ---------------------------------------------------------------- 캡처 지점 한계
test('Access VLAN 오류: PC1 NIC만 보면 SVI Vlan10 down과 구분되지 않지만 PC3 NIC에서는 구분된다', () => {
  const a = { pc1AccessVlan: 20 }, b = { sviDown: 10 };
  assert.strictEqual(E.signature(at(E.simulate(a, 'ping_srv'), 'PC1')), E.signature(at(E.simulate(b, 'ping_srv'), 'PC1')));
  assert.notStrictEqual(E.signature(at(E.simulate(a, 'ping_srv'), 'PC3')), E.signature(at(E.simulate(b, 'ping_srv'), 'PC3')));
});
test('Trunk VLAN 20 누락: 서버 NIC에는 아무것도 도착하지 않고, PC3 NIC에 L3SW의 ARP가 보인다', () => {
  const r = E.simulate({ trunkBAllowed: [10] }, 'ping_srv');
  assert.strictEqual(at(r, 'SRV').length, 0);
  assert.ok(at(r, 'PC3').some((e) => e.kind === 'arp_request' && e.srcIp === '192.168.20.1' && e.dstIp === '192.168.20.100'));
});
test('Subnet Mask /16: Gateway가 아니라 서버 IP를 직접 ARP로 찾는다', () => {
  const r = at(E.simulate({ pc1Mask: 16 }, 'ping_srv'));
  assert.ok(r.every((e) => e.kind === 'arp_request' && e.dstIp === '192.168.20.100'));
});
test('ICMP Unreachable은 Echo Reply로 세지 않는다 (SVI Vlan20 down)', () => {
  const r = E.simulate({ sviDown: 20 }, 'ping_srv');
  assert.ok(r.events.some((e) => e.kind === 'icmp_unreach'));
  assert.strictEqual(E.summarize(r.events, 'PC1', '192.168.10.10', '192.168.20.100').icmp_reply_count, 0);
});

// ---------------------------------------------------------------- 초기화 / 상태 독립성
test('시뮬레이션 사이에 상태가 남지 않는다 (장애 실행 후 정상 실행 = 처음 정상 실행)', () => {
  const first = E.signature(E.simulate({}, 'web').events);
  E.simulate({ pc1AccessVlan: 20 }, 'web'); E.simulate({ dnsService: 'nxdomain' }, 'web', { caches: { arp: true, dns: true } });
  assert.strictEqual(E.signature(E.simulate({}, 'web').events), first);
  assert.deepStrictEqual(E.normalizeConfig({}), E.normalizeConfig(E.DEFAULT_CONFIG));
});

// ---------------------------------------------------------------- Blind Fault
const TRUTH_WORDS = { gateway: ['Gateway 설정', '게이트웨이'], mask: ['Mask', '마스크', 'Subnet'], access_vlan: ['VLAN'], trunk: ['Trunk', '트렁크'], svi: ['SVI', 'Vlan10', 'Vlan20'], dns: ['DNS'], web: ['포트', 'Port', '80'] };
function truthOf(cfg) {
  const n = E.normalizeConfig(cfg);
  return Object.keys(E.CANDIDATES).find((k) => E.CANDIDATES[k].variants.some((v) => {
    const nv = E.normalizeConfig(v); return Object.keys(E.DEFAULT_CONFIG).every((x) => E.configKey(nv, x) === E.configKey(n, x));
  }));
}
test('Blind 사건의 제목·증상·ID가 자기 원인을 암시하지 않는다', () => {
  E.BLIND_CASES.forEach((c) => {
    const t = truthOf(c.config);
    assert.ok(t, c.id + ' 후보 매핑');
    TRUTH_WORDS[t].forEach((w) => { assert.ok(!(c.title + c.symptom).includes(w), c.id + ' 에 "' + w + '"'); });
    assert.ok(/^사건 \d+$/.test(c.title));
    const v = S.validate({ case_id: c.id, source_ip: '1.1.1.1', destination_ip: '1.1.1.2', arp_request_count: 0, arp_reply_count: 0, icmp_request_count: 0, icmp_reply_count: 0, dns_query_count: 0, tcp_syn_count: 0, notes: '' });
    assert.ok(!v.errors.some((e) => e.field === 'case_id'), c.id);
  });
});
test('Blind 사건마다 모든 검사를 하면 원인이 하나로 좁혀지고, 그 후보가 정답과 같다', () => {
  const all = [];
  Object.keys(E.TESTS).forEach((t) => Object.keys(E.CAPTURE_POINTS).forEach((cp) => all.push({ type: 'test', test: t, cp })));
  Object.keys(E.STATUS_CHECKS).forEach((k) => all.push({ type: 'status', check: k }));
  E.BLIND_CASES.forEach((c) => {
    const cons = E.consistentCandidates(all, c.config);
    assert.deepStrictEqual(cons, [truthOf(c.config)], c.id + ' → ' + cons.join(','));
  });
});
test('증거가 적으면 복수 후보가 남는다 (사건 4: PC1에서 서버 ping 하나만)', () => {
  const c = E.BLIND_CASES.find((x) => x.id === 'EDU-CASE-4');
  const cons = E.consistentCandidates([{ type: 'test', test: 'ping_srv', cp: 'PC1' }], c.config);
  assert.ok(cons.length >= 2 && cons.includes('svi') && cons.includes('access_vlan'), cons.join(','));
  const split = E.splittingChecks(cons, [{ type: 'test', test: 'ping_pc2', cp: 'PC1' }]);
  assert.strictEqual(split.length, 1, '같은 VLAN PC ping이 두 후보를 가른다');
});
test('장비 상태 출력은 정상 설정에서 정상 값을 보여 준다', () => {
  assert.ok(E.statusOutput({}, 'l3_ipint').join('\n').includes('Vlan10                 192.168.10.1    YES manual up'));
  assert.ok(E.statusOutput({ sviDown: 10 }, 'l3_ipint').join('\n').includes('administratively down'));
  assert.ok(E.statusOutput({ trunkBAllowed: [20] }, 'swb_trunk').join('\n').includes('Gi0/1       20'));
});

// ---------------------------------------------------------------- 검증기
test('JS 검증기가 Python 검증기와 같은 fixture 결과를 낸다', () => {
  const FIX = path.join(__dirname, 'fixtures');
  const expected = JSON.parse(fs.readFileSync(path.join(FIX, 'expected.json'), 'utf8'));
  Object.keys(expected).forEach((name) => {
    const r = S.validate(JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8')));
    assert.strictEqual(r.valid, expected[name].valid, name);
    assert.deepStrictEqual([...new Set(r.errors.map((e) => e.field))].sort(), expected[name].error_fields.slice().sort(), name);
  });
});
test('0과 null 구분: 0은 통과, 이유 없는 null은 오류, 이유 있는 null은 통과', () => {
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'packet_summary.example.json'), 'utf8'));
  const z = Object.assign({}, base, { dns_query_count: 0 });
  assert.ok(S.validate(z).valid);
  const n = Object.assign({}, base, { dns_query_count: null, null_reasons: {} });
  assert.ok(!S.validate(n).valid);
  const nr = Object.assign({}, base, { dns_query_count: null, null_reasons: { dns_query_count: '미수집' } });
  assert.ok(S.validate(nr).valid);
});
test('packet_summary.example.json은 유효하고 교육용 표시가 있으며 example_data.js와 같다', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'packet_summary.example.json'), 'utf8'));
  assert.ok(S.validate(raw).valid);
  assert.strictEqual(raw.evidence_source, 'example');
  assert.ok(raw.notes.includes(S.EXAMPLE_MARK));
  const js = fs.readFileSync(path.join(LAB, 'example_data.js'), 'utf8');
  const obj = JSON.parse(js.slice(js.indexOf('=') + 1).trim().replace(/;$/, ''));
  assert.deepStrictEqual(obj, raw);
});
test('예제 JSON의 count는 교육용 모델의 집계와 일치한다 (값을 지어내지 않음)', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'packet_summary.example.json'), 'utf8'));
  const c = E.summarize(E.simulate({ pc1Gateway: '192.168.10.254' }, 'ping_srv').events, 'PC1', raw.source_ip, raw.destination_ip, raw.analysis_scope.arp_targets);
  Object.keys(c).forEach((k) => assert.strictEqual(raw[k], c[k], k));
});

test('examples/*.json은 모두 유효한 교육용 예제이고 count가 모델 집계와 같다', () => {
  const dir = path.join(__dirname, '..', 'examples');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 4);
  files.forEach((f) => {
    const o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(S.validate(o).valid, f);
    assert.strictEqual(o.evidence_source, 'example', f);
  });
  const rst = JSON.parse(fs.readFileSync(path.join(dir, 'tcp_rst.json'), 'utf8'));
  assert.deepStrictEqual([rst.tcp_syn_count, rst.tcp_syn_ack_count, rst.tcp_rst_count], [1, 0, 1]);
  const dns = JSON.parse(fs.readFileSync(path.join(dir, 'dns_no_response.json'), 'utf8'));
  assert.ok(dns.dns_query_count > 0 && dns.dns_response_count === 0);
  const lim = JSON.parse(fs.readFileSync(path.join(dir, 'limited_capture_nulls.json'), 'utf8'));
  assert.strictEqual(lim.dns_query_count, null); assert.ok(lim.null_reasons.dns_query_count);
});

// ---------------------------------------------------------------- 콘텐츠·보안
test('예측 질문의 정답이 보기 안에 있고, 비교 사례는 기본·대체 지점 중 한 곳에서 차이를 보인다', () => {
  Object.values(C.LESSONS).forEach((l) => assert.ok(l.predict.options.some((o) => o[0] === l.predict.answer), l.id));
  C.COMPARE_CASES.forEach((k) => k.variants.forEach((v) => {
    const pts = [k.cp].concat(k.altCp ? [k.altCp] : []);
    assert.ok(pts.some((cp) => E.signature(at(E.simulate(v[1], k.test), cp)) !== E.signature(at(E.simulate({}, k.test), cp))), k.id + ' ' + v[0]);
  }));
});
test('모든 패킷 종류에 설명(쉬운 설명·실제 흐름)이 있고, 용어는 용어집에 있다', () => {
  const seen = new Set();
  ['ping_pc2', 'ping_srv', 'dns', 'web'].forEach((t) => [{}, { sviDown: 20 }, { dnsService: 'nxdomain' }, { webPort: 'closed' }].forEach((cfg) => E.simulate(cfg, t).events.forEach((e) => {
    seen.add(e.kind);
    const x = C.explain(E, e);
    assert.ok(x.easy && x.flow, e.kind);
    x.terms.forEach((term) => assert.ok(C.GLOSSARY[term], term));
  })));
  assert.ok(seen.size >= 13, [...seen].join(','));
});
test('app.js는 innerHTML/outerHTML/insertAdjacentHTML/eval을 쓰지 않는다 (외부 JSON을 HTML로 실행하지 않음)', () => {
  const src = fs.readFileSync(path.join(LAB, 'app.js'), 'utf8');
  ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'eval(', 'new Function'].forEach((w) => assert.ok(!src.includes(w), w));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
