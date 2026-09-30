/* learning_lab UI
 * - 외부 JSON이나 사용자 입력은 textContent로만 넣는다 (HTML 문자열로 해석하지 않음).
 * - 모든 패킷은 engine.js의 교육용 모델이 계산한다. 화면에서 임의로 만든 패킷은 없다.
 */
(function () {
  'use strict';
  var E = window.PacketEngine, C = window.PacketContent, S = window.PacketSchema, EX = window.PacketExample;

  // ---------------------------------------------------------------- DOM helpers
  function h(tag, attrs) {
    var el = document.createElement(tag);
    setAttrs(el, attrs);
    appendKids(el, Array.prototype.slice.call(arguments, 2));
    return el;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    setAttrs(el, attrs);
    appendKids(el, Array.prototype.slice.call(arguments, 2));
    return el;
  }
  function setAttrs(el, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
  }
  function appendKids(el, kids) {
    kids.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) appendKids(el, c);
      else if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(String(c)));
      else el.appendChild(c);
    });
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'application/json' });
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function protoBadge(p) { return h('span', { class: 'proto p-' + p, text: p }); }
  function uid() { return 'u' + Math.random().toString(36).slice(2, 9); }

  // ---------------------------------------------------------------- global state
  var state = {
    seenTerms: {},
    lessons: { a: {}, b: {}, c: {} },
    compare: { caseId: C.COMPARE_CASES[0].id, variant: 0, cp: null },
    lab: null,
    blind: null,
    json: { obj: null, raw: '', result: null, sel: null },
    answers: {}
  };
  var active = []; // 화면 전환 시 정리할 플레이어(타이머)
  function cleanup() { active.forEach(function (p) { p.destroy(); }); active = []; }

  var main = document.getElementById('main');
  function setHeader(title, goal, next, badge) {
    document.getElementById('unitTitle').textContent = title;
    document.getElementById('unitGoal').textContent = goal || '';
    document.getElementById('nextAction').textContent = next || '';
    var b = document.getElementById('dataBadge');
    badge = badge || { text: '교육용 예제', cls: 'badge-example' };
    b.textContent = badge.text; b.className = 'badge ' + badge.cls;
    document.title = title + ' — Packet Lab';
  }
  function setNext(text) { document.getElementById('nextAction').textContent = text; }

  // ---------------------------------------------------------------- topology
  var POS = { MLS1: [390, 50], 'SW1': [170, 146], 'SW2': [560, 146], PC1: [90, 246], PC2: [250, 246], PC3: [418, 246], PC4: [560, 246], SRV: [702, 246] };
  var LINKS = [['MLS1', 'SW1', 'trunk'], ['MLS1', 'SW2', 'trunk'], ['SW1', 'PC1'], ['SW1', 'PC2'], ['SW2', 'PC3'], ['SW2', 'PC4'], ['SW2', 'SRV']];
  function norm(x) { return /^SVI/.test(x) ? 'MLS1' : x; }
  function swOf(x) { return E.HOSTS[x] ? E.HOSTS[x].sw : 'MLS1'; }
  function chain(a, b) {
    var A = norm(a), B = norm(b), sa = swOf(a), sb = swOf(b), n = [A];
    if (A !== sa) n.push(sa);
    if (sa !== sb) { if (sa !== 'MLS1') n.push('MLS1'); if (sb !== 'MLS1') n.push(sb); }
    if (n[n.length - 1] !== B) n.push(B);
    return n.filter(function (v, i, arr) { return i === 0 || arr[i - 1] !== v; });
  }
  function linkKey(a, b) { return [a, b].sort().join('|'); }
  function eventLinks(ev) {
    var keys = {};
    function addChain(c) { for (var i = 1; i < c.length; i++) keys[linkKey(c[i - 1], c[i])] = true; }
    if (ev.to === 'broadcast') {
      var others = ev.visibleAt.filter(function (x) { return x !== ev.from; });
      if (!others.length) addChain(chain(ev.from, norm(ev.from) === 'MLS1' ? 'MLS1' : swOf(ev.from)));
      others.forEach(function (o) { addChain(chain(ev.from, o)); });
    } else if (ev.to) addChain(chain(ev.from, ev.to));
    return keys;
  }
  function devLabel(id) { return id === 'SRV' ? 'Server' : id; }

  // cfg: 표시할 설정(null이면 network_spec 기준 값만 표시 — Blind에서 정답 노출 방지)
  function createTopology(opts) {
    opts = opts || {};
    var cfg = opts.cfg ? E.normalizeConfig(opts.cfg) : null;
    var root = s('svg', { viewBox: '0 0 780 300', role: 'group', 'aria-label': '교육용 네트워크 토폴로지. 장비를 누르면 정보가 보입니다.' });
    var linkEls = {}, nodeEls = {};
    LINKS.forEach(function (l) {
      var a = POS[l[0]], b = POS[l[1]];
      var el = s('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'link' + (l[2] ? ' trunk' : '') });
      linkEls[linkKey(l[0], l[1])] = el; root.appendChild(el);
    });
    function sub(id) {
      if (id === 'MLS1') return 'Vlan10 .10.1 · Vlan20 .20.1';
      if (id === 'SW1' || id === 'SW2') return 'L2 Switch';
      var hst = E.HOSTS[id], vlan = hst.vlan;
      if (id === 'PC1' && cfg) vlan = cfg.pc1AccessVlan;
      return hst.ip + ' · VLAN ' + vlan;
    }
    Object.keys(POS).forEach(function (id) {
      var p = POS[id], w = id === 'MLS1' ? 176 : 132;
      var g = s('g', { class: 'node' + (opts.cp === id ? ' cp' : ''), tabindex: '0', role: 'button', 'aria-label': devLabel(id) + ' 정보 보기' },
        s('rect', { x: p[0] - w / 2, y: p[1] - 22, width: w, height: 44, rx: 8 }),
        s('text', { x: p[0], y: p[1] - 4, 'text-anchor': 'middle', text: devLabel(id) + (opts.cp === id ? ' (캡처)' : '') }),
        s('text', { x: p[0], y: p[1] + 12, 'text-anchor': 'middle', class: 'sub', text: sub(id) }));
      function pick() { if (opts.onNode) opts.onNode(id); }
      g.addEventListener('click', pick);
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      nodeEls[id] = g; root.appendChild(g);
    });
    root.appendChild(s('text', { x: 10, y: 292, class: 'legend', text: '주황 점선 = Trunk(여러 VLAN) · 굵은 파란 선 = 지금 패킷이 지나는 길 · 점선 테두리 = 캡처 지점' }));
    var marker = s('g', { class: 'marker hidden' }, s('rect', { x: -22, y: -10, width: 44, height: 20, rx: 10 }), s('text', { x: 0, y: 4, 'text-anchor': 'middle', class: 'marker-label', text: '' }));
    root.appendChild(marker);
    return {
      el: root,
      highlight: function (ev) {
        Object.keys(linkEls).forEach(function (k) { linkEls[k].classList.remove('on'); });
        Object.keys(nodeEls).forEach(function (k) { nodeEls[k].classList.remove('on'); });
        if (!ev) { marker.classList.add('hidden'); return; }
        var keys = eventLinks(ev);
        Object.keys(keys).forEach(function (k) { if (linkEls[k]) linkEls[k].classList.add('on'); });
        nodeEls[norm(ev.from)].classList.add('on');
        var endId = ev.to === 'broadcast' ? norm(ev.from) : norm(ev.to || ev.from);
        if (nodeEls[endId]) nodeEls[endId].classList.add('on');
        var st = POS[norm(ev.from)], en = ev.to === 'broadcast' ? POS[swOf(ev.from)] || st : POS[endId];
        marker.classList.remove('hidden');
        marker.querySelector('text').textContent = ev.proto;
        marker.style.transition = 'none';
        marker.style.transform = 'translate(' + st[0] + 'px,' + (st[1] - 32) + 'px)';
        void marker.getBoundingClientRect();
        marker.style.transition = '';
        marker.style.transform = 'translate(' + en[0] + 'px,' + (en[1] - 32) + 'px)';
      }
    };
  }

  function deviceInfo(id, cfg) {
    var c = cfg ? E.normalizeConfig(cfg) : null;
    if (E.HOSTS[id]) {
      var x = E.HOSTS[id];
      var rows = [['역할', x.label], ['IP', x.ip + '/' + (id === 'PC1' && c ? c.pc1Mask : x.mask)], ['MAC', x.mac], ['연결', x.sw + ' ' + x.port],
        ['VLAN', String(id === 'PC1' && c ? c.pc1AccessVlan : x.vlan)], ['Default Gateway', id === 'PC1' && c ? c.pc1Gateway : x.gw]];
      if (!c && id === 'PC1') rows.push(['주의', 'network_spec 기준 값입니다. 실제 설정은 장비 상태 확인으로 봅니다.']);
      return rows;
    }
    if (id === 'MLS1') return [['역할', 'L3 Switch — VLAN 간 라우팅 (Default Gateway)'], ['Vlan10 SVI', '192.168.10.1 / 00:d0:bc:00:00:0a'], ['Vlan20 SVI', '192.168.20.1 / 00:d0:bc:00:00:14'], ['포트', 'Gi0/1 → SW1 (Trunk), Gi0/2 → SW2 (Trunk)']];
    return [['역할', 'L2 Switch — 같은 VLAN 안에서 MAC 주소로 프레임 전달'], ['Uplink', 'Gi0/1 → MLS1 (Trunk)'], ['포트', id === 'SW1' ? 'Fa0/1 PC1, Fa0/2 PC2 (VLAN 10)' : 'Fa0/1 PC3, Fa0/2 PC4, Fa0/3 Server (VLAN 20)']];
  }
  function kv(rows) {
    var dl = h('dl', { class: 'kv' });
    rows.forEach(function (r) { dl.appendChild(h('dt', { text: r[0] })); dl.appendChild(h('dd', { text: r[1] })); });
    return dl;
  }

  // packet_summary.json에서 이 패킷이 세어지는 필드 (engine.summarize와 같은 기준)
  function countedField(ev, ctx) {
    if (!ctx) return null;
    var t = ctx.targets || [ctx.dst];
    if (ev.kind === 'arp_request' && ev.srcIp === ctx.src && t.indexOf(ev.dstIp) >= 0) return 'arp_request_count';
    if (ev.kind === 'arp_reply' && ev.dstIp === ctx.src && t.indexOf(ev.srcIp) >= 0) return 'arp_reply_count';
    if (ev.kind === 'icmp_echo_request' && ev.srcIp === ctx.src && ev.dstIp === ctx.dst) return 'icmp_request_count';
    if (ev.kind === 'icmp_echo_reply' && ev.srcIp === ctx.dst && ev.dstIp === ctx.src) return 'icmp_reply_count';
    if (ev.kind === 'dns_query' && ev.srcIp === ctx.src) return 'dns_query_count';
    if ((ev.kind === 'dns_response' || ev.kind === 'dns_error') && ev.dstIp === ctx.src) return 'dns_response_count';
    if (ev.kind === 'tcp_syn' && ev.srcIp === ctx.src && ev.dstIp === ctx.dst) return 'tcp_syn_count';
    if (ev.kind === 'tcp_syn_ack' && ev.srcIp === ctx.dst && ev.dstIp === ctx.src) return 'tcp_syn_ack_count';
    if (ev.kind === 'tcp_rst' && ev.srcIp === ctx.dst && ev.dstIp === ctx.src) return 'tcp_rst_count';
    return '(집계 대상 아님)';
  }
  function cpNames(list) { return list.map(function (x) { return E.CAPTURE_POINTS[x]; }).join(', ') || '(캡처 지점 없음)'; }

  // ---------------------------------------------------------------- player
  // opts: events, cp, cfg(null=spec labels), progressive, allPoints, ctx(json), onNode, emptyText
  function createPlayer(opts) {
    var events = opts.events, idx = -1, timer = null, speed = 1;
    var root = h('section', { class: 'player', 'aria-label': opts.label || '패킷 재생기' });
    var detail = h('div', { class: 'detail card' });
    var topo = createTopology({ cfg: opts.cfg, cp: opts.cp, onNode: function (id) { showDevice(id); } });
    var topoBox = h('div', { class: 'topo card' }, topo.el);
    var explainBox = h('div', { class: 'explain card', 'aria-live': 'polite' });
    var pos = h('span', { class: 'pos' });
    var playBtn = h('button', { class: 'btn', type: 'button', onclick: function () { timer ? pause() : play(); } }, '▶ 재생');
    var sp = h('select', { 'aria-label': '재생 속도', onchange: function () { speed = +sp.value; if (timer) { pause(); play(); } } },
      h('option', { value: '0.5', text: '느리게' }), h('option', { value: '1', text: '보통', selected: true }), h('option', { value: '2', text: '빠르게' }));
    var controls = h('div', { class: 'controls', role: 'group', 'aria-label': '재생 제어 (←/→ 키로도 이동)' },
      h('button', { class: 'btn', type: 'button', onclick: function () { pause(); go(-1); } }, '⏮ 처음으로'),
      h('button', { class: 'btn', type: 'button', onclick: function () { pause(); go(idx - 1); } }, '◀ 이전'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { pause(); go(idx + 1); } }, '다음 패킷 ▶'),
      playBtn, sp, pos);
    var tbody = h('tbody');
    var table = h('table', { class: 'pkts' }, h('thead', null, h('tr', null,
      h('th', { text: 'No.' }), h('th', { text: '시간(s)' }), h('th', { text: '출발' }), h('th', { text: '도착' }), h('th', { text: '프로토콜' }), h('th', { text: '요약 (Info)' }),
      opts.allPoints ? h('th', { text: '보이는 캡처 지점' }) : null)), tbody);
    var tableWrap = h('div', { class: 'table-wrap', tabindex: '0', 'aria-label': '패킷 목록. 행을 누르면 그 패킷으로 이동합니다.' }, table);
    root.appendChild(topoBox); root.appendChild(explainBox); root.appendChild(controls); root.appendChild(tableWrap); root.appendChild(detail);
    root.addEventListener('keydown', function (e) {
      var tg = e.target.tagName;
      if (tg === 'SELECT' || tg === 'INPUT' || tg === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); pause(); go(idx + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); pause(); go(idx - 1); }
    });

    function fromTo(ev) {
      var f = ev.from === 'SRV' ? 'Server' : /^SVI/.test(ev.from) ? 'MLS1' : ev.from;
      return [f + ' ' + (ev.srcIp || ''), ev.to === 'broadcast' ? 'Broadcast' : (ev.dstIp || '')];
    }
    function renderTable() {
      clear(tbody);
      if (!events.length) {
        tbody.appendChild(h('tr', null, h('td', { colspan: opts.allPoints ? 7 : 6, text: opts.emptyText || '이 캡처 지점에서는 관찰 구간 동안 패킷이 보이지 않았습니다. (보이지 않음 ≠ 존재하지 않음)' })));
        return;
      }
      events.forEach(function (ev, i) {
        if (opts.progressive && i > idx) return;
        var ft = fromTo(ev);
        var tr = h('tr', { class: 'pkt' + (i === idx ? ' current' : '') + (i > idx ? ' future' : '') + (opts.diffFrom !== undefined && i === opts.diffFrom ? ' diff' : ''), tabindex: '-1', onclick: function () { pause(); go(i); } },
          h('td', { text: String(i + 1) }), h('td', { text: ev.t.toFixed(3) }), h('td', { text: ft[0] }), h('td', { text: ft[1] }),
          h('td', null, protoBadge(ev.proto)), h('td', { class: 'info', text: ev.info + (opts.diffFrom === i ? '  ← 첫 차이' : '') }),
          opts.allPoints ? h('td', { text: ev.visibleAt.map(devLabel).join(', ') || '없음' }) : null);
        tbody.appendChild(tr);
      });
      if (opts.progressive && idx < events.length - 1) tbody.appendChild(h('tr', null, h('td', { colspan: opts.allPoints ? 7 : 6, class: 'muted', text: '… 다음 패킷은 "다음 패킷 ▶"을 눌러 확인합니다. 먼저 무엇이 나올지 예상해 보세요.' })));
    }
    function renderExplain() {
      clear(explainBox);
      if (idx < 0) {
        explainBox.appendChild(h('h3', { text: '시작 전' }));
        explainBox.appendChild(h('p', { text: opts.startText || '"다음 패킷 ▶"을 눌러 한 단계씩 진행합니다. 자동으로 보려면 재생을 누릅니다.' }));
        if (events.length) explainBox.appendChild(h('p', { class: 'muted small', text: '이 흐름에는 패킷 ' + events.length + '개가 있습니다.' }));
        return;
      }
      var ev = events[idx], x = C.explain(E, ev);
      explainBox.appendChild(h('h3', null, '#' + (idx + 1) + ' ', protoBadge(ev.proto), ' ', ev.info));
      explainBox.appendChild(h('div', { class: 'layer' }, h('b', { text: '① 지금 일어나는 일 (쉬운 설명)' }), h('span', { text: x.easy })));
      explainBox.appendChild(h('div', { class: 'layer' }, h('b', { text: '② 실제 흐름' }), h('span', { text: x.flow })));
      if (x.limit) explainBox.appendChild(h('div', { class: 'layer callout warn' }, h('b', { text: '이 패킷만으로 알 수 없는 것' }), h('span', { text: x.limit })));
      var nx = events[idx + 1];
      explainBox.appendChild(h('div', { class: 'layer' }, h('b', { text: '다음에 기대하는 패킷' }),
        h('span', { text: opts.expect ? opts.expect(idx) : nx ? (opts.progressive ? '예상해 본 뒤 "다음 패킷 ▶"으로 확인하세요.' : nx.proto + ' — ' + nx.info) : '이 지점에서 더 이상 관찰된 패킷이 없습니다. (관찰 구간 끝)' })));
      var fresh = x.terms.filter(function (t) { return !state.seenTerms[t]; });
      if (fresh.length) {
        explainBox.appendChild(h('div', null, h('b', { class: 'small', text: '처음 나온 용어' }),
          fresh.map(function (t) { state.seenTerms[t] = true; return h('div', { class: 'term' }, h('b', { text: t }), C.GLOSSARY[t]); })));
      }
    }
    function renderDetail(ev) {
      clear(detail);
      if (!ev) { detail.appendChild(h('p', { class: 'muted', text: '패킷이나 장비를 선택하면 상세 정보가 여기에 나옵니다.' })); return; }
      var x = C.explain(E, ev);
      detail.appendChild(h('h3', null, '선택한 패킷 상세 ', h('span', { class: 'tag', text: '③ 기술 세부사항' })));
      detail.appendChild(kv(x.detail));
      detail.appendChild(h('p', { class: 'small' }, h('b', { text: '이 패킷이 보이는 캡처 지점: ' }), cpNames(ev.visibleAt)));
      var cf = countedField(ev, opts.ctx);
      if (cf) detail.appendChild(h('p', { class: 'small' }, h('b', { text: 'packet_summary.json에서 세는 필드: ' }), h('code', { text: cf })));
    }
    function showDevice(id) {
      clear(detail);
      detail.appendChild(h('h3', { text: devLabel(id) + ' 정보' }));
      detail.appendChild(kv(deviceInfo(id, opts.cfg)));
    }
    function go(i) {
      idx = Math.max(-1, Math.min(events.length - 1, i));
      pos.textContent = (idx + 1) + ' / ' + events.length;
      topo.highlight(idx >= 0 ? events[idx] : null);
      renderTable(); renderExplain(); renderDetail(idx >= 0 ? events[idx] : null);
      var cur = tbody.querySelector('tr.current');
      if (cur && cur.scrollIntoView && !document.documentElement.classList.contains('reduce-motion')) cur.scrollIntoView({ block: 'nearest' });
      if (opts.onStep) opts.onStep(idx);
    }
    function play() {
      if (!events.length) return;
      if (idx >= events.length - 1) go(-1);
      playBtn.textContent = '⏸ 일시정지';
      timer = setInterval(function () { if (idx >= events.length - 1) pause(); else go(idx + 1); }, 1400 / speed);
    }
    function pause() { if (timer) clearInterval(timer); timer = null; playBtn.textContent = '▶ 재생'; }
    go(opts.startAt !== undefined ? opts.startAt : -1);
    var api = { el: root, go: go, destroy: pause, index: function () { return idx; } };
    active.push(api);
    return api;
  }

  // ---------------------------------------------------------------- 관찰 요약 (사실만)
  function summarizeObs(events) {
    var groups = [], map = {};
    var L = {
      arp_request: function (e) { return ['ARP Request', e.srcIp + '가 ' + e.dstIp + '를 찾음']; },
      arp_reply: function (e) { return ['ARP Reply', e.srcIp + '가 ' + e.dstIp + '에게 답함']; },
      icmp_echo_request: function (e) { return ['ICMP Echo Request', e.srcIp + ' → ' + e.dstIp]; },
      icmp_echo_reply: function (e) { return ['ICMP Echo Reply', e.srcIp + ' → ' + e.dstIp]; },
      icmp_unreach: function (e) { return ['ICMP Destination Unreachable', e.srcIp + '가 보냄']; },
      dns_query: function (e) { return ['DNS Query', e.srcIp + ' → ' + e.dstIp]; },
      dns_response: function (e) { return ['DNS Response', 'A = ' + e.fields['dns.a'] + ', ' + e.srcIp + '가 보냄']; },
      dns_error: function (e) { return ['DNS 오류 응답', e.fields['dns.flags.rcode'] + ', ' + e.srcIp + '가 보냄']; },
      tcp_syn: function (e) { return ['TCP SYN', e.srcIp + ' → ' + e.dstIp + ':80']; },
      tcp_syn_ack: function (e) { return ['TCP SYN-ACK', e.srcIp + ' → ' + e.dstIp]; },
      tcp_ack: function (e) { return ['TCP ACK', e.srcIp + ' → ' + e.dstIp]; },
      tcp_rst: function (e) { return ['TCP RST', e.srcIp + ' → ' + e.dstIp]; },
      http_request: function (e) { return ['HTTP GET', e.srcIp + ' → ' + e.dstIp]; },
      http_response: function (e) { return ['HTTP 200 OK', e.srcIp + ' → ' + e.dstIp]; }
    };
    events.forEach(function (e) {
      var p = L[e.kind](e), key = p.join('|');
      if (!map[key]) { map[key] = { name: p[0], what: p[1], n: 0 }; groups.push(map[key]); }
      map[key].n++;
    });
    if (!groups.length) return ['이 지점에서 관찰 구간 동안 보인 패킷 없음'];
    return groups.map(function (g) { return g.name + ' ' + g.n + '건 (' + g.what + ')'; });
  }

  // ---------------------------------------------------------------- 이해 확인 질문 컴포넌트
  function questionBox(qid) {
    var q = C.QUESTIONS[qid], id = uid();
    var ans = state.answers[qid] || '';
    var ta = h('textarea', { id: id, value: ans, oninput: function () { state.answers[qid] = ta.value; btn.disabled = ta.value.trim().length < 15; } });
    var out = h('div');
    var btn = h('button', { class: 'btn', type: 'button', disabled: ans.trim().length < 15, onclick: function () {
      clear(out);
      out.appendChild(h('div', { class: 'callout' }, h('b', { text: '모범 설명' }), h('p', { text: q.model })));
      out.appendChild(h('p', { class: 'small', text: '자기 점검: 내 설명에 아래 근거가 들어갔나요? (자동 채점하지 않습니다. 키워드가 들어갔다고 이해한 것은 아닙니다.)' }));
      out.appendChild(h('ul', { class: 'check-list' }, q.points.map(function (p) { var cid = uid(); return h('li', null, h('input', { type: 'checkbox', id: cid }), ' ', h('label', { for: cid, text: p })); })));
      out.appendChild(h('p', { class: 'small muted', text: '가장 좋은 확인 방법: 이 설명을 다른 팀원에게 소리 내어 말해 보고, 듣는 사람이 다시 설명할 수 있는지 봅니다.' }));
    } }, '모범 설명과 비교하기');
    return h('div', { class: 'card stack' }, h('label', { for: id }, h('b', { text: '내 말로 설명하기 — ' + q.q })), ta,
      h('div', { class: 'btn-row' }, btn, h('span', { class: 'small muted', text: '15자 이상 쓰면 비교할 수 있습니다.' })), out);
  }

  // ---------------------------------------------------------------- 화면: 시작
  function viewHome() {
    setHeader('시작하기', '이 앱의 목적과 배우게 될 내용', '아래 세 버튼 중 하나를 누르세요. 처음이라면 "정상 패킷 따라가기"부터.');
    main.appendChild(h('h1', { text: '패킷을 보고 네트워크 장애를 설명하는 연습' }));
    main.appendChild(h('p', { class: 'lead', text: '네트워크가 "안 된다"는 말만으로는 원인을 알 수 없습니다. 이 앱은 패킷이 어디에서 어디로 가는지 따라가 보고, 정상일 때와 장애일 때 무엇이 달라지는지 직접 비교하게 합니다.' }));
    main.appendChild(h('div', { class: 'grid grid-3' },
      h('a', { class: 'btn btn-big btn-primary', href: '#/flow/a' }, h('b', { text: '① 정상 패킷 따라가기' }), h('br'), h('span', { class: 'small', text: '같은 네트워크 → 다른 네트워크 → 웹 접속 순서' })),
      h('a', { class: 'btn btn-big', href: '#/blind' }, h('b', { text: '② 장애 조사하기' }), h('br'), h('span', { class: 'small', text: '원인을 숨긴 사건을 패킷 증거로 좁혀 보기' })),
      h('a', { class: 'btn btn-big', href: '#/demo' }, h('b', { text: '③ 발표용 짧은 경로 (약 2분)' }), h('br'), h('span', { class: 'small', text: '팀 발표에서 패킷 증거만 빠르게 보여 주기' }))));
    main.appendChild(h('h2', { text: '끝나면 이렇게 말할 수 있습니다' }));
    main.appendChild(h('ul', null,
      h('li', { text: '"이 패킷은 어디에서 어디로 가고, 왜 이 단계가 필요한가"' }),
      h('li', { text: '"정상이라면 다음에 무엇이 보여야 하는데, 지금은 무엇이 보이는가"' }),
      h('li', { text: '"지금 확실한 것(관찰)과 아직 모르는 것(추측)은 무엇인가"' }),
      h('li', { text: '"남은 원인 후보를 구분하려면 무엇을 더 확인해야 하는가"' })));
    main.appendChild(h('div', { class: 'callout warn' }, h('b', { text: '이 앱에 대해 먼저 알아 둘 것 ' }),
      '모든 패킷은 단순화한 교육용 모델이 계산합니다. 주소와 장비 이름은 교육용 예제이며, 팀의 실제 네트워크(network_spec.md)나 실제 장애 사례와 다릅니다. 실제 증거는 Wireshark 캡처와 packet_analysis.md에 따로 기록합니다.'));
    main.appendChild(h('details', null, h('summary', { text: '교육용 모델의 단순화 가정 보기' }), h('ul', null, E.ASSUMPTIONS.map(function (a) { return h('li', { text: a }); }))));
  }

  // ---------------------------------------------------------------- 화면: 정상 흐름 A·B·C
  function viewLesson(id) {
    var L = C.LESSONS[id], st = state.lessons[id];
    setHeader('정상 패킷 따라가기 — ' + L.title, L.goal, st.predicted ? '"다음 패킷 ▶"을 눌러 한 단계씩 따라가세요.' : '먼저 아래 예측 질문에 답하세요.');
    main.appendChild(h('div', { class: 'btn-row', role: 'tablist', 'aria-label': '정상 흐름 단원' },
      ['a', 'b', 'c'].map(function (k) { return h('a', { class: 'btn' + (k === id ? ' btn-primary' : ''), href: '#/flow/' + k, 'aria-current': k === id ? 'page' : null, text: C.LESSONS[k].title }); })));
    main.appendChild(h('h1', { text: L.title }));
    main.appendChild(h('ol', { class: 'steps-line', 'aria-label': '학습 단계' },
      [['예측', !!st.predicted], ['조작', !!st.predicted], ['관찰', !!st.predicted], ['설명', false]].map(function (x, i) {
        return h('li', { class: x[1] ? 'done' : (i === 0 && !st.predicted ? 'now' : ''), text: x[0] });
      })));
    main.appendChild(h('div', { class: 'card' }, h('b', { text: '이 예제의 조건 ' }), h('span', { class: 'tag', text: '교육용 예제 설정' }), h('p', { text: L.conditions })));

    // 1. 예측
    var P = L.predict, name = uid();
    var fb = h('div');
    var form = h('form', { class: 'card stack', onsubmit: function (e) {
      e.preventDefault();
      var v = form.querySelector('input[name=' + name + ']:checked');
      if (!v) { clear(fb).appendChild(h('p', { class: 'warn', text: '하나를 골라 주세요.' })); return; }
      st.predicted = v.value; route();
    } }, h('h2', { style: 'margin-top:0', text: '① 예측 — ' + P.q }),
      P.options.map(function (o) { var oid = uid(); return h('div', null, h('input', { type: 'radio', name: name, id: oid, value: o[0], checked: st.predicted === o[0] }), ' ', h('label', { for: oid, text: o[1] })); }),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', type: 'submit' }, '예측 확인'), h('a', { href: '#', onclick: function (e) { e.preventDefault(); st.predicted = 'skip'; route(); }, class: 'small', text: '예측 없이 보기' })), fb);
    main.appendChild(form);
    if (st.predicted && st.predicted !== 'skip') {
      var right = st.predicted === P.answer;
      fb.appendChild(h('div', { class: 'callout ' + (right ? 'ok' : 'warn') }, h('b', { text: right ? '✓ 맞았습니다. ' : '✕ 다시 생각해 볼 부분이 있습니다. ' }), P.why));
    }
    if (!st.predicted) return;

    // 2. 조작 (캐시)
    var caches = { arp: !!st.arp, dns: !!st.dns };
    var cold = E.simulate({}, L.test, { caches: {} });
    var sim = E.simulate({}, L.test, { caches: caches });
    function toggle(key, label) {
      var cid = uid();
      return h('span', null, h('input', { type: 'checkbox', id: cid, checked: caches[key], onchange: function (e) { st[key] = e.target.checked; route(); } }), ' ', h('label', { for: cid, text: label }));
    }
    main.appendChild(h('div', { class: 'card stack' }, h('h2', { style: 'margin-top:0', text: '② 조작 — 캐시가 있으면 무엇이 달라질까?' }),
      h('div', { class: 'btn-row' }, toggle('arp', 'ARP 캐시 있음 (모든 장비가 이미 MAC을 알고 있음)'), L.test === 'web' ? toggle('dns', 'PC1 DNS 캐시 있음') : null),
      h('p', { class: 'small', text: '캐시 없음: 패킷 ' + cold.events.length + '개 · 지금 설정: 패킷 ' + sim.events.length + '개' +
        (sim.events.length < cold.events.length ? ' → ' + (cold.events.length - sim.events.length) + '개가 줄었습니다. 이미 아는 정보는 다시 묻지 않기 때문입니다. 이처럼 "패킷이 보이지 않음"이 언제나 장애를 뜻하지는 않습니다.' : '') }),
      null));

    // 특별 패널
    if (id === 'a') {
      var pc1 = E.HOSTS.PC1, pc2 = E.HOSTS.PC2;
      main.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: 'PC1이 가장 먼저 하는 계산: 같은 네트워크인가?' }),
        kv([['PC1 주소', pc1.ip + '/24 → 네트워크 ' + E.networkOf(pc1.ip, 24)], ['목적지', pc2.ip + ' → 네트워크 ' + E.networkOf(pc2.ip, 24)], ['결론', E.sameSubnet(pc1.ip, pc2.ip, 24) ? '같다 → Gateway를 거치지 않고 PC2에게 직접. next hop = PC2' : '다르다']]),
        h('p', { class: 'small', text: 'ARP 질문(브로드캐스트)은 VLAN 10 안에서만 퍼집니다. 패킷 목록의 "보이는 캡처 지점" 칸을 보면 VLAN 20의 PC3에는 보이지 않습니다.' })));
    }
    if (id === 'b') {
      var legs = sim.events.filter(function (e) { return e.kind === 'icmp_echo_request'; }).slice(0, 2);
      if (legs.length === 2) main.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: '라우터 전후로 무엇이 바뀌고 무엇이 그대로인가 (첫 ping)' }),
        h('div', { class: 'table-wrap', tabindex: '0' }, h('table', { class: 'pkts' }, h('thead', null, h('tr', null, ['구간', '출발 MAC', '도착 MAC', '출발 IP', '도착 IP'].map(function (t) { return h('th', { text: t }); }))),
          h('tbody', null, legs.map(function (e, i) {
            return h('tr', null, h('td', { text: i === 0 ? '① PC1 → MLS1 (VLAN 10)' : '② MLS1 → Server (VLAN 20)' }), h('td', { text: e.srcMac }), h('td', { text: e.dstMac }), h('td', { text: e.srcIp }), h('td', { text: e.dstIp }));
          })))),
        h('p', { class: 'small', text: 'MAC(링크 주소)은 구간마다 새로 붙습니다. IP(최종 목적지)는 끝까지 같습니다. 이 예제는 NAT를 쓰지 않습니다.' })));
    }
    if (id === 'c') {
      main.appendChild(h('div', { class: 'grid grid-3' },
        [['DNS', '어디로 가야 하나?', '이름 www.packetlab.test → IP 192.168.20.20'], ['TCP', '상대가 받을 준비가 됐나?', 'SYN → SYN-ACK → ACK로 연결을 연다'], ['HTTP', '무엇을 달라고 할까?', 'GET / → 200 OK']].map(function (x) {
          return h('div', { class: 'card' }, protoBadge(x[0]), h('p', null, h('b', { text: x[1] })), h('p', { class: 'small', text: x[2] }));
        })));
      main.appendChild(h('p', { class: 'small muted', text: '이 예제는 일반 DNS(UDP 53)와 일반 HTTP(TCP 80)입니다. 실제 HTTPS나 암호화 DNS에서는 요청 내용이 암호화되어 이렇게 보이지 않을 수 있습니다.' }));
    }

    // 3. 관찰
    main.appendChild(h('h2', { text: '③ 관찰 — 한 단계씩 따라가기' }));
    main.appendChild(h('p', { class: 'small muted', text: '이 화면은 교육용으로 모든 지점을 한꺼번에 보여 줍니다. 실제 Wireshark는 캡처한 한 지점만 보여 줍니다. 오른쪽 끝 "보이는 캡처 지점" 칸이 그 차이를 알려 줍니다.' }));
    var target = E.TESTS[L.test].target === E.DOMAIN ? E.HOSTS.SRV.ip : E.TESTS[L.test].target;
    var pl = createPlayer({ events: sim.events, cfg: {}, allPoints: true, progressive: true, ctx: { src: E.HOSTS.PC1.ip, dst: target, targets: [target, E.HOSTS.PC1.gw] },
      onStep: function (i) { if (i === sim.events.length - 1) setNext('아래 "④ 설명"에서 핵심을 정리하고 내 말로 설명해 보세요.'); } });
    main.appendChild(pl.el);
    main.appendChild(h('div', { class: 'card' }, h('b', { text: 'PC1 화면 (명령 결과)' }), h('div', { class: 'console', text: E.TESTS[L.test].cmd + '\n' + sim.outcome.console.join('\n') })));

    // 4. 설명
    main.appendChild(h('h2', { text: '④ 설명 — 핵심 정리' }));
    main.appendChild(h('ol', null, L.points.map(function (p) { return h('li', { text: p }); })));
    L.check.forEach(function (q) { main.appendChild(questionBox(q)); });
    var nextId = { a: 'b', b: 'c', c: null }[id];
    main.appendChild(h('div', { class: 'btn-row', style: 'margin-top:16px' },
      nextId ? h('a', { class: 'btn btn-primary', href: '#/flow/' + nextId, text: '다음 단원: ' + C.LESSONS[nextId].title }) : h('a', { class: 'btn btn-primary', href: '#/compare', text: '다음: 정상·장애 비교' })));
  }

  // ---------------------------------------------------------------- 화면: 정상·장애 비교
  function firstDiff(a, b) {
    var n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) {
      var x = a[i], y = b[i];
      if (!x || !y || x.kind !== y.kind || x.srcIp !== y.srcIp || x.dstIp !== y.dstIp || x.info !== y.info) return i;
    }
    return -1;
  }
  function viewCompare(caseId) {
    var cs = state.compare;
    if (caseId && caseId !== cs.caseId) { cs.caseId = caseId; cs.variant = 0; cs.cp = null; }
    var K = C.COMPARE_CASES.filter(function (c) { return c.id === cs.caseId; })[0] || C.COMPARE_CASES[0];
    var cp = cs.cp || K.cp, variant = K.variants[cs.variant] || K.variants[0];
    setHeader('정상·장애 비교 — ' + K.title, '같은 테스트를 정상과 장애에서 같은 지점으로 보고, 처음 달라지는 곳을 찾는다.', '양쪽을 같은 단계로 넘기며 "첫 차이" 표시를 찾으세요. 그다음 아래의 관찰 사실과 원인 후보를 구분해 읽으세요.');
    main.appendChild(h('h1', { text: '정상·장애 비교' }));
    main.appendChild(h('p', { class: 'small muted', text: '아래 사례는 교육용 예제입니다. 실제 과제의 장애 사례나 case_id와 연결되지 않습니다.' }));
    main.appendChild(h('div', { class: 'btn-row', 'aria-label': '비교 사례' }, C.COMPARE_CASES.map(function (c) {
      return h('a', { class: 'btn' + (c.id === K.id ? ' btn-primary' : ''), href: '#/compare/' + c.id, 'aria-current': c.id === K.id ? 'true' : null, text: c.title });
    })));
    main.appendChild(h('div', { class: 'card stack', style: 'margin-top:12px' },
      h('h2', { style: 'margin-top:0', text: K.title }),
      h('p', null, h('b', { text: '성립 조건: ' }), K.conditions),
      h('div', { class: 'btn-row' },
        K.variants.length > 1 ? h('label', null, '장애 설정 ', h('select', { onchange: function (e) { cs.variant = +e.target.value; route(); } },
          K.variants.map(function (v, i) { return h('option', { value: String(i), selected: i === cs.variant, text: v[0] }); }))) : h('span', null, h('b', { text: '장애 설정: ' }), variant[0]),
        h('label', null, '캡처 지점 ', h('select', { onchange: function (e) { cs.cp = e.target.value; route(); } },
          Object.keys(E.CAPTURE_POINTS).map(function (k) { return h('option', { value: k, selected: k === cp, text: E.CAPTURE_POINTS[k] }); }))),
        K.altCp && cp !== K.altCp ? h('button', { class: 'btn', type: 'button', onclick: function () { cs.cp = K.altCp; route(); } }, '다른 지점(' + devLabel(K.altCp) + ')에서 보기') : null,
        cp !== K.cp ? h('button', { class: 'btn', type: 'button', onclick: function () { cs.cp = null; route(); } }, '기본 지점으로') : null)));

    var n = E.simulate({}, K.test), f = E.simulate(variant[1], K.test);
    var ne = E.eventsAt(n.events, cp), fe = E.eventsAt(f.events, cp);
    var d = firstDiff(ne, fe);
    var target = E.TESTS[K.test].target === E.DOMAIN ? E.HOSTS.SRV.ip : E.TESTS[K.test].target;
    var ctx = { src: E.HOSTS.PC1.ip, dst: target, targets: [target, E.normalizeConfig(variant[1]).pc1Gateway] };

    var diffBox = h('div', { class: 'callout ' + (d >= 0 ? 'bad' : 'ok') });
    if (d < 0) diffBox.appendChild(h('span', { text: '이 캡처 지점에서는 정상과 장애의 패킷이 같습니다. 이 지점만으로는 차이를 볼 수 없습니다. 다른 지점이나 다른 테스트가 필요합니다.' }));
    else {
      diffBox.appendChild(h('b', { text: '첫 차이: ' + (d + 1) + '번째 패킷. ' }));
      diffBox.appendChild(h('span', { text: '정상에서 기대한 것 → ' + (ne[d] ? ne[d].proto + ' ' + ne[d].info : '(더 이상 패킷 없음)') + ' / 장애에서 관찰한 것 → ' + (fe[d] ? fe[d].proto + ' ' + fe[d].info : '(더 이상 패킷 없음)') }));
    }
    main.appendChild(diffBox);

    var cols = h('div', { class: 'cmp-cols' });
    var pn, pf;
    function syncTo(i) { if (pn.index() !== i) pn.go(Math.min(i, ne.length - 1)); if (pf.index() !== i) pf.go(Math.min(i, fe.length - 1)); }
    var shared = h('div', { class: 'btn-row', role: 'group', 'aria-label': '양쪽 같은 단계로 이동' },
      h('button', { class: 'btn', type: 'button', onclick: function () { syncTo(-1); } }, '⏮ 양쪽 처음으로'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { syncTo(Math.max(pn.index(), pf.index()) + 1); } }, '양쪽 다음 단계 ▶'),
      d >= 0 ? h('button', { class: 'btn', type: 'button', onclick: function () { syncTo(d); } }, '첫 차이로 이동') : null);
    pn = createPlayer({ events: ne, cfg: {}, cp: cp, ctx: ctx, diffFrom: d >= 0 ? d : undefined, label: '정상 상태 패킷' });
    pf = createPlayer({ events: fe, cfg: variant[1], cp: cp, ctx: ctx, diffFrom: d >= 0 ? d : undefined, label: '장애 상태 패킷' });
    pn.el.classList.add('compact'); pf.el.classList.add('compact');
    cols.appendChild(h('section', { class: 'stack' }, h('div', { class: 'col-title' }, h('span', { class: 'ok', text: '✓ 정상 (Baseline)' })),
      h('div', { class: 'console', text: E.TESTS[K.test].cmd + '\n' + n.outcome.console.join('\n') }), pn.el));
    cols.appendChild(h('section', { class: 'stack' }, h('div', { class: 'col-title' }, h('span', { class: 'bad', text: '⚠ 장애 조건: ' + variant[0] })),
      h('div', { class: 'console', text: E.TESTS[K.test].cmd + '\n' + f.outcome.console.join('\n') }), pf.el));
    main.appendChild(shared);
    main.appendChild(cols);

    main.appendChild(h('div', { class: 'grid grid-2', style: 'margin-top:16px' },
      h('div', { class: 'card fact' }, h('h3', { style: 'margin-top:0', text: '관찰한 사실 (장애, ' + E.CAPTURE_POINTS[cp] + ')' }),
        h('p', { class: 'small muted', text: '관찰 구간: 테스트 시작 0초 ~ ' + (fe.length ? fe[fe.length - 1].t.toFixed(1) : '0') + '초 (교육용 모델 시간)' }),
        h('ul', null, summarizeObs(fe).map(function (x) { return h('li', { text: x }); }))),
      h('div', { class: 'card guess' }, h('h3', { style: 'margin-top:0', text: '해석: 원인 후보 (확정 아님)' }),
        h('ul', null, K.candidates.map(function (x) { return h('li', { text: x }); })),
        h('p', null, h('b', { text: '구분하려면 추가로 확인할 것: ' }), K.next)),
      h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: '왜 한 번의 관찰로는 부족한가' }), h('p', { text: K.why }),
        h('p', { class: 'small muted', text: '같은 설정 오류라도 테스트, 캡처 지점, 캐시 상태에 따라 보이는 패킷이 달라질 수 있습니다. "이 오류면 항상 이 패킷"이라고 외우지 마세요.' }))));
  }

  // ---------------------------------------------------------------- 화면: 설정 변경 실험실
  function labDefaults() {
    var cfg = {};
    Object.keys(E.CONFIG_OPTIONS).forEach(function (k) { cfg[k] = String(E.CONFIG_OPTIONS[k].options[0][0]); });
    return { cfg: cfg, multi: false, predict: null, test: 'ping_srv', cp: 'PC1', run: null, explained: false };
  }
  function labStage(L) {
    var changed = E.changedKeys(L.cfg).length > 0;
    if (!changed && !L.run) return 0;
    if (!L.predict) return 1;
    if (!L.run) return 2;
    if (!L.explained) return 3;
    return 5;
  }
  function viewLab() {
    var L = state.lab = state.lab || labDefaults();
    var stage = labStage(L);
    var nexts = ['설정 하나를 바꾸세요.', '바꾼 설정으로 어떤 결과가 나올지 예측하세요.', '테스트와 캡처 지점을 고르고 "통신 실행"을 누르세요.', '패킷을 한 단계씩 관찰한 뒤 "이유 설명 보기"를 누르세요.', '', '"정상으로 복원"을 누르고 다른 설정으로 다시 해 보세요.'];
    setHeader('설정 변경 실험실', '설정 하나를 바꾸면 패킷 순서와 응답이 어떻게 달라지는지 직접 확인한다.', nexts[stage]);
    main.appendChild(h('h1', { text: '설정 변경 실험실' }));
    main.appendChild(h('p', { class: 'small muted', text: '여기서 바꾸는 설정은 교육용 모델 안에서만 바뀝니다. 실제 장비나 Packet Tracer 파일은 바뀌지 않습니다.' }));
    main.appendChild(h('ol', { class: 'steps-line', 'aria-label': '실험 단계' },
      ['설정 변경', '결과 예측', '통신 실행', '패킷 관찰', '이유 설명', '정상 복원'].map(function (t, i) {
        return h('li', { class: i < stage ? 'done' : i === stage ? 'now' : '', text: (i + 1) + '. ' + t });
      })));

    // 1. 설정
    var changed = E.changedKeys(L.cfg);
    var form = h('div', { class: 'card' }, h('h2', { style: 'margin-top:0', text: '1. 설정 변경' }),
      h('p', { class: 'small', text: '한 번에 하나만 바꾸는 것이 기본입니다. 그래야 "무엇 때문에 달라졌는지" 말할 수 있습니다.' }));
    var grid = h('div', { class: 'grid grid-2' });
    Object.keys(E.CONFIG_OPTIONS).forEach(function (k) {
      var o = E.CONFIG_OPTIONS[k], sid = uid();
      var locked = !L.multi && changed.length > 0 && changed.indexOf(k) < 0;
      grid.appendChild(h('label', { class: 'field', for: sid }, h('span', { text: o.label + (changed.indexOf(k) >= 0 ? '  ← 바뀜' : '') }),
        h('select', { id: sid, disabled: locked, onchange: function (e) { L.cfg[k] = e.target.value; L.predict = null; L.run = null; L.explained = false; route(); } },
          o.options.map(function (op, i) { return h('option', { value: String(op[0]), selected: String(op[0]) === String(L.cfg[k]), text: op[1] + (i === 0 ? ' (정상)' : '') }); }))));
    });
    form.appendChild(grid);
    var mid = uid();
    form.appendChild(h('div', { class: 'small' }, h('input', { type: 'checkbox', id: mid, checked: L.multi, onchange: function (e) { L.multi = e.target.checked; route(); } }), ' ',
      h('label', { for: mid, text: '여러 설정을 동시에 바꾸기 (고급 — 원인을 설명하기 어려워집니다)' })));
    if (!L.multi && changed.length) form.appendChild(h('p', { class: 'small muted', text: '다른 설정은 잠겨 있습니다. 먼저 정상으로 복원하거나 "여러 설정을 동시에 바꾸기"를 켜세요.' }));
    main.appendChild(form);

    // 2. 예측
    if (changed.length || L.run) {
      var pr = L.predict || {};
      var nm1 = uid(), nm2 = uid();
      var pform = h('form', { class: 'card stack', onsubmit: function (e) {
        e.preventDefault();
        var a = pform.querySelector('input[name=' + nm1 + ']:checked'), b = pform.querySelector('input[name=' + nm2 + ']:checked');
        if (!a || !b) return;
        L.predict = { result: a.value, repeat: b.value }; route();
      } }, h('h2', { style: 'margin-top:0', text: '2. 결과 예측' }),
        h('p', { class: 'small', text: '실행할 테스트: ' + E.TESTS[L.test].label + ' (3단계에서 바꿀 수 있습니다)' }),
        h('fieldset', null, h('legend', { text: 'PC1 화면의 결과는?' }),
          [['ok', '성공'], ['fail', '실패']].map(function (o) { var id = uid(); return h('span', null, h('input', { type: 'radio', name: nm1, id: id, value: o[0], checked: pr.result === o[0] }), ' ', h('label', { for: id, text: o[1] }), '  '); })),
        h('fieldset', null, h('legend', { text: '같은 요청이 반복(재전송)될 패킷은?' }),
          [['ARP', 'ARP Request'], ['ICMP', 'ICMP Echo Request'], ['DNS', 'DNS Query'], ['TCP', 'TCP SYN'], ['none', '반복 없음']].map(function (o) { var id = uid(); return h('span', null, h('input', { type: 'radio', name: nm2, id: id, value: o[0], checked: pr.repeat === o[0] }), ' ', h('label', { for: id, text: o[1] }), '  '); })),
        h('button', { class: 'btn btn-primary', type: 'submit' }, L.predict ? '예측 수정' : '예측 저장'));
      main.appendChild(pform);
    }

    // 3. 실행
    if (L.predict || (!changed.length && L.run)) {
      main.appendChild(h('div', { class: 'card btn-row' }, h('h2', { style: 'margin:0 12px 0 0', text: '3. 통신 실행' }),
        h('label', null, '테스트 ', h('select', { onchange: function (e) { L.test = e.target.value; L.run = null; L.explained = false; route(); } },
          Object.keys(E.TESTS).map(function (k) { return h('option', { value: k, selected: k === L.test, text: E.TESTS[k].label }); }))),
        h('label', null, '캡처 지점 ', h('select', { onchange: function (e) { L.cp = e.target.value; if (L.run) L.run.cp = L.cp; route(); } },
          Object.keys(E.CAPTURE_POINTS).map(function (k) { return h('option', { value: k, selected: k === L.cp, text: E.CAPTURE_POINTS[k] }); }))),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { L.run = { test: L.test, cp: L.cp }; L.explained = false; route(); } }, '통신 실행')));
    }

    // 4~6
    if (L.run) {
      var sim = E.simulate(L.cfg, L.run.test), base = E.simulate({}, L.run.test);
      var ev = E.eventsAt(sim.events, L.cp), bev = E.eventsAt(base.events, L.cp);
      var target = E.TESTS[L.run.test].target === E.DOMAIN ? (L.run.test === 'dns' ? E.normalizeConfig(L.cfg).pc1Dns : E.HOSTS.SRV.ip) : E.TESTS[L.run.test].target;
      var ctx = { src: E.HOSTS.PC1.ip, dst: target, targets: [target, E.normalizeConfig(L.cfg).pc1Gateway] };
      var cNow = E.summarize(sim.events, L.cp, ctx.src, ctx.dst, ctx.targets), cBase = E.summarize(base.events, L.cp, ctx.src, ctx.dst, ctx.targets);
      main.appendChild(h('h2', { text: '4. 패킷 관찰 — ' + E.CAPTURE_POINTS[L.cp] }));
      main.appendChild(h('div', { class: 'grid grid-2' },
        h('div', { class: 'card' }, h('b', { text: 'PC1 화면' }), h('div', { class: 'console', text: E.TESTS[L.run.test].cmd + '\n' + sim.outcome.console.join('\n') })),
        h('div', { class: 'card' }, h('b', { text: '정상과 집계 비교 (packet_summary 기준, 이 캡처 지점)' }),
          h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '필드' }), h('th', { text: '정상' }), h('th', { text: '지금' }))),
            h('tbody', null, Object.keys(cNow).map(function (k) {
              var diff = cNow[k] !== cBase[k];
              return h('tr', null, h('td', null, h('code', { text: k })), h('td', { text: String(cBase[k]) }), h('td', { class: diff ? 'bad' : '', text: String(cNow[k]) + (diff ? ' ◀ 다름' : '') }));
            })))))));
      var pl = createPlayer({ events: ev, cfg: L.cfg, cp: L.cp, ctx: ctx });
      main.appendChild(pl.el);

      main.appendChild(h('h2', { text: '5. 이유 설명' }));
      if (!L.explained) main.appendChild(h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { L.explained = true; route(); } }, '이유 설명 보기'));
      else {
        var kinds = {};
        ev.forEach(function (e) { if (e.retry) kinds[e.proto] = (kinds[e.proto] || 0) + 1; });
        var rep = Object.keys(kinds).sort(function (a, b) { return kinds[b] - kinds[a]; })[0] || 'none';
        var okPred = L.predict && ((L.predict.result === 'ok') === !!sim.outcome.success);
        var repPred = L.predict && L.predict.repeat === rep;
        main.appendChild(h('div', { class: 'card stack' },
          L.predict ? h('p', null, h('b', { text: '내 예측 확인: ' }),
            h('span', { class: okPred ? 'ok' : 'bad', text: (okPred ? '✓' : '✕') + ' 결과 ' + (sim.outcome.success ? '성공' : '실패') }), ' · ',
            h('span', { class: repPred ? 'ok' : 'bad', text: (repPred ? '✓' : '✕') + ' 반복된 패킷: ' + (rep === 'none' ? '없음' : rep) + (L.cp !== 'PC1' ? ' (이 캡처 지점 기준)' : '') })) : null,
          h('p', { class: 'small', text: '아래는 교육용 모델이 이번 실행에서 실제로 내린 판단 순서입니다. 문장을 미리 정해 둔 것이 아니라, 바꾼 설정으로 계산한 결과입니다.' }),
          h('ol', null, sim.trace.map(function (t) { return h('li', { text: t.text }); })),
          h('p', { class: 'small muted', text: '같은 설정 오류라도 다른 테스트나 다른 캡처 지점에서는 다른 모습으로 보일 수 있습니다. 테스트를 바꿔 다시 실행해 보세요.' }),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn', type: 'button', onclick: function () { exportLab(L, sim, ev, ctx); } }, '이 결과를 교육용 packet_summary 예제로 내보내기'))));
      }
    }
    if (changed.length || L.run) {
      main.appendChild(h('h2', { text: '6. 정상 복원' }));
      main.appendChild(h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { state.lab = labDefaults(); route(); } }, '정상으로 복원 (모든 설정·예측·결과 초기화)'));
    }
    main.appendChild(h('details', null, h('summary', { text: '이 모델이 지원하는 범위와 단순화 가정' }), h('ul', null, E.ASSUMPTIONS.map(function (a) { return h('li', { text: a }); }))));
  }

  // 교육용 packet_summary 생성 (engine.summarize 기준) — 실제 증거 아님 표시 유지
  function buildExampleSummary(caseId, test, cp, ev, ctx, extraLimits) {
    var c = E.summarize(ev, cp, ctx.src, ctx.dst, ctx.targets), seen = E.eventsAt(ev, cp);
    var o = {
      case_id: caseId, source_ip: ctx.src, destination_ip: ctx.dst,
      arp_request_count: c.arp_request_count, arp_reply_count: c.arp_reply_count,
      icmp_request_count: c.icmp_request_count, icmp_reply_count: c.icmp_reply_count,
      dns_query_count: c.dns_query_count, tcp_syn_count: c.tcp_syn_count,
      notes: S.EXAMPLE_MARK + ' 관찰 구간 집계: ARP Request ' + c.arp_request_count + ' / Reply ' + c.arp_reply_count + ', ICMP Echo Request ' + c.icmp_request_count + ' / Reply ' + c.icmp_reply_count +
        ', DNS Query ' + c.dns_query_count + ' / Response ' + c.dns_response_count + ', TCP SYN ' + c.tcp_syn_count + ' / SYN-ACK ' + c.tcp_syn_ack_count + ' / RST ' + c.tcp_rst_count,
      schema_version: '0.1-draft', capture_file: null, evidence_source: 'example',
      capture_point: E.CAPTURE_POINTS[cp] + ' — 교육용 모델', test_description: '[교육용] ' + E.TESTS[test].cmd,
      analysis_scope: { time_window: { start: 'EXAMPLE+0.000s', end: 'EXAMPLE+' + (seen.length ? seen[seen.length - 1].t.toFixed(3) : '0.000') + 's' },
        display_filter: 'arp || icmp || dns || tcp', target_flow: ctx.src + ' → ' + ctx.dst, arp_targets: ctx.targets.filter(function (v, i, a) { return a.indexOf(v) === i; }),
        count_basis: { unit: 'packets', retransmissions_included: true } },
      dns_response_count: c.dns_response_count, tcp_syn_ack_count: c.tcp_syn_ack_count, tcp_rst_count: c.tcp_rst_count,
      evidence: E.eventsAt(ev, cp).slice(0, 6).map(function (e) { return { ref_type: 'example_event', event_id: 'EX-' + e.no, time: 'EXAMPLE+' + e.t.toFixed(3) + 's', protocol: e.proto, observation: e.info }; }),
      limitations: ['[교육용] 교육용 모델이 만든 값이며 실제 캡처가 아님', '단일 캡처 지점(' + E.CAPTURE_POINTS[cp] + ')의 관찰'].concat(extraLimits || []),
      null_reasons: {}
    };
    return o;
  }
  function exportLab(L, sim, ev, ctx) {
    var o = buildExampleSummary('EDU-LAB-01', L.run.test, L.cp, sim.events, ctx);
    var v = S.validate(o);
    if (!v.valid) { alert('검증 실패로 저장하지 않았습니다: ' + v.errors.map(function (e) { return e.field; }).join(', ')); return; }
    download('packet_summary.edu-lab.example.json', JSON.stringify(o, null, 2) + '\n');
  }

  // ---------------------------------------------------------------- 화면: Blind Fault
  var BLIND_EXPLAIN = {
    'EDU-CASE-1': 'PC1의 Default Gateway가 192.168.10.254로 잘못 설정되어 있었다. 핵심 증거는 ARP가 찾는 IP였다. 다른 네트워크로 보낼 때 PC1은 192.168.10.1이 아니라 192.168.10.254를 찾았고, 그 주소를 쓰는 장비가 없어 답이 없었다. 같은 네트워크(PC2, 192.168.10.1)로는 통신이 됐다.',
    'EDU-CASE-2': 'SW1의 PC1 포트(Fa0/1)가 VLAN 20에 할당되어 있었다. PC1 NIC에서는 ARP만 반복되어 SVI down과 비슷해 보였다. 하지만 같은 VLAN 10의 PC2와도 통신이 안 됐고, VLAN 20의 PC3 NIC에서 PC1의 ARP가 보였다. 이것이 PC1의 브로드캐스트가 VLAN 20으로 퍼지고 있다는 근거였다.',
    'EDU-CASE-3': 'MLS1 Gi0/2와 SW2 사이 Trunk에서 VLAN 20이 빠져 있었다. PC1은 Gateway의 MAC을 찾았고 ping도 내보냈지만 답이 오지 않았다. Server NIC와 PC3 NIC에는 아무것도 도착하지 않았다. VLAN 20 장비 전체가 MLS1과 끊겼다는 근거다. PC2는 PC1과 같은 SW1에 있어 Trunk를 지나지 않으므로 통신이 됐다.',
    'EDU-CASE-4': 'MLS1의 Vlan10 SVI가 down이었다. PC1이 192.168.10.1을 찾는 ARP에 답이 없었다. 같은 VLAN 10의 PC2와는 통신이 됐으므로, PC1의 포트 VLAN보다는 Gateway 쪽 인터페이스를 의심할 근거가 됐다.',
    'EDU-CASE-5': 'PC1의 DNS 서버 주소가 192.168.20.53으로 잘못 설정되어 있었다. 서버 IP로 ping은 됐다. DNS Query의 목적지 IP가 서버(192.168.20.20)가 아니라 192.168.20.53이었고, 응답이 없었다.',
    'EDU-CASE-6': 'Server의 웹 서비스(TCP 80)가 중지되어 있었다. DNS와 ping은 정상이었다. SYN에 대해 서버가 RST로 답했다. 즉 서버까지는 도달했지만 80번 포트에서 연결을 받는 프로그램이 없었다.',
    'EDU-CASE-7': 'PC1의 Subnet Mask가 /16으로 잘못 설정되어 있었다. PC1은 서버(192.168.20.20)를 같은 네트워크로 착각해 Gateway 대신 서버 IP를 직접 ARP로 찾았다. Gateway ping은 됐다.'
  };
  function blindNew(i) { return { i: i, checks: [], sel: null, notes: [], cands: {}, reason: '', hint: 0, submitted: false, reveal: false, candHistory: [] }; }
  function checkObj(c) { return c.type === 'status' ? { type: 'status', check: c.check } : { type: 'test', test: c.test, cp: c.cp }; }
  function trueCandidate(cfg) {
    var n = E.normalizeConfig(cfg);
    return Object.keys(E.CANDIDATES).filter(function (k) {
      return E.CANDIDATES[k].variants.some(function (v) { var nv = E.normalizeConfig(v); return Object.keys(E.DEFAULT_CONFIG).every(function (x) { return E.configKey(nv, x) === E.configKey(n, x); }); });
    })[0];
  }
  function allChecks() {
    var list = [];
    Object.keys(E.TESTS).forEach(function (t) { Object.keys(E.CAPTURE_POINTS).forEach(function (cp) { list.push({ type: 'test', test: t, cp: cp }); }); });
    Object.keys(E.STATUS_CHECKS).forEach(function (k) { list.push({ type: 'status', check: k }); });
    return list;
  }
  function checkLabel(c) { return c.type === 'status' ? '장비 상태: ' + E.STATUS_CHECKS[c.check].label : E.TESTS[c.test].label + ' @ ' + E.CAPTURE_POINTS[c.cp]; }
  function runCheck(B, c) {
    var cfg = E.BLIND_CASES[B.i].config;
    var rec = { id: B.checks.length + 1, type: c.type, test: c.test, cp: c.cp, check: c.check };
    if (c.type === 'status') rec.output = E.statusOutput(cfg, c.check);
    else { var sim = E.simulate(cfg, c.test); rec.events = E.eventsAt(sim.events, c.cp); rec.console = sim.outcome.console; rec.summary = summarizeObs(rec.events); }
    B.checks.push(rec); B.sel = rec.id;
    B.candHistory.push(E.consistentCandidates(B.checks.map(checkObj), cfg).length);
  }
  function viewBlind() {
    var B = state.blind;
    if (!B) {
      setHeader('Blind Fault 조사', '원인을 모르는 상태에서 패킷 증거로 원인 후보를 좁힌다.', '조사할 사건 하나를 고르세요.');
      main.appendChild(h('h1', { text: 'Blind Fault 조사' }));
      main.appendChild(h('p', { class: 'lead', text: '실제 장애는 원인을 모른 채 시작합니다. 사용자의 말(증상)만 보고, 검사를 골라 패킷을 관찰하며 원인 후보를 좁혀 보세요.' }));
      main.appendChild(h('div', { class: 'callout warn small' }, '이 사건들은 교육용 예제입니다. 팀의 실제 장애(SRE가 관리하는 사례)와는 관계없습니다. 교육용 정답은 브라우저 코드 안에 있어 개발자 도구로 볼 수 있으므로, 이 화면은 시험 도구가 아니라 연습 도구입니다.'));
      main.appendChild(h('div', { class: 'grid grid-3' }, E.BLIND_CASES.map(function (c, i) {
        return h('div', { class: 'card stack' }, h('h3', { style: 'margin-top:0', text: c.title }), h('p', { text: c.symptom }),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { state.blind = blindNew(i); route(); } }, '이 사건 조사하기'));
      })));
      return;
    }
    var K = E.BLIND_CASES[B.i];
    var packetRuns = B.checks.filter(function (c) { return c.type === 'test'; }).length;
    var stage = B.reveal ? 7 : B.submitted ? 6 : Object.keys(B.cands).some(function (k) { return B.cands[k]; }) ? 4 : B.notes.length ? 3 : B.checks.length ? 2 : 1;
    var nexts = ['', '검사를 하나 골라 실행하세요. 패킷 검사부터 시작합니다.', '결과에서 본 사실을 증거 노트에 적으세요.', '가능한 원인 후보를 고르세요. 여러 개여도 됩니다.', '후보를 구분할 추가 검사를 하거나, 근거를 적고 결론을 제출하세요.', '', '피드백을 읽고 "해설과 복구 전후 비교"를 보세요.', '같은 검사가 복구 후 어떻게 달라졌는지 비교하세요.'];
    setHeader('Blind Fault 조사 — ' + K.title, '관찰한 증거로 원인 후보를 좁히고, 무엇을 더 확인해야 하는지 설명한다.', nexts[stage]);
    main.appendChild(h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: function () { state.blind = null; route(); } }, '← 사건 목록'),
      h('button', { class: 'btn', type: 'button', onclick: function () { state.blind = blindNew(B.i); route(); } }, '이 사건 처음부터 (초기화)')));
    main.appendChild(h('h1', { text: K.title + ' 조사' }));
    main.appendChild(h('ol', { class: 'steps-line', 'aria-label': '조사 단계' },
      ['증상 확인', '검사 선택', '결과 관찰', '증거 노트', '후보 선택', '추가 검사', '결론 제출', '해설·복구 비교'].map(function (t, i) {
        return h('li', { class: i < stage ? 'done' : i === stage ? 'now' : '', text: t });
      })));
    main.appendChild(h('div', { class: 'card' }, h('b', { text: '증상 (사용자 신고) ' }), h('span', { class: 'tag', text: '교육용 사건' }), h('p', { text: K.symptom }),
      h('p', { class: 'small muted', text: '테스트는 PC1에서 실행하고, 기본 캡처 지점은 PC1 NIC입니다. 토폴로지의 VLAN·주소 표시는 network_spec 기준 값이며 실제 설정과 다를 수 있습니다.' })));

    // 검사 선택
    var box = h('div', { class: 'card stack' }, h('h2', { style: 'margin-top:0', text: '검사 선택' }));
    box.appendChild(h('h3', { text: '패킷 검사 (PC1에서 실행, PC1 NIC에서 캡처)' }));
    box.appendChild(h('div', { class: 'btn-row' }, Object.keys(E.TESTS).map(function (t) {
      return h('button', { class: 'btn', type: 'button', onclick: function () { runCheck(B, { type: 'test', test: t, cp: 'PC1' }); route(); } }, E.TESTS[t].label);
    })));
    var ranTests = B.checks.filter(function (c) { return c.type === 'test'; }).map(function (c) { return c.test; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    var ot = h('select', { 'aria-label': '다시 볼 테스트' }, ranTests.map(function (t) { return h('option', { value: t, text: E.TESTS[t].label }); }));
    var oc = h('select', { 'aria-label': '다른 캡처 지점' }, ['PC2', 'PC3', 'SRV'].map(function (k) { return h('option', { value: k, text: E.CAPTURE_POINTS[k] }); }));
    box.appendChild(h('h3', { text: '다른 지점의 캡처 확인' }));
    box.appendChild(ranTests.length ? h('div', { class: 'btn-row' }, '같은 테스트를 ', ot, ' 다른 지점 ', oc, h('button', { class: 'btn', type: 'button', onclick: function () { runCheck(B, { type: 'test', test: ot.value, cp: oc.value }); route(); } }, '에서 본 결과 확인'))
      : h('p', { class: 'small muted', text: '먼저 패킷 검사를 하나 실행하면, 같은 테스트를 다른 지점에서 본 결과를 확인할 수 있습니다.' }));
    box.appendChild(h('h3', { text: '장비 상태 확인' }));
    if (packetRuns < 2) box.appendChild(h('p', { class: 'small muted', text: '패킷을 먼저 관찰합니다. 패킷 검사를 2개 이상 실행하면 장비 상태 확인이 열립니다. (지금 ' + packetRuns + '개) 설정 화면을 먼저 보면 증거 없이 답을 맞히는 습관이 생깁니다.' }));
    box.appendChild(h('div', { class: 'btn-row' }, Object.keys(E.STATUS_CHECKS).map(function (k) {
      return h('button', { class: 'btn', type: 'button', disabled: packetRuns < 2, onclick: function () { runCheck(B, { type: 'status', check: k }); route(); } }, E.STATUS_CHECKS[k].label);
    })));
    main.appendChild(box);

    // 결과 기록
    if (B.checks.length) {
      main.appendChild(h('h2', { text: '결과 (실행한 검사만 공개됩니다)' }));
      main.appendChild(h('div', { class: 'grid grid-3' }, B.checks.map(function (c) {
        return h('button', { class: 'log-item btn' + (c.id === B.sel ? ' sel' : ''), type: 'button', 'aria-pressed': c.id === B.sel ? 'true' : 'false', onclick: function () { B.sel = c.id; route(); } },
          h('b', { text: '#' + c.id + ' ' + checkLabel(c) }), h('br'),
          h('span', { class: 'small', text: c.type === 'status' ? '출력 보기' : (c.summary || []).slice(0, 2).join(' · ') }));
      })));
      var sel = B.checks.filter(function (c) { return c.id === B.sel; })[0];
      if (sel) {
        if (sel.type === 'status') main.appendChild(h('div', { class: 'card' }, h('b', { text: '#' + sel.id + ' ' + checkLabel(sel) }), h('div', { class: 'console', text: sel.output.join('\n') })));
        else {
          main.appendChild(h('div', { class: 'grid grid-2' },
            h('div', { class: 'card fact' }, h('b', { text: '#' + sel.id + ' 관찰한 사실 — ' + E.CAPTURE_POINTS[sel.cp] }), h('ul', null, sel.summary.map(function (x) { return h('li', { text: x }); })),
              h('button', { class: 'btn', type: 'button', onclick: function () { B.notes.push({ type: 'fact', text: '#' + sel.id + ' ' + checkLabel(sel) + ': ' + sel.summary.join('; '), ref: sel.id }); route(); } }, '이 관찰을 증거 노트에 추가')),
            h('div', { class: 'card' }, h('b', { text: 'PC1 화면' }), h('div', { class: 'console', text: E.TESTS[sel.test].cmd + '\n' + sel.console.join('\n') }))));
          var target = E.TESTS[sel.test].target === E.DOMAIN ? E.HOSTS.SRV.ip : E.TESTS[sel.test].target;
          main.appendChild(createPlayer({ events: sel.events, cfg: null, cp: sel.cp, ctx: { src: E.HOSTS.PC1.ip, dst: target, targets: [target] } }).el);
        }
      }
    }

    // 증거 노트
    var nt = h('textarea', { 'aria-label': '증거 노트 내용', placeholder: '예: #1 PC1 NIC에서 ARP Request 8건, 찾는 IP 192.168.10.254, Reply 없음' });
    var tn = uid();
    main.appendChild(h('div', { class: 'card stack' }, h('h2', { style: 'margin-top:0', text: '증거 노트' }),
      h('p', { class: 'small', text: '관찰한 사실과 해석(추측)을 나눠 적습니다. 사실에는 "무엇이 보였다/안 보였다", 해석에는 "그래서 무엇일 수 있다"를 씁니다.' }),
      B.notes.length ? h('ul', null, B.notes.map(function (n, i) {
        return h('li', { class: n.type === 'fact' ? 'fact' : 'guess', style: 'padding-left:8px;margin:4px 0' }, h('span', { class: 'tag', text: n.type === 'fact' ? '관찰' : '해석' }), n.text, ' ',
          h('button', { class: 'btn small', type: 'button', 'aria-label': '노트 삭제', onclick: function () { B.notes.splice(i, 1); route(); } }, '삭제'));
      })) : h('p', { class: 'muted small', text: '아직 노트가 없습니다.' }),
      nt,
      h('div', { class: 'btn-row' }, h('span', null, h('input', { type: 'radio', name: tn, id: tn + 'f', value: 'fact', checked: true }), ' ', h('label', { for: tn + 'f', text: '관찰한 사실' })),
        h('span', null, h('input', { type: 'radio', name: tn, id: tn + 'g', value: 'guess' }), ' ', h('label', { for: tn + 'g', text: '해석·추측' })),
        h('button', { class: 'btn', type: 'button', onclick: function () {
          if (!nt.value.trim()) return;
          var ty = document.getElementById(tn + 'g').checked ? 'guess' : 'fact';
          B.notes.push({ type: ty, text: nt.value.trim() }); route();
        } }, '노트 추가'),
        B.notes.length ? h('button', { class: 'btn', type: 'button', onclick: function () { exportMemo(B); } }, '노트 내보내기 (사람 메모)') : null)));

    // 후보·결론
    var cbox = h('div', { class: 'card stack' }, h('h2', { style: 'margin-top:0', text: '원인 후보와 결론' }),
      h('p', { class: 'small', text: '지금까지의 증거로 가능한 후보를 모두 고르세요. 증거가 부족하면 여러 개를 고르는 것이 맞습니다.' }));
    Object.keys(E.CANDIDATES).forEach(function (k) {
      var id = uid();
      cbox.appendChild(h('div', null, h('input', { type: 'checkbox', id: id, checked: !!B.cands[k], disabled: B.submitted, onchange: function (e) { B.cands[k] = e.target.checked; route(); } }), ' ', h('label', { for: id, text: E.CANDIDATES[k].label })));
    });
    var rt = h('textarea', { 'aria-label': '결론의 근거', value: B.reason, disabled: B.submitted, oninput: function () { B.reason = rt.value; }, placeholder: '근거: 어떤 검사에서 무엇이 보였기 때문에 이 후보들이 남았는가? 무엇을 확인하면 구분할 수 있는가?' });
    cbox.appendChild(rt);
    var hintBox = h('div');
    var selCount = Object.keys(B.cands).filter(function (k) { return B.cands[k]; }).length;
    cbox.appendChild(h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'button', disabled: B.submitted || !selCount || !B.checks.length, onclick: function () { B.submitted = true; route(); } }, '결론 제출'),
      h('button', { class: 'btn', type: 'button', disabled: B.hint >= 3, onclick: function () { B.hint++; route(); } }, '힌트 ' + (B.hint < 3 ? (B.hint + 1) + '/3 보기' : '모두 봄')),
      B.submitted ? h('button', { class: 'btn', type: 'button', onclick: function () { B.submitted = false; B.reveal = false; route(); } }, '다시 시도 (결론 수정)') : null));
    if (!B.checks.length || !selCount) cbox.appendChild(h('p', { class: 'small muted', text: '검사를 1개 이상 실행하고 후보를 1개 이상 고르면 제출할 수 있습니다.' }));
    var cfg = K.config, checksObj = B.checks.map(checkObj), cons = E.consistentCandidates(checksObj, cfg);
    if (B.hint >= 1) hintBox.appendChild(h('p', { class: 'callout', text: '힌트 1: 증상에서 "되는 통신"과 "안 되는 통신"을 나눠 각각 패킷 검사를 해 보세요. 되는 쪽과 안 되는 쪽의 차이가 범위를 좁힙니다.' }));
    if (B.hint >= 2) {
      var ran = {}; checksObj.forEach(function (c) { ran[JSON.stringify(c)] = true; });
      var split = E.splittingChecks(cons, allChecks()).filter(function (c) { return !ran[JSON.stringify(c)]; }).slice(0, 4);
      hintBox.appendChild(h('div', { class: 'callout' }, h('b', { text: '힌트 2: ' }), split.length ? '지금 남은 가능성을 나눌 수 있는 검사 예: ' + split.map(checkLabel).join(' / ') : '지금 검사들로 이미 가능성이 하나로 좁혀졌습니다. 근거를 정리해 제출해 보세요.'));
    }
    if (B.hint >= 3) hintBox.appendChild(h('p', { class: 'callout', text: '힌트 3: 응답 유무보다 "누구를 향했는가"를 보세요. ARP가 찾는 IP(arp.dst.proto_ipv4), DNS 질의의 목적지 IP, 응답을 보낸 IP가 network_spec의 값과 같은지 비교합니다.' }));
    cbox.appendChild(hintBox);
    main.appendChild(cbox);

    if (B.submitted) main.appendChild(blindFeedback(B, K, cons));
  }
  function blindFeedback(B, K, cons) {
    var cfg = K.config, checksObj = B.checks.map(checkObj), truth = trueCandidate(cfg);
    var sel = Object.keys(B.cands).filter(function (k) { return B.cands[k]; });
    var box = h('section', { class: 'card stack', 'aria-live': 'polite' }, h('h2', { style: 'margin-top:0', text: '피드백' }));
    var contra = sel.filter(function (k) { return cons.indexOf(k) < 0; });
    var missed = cons.filter(function (k) { return sel.indexOf(k) < 0; });
    contra.forEach(function (k) {
      var v = E.CANDIDATES[k].variants[0], why = null;
      for (var i = 0; i < checksObj.length; i++) {
        var c = checksObj[i];
        var allDiffer = E.CANDIDATES[k].variants.every(function (vv) { return E.observe(vv, c) !== E.observe(cfg, c); });
        if (allDiffer) {
          var mine = B.checks[i];
          var alt = c.type === 'status' ? E.statusOutput(v, c.check).join(' / ') : summarizeObs(E.eventsAt(E.simulate(v, c.test).events, c.cp)).join('; ');
          var act = c.type === 'status' ? mine.output.join(' / ') : mine.summary.join('; ');
          why = [checkLabel(c), alt, act]; break;
        }
      }
      box.appendChild(h('div', { class: 'callout bad' }, h('b', { text: '근거와 맞지 않는 후보: ' + E.CANDIDATES[k].label }),
        why ? h('p', { class: 'small', text: '검사 "' + why[0] + '"에서, 이 후보라면 → ' + why[1] + ' 가 보여야 합니다. 실제로는 → ' + why[2] + '. 이 차이를 다시 보세요.' }) : null));
    });
    if (!contra.length) box.appendChild(h('div', { class: 'callout ok' }, h('b', { text: '고른 후보가 모두 지금까지의 관찰과 모순되지 않습니다.' })));
    if (missed.length) box.appendChild(h('div', { class: 'callout warn' }, h('b', { text: '아직 배제할 근거가 없는 후보: ' }), missed.map(function (k) { return E.CANDIDATES[k].label; }).join(', '),
      h('p', { class: 'small', text: '이 후보들을 배제하려면 추가 검사가 필요합니다.' })));
    if (!contra.length && cons.length > 1) {
      var ran = {}; checksObj.forEach(function (c) { ran[JSON.stringify(c)] = true; });
      var split = E.splittingChecks(cons, allChecks()).filter(function (c) { return !ran[JSON.stringify(c)]; }).slice(0, 4);
      box.appendChild(h('p', null, h('b', { text: '현재 증거로 가능한 후보가 ' + cons.length + '개입니다. ' }), '추가 증거가 나오기 전까지는 복수 후보가 타당한 결론입니다. 구분할 수 있는 다음 검사: ' + (split.map(checkLabel).join(' / ') || '없음')));
    }
    if (!contra.length && cons.length === 1 && sel.length === 1) box.appendChild(h('p', { class: 'ok', text: '✓ 증거만으로 가능성을 하나까지 좁혔습니다.' }));
    // 과정 평가 (점수 없음)
    var firstIsPacket = B.checks[0] && B.checks[0].type === 'test';
    var factNotes = B.notes.filter(function (n) { return n.type === 'fact'; }).length, guessNotes = B.notes.length - factNotes;
    var reduced = B.candHistory.some(function (n, i) { return i > 0 && n < B.candHistory[i - 1]; }) || (B.candHistory[0] !== undefined && B.candHistory[0] < Object.keys(E.CANDIDATES).length);
    var otherCp = B.checks.some(function (c) { return c.type === 'test' && c.cp !== 'PC1'; });
    box.appendChild(h('h3', { text: '조사 과정 돌아보기 (정답 여부보다 중요한 것)' }));
    box.appendChild(h('ul', { class: 'check-list' },
      h('li', { text: (firstIsPacket ? '✓' : '△') + ' 패킷 먼저 관찰: ' + (firstIsPacket ? '첫 검사가 패킷 검사였습니다.' : '첫 검사가 장비 상태 확인이었습니다.') }),
      h('li', { text: (B.checks.length >= 2 ? '✓' : '△') + ' 관련 증거 수집: 검사 ' + B.checks.length + '개 (패킷 ' + B.checks.filter(function (c) { return c.type === 'test'; }).length + '개, 다른 지점 캡처 ' + (otherCp ? '있음' : '없음') + ')' }),
      h('li', { text: (factNotes ? '✓' : '△') + ' 관찰과 추측 구분: 관찰 노트 ' + factNotes + '개, 해석 노트 ' + guessNotes + '개' }),
      h('li', { text: (sel.length > 1 || missed.length === 0 ? '✓' : '△') + ' 대안 검토: 후보 ' + sel.length + '개 선택' }),
      h('li', { text: (reduced ? '✓' : '△') + ' 유효한 추가 검사: 검사 후 가능한 후보 수 변화 ' + [Object.keys(E.CANDIDATES).length].concat(B.candHistory).join(' → ') })));
    box.appendChild(h('p', { class: 'small muted', text: '자동 판정은 교육용 모델 안에서 "관찰과 모순되는가"만 계산합니다. 근거 문장의 품질은 자동으로 판정하지 않습니다. 팀원에게 근거를 말로 설명해 보세요.' }));
    if (!B.reveal) box.appendChild(h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { B.reveal = true; route(); } }, '해설과 복구 전후 비교 보기'));
    else {
      box.appendChild(h('h3', { text: '해설 — 실제로 바뀐 설정' }));
      box.appendChild(h('div', { class: 'callout' }, h('b', { text: E.CANDIDATES[truth].label + ' ' }), h('p', { text: BLIND_EXPLAIN[K.id] })));
      box.appendChild(h('h3', { text: '복구 전후 비교 (같은 검사 반복)' }));
      box.appendChild(h('p', { class: 'small muted', text: '교육용 복구 = 모든 설정을 정상으로 되돌린 상태. 실제 과제에서 복구 작업은 SRE 담당이고, 2번은 복구 후 같은 테스트를 반복해 패킷 변화를 기록합니다.' }));
      var tb = h('tbody');
      B.checks.forEach(function (c) {
        var o = checkObj(c), before, after;
        if (o.type === 'status') { before = c.output.join(' / '); after = E.statusOutput({}, o.check).join(' / '); }
        else { before = c.summary.join('; '); after = summarizeObs(E.eventsAt(E.simulate({}, o.test).events, o.cp)).join('; '); }
        tb.appendChild(h('tr', null, h('td', { text: '#' + c.id + ' ' + checkLabel(c) }), h('td', { text: before }), h('td', { text: after }), h('td', { class: before === after ? '' : 'bad', text: before === after ? '같음' : '달라짐' })));
      });
      box.appendChild(h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '검사' }), h('th', { text: '장애 때' }), h('th', { text: '복구 후' }), h('th', { text: '변화' }))), tb)));
      box.appendChild(h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: function () { exportBlind(B, K); } }, '장애 관찰을 교육용 packet_summary 예제로 내보내기'),
        h('button', { class: 'btn', type: 'button', onclick: function () { state.blind = null; route(); } }, '다른 사건 조사하기')));
    }
    return box;
  }
  function exportBlind(B, K) {
    var first = B.checks.filter(function (c) { return c.type === 'test' && c.cp === 'PC1'; })[0];
    if (!first) { alert('PC1 NIC에서 실행한 패킷 검사가 없어 내보낼 관찰이 없습니다.'); return; }
    var sim = E.simulate(K.config, first.test);
    var target = E.TESTS[first.test].target === E.DOMAIN ? E.HOSTS.SRV.ip : E.TESTS[first.test].target;
    // ARP 대상 = 최종 목적지 + 캡처에서 실제로 관찰된 PC1의 ARP 대상(next hop)
    var targets = [target].concat(E.eventsAt(sim.events, 'PC1').filter(function (e) { return e.kind === 'arp_request' && e.srcIp === E.HOSTS.PC1.ip; }).map(function (e) { return e.dstIp; }));
    var o = buildExampleSummary(K.id, first.test, 'PC1', sim.events, { src: E.HOSTS.PC1.ip, dst: target, targets: targets }, ['arp_targets는 최종 목적지와, 캡처에서 PC1이 실제로 찾은 IP(next hop)를 포함']);
    var v = S.validate(o);
    if (!v.valid) { alert('검증 실패로 저장하지 않았습니다: ' + v.errors.map(function (e) { return e.field; }).join(', ')); return; }
    download('packet_summary.' + K.id.toLowerCase() + '.example.json', JSON.stringify(o, null, 2) + '\n');
  }
  function exportMemo(B) {
    var K = E.BLIND_CASES[B.i];
    var lines = ['# 분석 메모 — ' + K.id + ' (교육용)', '', '> 사람이 작성한 메모입니다. packet_summary.json의 관찰 데이터와 섞지 않습니다.', '', '## 관찰한 사실'];
    B.notes.filter(function (n) { return n.type === 'fact'; }).forEach(function (n) { lines.push('- ' + n.text); });
    lines.push('', '## 해석·추측');
    B.notes.filter(function (n) { return n.type !== 'fact'; }).forEach(function (n) { lines.push('- ' + n.text); });
    if (B.reason) lines.push('', '## 결론 근거', B.reason);
    download('analyst_memo.' + K.id.toLowerCase() + '.md', lines.join('\n') + '\n', 'text/markdown');
  }

  // ---------------------------------------------------------------- 화면: 실제 증거 읽기
  function viewEvidence() {
    setHeader('실제 증거 읽기', 'Wireshark에서 어떤 필터로 어떤 필드를 보고, 어떻게 기록하는지 안다.', '프로토콜별 카드를 읽고, 아래 대응표로 이 앱의 표와 실제 Wireshark 화면을 연결하세요.');
    main.appendChild(h('h1', { text: '실제 증거 읽기' }));
    main.appendChild(h('p', { class: 'lead', text: '이 앱의 패킷 표는 Wireshark 화면을 흉내 낸 재현 UI입니다. 실제 캡처에서는 아래 필터와 필드를 봅니다.' }));
    main.appendChild(h('div', { class: 'grid grid-2' }, C.PROTOCOL_GUIDE.map(function (g) {
      return h('div', { class: 'card stack' }, h('h2', { style: 'margin-top:0' }, protoBadge(g.proto), ' ', g.proto),
        h('p', null, h('b', { text: 'Display filter: ' }), h('code', { text: g.filter })),
        h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '필드' }), h('th', { text: '의미' }))),
          h('tbody', null, g.fields.map(function (f) { return h('tr', null, h('td', null, h('code', { text: f[0] })), h('td', { text: f[1] })); })))),
        h('div', { class: 'callout warn' }, h('b', { text: '흔한 오해 ' }), g.mistake),
        h('p', { class: 'small' }, h('b', { text: '증거 기록 예시: ' }), g.record));
    })));
    main.appendChild(h('h2', { text: '이 앱의 표 ↔ 실제 Wireshark 화면' }));
    main.appendChild(h('p', { class: 'small muted', text: '재현 UI입니다. 실제 캡처 화면이 아닙니다.' }));
    main.appendChild(h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '이 앱' }), h('th', { text: 'Wireshark' }), h('th', { text: '차이' }))),
      h('tbody', null, [['No.', 'No.', '앱은 선택한 지점에서 보이는 패킷만 다시 번호를 매긴다'], ['시간(s)', 'Time', '앱은 모델 시간(테스트 시작=0). Wireshark는 캡처 시작 기준'],
        ['출발 / 도착', 'Source / Destination', 'ARP 브로드캐스트는 앱에서 "Broadcast"로 표시'], ['프로토콜', 'Protocol', '같음'], ['요약 (Info)', 'Info', '앱은 핵심만 짧게 표시'],
        ['상세 영역', 'Packet Details 창', 'Wireshark는 모든 계층 필드를 트리로 보여 준다'], ['보이는 캡처 지점', '(없음)', 'Wireshark는 자기가 캡처한 한 지점만 안다. 이 칸은 교육용']].map(function (r) {
        return h('tr', null, r.map(function (c) { return h('td', { text: c }); }));
      })))));
    main.appendChild(h('h2', { text: 'Display filter와 Capture filter는 다르다' }));
    main.appendChild(h('div', { class: 'grid grid-2' },
      h('div', { class: 'card' }, h('b', { text: 'Display filter (보기 필터)' }), h('p', { text: '이미 저장한 패킷 중에서 보여 줄 것만 고릅니다. 예: arp, dns, tcp.flags.syn == 1. 나중에 바꿔도 원본 캡처는 그대로입니다.' })),
      h('div', { class: 'card' }, h('b', { text: 'Capture filter (저장 필터)' }), h('p', { text: '캡처할 때부터 저장할 패킷을 제한합니다. 예: host 192.168.10.10. 여기서 빠진 패킷은 나중에 볼 수 없습니다. 그래서 그 항목은 0이 아니라 null(미수집)로 기록합니다.' }))));
    main.appendChild(h('div', { class: 'btn-row', style: 'margin-top:16px' }, h('a', { class: 'btn btn-primary', href: '#/json', text: '다음: JSON 전달' })));
  }

  // ---------------------------------------------------------------- 화면: JSON 전달
  var FIELD_GROUPS = { ARP: ['arp_request_count', 'arp_reply_count'], ICMP: ['icmp_request_count', 'icmp_reply_count'], DNS: ['dns_query_count', 'dns_response_count'], TCP: ['tcp_syn_count', 'tcp_syn_ack_count', 'tcp_rst_count'], HTTP: [] };
  var FIELD_MEANING = {
    arp_request_count: 'ARP Request (보낸 쪽 = source_ip, 찾는 IP ∈ arp_targets)', arp_reply_count: 'ARP Reply (받는 쪽 = source_ip)',
    icmp_request_count: 'ICMP Echo Request만 (type 8)', icmp_reply_count: 'ICMP Echo Reply만 (type 0)',
    dns_query_count: 'source_ip가 보낸 DNS Query', dns_response_count: 'source_ip가 받은 DNS Response (오류 응답 포함)',
    tcp_syn_count: 'SYN=1·ACK=0 (SYN-ACK 제외)', tcp_syn_ack_count: 'SYN=1·ACK=1', tcp_rst_count: 'RST=1 (목적지 → source)'
  };
  function viewJson() {
    var J = state.json;
    var src = J.obj && J.result && J.result.valid ? J.obj.evidence_source : null;
    var badge = src === 'wireshark_capture' ? { text: '실제 캡처 데이터', cls: 'badge-real' } : src === 'packet_tracer_simulation' ? { text: 'Packet Tracer 관찰', cls: 'badge-pt' } : src === 'example' || !J.obj ? { text: '교육용 예제', cls: 'badge-example' } : { text: '출처 미기재', cls: 'badge-example' };
    setHeader('JSON 전달', '내 관찰을 다음 담당자(AI Engineer)가 쓸 수 있는 packet_summary.json으로 넘기는 방법을 안다.', J.obj ? '증거 항목을 눌러 관련 필드가 어디인지 확인하세요.' : 'packet_summary.json 파일을 불러오거나 "교육용 예제 넣기"를 누르세요.', badge);
    main.appendChild(h('h1', { text: 'JSON 전달 — 내 결과가 다음 사람의 입력이 된다' }));
    main.appendChild(h('div', { class: 'pipeline', role: 'list', 'aria-label': '팀 데이터 흐름' },
      [['1번 Architect', 'network_spec.md', '주소·VLAN·서버 정보 (내가 받는 입력)'], ['2번 Packet Analyst (나)', '캡처와 분석', 'normal.pcapng · fault_<case_id>.pcapng · packet_analysis.md'],
        ['2번 → 3번', 'packet_summary.json', '관찰한 숫자와 증거만. 정답 없음'], ['3번 AI Engineer', 'diagnosis.json', '원인 후보 · 근거 · 추가 확인'], ['4번 SRE', '복구 검증', '복구 후 같은 테스트 반복 → 2번이 패킷 변화 기록']].map(function (p, i, arr) {
        return [h('div', { class: 'pipe' + (i === 2 ? ' me' : ''), role: 'listitem' }, h('div', { class: 'small muted', text: p[0] }), h('b', { text: p[1] }), h('div', { class: 'small', text: p[2] })), i < arr.length - 1 ? h('span', { class: 'pipe-arrow', 'aria-hidden': 'true', text: '→' }) : null];
      })));

    // 불러오기
    var ta = h('textarea', { 'aria-label': 'JSON 붙여넣기', value: J.raw, placeholder: '여기에 packet_summary.json 내용을 붙여 넣고 "검사하기"를 누르세요.' });
    var file = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'JSON 파일 선택', onchange: function (e) {
      var f = e.target.files[0]; if (!f) return;
      var r = new FileReader(); r.onload = function () { load(String(r.result)); }; r.readAsText(f);
    } });
    function load(raw) {
      J.raw = raw; J.sel = null;
      try { J.obj = JSON.parse(raw); J.parseError = null; } catch (err) { J.obj = null; J.parseError = err.message; J.result = null; route(); return; }
      J.result = S.validate(J.obj); route();
    }
    main.appendChild(h('div', { class: 'card stack', style: 'margin-top:16px' }, h('h2', { style: 'margin-top:0', text: 'packet_summary.json 불러오기' }),
      h('p', { class: 'small', text: '브라우저 안에서만 읽고 검사합니다. 서버로 보내지 않습니다. .pcapng 파일은 이 앱에서 직접 분석하지 않습니다 → summarize_pcap.py로 JSON을 만든 뒤 불러오세요.' }),
      h('div', { class: 'btn-row' }, file,
        h('button', { class: 'btn', type: 'button', onclick: function () { load(JSON.stringify(EX, null, 2)); } }, '교육용 예제 넣기'),
        h('button', { class: 'btn', type: 'button', onclick: function () { state.json = { obj: null, raw: '', result: null, sel: null }; route(); } }, '지우기')),
      ta, h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { load(ta.value); } }, '검사하기')));

    if (J.parseError) main.appendChild(h('div', { class: 'callout bad' }, h('b', { text: 'JSON 문법 오류 ' }), J.parseError, h('p', { class: 'small', text: '쉼표, 따옴표, 괄호 짝을 확인하세요.' })));
    if (J.result) main.appendChild(renderJsonResult(J));

    // 0 / null / 판단불가
    main.appendChild(h('h2', { text: '0, null, 판단 불가는 서로 다르다' }));
    main.appendChild(h('div', { class: 'grid grid-3' },
      h('div', { class: 'card' }, h('b', { text: 'arp_reply_count: 0' }), h('p', { text: 'PC1 NIC에서 30초를 분석했고, ARP Reply가 하나도 없었다.' }), h('p', { class: 'small muted', text: '→ "이 지점·이 구간에 없었다"는 관찰.' })),
      h('div', { class: 'card' }, h('b', { text: 'dns_query_count: null' }), h('code', { class: 'small', text: 'null_reasons: {"dns_query_count": "capture filter가 arp만 저장"}' }), h('p', { text: 'DNS를 저장하지 않아서 셀 수 없었다.' }), h('p', { class: 'small muted', text: '→ 0으로 바꾸면 "DNS 질의 없음"이라는 거짓 관찰이 된다.' })),
      h('div', { class: 'card' }, h('b', { text: 'icmp_reply_count: 0 + limitations' }), h('code', { class: 'small', text: '"서버 쪽 캡처 없음 → 요청이 서버에 도착했는지 모름"' }), h('p', { text: 'Reply는 안 보였지만, 요청이 어디까지 갔는지는 이 지점에서 판단할 수 없다.' }), h('p', { class: 'small muted', text: '→ 숫자는 사실, 한계는 따로 적는다.' }))));
    main.appendChild(h('div', { class: 'btn-row', style: 'margin-top:16px' }, h('a', { class: 'btn btn-primary', href: '#/check', text: '다음: 이해 확인' })));
  }
  function renderJsonResult(J) {
    var R = J.result, o = J.obj;
    var wrap = h('section', { class: 'stack', 'aria-live': 'polite' });
    wrap.appendChild(h('div', { class: 'callout ' + (R.valid ? 'ok' : 'bad') }, h('b', { text: R.valid ? '✓ 데이터 계약을 통과했습니다.' : '✕ 사용할 수 없습니다. 아래 오류를 고쳐 주세요.' }), ' 오류 ' + R.errors.length + '개, 경고 ' + R.warnings.length + '개'));
    if (R.errors.length || R.warnings.length) wrap.appendChild(h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '종류' }), h('th', { text: '필드' }), h('th', { text: '내용' }))),
      h('tbody', null, R.errors.map(function (e) { return h('tr', null, h('td', { class: 'bad', text: '✕ 오류' }), h('td', null, h('code', { text: e.field })), h('td', { text: e.message })); }),
        R.warnings.map(function (e) { return h('tr', null, h('td', { class: 'warn', text: '⚠ 경고' }), h('td', null, h('code', { text: e.field })), h('td', { text: e.message })); })))));
    if (!R.valid) return wrap;
    var hl = J.sel !== null && o.evidence && o.evidence[J.sel] ? (FIELD_GROUPS[o.evidence[J.sel].protocol] || []) : [];
    function val(k) {
      if (!(k in o)) return ['제공되지 않음', 'muted'];
      if (o[k] === null) return ['null — 모름. 이유: ' + ((o.null_reasons || {})[k] || '(없음)'), 'warn'];
      if (o[k] === 0) return ['0 — 분석했고 관찰되지 않음', ''];
      return [String(o[k]), ''];
    }
    function str(k) { return k in o && o[k] !== null && o[k] !== '' ? (typeof o[k] === 'string' ? o[k] : JSON.stringify(o[k])) : '제공되지 않음'; }
    wrap.appendChild(h('div', { class: 'grid grid-2' },
      h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: '사례 정보' }), kv([['case_id', str('case_id')], ['source_ip → destination_ip', o.source_ip + ' → ' + o.destination_ip], ['evidence_source', str('evidence_source')],
        ['capture_file', str('capture_file')], ['capture_point', str('capture_point')], ['test_description', str('test_description')], ['schema_version', str('schema_version')]]),
        h('p', null, h('b', { text: 'notes (관찰 요약): ' }), o.notes)),
      h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: '분석 범위 (analysis_scope)' }),
        o.analysis_scope ? kv([['시간 구간', o.analysis_scope.time_window ? JSON.stringify(o.analysis_scope.time_window) : '제공되지 않음'], ['필터', o.analysis_scope.display_filter || '제공되지 않음'],
          ['대상 흐름', o.analysis_scope.target_flow || '제공되지 않음'], ['ARP 대상', (o.analysis_scope.arp_targets || []).join(', ') || '제공되지 않음'],
          ['집계 기준', o.analysis_scope.count_basis ? o.analysis_scope.count_basis.unit + ', 재전송 포함=' + o.analysis_scope.count_basis.retransmissions_included : '제공되지 않음']]) : h('p', { class: 'muted', text: '제공되지 않음' }))));
    wrap.appendChild(h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: '필드' }), h('th', { text: '값' }), h('th', { text: '무엇을 셌나' }))),
      h('tbody', null, S.BASE_COUNTS.concat(S.EXTRA_COUNTS).map(function (k) {
        var v = val(k);
        return h('tr', { class: hl.indexOf(k) >= 0 ? 'pkt current' : '' }, h('td', null, h('code', { text: k }), S.BASE_COUNTS.indexOf(k) >= 0 ? '' : h('span', { class: 'tag', text: '추가' })), h('td', { class: v[1], text: v[0] }), h('td', { class: 'small', text: FIELD_MEANING[k] }));
      })))));
    wrap.appendChild(h('div', { class: 'grid grid-2' },
      h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: '증거 (evidence) — 누르면 관련 필드 강조' }),
        o.evidence && o.evidence.length ? h('div', { class: 'stack' }, o.evidence.map(function (e, i) {
          var ref = e.ref_type === 'frame' ? '프레임 ' + e.frame_number : (e.event_id || e.ref_type);
          return h('button', { class: 'log-item btn' + (J.sel === i ? ' sel' : ''), type: 'button', 'aria-pressed': J.sel === i ? 'true' : 'false', onclick: function () { J.sel = J.sel === i ? null : i; route(); } },
            e.protocol ? protoBadge(e.protocol) : null, ' ', h('b', { text: ref }), ' ', h('span', { class: 'small', text: (e.time || '시각 제공되지 않음') }), h('br'), h('span', { text: e.observation }));
        })) : h('p', { class: 'muted', text: '제공되지 않음. (요약 데이터만 있습니다. 프레임·시각은 만들어 넣지 않습니다.)' })),
      h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: '이 캡처로 알 수 없는 것 (limitations)' }),
        o.limitations && o.limitations.length ? h('ul', null, o.limitations.map(function (l) { return h('li', { text: l }); })) : h('p', { class: 'muted', text: '제공되지 않음' }))));
    var lines = JSON.stringify(o, null, 2).split('\n');
    wrap.appendChild(h('details', { open: hl.length > 0 }, h('summary', { text: '원본 JSON 보기' }),
      h('div', { class: 'json-lines' }, lines.map(function (ln) {
        var m = ln.match(/^\s*"([a-z_]+)":/);
        return h('div', { class: m && hl.indexOf(m[1]) >= 0 ? 'hl' : '', text: ln });
      }))));
    return wrap;
  }

  // ---------------------------------------------------------------- 화면: 이해 확인
  function viewCheck() {
    setHeader('이해 확인', '"관찰한 증거 → 해석 → 원인 후보 → 추가 확인"을 내 말로 설명한다.', '질문 하나를 골라 먼저 내 말로 쓰고, 모범 설명과 비교하세요.');
    main.appendChild(h('h1', { text: '이해 확인 — 내 말로 설명하기' }));
    main.appendChild(h('p', { class: 'lead', text: '답을 고르는 문제가 아닙니다. 먼저 쓰고, 모범 설명과 비교하고, 빠진 근거를 점검합니다. 이 앱은 자동으로 채점하지 않습니다.' }));
    ['q_gwmac', 'q_ping_web', 'q_dns', 'q_arp', 'q_split', 'q_scope'].forEach(function (q) { main.appendChild(questionBox(q)); });
    main.appendChild(h('div', { class: 'callout' }, h('b', { text: '팀원 이해 점검 방법 ' }), '앱을 처음 보는 팀원에게 사전 설명 없이 "시작하기"부터 맡깁니다. 끝난 뒤 사건 하나를 골라 "무엇이 보였고, 그래서 무엇일 수 있고, 무엇을 더 확인하겠다"를 1분 안에 말하게 합니다. 자세한 절차는 02_packet_capture/README.md의 "팀원 이해 점검"에 있습니다.'));
  }

  // ---------------------------------------------------------------- 화면: 발표용 짧은 경로
  function viewDemo() {
    setHeader('발표용 짧은 경로', '팀 발표에서 2번 파트의 패킷 증거를 약 2분 안에 보여 준다.', '각 단계의 "화면 열기"를 누르고, 아래 대사를 참고해 설명하세요.');
    main.appendChild(h('h1', { text: '발표용 짧은 경로 (약 2분)' }));
    main.appendChild(h('p', { class: 'lead', text: '팀 발표 전체가 5~8분이므로 2번 파트는 짧게 갑니다. 듣는 사람이 "무엇이 보였고, 왜 그게 중요한지"만 가져가면 됩니다.' }));
    main.appendChild(h('div', { class: 'callout warn small' }, '실제 발표에서는 이 교육용 화면보다 팀의 실제 캡처(Wireshark 화면)와 packet_summary.json을 우선 보여 주세요. 이 경로는 실제 증거를 설명하기 위한 보조 자료입니다.'));
    C.DEMO.forEach(function (d) {
      main.appendChild(h('div', { class: 'card stack', style: 'margin-top:12px' }, h('h2', { style: 'margin-top:0', text: d.title + '  (' + d.seconds + '초)' }),
        h('p', null, h('b', { text: '말할 내용: ' }), d.say),
        h('a', { class: 'btn btn-primary', href: d.route, text: '화면 열기' })));
    });
  }

  // ---------------------------------------------------------------- router
  function renderNav(hash) {
    var ol = clear(document.getElementById('flowNav'));
    C.FLOW_STEPS.forEach(function (s0) {
      var base = s0[0].replace(/\/a$/, '');
      var on = hash === s0[0] || (base !== '#/home' && hash.indexOf(base.split('/').slice(0, 2).join('/')) === 0);
      ol.appendChild(h('li', null, h('a', { href: s0[0], 'aria-current': on ? 'page' : null, text: s0[1] })));
    });
  }
  function focusKey() {
    var a = document.activeElement;
    if (!a || a === document.body || !main.contains(a)) return null;
    return { tag: a.tagName, text: (a.textContent || '').trim(), label: a.getAttribute('aria-label'), id: a.id && a.id.charAt(0) !== 'u' ? a.id : null };
  }
  function restoreFocus(k) {
    if (!k) return;
    var cands = main.querySelectorAll(k.tag.toLowerCase());
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if ((k.label && c.getAttribute('aria-label') === k.label && (c.textContent || '').trim() === k.text) || (!k.label && (c.textContent || '').trim() === k.text && k.text)) {
        if (!c.disabled) { c.focus({ preventScroll: true }); return; }
      }
    }
  }
  function route() {
    var y = window.scrollY, fk = focusKey();
    var hash = location.hash || '#/home';
    cleanup(); clear(main);
    renderNav(hash);
    var m;
    if ((m = hash.match(/^#\/flow\/([abc])$/))) viewLesson(m[1]);
    else if ((m = hash.match(/^#\/compare(?:\/([a-z_]+))?$/))) viewCompare(m[1]);
    else if (hash === '#/lab') viewLab();
    else if (hash === '#/blind') viewBlind();
    else if (hash === '#/evidence') viewEvidence();
    else if (hash === '#/json') viewJson();
    else if (hash === '#/check') viewCheck();
    else if (hash === '#/demo') viewDemo();
    else viewHome();
    if (route.lastHash === hash) { window.scrollTo(0, y); restoreFocus(fk); } else { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
    route.lastHash = hash;
  }

  var rm = document.getElementById('reduceMotion');
  var sysReduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  rm.checked = sysReduce;
  function applyMotion() { document.documentElement.classList.toggle('reduce-motion', rm.checked); }
  rm.addEventListener('change', applyMotion); applyMotion();
  window.addEventListener('hashchange', route);
  window.PacketLabApp = { route: route, state: state };
  route();
})();
