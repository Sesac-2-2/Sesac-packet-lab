/* Packet.AI 2번 Packet Analyst — 교육용 네트워크 모델 (learning_lab)
 *
 * 이 파일은 "설정값 → 패킷 순서"를 계산하는 단순화된 교육용 모델이다.
 * - 실제 장비·Packet Tracer·Wireshark를 대체하지 않는다.
 * - 주소와 장비 이름은 교육용 예제 설정이다(실제 network_spec.md 값 아님).
 * - 지원 범위와 단순화 가정은 ASSUMPTIONS에 모두 적어 두고 화면에도 보여 준다.
 * 브라우저(window.PacketEngine)와 Node(module.exports) 양쪽에서 쓴다.
 */
(function (root) {
  'use strict';

  var ASSUMPTIONS = [
    '교육용 예제 주소를 쓴다. 실제 과제 네트워크의 주소·장비명이 아니다.',
    '테스트는 항상 PC1에서 시작한다.',
    'NAT, 방화벽 ACL, STP 차단, 링크 Down은 다루지 않는다.',
    'PC는 ping 1회 시도마다 next hop의 MAC을 모르면 ARP Request를 최대 2번 보낸다(실제 OS마다 횟수가 다르다).',
    '라우터(MLS1)는 목적지 네트워크로 가는 경로가 없으면 ICMP Destination Unreachable을 돌려준다고 가정한다(실제 장비는 설정·속도 제한에 따라 보내지 않을 수 있다).',
    '라우터가 다음 장비의 MAC을 ARP로 찾지 못하면 그 패킷은 조용히 버려진다.',
    'nslookup은 응답이 없으면 같은 질의를 2번 더 보낸다(총 3번). TCP SYN은 응답이 없으면 2번 재전송한다(총 3번).',
    'HTTP는 암호화되지 않은 일반 HTTP(포트 80), DNS는 일반 UDP 53이다. HTTPS·암호화 DNS에서는 같은 내용이 보이지 않는다.',
    'TCP 연결 종료(FIN) 과정은 생략한다.',
    '설정 실험실과 Blind Fault 조사는 모든 장비의 ARP·DNS 캐시가 빈 상태에서 시작한다.',
    '캡처는 각 호스트의 NIC(Access Port 쪽)에서 한다고 가정한다. Access Port 캡처에는 802.1Q VLAN 태그가 보이지 않는 것이 정상이다.'
  ];

  // ---------- 교육용 토폴로지 ----------
  var DOMAIN = 'www.packetlab.test';
  var WRONG_WEB_IP = '192.168.20.200';

  var HOSTS = {
    PC1: { id: 'PC1', label: 'PC1 (개발팀)', ip: '192.168.10.10', mac: '00:10:0a:00:00:10', sw: 'SW1', port: 'Fa0/1', vlan: 10, mask: 24, gw: '192.168.10.1', dns: '192.168.20.20' },
    PC2: { id: 'PC2', label: 'PC2 (개발팀)', ip: '192.168.10.11', mac: '00:10:0a:00:00:11', sw: 'SW1', port: 'Fa0/2', vlan: 10, mask: 24, gw: '192.168.10.1', dns: '192.168.20.20' },
    PC3: { id: 'PC3', label: 'PC3 (운영팀)', ip: '192.168.20.10', mac: '00:10:14:00:00:10', sw: 'SW2', port: 'Fa0/1', vlan: 20, mask: 24, gw: '192.168.20.1', dns: '192.168.20.20' },
    PC4: { id: 'PC4', label: 'PC4 (운영팀)', ip: '192.168.20.11', mac: '00:10:14:00:00:11', sw: 'SW2', port: 'Fa0/2', vlan: 20, mask: 24, gw: '192.168.20.1', dns: '192.168.20.20' },
    SRV: { id: 'SRV', label: 'Server (DNS·Web)', ip: '192.168.20.20', mac: '00:10:14:00:01:00', sw: 'SW2', port: 'Fa0/3', vlan: 20, mask: 24, gw: '192.168.20.1', dns: '192.168.20.20' }
  };
  var SVIS = {
    SVI10: { id: 'SVI10', label: 'MLS1 Vlan10', ip: '192.168.10.1', mac: '00:d0:bc:00:00:0a', vlan: 10, mask: 24, sw: 'MLS1' },
    SVI20: { id: 'SVI20', label: 'MLS1 Vlan20', ip: '192.168.20.1', mac: '00:d0:bc:00:00:14', vlan: 20, mask: 24, sw: 'MLS1' }
  };
  var CAPTURE_POINTS = {
    PC1: 'PC1 NIC (SW1 Fa0/1)',
    PC2: 'PC2 NIC (SW1 Fa0/2)',
    PC3: 'PC3 NIC (SW2 Fa0/1)',
    SRV: 'Server NIC (SW2 Fa0/3)'
  };

  var DEFAULT_CONFIG = {
    pc1Gateway: '192.168.10.1',
    pc1Mask: 24,
    pc1AccessVlan: 10,
    trunkAAllowed: [10, 20],
    trunkBAllowed: [10, 20],
    sviDown: null,
    pc1Dns: '192.168.20.20',
    dnsService: 'ok',
    webPort: 'open'
  };

  // 설정 실험실에서 조절할 수 있는 값 (첫 값이 정상)
  var CONFIG_OPTIONS = {
    pc1Gateway: { label: 'PC1 Default Gateway', options: [['192.168.10.1', '192.168.10.1 (명세와 같음)'], ['192.168.10.254', '192.168.10.254 (존재하지 않는 주소)']] },
    pc1Mask: { label: 'PC1 Subnet Mask', options: [[24, '/24 = 255.255.255.0'], [16, '/16 = 255.255.0.0']] },
    pc1AccessVlan: { label: 'SW1 Fa0/1 Access VLAN (PC1 포트)', options: [[10, 'VLAN 10'], [20, 'VLAN 20']] },
    trunkAAllowed: { label: 'MLS1 Gi0/1 ↔ SW1 Trunk 허용 VLAN', options: [['10,20', '10, 20'], ['20', '20만 (10 누락)']] },
    trunkBAllowed: { label: 'MLS1 Gi0/2 ↔ SW2 Trunk 허용 VLAN', options: [['10,20', '10, 20'], ['10', '10만 (20 누락)']] },
    sviDown: { label: 'MLS1 SVI 상태', options: [['', 'Vlan10·Vlan20 모두 up'], ['10', 'Vlan10 down'], ['20', 'Vlan20 down']] },
    pc1Dns: { label: 'PC1 DNS 서버 주소', options: [['192.168.20.20', '192.168.20.20 (서버)'], ['192.168.20.53', '192.168.20.53 (존재하지 않는 주소)']] },
    dnsService: { label: 'Server DNS 응답 상태', options: [['ok', '정상 응답'], ['no_response', '응답하지 않음'], ['nxdomain', '오류 응답 (NXDOMAIN)'], ['wrong_answer', '잘못된 IP로 응답']] },
    webPort: { label: 'Server Web(TCP 80) 상태', options: [['open', '열림 (서비스 동작)'], ['closed', '닫힘 (서비스 중지 → RST)'], ['filtered', '응답 없음 (패킷 폐기)']] }
  };

  var TESTS = {
    ping_pc2: { id: 'ping_pc2', label: '같은 VLAN PC ping (PC1 → PC2)', cmd: 'ping -n 4 192.168.10.11', target: '192.168.10.11', kind: 'ping' },
    ping_gw: { id: 'ping_gw', label: 'Gateway ping (PC1 → 192.168.10.1)', cmd: 'ping -n 4 192.168.10.1', target: '192.168.10.1', kind: 'ping' },
    ping_pc3: { id: 'ping_pc3', label: '다른 VLAN PC ping (PC1 → PC3)', cmd: 'ping -n 4 192.168.20.10', target: '192.168.20.10', kind: 'ping' },
    ping_srv: { id: 'ping_srv', label: '서버 IP ping (PC1 → Server)', cmd: 'ping -n 4 192.168.20.20', target: '192.168.20.20', kind: 'ping' },
    dns: { id: 'dns', label: 'DNS 조회 (nslookup)', cmd: 'nslookup ' + DOMAIN, target: DOMAIN, kind: 'dns' },
    web: { id: 'web', label: 'TCP/Web 연결 (브라우저)', cmd: 'http://' + DOMAIN + '/', target: DOMAIN, kind: 'web' }
  };

  var STATUS_CHECKS = {
    pc1_ipconfig: { id: 'pc1_ipconfig', label: 'PC1 ipconfig /all', device: 'PC1' },
    sw1_vlan: { id: 'sw1_vlan', label: 'SW1 show vlan brief', device: 'SW1' },
    mls_trunk: { id: 'mls_trunk', label: 'MLS1 show interfaces trunk', device: 'MLS1' },
    l3_ipint: { id: 'l3_ipint', label: 'MLS1 show ip interface brief', device: 'MLS1' },
    srv_service: { id: 'srv_service', label: 'Server 서비스 상태', device: 'SRV' }
  };

  // ---------- 주소 계산 ----------
  function ipToInt(ip) {
    var p = String(ip).split('.');
    return (((+p[0]) << 24) >>> 0) + ((+p[1]) << 16) + ((+p[2]) << 8) + (+p[3]);
  }
  function maskInt(bits) { return bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0); }
  function sameSubnet(a, b, bits) { var m = maskInt(bits); return ((ipToInt(a) & m) >>> 0) === ((ipToInt(b) & m) >>> 0); }
  function networkOf(ip, bits) { var n = (ipToInt(ip) & maskInt(bits)) >>> 0; return [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255].join('.') + '/' + bits; }

  function normalizeConfig(c) {
    var cfg = {};
    var k;
    for (k in DEFAULT_CONFIG) cfg[k] = DEFAULT_CONFIG[k];
    for (k in (c || {})) if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, k)) cfg[k] = c[k];
    ['trunkAAllowed', 'trunkBAllowed'].forEach(function (t) { if (typeof cfg[t] === 'string') cfg[t] = cfg[t].split(',').filter(Boolean).map(Number); });
    if (cfg.sviDown === '' || cfg.sviDown === undefined) cfg.sviDown = null;
    if (cfg.sviDown !== null) cfg.sviDown = Number(cfg.sviDown);
    cfg.pc1Mask = Number(cfg.pc1Mask);
    cfg.pc1AccessVlan = Number(cfg.pc1AccessVlan);
    return cfg;
  }
  function configKey(cfg, k) {
    var v = cfg[k];
    if (k === 'trunkAAllowed' || k === 'trunkBAllowed') return v.slice().sort().join(',');
    if (k === 'sviDown') return v === null ? '' : String(v);
    return String(v);
  }
  function changedKeys(c) {
    var cfg = normalizeConfig(c), d = normalizeConfig({});
    return Object.keys(DEFAULT_CONFIG).filter(function (k) { return configKey(cfg, k) !== configKey(d, k); });
  }

  // ---------- 네트워크 상태 ----------
  function Net(config, caches) {
    this.cfg = normalizeConfig(config);
    this.caches = caches || { arp: false, dns: false };
    this.hosts = {};
    for (var id in HOSTS) {
      var h = {};
      for (var f in HOSTS[id]) h[f] = HOSTS[id][f];
      this.hosts[id] = h;
    }
    var p = this.hosts.PC1;
    p.gw = this.cfg.pc1Gateway; p.mask = this.cfg.pc1Mask; p.vlan = this.cfg.pc1AccessVlan; p.dns = this.cfg.pc1Dns;
    this.arpCache = {}; // device id -> {ip: mac}
    this.dnsCache = {};
    this.events = [];
    this.trace = [];
    this.t = 0;
    if (this.caches.arp) this.warmArp();
    if (this.caches.dns && this.cfg.dnsService === 'ok' && this.cfg.pc1Dns === HOSTS.SRV.ip) this.dnsCache[DOMAIN] = HOSTS.SRV.ip;
  }
  Net.prototype.sviUp = function (v) { return this.cfg.sviDown !== v; };
  Net.prototype.device = function (id) { return this.hosts[id] || SVIS[id]; };
  Net.prototype.vlanOf = function (id) { return this.device(id).vlan; };
  Net.prototype.uplinkAllows = function (sw, v) {
    if (sw === 'MLS1') return true;
    if (sw === 'SW1') return this.cfg.trunkAAllowed.indexOf(v) >= 0;
    return this.cfg.trunkBAllowed.indexOf(v) >= 0;
  };
  Net.prototype.l2Reach = function (a, b) {
    var da = this.device(a), db = this.device(b);
    if (da.vlan !== db.vlan) return false;
    if (da.sw === db.sw) return true;
    return this.uplinkAllows(da.sw, da.vlan) && this.uplinkAllows(db.sw, db.vlan);
  };
  // IP 소유자 중 ARP에 응답할 수 있는 장비 (SVI는 up일 때만)
  Net.prototype.ownerOf = function (ip) {
    for (var id in this.hosts) if (this.hosts[id].ip === ip) return id;
    if (SVIS.SVI10.ip === ip && this.sviUp(10)) return 'SVI10';
    if (SVIS.SVI20.ip === ip && this.sviUp(20)) return 'SVI20';
    return null;
  };
  Net.prototype.hostsInDomain = function (from) {
    var out = [], id;
    for (id in this.hosts) if (id !== from && this.l2Reach(from, id)) out.push(id);
    return out;
  };
  Net.prototype.warmArp = function () {
    // 캐시 "있음": 현재 설정에서 실제로 ARP가 성공할 항목만 미리 채운다 (캐시가 장애를 숨기지 않도록)
    var self = this;
    function learn(dev, ip) {
      var o = self.ownerOf(ip);
      if (o && self.l2Reach(dev, o)) { (self.arpCache[dev] = self.arpCache[dev] || {})[ip] = self.device(o).mac; }
    }
    for (var id in this.hosts) {
      var h = this.hosts[id];
      learn(id, h.gw);
      for (var j in this.hosts) if (j !== id) learn(id, this.hosts[j].ip);
    }
    ['SVI10', 'SVI20'].forEach(function (s) { for (var j in self.hosts) learn(s, self.hosts[j].ip); });
  };
  Net.prototype.captureHosts = function (ids) { return ids.filter(function (id) { return CAPTURE_POINTS[id]; }); };
  Net.prototype.pathNodes = function (a, b) {
    var sa = this.device(a).sw, sb = b ? this.device(b).sw : null;
    var nodes = [a];
    if (sa !== 'MLS1') nodes.push(sa);
    if (!b) return nodes;
    if (sa !== sb) { if (sa !== 'MLS1') nodes.push('MLS1'); if (sb !== 'MLS1') nodes.push(sb); }
    nodes.push(b);
    return nodes.map(function (n) { return /^SVI/.test(n) ? 'MLS1' : n; }).filter(function (n, i, arr) { return i === 0 || arr[i - 1] !== n; });
  };
  Net.prototype.tick = function (dt) { this.t = Math.round((this.t + (dt || 0.001)) * 1000) / 1000; return this.t; };
  Net.prototype.emit = function (ev) {
    ev.no = this.events.length + 1;
    ev.t = this.tick(ev.dt);
    delete ev.dt;
    this.events.push(ev);
    return ev;
  };
  Net.prototype.note = function (s) { this.trace.push({ t: this.t, text: s }); };

  // ARP 해석. from이 targetIp의 MAC을 찾는다. 성공 시 MAC, 실패 시 null.
  Net.prototype.resolve = function (from, targetIp, tries) {
    var cache = this.arpCache[from] = this.arpCache[from] || {};
    var dev = this.device(from);
    if (cache[targetIp]) {
      this.note(dev.label + '의 ARP 캐시에 ' + targetIp + '의 MAC이 이미 있어 ARP를 보내지 않는다.');
      return cache[targetIp];
    }
    var owner = this.ownerOf(targetIp);
    var reach = owner && this.l2Reach(from, owner);
    var domain = this.captureHosts(this.hostsInDomain(from));
    var seen = this.captureHosts([from]).concat(domain);
    for (var i = 0; i < tries; i++) {
      this.emit({
        dt: i === 0 ? 0.001 : 1.0, proto: 'ARP', kind: 'arp_request', from: from, to: 'broadcast',
        srcIp: dev.ip, dstIp: targetIp, srcMac: dev.mac, dstMac: 'ff:ff:ff:ff:ff:ff',
        info: 'Who has ' + targetIp + '? Tell ' + dev.ip,
        fields: { 'arp.opcode': '1 (request)', 'arp.src.proto_ipv4': dev.ip, 'arp.dst.proto_ipv4': targetIp, 'eth.dst': 'ff:ff:ff:ff:ff:ff' },
        path: this.pathNodes(from, null), vlan: dev.vlan, visibleAt: seen, retry: i > 0
      });
      if (reach) {
        var od = this.device(owner);
        this.emit({
          proto: 'ARP', kind: 'arp_reply', from: owner, to: from,
          srcIp: targetIp, dstIp: dev.ip, srcMac: od.mac, dstMac: dev.mac,
          info: targetIp + ' is at ' + od.mac,
          fields: { 'arp.opcode': '2 (reply)', 'arp.src.proto_ipv4': targetIp, 'arp.src.hw_mac': od.mac, 'arp.dst.proto_ipv4': dev.ip },
          path: this.pathNodes(owner, from), vlan: dev.vlan, visibleAt: this.captureHosts([owner, from])
        });
        cache[targetIp] = od.mac;
        (this.arpCache[owner] = this.arpCache[owner] || {})[dev.ip] = dev.mac;
        return od.mac;
      }
    }
    if (!owner) this.note('VLAN ' + dev.vlan + '에서 ' + targetIp + '에 응답할 장비가 없다 (그 주소를 가진 장비가 없거나, 해당 SVI가 down).');
    else this.note(targetIp + '의 주인(' + this.device(owner).label + ')은 있지만 VLAN ' + dev.vlan + ' 브로드캐스트가 닿는 범위 밖이다.');
    return null;
  };

  // 호스트가 IP 패킷을 보낸다. pkt: {proto, kind, info, fields, extra}
  // 반환: {status:'delivered'|'arp_fail'|'dropped'|'unreachable', at: deviceId}
  Net.prototype.hostSend = function (from, dstIp, pkt) {
    var h = this.hosts[from];
    var local = sameSubnet(h.ip, dstIp, h.mask);
    var nextHop = local ? dstIp : h.gw;
    this.note(h.label + ': 목적지 ' + dstIp + (local ? '는 내 네트워크(' + networkOf(h.ip, h.mask) + ') 안 → 직접 전달, next hop = 목적지 자신'
      : '는 내 네트워크(' + networkOf(h.ip, h.mask) + ') 밖 → Default Gateway ' + h.gw + '로 보낸다'));
    var mac = this.resolve(from, nextHop, 2);
    if (!mac) return { status: 'arp_fail', nextHop: nextHop };
    var nhOwner = this.ownerOf(nextHop);
    var dstOwner = this.ownerOf(dstIp);
    var leg1To = nhOwner;
    this.emitIp(from, leg1To, h.ip, dstIp, h.mac, mac, pkt, h.vlan);
    if (nhOwner === dstOwner && this.hosts[dstOwner]) return { status: 'delivered', at: dstOwner };
    if (nhOwner === dstOwner && SVIS[dstOwner]) return { status: 'delivered', at: dstOwner }; // Gateway 자신이 목적지
    if (!/^SVI/.test(nhOwner)) { this.note('next hop이 라우터가 아니라서 더 이상 전달되지 않는다.'); return { status: 'dropped', at: nhOwner }; }
    return this.route(nhOwner, from, dstIp, pkt);
  };

  Net.prototype.emitIp = function (from, to, srcIp, dstIp, srcMac, dstMac, pkt, vlan) {
    var fields = { 'eth.src': srcMac, 'eth.dst': dstMac, 'ip.src': srcIp, 'ip.dst': dstIp };
    for (var k in (pkt.fields || {})) fields[k] = pkt.fields[k];
    var ev = {
      proto: pkt.proto, kind: pkt.kind, from: from, to: to, srcIp: srcIp, dstIp: dstIp, srcMac: srcMac, dstMac: dstMac,
      info: pkt.info, fields: fields, path: this.pathNodes(from, to), vlan: vlan, visibleAt: this.captureHosts([from, to]),
      dt: pkt.dt, retry: !!pkt.retry
    };
    if (pkt.extra) for (var e in pkt.extra) ev[e] = pkt.extra[e];
    return this.emit(ev);
  };

  Net.prototype.route = function (ingress, srcHost, dstIp, pkt) {
    var inSvi = SVIS[ingress];
    var egress = null;
    if (this.sviUp(10) && sameSubnet(dstIp, SVIS.SVI10.ip, 24)) egress = 'SVI10';
    if (this.sviUp(20) && sameSubnet(dstIp, SVIS.SVI20.ip, 24)) egress = 'SVI20';
    if (!egress) {
      this.note('MLS1에 ' + dstIp + ' 네트워크로 가는 경로가 없다(해당 SVI가 down이면 연결된 경로도 사라진다) → ICMP Destination Unreachable을 돌려준다 (모델 가정).');
      var src = this.hosts[srcHost];
      this.emitIp(ingress, srcHost, inSvi.ip, src.ip, inSvi.mac, src.mac, {
        proto: 'ICMP', kind: 'icmp_unreach', info: 'Destination unreachable (Network unreachable)',
        fields: { 'icmp.type': '3 (Destination Unreachable)', 'icmp.code': '0 (Network unreachable)' }
      }, inSvi.vlan);
      return { status: 'unreachable', at: ingress };
    }
    var eg = SVIS[egress];
    this.note('MLS1: ' + dstIp + '는 ' + eg.label + '(' + networkOf(eg.ip, 24) + ') 쪽 → 출구 인터페이스를 바꾸고 새 Ethernet 헤더를 붙인다 (IP 주소는 그대로, NAT 없음).');
    var mac = this.resolve(egress, dstIp, 1);
    if (!mac) { this.note('MLS1가 ' + dstIp + '의 MAC을 찾지 못해 패킷을 버린다.'); return { status: 'dropped', at: 'MLS1' }; }
    var dst = this.ownerOf(dstIp);
    var p2 = {}; for (var k in pkt) p2[k] = pkt[k];
    p2.dt = 0.001; p2.extra = { routedLeg: true };
    this.emitIp(egress, dst, this.hosts[srcHost].ip, dstIp, eg.mac, mac, p2, eg.vlan);
    return { status: 'delivered', at: dst };
  };

  // ---------- 테스트 ----------
  function runPing(net, target) {
    var ok = 0, lines = [];
    for (var i = 0; i < 4; i++) {
      var seq = i + 1;
      var req = { proto: 'ICMP', kind: 'icmp_echo_request', info: 'Echo (ping) request  seq=' + seq, dt: i === 0 ? 0.001 : 1.0, fields: { 'icmp.type': '8 (Echo Request)', 'icmp.seq': String(seq) } };
      var r = net.hostSend('PC1', target, req);
      if (r.status === 'delivered') {
        var replier = r.at;
        var rep = { proto: 'ICMP', kind: 'icmp_echo_reply', info: 'Echo (ping) reply    seq=' + seq, fields: { 'icmp.type': '0 (Echo Reply)', 'icmp.seq': String(seq) } };
        var back = /^SVI/.test(replier) ? replyFromSvi(net, replier, rep) : net.hostSend(replier, net.hosts.PC1.ip, rep);
        if (back.status === 'delivered' && back.at === 'PC1') { ok++; lines.push('Reply from ' + target + ': bytes=32 time<1ms TTL=' + (sameSubnet(target, net.hosts.PC1.ip, 24) ? 128 : 127)); }
        else lines.push('Request timed out.');
      } else if (r.status === 'arp_fail') {
        lines.push('Reply from ' + net.hosts.PC1.ip + ': Destination host unreachable.');
      } else if (r.status === 'unreachable') {
        lines.push('Reply from ' + SVIS[r.at].ip + ': Destination net unreachable.');
      } else {
        lines.push('Request timed out.');
      }
    }
    lines.push('Ping statistics: Sent = 4, Received = ' + ok + ', Lost = ' + (4 - ok));
    return { success: ok === 4, partial: ok > 0 && ok < 4, console: lines };
  }
  // SVI(게이트웨이 자신)가 ping에 응답
  function replyFromSvi(net, sviId, pkt) {
    var s = SVIS[sviId], pc = net.hosts.PC1;
    if (!net.l2Reach(sviId, 'PC1')) return { status: 'dropped' };
    var mac = net.resolve(sviId, pc.ip, 1);
    if (!mac) return { status: 'dropped' };
    net.emitIp(sviId, 'PC1', s.ip, pc.ip, s.mac, mac, pkt, s.vlan);
    return { status: 'delivered', at: 'PC1' };
  }

  function runDns(net, lines) {
    var pc = net.hosts.PC1;
    if (net.dnsCache[DOMAIN]) {
      net.note('PC1의 DNS 캐시에 ' + DOMAIN + ' → ' + net.dnsCache[DOMAIN] + '가 있어 DNS 질의를 보내지 않는다.');
      lines.push('(DNS 캐시 사용) ' + DOMAIN + ' → ' + net.dnsCache[DOMAIN]);
      return { ip: net.dnsCache[DOMAIN], outcome: 'cache' };
    }
    for (var i = 0; i < 3; i++) {
      var q = { proto: 'DNS', kind: 'dns_query', dt: i === 0 ? 0.001 : 2.0, retry: i > 0,
        info: 'Standard query 0x1a2b A ' + DOMAIN,
        fields: { 'udp.dstport': '53', 'dns.flags.response': '0 (query)', 'dns.qry.name': DOMAIN, 'dns.qry.type': 'A' } };
      var r = net.hostSend('PC1', pc.dns, q);
      if (r.status !== 'delivered') continue;
      if (r.at !== 'SRV') { net.note(pc.dns + '에는 DNS 서비스가 없다.'); continue; }
      var svc = net.cfg.dnsService;
      if (svc === 'no_response') { net.note('Server가 DNS 질의를 받았지만 응답하지 않는다.'); continue; }
      var ans, info, fields = { 'udp.srcport': '53', 'dns.flags.response': '1 (response)', 'dns.qry.name': DOMAIN };
      if (svc === 'nxdomain') { ans = null; info = 'Standard query response 0x1a2b No such name A ' + DOMAIN; fields['dns.flags.rcode'] = '3 (NXDOMAIN)'; fields['dns.count.answers'] = '0'; }
      else { ans = svc === 'wrong_answer' ? WRONG_WEB_IP : HOSTS.SRV.ip; info = 'Standard query response 0x1a2b A ' + DOMAIN + ' A ' + ans; fields['dns.flags.rcode'] = '0 (No error)'; fields['dns.a'] = ans; }
      var back = net.hostSend('SRV', pc.ip, { proto: 'DNS', kind: ans ? 'dns_response' : 'dns_error', info: info, fields: fields });
      if (back.status === 'delivered' && back.at === 'PC1') {
        if (!ans) { lines.push('*** ' + pc.dns + ' can\'t find ' + DOMAIN + ': Non-existent domain'); return { ip: null, outcome: 'nxdomain' }; }
        lines.push('Server:  ' + pc.dns); lines.push('Name:    ' + DOMAIN); lines.push('Address: ' + ans);
        net.dnsCache[DOMAIN] = ans;
        return { ip: ans, outcome: 'answer' };
      }
    }
    lines.push('DNS request timed out. (timeout was 2 seconds) ×3');
    lines.push('*** Request to ' + pc.dns + ' timed-out');
    return { ip: null, outcome: 'timeout' };
  }

  function runWeb(net) {
    var lines = [];
    var d = runDns(net, lines);
    if (!d.ip) { lines.push('브라우저: 사이트에 연결할 수 없음 (주소를 찾을 수 없음)'); return { success: false, console: lines }; }
    var ip = d.ip, pc = net.hosts.PC1;
    for (var i = 0; i < 3; i++) {
      var syn = { proto: 'TCP', kind: 'tcp_syn', dt: i === 0 ? 0.01 : (i === 1 ? 1.0 : 2.0), retry: i > 0,
        info: '49152 → 80 [SYN] Seq=0' + (i > 0 ? '  (TCP Retransmission)' : ''),
        fields: { 'tcp.srcport': '49152', 'tcp.dstport': '80', 'tcp.flags.syn': '1', 'tcp.flags.ack': '0' } };
      var r = net.hostSend('PC1', ip, syn);
      if (r.status !== 'delivered') continue;
      if (r.at !== 'SRV') continue;
      var wp = net.cfg.webPort;
      if (wp === 'filtered') { net.note('Server가 SYN을 받았지만 아무 응답도 보내지 않는다 (패킷 폐기).'); continue; }
      if (wp === 'closed') {
        net.hostSend('SRV', pc.ip, { proto: 'TCP', kind: 'tcp_rst', info: '80 → 49152 [RST, ACK] Seq=1 Ack=1',
          fields: { 'tcp.srcport': '80', 'tcp.dstport': '49152', 'tcp.flags.reset': '1', 'tcp.flags.ack': '1' } });
        net.note('Server의 80번 포트에서 듣고 있는 프로그램이 없어 RST로 즉시 거절한다.');
        lines.push('브라우저: 연결이 거부됨 (ERR_CONNECTION_REFUSED)');
        return { success: false, console: lines };
      }
      net.hostSend('SRV', pc.ip, { proto: 'TCP', kind: 'tcp_syn_ack', info: '80 → 49152 [SYN, ACK] Seq=0 Ack=1',
        fields: { 'tcp.srcport': '80', 'tcp.dstport': '49152', 'tcp.flags.syn': '1', 'tcp.flags.ack': '1' } });
      net.hostSend('PC1', ip, { proto: 'TCP', kind: 'tcp_ack', info: '49152 → 80 [ACK] Seq=1 Ack=1',
        fields: { 'tcp.flags.syn': '0', 'tcp.flags.ack': '1' } });
      net.hostSend('PC1', ip, { proto: 'HTTP', kind: 'http_request', info: 'GET / HTTP/1.1  Host: ' + DOMAIN,
        fields: { 'http.request.method': 'GET', 'http.request.uri': '/', 'http.host': DOMAIN } });
      net.hostSend('SRV', pc.ip, { proto: 'HTTP', kind: 'http_response', info: 'HTTP/1.1 200 OK  (text/html)',
        fields: { 'http.response.code': '200' } });
      lines.push('브라우저: 페이지 표시됨 (HTTP 200 OK)');
      return { success: true, console: lines };
    }
    lines.push('브라우저: 연결 시간 초과 (ERR_CONNECTION_TIMED_OUT)');
    return { success: false, console: lines };
  }

  function simulate(config, testId, opts) {
    opts = opts || {};
    var net = new Net(config, opts.caches);
    var test = TESTS[testId];
    if (!test) throw new Error('unknown test: ' + testId);
    var res;
    if (test.kind === 'ping') res = runPing(net, test.target);
    else if (test.kind === 'dns') {
      var lines = []; var d = runDns(net, lines);
      res = { success: !!d.ip && (net.cfg.dnsService !== 'wrong_answer'), console: lines, dnsOutcome: d.outcome, resolved: d.ip };
    } else res = runWeb(net);
    return { test: test, config: net.cfg, events: net.events, trace: net.trace, outcome: res };
  }

  function eventsAt(events, cp) {
    return events.filter(function (e) { return e.visibleAt.indexOf(cp) >= 0; });
  }
  // 관찰 서명: 두 결과가 "같은 지점에서 똑같이 보이는지" 비교할 때 쓴다
  function signature(events) {
    return events.map(function (e) { return [e.proto, e.kind, e.srcIp, e.dstIp, e.srcMac, e.dstMac, e.info].join('|'); }).join('\n');
  }

  // ---------- 장비 상태 확인 출력 ----------
  function statusOutput(config, checkId) {
    var cfg = normalizeConfig(config);
    var up = function (v) { return cfg.sviDown === v ? 'administratively down    down' : 'up                    up'; };
    switch (checkId) {
      case 'pc1_ipconfig': return [
        'Ethernet adapter:',
        '   IPv4 Address. . . . . . . . . . . : 192.168.10.10',
        '   Subnet Mask . . . . . . . . . . . : ' + (cfg.pc1Mask === 24 ? '255.255.255.0' : '255.255.0.0'),
        '   Default Gateway . . . . . . . . . : ' + cfg.pc1Gateway,
        '   DNS Servers . . . . . . . . . . . : ' + cfg.pc1Dns];
      case 'sw1_vlan': return [
        'VLAN Name                             Status    Ports',
        '---- -------------------------------- --------- -------------------------------',
        '1    default                          active    Fa0/3-24, Gi0/2',
        '10   DEV_TEAM                         active    ' + (cfg.pc1AccessVlan === 10 ? 'Fa0/1, Fa0/2' : 'Fa0/2'),
        '20   OPS_TEAM                         active    ' + (cfg.pc1AccessVlan === 20 ? 'Fa0/1' : '')];
      case 'mls_trunk': return [
        'Port        Mode         Encapsulation  Status        Native vlan',
        'Gi0/1       on           802.1q         trunking      1',
        'Gi0/2       on           802.1q         trunking      1',
        '',
        'Port        Vlans allowed on trunk',
        'Gi0/1       ' + cfg.trunkAAllowed.slice().sort().join(','),
        'Gi0/2       ' + cfg.trunkBAllowed.slice().sort().join(',')];
      case 'l3_ipint': return [
        'Interface              IP-Address      OK? Method Status                Protocol',
        'Vlan10                 192.168.10.1    YES manual ' + up(10),
        'Vlan20                 192.168.20.1    YES manual ' + up(20)];
      case 'srv_service': return [
        'DNS 서비스: ' + (cfg.dnsService === 'no_response' ? '응답 안 함' : '동작 중') + (cfg.dnsService === 'nxdomain' ? ' (레코드 ' + DOMAIN + ' 없음)' : '') + (cfg.dnsService === 'wrong_answer' ? ' (레코드 ' + DOMAIN + ' → ' + WRONG_WEB_IP + ')' : ''),
        'HTTP 서비스 (TCP 80): ' + ({ open: '동작 중 (LISTEN)', closed: '중지됨 (LISTEN 없음)', filtered: '동작 중이나 들어오는 SYN을 폐기' })[cfg.webPort]];
    }
    throw new Error('unknown check: ' + checkId);
  }

  // ---------- Blind Fault: 후보와 일관성 ----------
  var CANDIDATES = {
    gateway: { label: 'PC Default Gateway 설정 오류', variants: [{ pc1Gateway: '192.168.10.254' }] },
    mask: { label: 'PC Subnet Mask 오류', variants: [{ pc1Mask: 16 }] },
    access_vlan: { label: 'Access Port VLAN 할당 오류', variants: [{ pc1AccessVlan: 20 }] },
    trunk: { label: 'Trunk 허용 VLAN 누락', variants: [{ trunkAAllowed: [20] }, { trunkBAllowed: [10] }] },
    svi: { label: 'SVI Down (Inter-VLAN Gateway 인터페이스)', variants: [{ sviDown: 10 }, { sviDown: 20 }] },
    dns: { label: 'DNS 설정·서버 문제', variants: [{ pc1Dns: '192.168.20.53' }, { dnsService: 'no_response' }, { dnsService: 'nxdomain' }, { dnsService: 'wrong_answer' }] },
    web: { label: 'Server Web 서비스·포트 문제', variants: [{ webPort: 'closed' }, { webPort: 'filtered' }] }
  };

  // check: {type:'test', test, cp} | {type:'status', check}
  function observe(config, check) {
    if (check.type === 'status') return statusOutput(config, check.check).join('\n');
    var sim = simulate(config, check.test, {});
    return signature(eventsAt(sim.events, check.cp)) + '\n#' + sim.outcome.console.join('/');
  }
  function candidateConsistent(candId, checks, actualConfig) {
    var c = CANDIDATES[candId];
    return c.variants.some(function (v) {
      return checks.every(function (ch) { return observe(v, ch) === observe(actualConfig, ch); });
    });
  }
  function consistentCandidates(checks, actualConfig) {
    return Object.keys(CANDIDATES).filter(function (k) { return candidateConsistent(k, checks, actualConfig); });
  }
  // 남은 후보들을 구분할 수 있는 다음 검사 목록
  function splittingChecks(cands, allChecks) {
    return allChecks.filter(function (ch) {
      var outs = {};
      cands.forEach(function (k) { CANDIDATES[k].variants.forEach(function (v) { outs[observe(v, ch)] = true; }); });
      return Object.keys(outs).length > 1;
    });
  }

  // Blind 사례: 제목·증상은 원인을 암시하지 않는다
  var BLIND_CASES = [
    { id: 'EDU-CASE-1', title: '사건 1', symptom: 'PC1 사용자: "서버 웹페이지가 안 열려요. 옆자리 PC2랑 파일 공유는 돼요."', config: { pc1Gateway: '192.168.10.254' } },
    { id: 'EDU-CASE-2', title: '사건 2', symptom: 'PC1 사용자: "오늘 아침부터 인터넷도, 사내 서버도 전부 안 돼요."', config: { pc1AccessVlan: 20 } },
    { id: 'EDU-CASE-3', title: '사건 3', symptom: 'PC1 사용자: "서버 웹페이지가 안 열려요. 같은 팀 PC2와는 통신이 돼요."', config: { trunkBAllowed: [10] } },
    { id: 'EDU-CASE-4', title: '사건 4', symptom: 'PC1 사용자: "같은 팀 PC2는 되는데, 서버랑 운영팀 PC가 다 안 돼요."', config: { sviDown: 10 } },
    { id: 'EDU-CASE-5', title: '사건 5', symptom: 'PC1 사용자: "주소창에 www.packetlab.test을 치면 안 열려요."', config: { pc1Dns: '192.168.20.53' } },
    { id: 'EDU-CASE-6', title: '사건 6', symptom: 'PC1 사용자: "서버 웹페이지가 안 열려요. 서버 IP로 ping은 된대요."', config: { webPort: 'closed' } },
    { id: 'EDU-CASE-7', title: '사건 7', symptom: 'PC1 사용자: "서버 웹페이지가 안 열려요. Gateway로 ping은 돼요."', config: { pc1Mask: 16 } }
  ];

  // ---------- packet_summary 집계 (summarize_pcap.py와 같은 기준) ----------
  function summarize(events, cp, sourceIp, destinationIp, arpTargets) {
    var ev = eventsAt(events, cp);
    var targets = arpTargets && arpTargets.length ? arpTargets : [destinationIp];
    var c = { arp_request_count: 0, arp_reply_count: 0, icmp_request_count: 0, icmp_reply_count: 0, dns_query_count: 0, dns_response_count: 0, tcp_syn_count: 0, tcp_syn_ack_count: 0, tcp_rst_count: 0 };
    ev.forEach(function (e) {
      if (e.kind === 'arp_request' && e.srcIp === sourceIp && targets.indexOf(e.dstIp) >= 0) c.arp_request_count++;
      if (e.kind === 'arp_reply' && e.dstIp === sourceIp && targets.indexOf(e.srcIp) >= 0) c.arp_reply_count++;
      if (e.kind === 'icmp_echo_request' && e.srcIp === sourceIp && e.dstIp === destinationIp) c.icmp_request_count++;
      if (e.kind === 'icmp_echo_reply' && e.srcIp === destinationIp && e.dstIp === sourceIp) c.icmp_reply_count++;
      if (e.kind === 'dns_query' && e.srcIp === sourceIp) c.dns_query_count++;
      if ((e.kind === 'dns_response' || e.kind === 'dns_error') && e.dstIp === sourceIp) c.dns_response_count++;
      if (e.kind === 'tcp_syn' && e.srcIp === sourceIp && e.dstIp === destinationIp) c.tcp_syn_count++;
      if (e.kind === 'tcp_syn_ack' && e.srcIp === destinationIp && e.dstIp === sourceIp) c.tcp_syn_ack_count++;
      if (e.kind === 'tcp_rst' && e.srcIp === destinationIp && e.dstIp === sourceIp) c.tcp_rst_count++;
    });
    return c;
  }

  var api = {
    ASSUMPTIONS: ASSUMPTIONS, HOSTS: HOSTS, SVIS: SVIS, CAPTURE_POINTS: CAPTURE_POINTS, DOMAIN: DOMAIN,
    DEFAULT_CONFIG: DEFAULT_CONFIG, CONFIG_OPTIONS: CONFIG_OPTIONS, TESTS: TESTS, STATUS_CHECKS: STATUS_CHECKS,
    CANDIDATES: CANDIDATES, BLIND_CASES: BLIND_CASES,
    simulate: simulate, eventsAt: eventsAt, signature: signature, statusOutput: statusOutput,
    observe: observe, consistentCandidates: consistentCandidates, candidateConsistent: candidateConsistent,
    splittingChecks: splittingChecks, summarize: summarize, normalizeConfig: normalizeConfig,
    changedKeys: changedKeys, configKey: configKey, sameSubnet: sameSubnet, networkOf: networkOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PacketEngine = api;
})(typeof window !== 'undefined' ? window : this);
