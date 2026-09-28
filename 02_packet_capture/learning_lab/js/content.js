/* learning_lab 설명 문구와 학습 콘텐츠
 * 작성 원칙: 설명하는 사람이 편한 문장이 아니라, 처음 듣는 팀원이 이해하기 쉬운 문장.
 *  - 한 문장에 한 가지 생각. 쉬운 설명 → 실제 흐름 → 기술 세부 순서.
 *  - 용어는 처음 나올 때 화면 안에서 풀어 준다(툴팁에 숨기지 않는다).
 *  - 관찰한 사실과 해석(추측)을 섞지 않는다.
 */
(function (root) {
  'use strict';

  var GLOSSARY = {
    'MAC 주소': '같은 네트워크 구간 안에서 장비를 찾는 주소. 랜카드마다 붙어 있고, 스위치는 이 주소를 보고 프레임을 전달한다.',
    'IP 주소': '네트워크를 넘어 최종 목적지를 찾는 주소. 라우터를 지나도 바뀌지 않는다(이 예제는 NAT 없음).',
    'ARP': 'IP 주소를 알 때 그 장비의 MAC 주소를 알아내는 방법. "이 IP 쓰는 분, MAC 알려 주세요"라고 묻는다.',
    '브로드캐스트': '같은 VLAN 안의 모든 장비에게 한꺼번에 보내는 방식. 목적지 MAC이 ff:ff:ff:ff:ff:ff이다. 라우터를 넘지 않는다.',
    'VLAN': '스위치 하나를 논리적으로 여러 네트워크로 나누는 기능. VLAN이 다르면 같은 스위치에 꽂혀 있어도 서로 직접 대화할 수 없다.',
    'Subnet': 'IP 주소 중 "같은 동네"로 보는 범위. PC는 Subnet Mask로 목적지가 같은 동네인지 계산한다.',
    'Default Gateway': '다른 네트워크로 나갈 때 PC가 패킷을 맡기는 장비(여기서는 L3 스위치). PC마다 주소를 설정한다.',
    'next hop': '패킷을 "바로 다음에" 넘겨줄 장비. 최종 목적지와 다를 수 있다. 다른 네트워크로 갈 때 next hop은 Gateway다.',
    'SVI': 'L3 스위치 안에 있는 VLAN별 가상 인터페이스(Vlan10, Vlan20). 각 VLAN의 Gateway 역할을 한다.',
    'Trunk': '스위치끼리 연결한 선 하나로 여러 VLAN을 함께 나르는 포트. 어떤 VLAN을 허용할지 목록으로 정한다.',
    'Access Port': 'PC가 꽂히는 포트. VLAN 하나에만 속한다. 여기서 캡처하면 VLAN 태그는 보이지 않는 것이 정상이다.',
    'ICMP Echo': 'ping이 쓰는 메시지. Echo Request(보냄)와 Echo Reply(답)가 짝을 이룬다.',
    'DNS': '도메인 이름(web.packetlab.example)을 IP 주소로 바꿔 주는 서비스. 보통 UDP 53번 포트를 쓴다.',
    'TCP': '데이터를 빠짐없이 순서대로 주고받기 위해 먼저 연결을 맺는 방식. SYN → SYN-ACK → ACK로 연결을 연다(3-way handshake).',
    'SYN': 'TCP 연결을 시작하자는 요청. SYN=1, ACK=0.',
    'SYN-ACK': '연결 요청을 받아들이겠다는 답. SYN=1, ACK=1.',
    'RST': '연결을 즉시 거절하거나 끊는 신호. 서버가 살아 있어 응답은 했지만 그 포트에서 받는 프로그램이 없을 때 흔히 보인다.',
    'HTTP': '웹 페이지를 요청하고 받는 규칙. GET으로 요청하고 200 OK로 답한다.',
    '캡처 지점': '패킷을 지켜본 위치. 한 지점에서 보이지 않았다고 다른 곳에서도 없었다는 뜻은 아니다.',
    '재전송': '답이 없어서 같은 요청을 다시 보내는 것. 재전송이 보이면 "답이 오지 않았다"는 관찰까지만 확실하다.',
    'NXDOMAIN': 'DNS 서버가 "그런 이름은 없다"고 답한 오류 응답(rcode 3). 무응답과 다르다.',
    'ICMP Destination Unreachable': '라우터가 "그 목적지로는 보낼 수 없다"고 알려 주는 메시지. Echo Reply가 아니다.'
  };

  var KIND_TERMS = {
    arp_request: ['ARP', 'MAC 주소', '브로드캐스트', 'VLAN'],
    arp_reply: ['ARP', 'MAC 주소'],
    icmp_echo_request: ['ICMP Echo', 'IP 주소', 'next hop', 'Default Gateway'],
    icmp_echo_reply: ['ICMP Echo'],
    icmp_unreach: ['ICMP Destination Unreachable', 'SVI'],
    dns_query: ['DNS'],
    dns_response: ['DNS'],
    dns_error: ['DNS', 'NXDOMAIN'],
    tcp_syn: ['TCP', 'SYN'],
    tcp_syn_ack: ['SYN-ACK'],
    tcp_ack: ['TCP'],
    tcp_rst: ['RST'],
    http_request: ['HTTP'],
    http_response: ['HTTP']
  };

  function dev(E, id) {
    if (E.HOSTS[id]) return E.HOSTS[id].id === 'SRV' ? 'Server' : id;
    if (E.SVIS[id]) return 'L3SW(' + E.SVIS[id].label.replace('L3SW ', '') + ')';
    return id;
  }

  // 패킷 하나를 세 단계로 설명한다
  function explain(E, ev) {
    var f = dev(E, ev.from), t = ev.to === 'broadcast' ? 'VLAN ' + ev.vlan + ' 전체' : dev(E, ev.to);
    var x = { easy: '', flow: '', detail: [], limit: '', terms: KIND_TERMS[ev.kind] || [] };
    var routed = ev.routedLeg ? ' 이 프레임은 라우터(L3SW)를 지난 뒤의 두 번째 구간이다. MAC 주소는 새 구간 것으로 바뀌었지만 IP 주소는 처음 그대로다.' : '';
    switch (ev.kind) {
      case 'arp_request':
        x.easy = f + '가 같은 VLAN 전체에 묻는다. "' + ev.dstIp + '를 쓰는 장비는 MAC 주소를 알려 주세요."' + (ev.retry ? ' 앞선 질문에 답이 없어서 다시 묻는 중이다.' : '');
        x.flow = '목적지 MAC이 ff:ff:ff:ff:ff:ff(브로드캐스트)라서 스위치는 VLAN ' + ev.vlan + '에 속한 모든 포트로 복사해 보낸다. 다른 VLAN이나 라우터 너머로는 가지 않는다.';
        x.limit = 'ARP Reply가 보이지 않아도 원인은 여러 가지다(그 IP를 가진 장비가 없음, VLAN이 다름, 인터페이스 down 등). 이 패킷 하나로 원인을 정할 수 없다.';
        break;
      case 'arp_reply':
        x.easy = f + '가 답한다. "' + ev.srcIp + '는 나이고, 내 MAC은 ' + ev.srcMac + '입니다." 이 답은 물어본 ' + t + '에게만 간다.';
        x.flow = t + '는 이 MAC을 ARP 캐시에 적어 둔다. 다음부터는 같은 주소를 다시 묻지 않는다.';
        x.limit = 'ARP Reply는 2계층(같은 VLAN) 연결이 된다는 증거다. 그 너머의 경로나 서비스가 정상이라는 뜻은 아니다.';
        break;
      case 'icmp_echo_request':
        x.easy = f + '가 ' + ev.dstIp + '에게 "들리나요?"라고 ping을 보낸다.' + routed;
        x.flow = '이 구간의 목적지 MAC은 ' + ev.dstMac + '(' + t + ')이다. IP 목적지는 최종 목적지 ' + ev.dstIp + '이다. MAC은 "바로 다음 장비", IP는 "최종 목적지"를 가리킨다.';
        x.limit = 'Echo Request가 나갔다는 사실은 보낸 쪽이 next hop의 MAC을 알았다는 뜻이다. 상대가 받았는지는 반대편이나 Reply로 확인해야 한다.';
        break;
      case 'icmp_echo_reply':
        x.easy = f + '가 "잘 들립니다"라고 답한다.' + routed;
        x.flow = '돌아오는 길도 같은 원리다. 보내는 쪽이 자기 기준으로 next hop을 다시 계산한다.';
        x.limit = 'ping 성공은 IP까지 연결된다는 뜻이다. DNS나 웹 서비스가 정상이라는 뜻은 아니다.';
        break;
      case 'icmp_unreach':
        x.easy = f + '가 "그 목적지 네트워크로는 보낼 길이 없다"고 알려 준다.';
        x.flow = '라우터가 목적지 네트워크를 연결 경로 목록에서 찾지 못했다. 이 교육 모델에서는 라우터가 이 메시지를 돌려준다고 가정한다.';
        x.limit = '실제 장비는 설정이나 속도 제한 때문에 이 메시지를 보내지 않을 수 있다. 이 메시지는 ICMP Echo Reply가 아니므로 icmp_reply_count에 세지 않는다.';
        break;
      case 'dns_query':
        x.easy = f + '가 DNS 서버 ' + ev.dstIp + '에게 묻는다. "' + (ev.fields['dns.qry.name'] || '') + '의 IP 주소가 뭔가요?"' + (ev.retry ? ' 답이 없어서 다시 묻는 중이다.' : '') + routed;
        x.flow = '웹 서버와 통신하려면 이름이 아니라 IP 주소가 필요하다. 그래서 DNS가 가장 먼저 나온다.';
        x.limit = 'DNS 응답이 안 보이면 원인 후보가 여럿이다. 질의를 보낸 주소가 맞는지, 그 주소까지 가는 길이 있는지, 서버가 답하는지를 나눠 봐야 한다.';
        break;
      case 'dns_response':
        x.easy = f + '가 답한다. "' + (ev.fields['dns.qry.name'] || '') + '의 주소는 ' + (ev.fields['dns.a'] || '') + '입니다."' + routed;
        x.flow = '이제 PC는 이 IP로 TCP 연결을 시작할 수 있다. 응답의 IP가 기대한 서버 주소(network_spec 기준)와 같은지도 확인해야 한다.';
        x.limit = '응답이 왔다고 내용이 맞다는 보장은 없다. 잘못된 IP로 답하는 경우도 있다.';
        break;
      case 'dns_error':
        x.easy = f + '가 답한다. "그런 이름은 모릅니다(NXDOMAIN)."' + routed;
        x.flow = 'DNS 서버까지 가는 길과 서버는 살아 있다. 다만 그 이름의 기록이 없다고 답했다.';
        x.limit = '오류 응답은 무응답과 다르다. 네트워크 경로보다는 DNS 서버의 기록이나 질의한 이름을 먼저 확인할 근거가 된다.';
        break;
      case 'tcp_syn':
        x.easy = f + '가 ' + ev.dstIp + '의 80번 포트에게 "연결해도 될까요?"라고 묻는다(SYN).' + (ev.retry ? ' 답이 없어서 다시 보내는 중이다(재전송).' : '') + routed;
        x.flow = '웹 페이지를 주고받기 전에 TCP 연결을 먼저 연다. SYN → SYN-ACK → ACK 세 단계다.';
        x.limit = 'SYN만 반복되면 "답이 오지 않았다"까지만 확실하다. 서버 서비스 중단, 방화벽, 경로 문제를 구분하려면 다른 증거가 필요하다.';
        break;
      case 'tcp_syn_ack':
        x.easy = f + '가 "좋아요, 연결합시다"라고 답한다(SYN-ACK).' + routed;
        x.flow = '서버의 80번 포트에서 웹 서비스가 연결을 받고 있다는 뜻이다.';
        x.limit = 'tcp.flags.syn == 1 필터에는 이 패킷도 보인다. 초기 SYN만 셀 때는 tcp.flags.ack == 0 조건을 함께 쓴다.';
        break;
      case 'tcp_ack':
        x.easy = f + '가 "확인했습니다"라고 답하며 연결이 열린다(ACK).';
        x.flow = '3-way handshake가 끝났다. 이제 HTTP 요청을 보낼 수 있다.';
        x.limit = '';
        break;
      case 'tcp_rst':
        x.easy = f + '가 연결을 곧바로 거절한다(RST).' + routed;
        x.flow = '서버에 패킷이 도착했고 서버가 답도 했다. 다만 80번 포트에서 연결을 받는 프로그램이 없다.';
        x.limit = 'RST는 무응답과 다르다. "서버까지는 도달했다"는 증거가 된다. 다만 중간 장비가 RST를 대신 보내는 환경도 있으니 보낸 IP를 확인한다.';
        break;
      case 'http_request':
        x.easy = f + '가 웹 페이지를 달라고 요청한다(GET /).';
        x.flow = '이 예제는 암호화되지 않은 HTTP라 요청 내용이 보인다. HTTPS라면 내용이 암호화되어 이렇게 보이지 않는다.';
        x.limit = '';
        break;
      case 'http_response':
        x.easy = f + '가 웹 페이지를 보내 준다(200 OK).';
        x.flow = 'DNS → TCP → HTTP가 모두 성공했다. 사용자가 보기에는 "페이지가 열렸다".';
        x.limit = '';
        break;
    }
    x.detail = [['구간', f + ' → ' + t], ['Ethernet 출발 MAC', ev.srcMac], ['Ethernet 도착 MAC', ev.dstMac], ['IP 출발', ev.srcIp || '—'], ['IP 도착', ev.dstIp || '—'], ['VLAN (이 구간)', String(ev.vlan)]];
    for (var k in ev.fields) if (!/^eth\.|^ip\./.test(k)) x.detail.push([k, ev.fields[k]]);
    return x;
  }

  // 정상 흐름 단원 A·B·C
  var LESSONS = {
    a: {
      id: 'a', title: 'A. 같은 네트워크의 PC끼리', test: 'ping_pc2',
      goal: 'PC1이 같은 네트워크의 PC2와 통신할 때 어떤 주소가 필요한지 설명할 수 있다.',
      conditions: 'PC1 192.168.10.10/24 (SW-A, VLAN 10) → PC2 192.168.10.11/24 (SW-B, VLAN 10). 두 스위치는 L3SW를 거치는 Trunk로 이어져 있다. 교육용 예제 주소다.',
      predict: { q: 'PC1이 PC2에게 ping을 보내려면, 먼저 알아내야 할 주소는 무엇일까?', options: [['pc2mac', 'PC2의 MAC 주소'], ['gwmac', 'Gateway(L3SW)의 MAC 주소'], ['dns', 'DNS 서버의 IP 주소'], ['pc2ip', 'PC2의 IP 주소']], answer: 'pc2mac',
        why: 'PC1은 PC2의 IP(192.168.10.11)를 이미 안다. 둘은 같은 네트워크(192.168.10.0/24)라서 Gateway를 거치지 않는다. 그래서 PC2의 MAC만 알면 직접 보낼 수 있다.' },
      points: ['PC1은 먼저 "목적지가 같은 네트워크인가?"를 계산한다.', '같은 네트워크라면 next hop은 목적지 자신이다. 그래서 PC2의 MAC을 ARP로 찾는다.', 'ARP 질문(브로드캐스트)은 VLAN 10 안에서만 퍼진다. VLAN 20의 PC3에는 닿지 않는다.', 'PC2가 다른 스위치에 있어도 Trunk가 VLAN 10을 허용하면 같은 VLAN으로 이어진다.'],
      check: ['q_scope']
    },
    b: {
      id: 'b', title: 'B. 다른 네트워크의 서버로', test: 'ping_srv',
      goal: '다른 네트워크로 보낼 때 최종 목적지(IP)와 다음 장비(MAC)가 왜 다른지 설명할 수 있다.',
      conditions: 'PC1 192.168.10.10/24 (VLAN 10) → Server 192.168.20.20/24 (VLAN 20). PC1의 Default Gateway는 192.168.10.1(L3SW Vlan10)이다. NAT는 쓰지 않는다. 교육용 예제 주소다.',
      predict: { q: 'PC1이 서버(다른 네트워크)로 ping을 보낼 때, ARP로 찾는 MAC은 누구의 것일까?', options: [['srv', '서버의 MAC'], ['gw', 'Gateway(L3SW Vlan10)의 MAC'], ['pc3', 'PC3의 MAC'], ['none', 'MAC은 필요 없다']], answer: 'gw',
        why: 'ARP 브로드캐스트는 라우터를 넘지 못한다. 그래서 PC1은 서버의 MAC을 직접 알 수 없다. 대신 "맡길 장비"인 Gateway의 MAC을 찾고, 그 뒤는 Gateway가 이어서 전달한다.' },
      points: ['PC1 계산: 192.168.20.20은 내 네트워크(192.168.10.0/24) 밖이다 → Gateway에게 맡긴다.', '첫 구간: 도착 MAC = Gateway, 도착 IP = 서버.', 'L3SW가 VLAN 20 쪽에서 서버 MAC을 ARP로 찾는다.', '두 번째 구간: MAC은 새로 바뀌고, IP는 그대로다. MAC은 구간마다 바뀌고 IP는 끝까지 같다.'],
      check: ['q_gwmac']
    },
    c: {
      id: 'c', title: 'C. 도메인으로 웹 페이지 열기', test: 'web',
      goal: 'DNS, TCP, HTTP가 각각 어떤 문제를 해결하는지 순서대로 설명할 수 있다.',
      conditions: 'PC1이 브라우저에 http://web.packetlab.example/ 을 입력한다. DNS 서버와 웹 서버는 같은 Server(192.168.20.20)다. 일반 DNS(UDP 53)와 일반 HTTP(TCP 80)를 쓴다. 교육용 예제다.',
      predict: { q: '웹 페이지 내용을 받기 전에, PC1이 반드시 먼저 알아내야 하는 것은?', options: [['ip', '서버의 IP 주소 (DNS)'], ['port', '서버의 운영체제'], ['vlan', '서버의 VLAN 번호'], ['mac', '서버의 MAC 주소']], answer: 'ip',
        why: '사람은 이름(web.packetlab.example)을 쓰지만 패킷은 IP 주소로 간다. 그래서 DNS로 IP를 먼저 알아낸다. 서버의 MAC은 다른 네트워크라 PC1이 직접 알 필요가 없다.' },
      points: ['DNS: 이름 → IP 주소. "어디로 가야 하나?"를 해결한다.', 'TCP: SYN → SYN-ACK → ACK. "상대가 연결을 받을 준비가 됐나?"를 해결한다.', 'HTTP: GET → 200 OK. "무엇을 달라고 할까?"를 해결한다.', '실제 HTTPS나 암호화 DNS에서는 이 내용이 암호화되어 이렇게 보이지 않는다.'],
      check: ['q_ping_web']
    }
  };

  // 정상·장애 비교 사례 (교육용. 실제 과제 사례·case_id와 무관)
  var COMPARE_CASES = [
    { id: 'cmp_gw', title: '잘못된 Gateway를 향한 ARP', test: 'ping_srv', cp: 'PC1', variants: [['PC1 Gateway = 192.168.10.254', { pc1Gateway: '192.168.10.254' }]],
      conditions: 'PC1 → Server ping. PC1의 Gateway만 192.168.10.254(아무 장비도 쓰지 않는 주소)로 바꾼다. 캡처는 PC1 NIC.',
      candidates: ['PC의 Gateway 주소 설정', 'Gateway 쪽 인터페이스(SVI) down', 'PC 포트의 VLAN 할당'],
      next: 'ARP가 찾는 IP(arp.dst.proto_ipv4)가 network_spec의 Gateway(192.168.10.1)와 같은지 본다. 다르면 PC 설정(ipconfig)을 확인한다.',
      why: 'ARP Reply가 없다는 것만으로는 세 후보를 구분할 수 없다. "누구를 찾고 있었는가"라는 필드가 결정적인 차이를 만든다.' },
    { id: 'cmp_access', title: 'Access VLAN 오류', test: 'ping_pc2', cp: 'PC1', altCp: 'PC3', variants: [['SW-A Fa0/1 = VLAN 20', { pc1AccessVlan: 20 }]],
      conditions: 'PC1 → PC2 ping(같은 Subnet). PC1 포트(SW-A Fa0/1)만 VLAN 20으로 바꾼다. 기본 캡처는 PC1 NIC, 비교용으로 PC3 NIC.',
      candidates: ['PC1 포트의 VLAN 할당', 'Trunk에서 VLAN 10 누락', 'PC2 쪽 문제'],
      next: '다른 지점(PC3 NIC, VLAN 20)에서 PC1의 ARP가 보이는지 확인한다. 보인다면 PC1의 브로드캐스트가 VLAN 20으로 퍼지고 있다는 뜻이다. 그다음 SW-A에서 show vlan brief로 확인한다.',
      why: 'PC1 NIC에서만 보면 Trunk VLAN 누락과 똑같이 "ARP 반복, Reply 없음"이다. Access Port 캡처에는 원래 VLAN 태그가 없으므로, 태그가 없다는 사실은 증거가 아니다.' },
    { id: 'cmp_trunk', title: 'Trunk VLAN 누락', test: 'ping_pc2', cp: 'PC1', altCp: 'PC2', variants: [['L3SW↔SW-B Trunk 허용 = 20만', { trunkBAllowed: [20] }]],
      conditions: 'PC1 → PC2 ping. L3SW와 SW-B 사이 Trunk에서 VLAN 10만 뺀다. 기본 캡처는 PC1 NIC, 비교용으로 PC2 NIC.',
      candidates: ['Trunk 허용 VLAN 누락', 'PC1 포트의 VLAN 할당', 'PC2 포트·PC2 자체 문제'],
      next: 'PC2 NIC에서 PC1의 ARP가 도착하는지 본다. 그리고 같은 VLAN 10이지만 SW-B를 거치지 않는 장비(Gateway 192.168.10.1)로는 ping이 되는지 비교한다. 마지막으로 show interfaces trunk로 확인한다.',
      why: 'PC1 쪽만 보면 Access VLAN 오류와 구분되지 않는다. "어디까지 닿았는가"를 보려면 반대편 지점의 관찰이 필요하다.' },
    { id: 'cmp_svi', title: 'SVI Down과 Gateway 응답 부재', test: 'ping_srv', cp: 'PC1', variants: [['L3SW Vlan10 down', { sviDown: 10 }], ['L3SW Vlan20 down', { sviDown: 20 }]],
      conditions: 'PC1 → Server ping. L3SW의 SVI 하나를 down으로 바꾼다. 어느 쪽 SVI가 down인지에 따라 PC1에서 보이는 모습이 달라진다. 캡처는 PC1 NIC.',
      candidates: ['SVI down', 'PC1 포트의 VLAN 할당', 'Gateway 주소 설정'],
      next: 'Vlan10 down이면 Gateway ARP 자체에 답이 없다. Vlan20 down이면 Gateway는 답하지만 이 모델에서는 Unreachable이 돌아온다. show ip interface brief로 확인한다.',
      why: '"Gateway ARP 응답 부재"는 SVI down일 수도 있고, VLAN이 달라서일 수도 있다. 같은 VLAN의 PC2로 ping이 되는지가 둘을 가르는 간단한 추가 검사다.' },
    { id: 'cmp_dns', title: 'DNS 무응답과 오류 응답', test: 'dns', cp: 'PC1', variants: [['Server DNS 응답 안 함', { dnsService: 'no_response' }], ['Server DNS 오류 응답(NXDOMAIN)', { dnsService: 'nxdomain' }], ['PC1 DNS 서버 주소 = 192.168.20.53', { pc1Dns: '192.168.20.53' }], ['Server DNS가 잘못된 IP로 응답', { dnsService: 'wrong_answer' }]],
      conditions: 'PC1에서 nslookup web.packetlab.example. DNS 서버 쪽이나 PC의 DNS 설정 하나만 바꾼다. 캡처는 PC1 NIC.',
      candidates: ['PC의 DNS 서버 주소 설정', 'DNS 서비스 중단', 'DNS 레코드 누락·오류', 'DNS 서버까지의 경로 문제'],
      next: '무응답이면 질의가 향한 IP(ip.dst)가 맞는지, 그 IP로 ping이 되는지 본다. 오류 응답이면 rcode와 질의한 이름을 본다. 응답의 IP가 network_spec의 서버 주소와 같은지도 본다.',
      why: '"DNS가 안 된다"는 한 문장 안에 무응답, 오류 응답, 잘못된 응답이 섞여 있다. 셋은 원인 후보가 서로 다르다.' },
    { id: 'cmp_tcp', title: 'TCP SYN 무응답과 RST 응답', test: 'web', cp: 'PC1', variants: [['Web 서비스 중지 (RST)', { webPort: 'closed' }], ['Web SYN 폐기 (무응답)', { webPort: 'filtered' }]],
      conditions: 'PC1 브라우저로 http://web.packetlab.example/. 서버의 80번 포트 상태만 바꾼다. DNS는 정상이다. 캡처는 PC1 NIC.',
      candidates: ['웹 서비스(프로그램) 중지', '방화벽 등 중간 폐기', '서버까지의 경로 문제'],
      next: '같은 서버 IP로 ping이 되는지 먼저 본다. RST라면 서버까지는 닿은 것이다. 무응답이라면 서버 NIC에서 SYN이 도착하는지 확인한다.',
      why: 'SYN 재전송만 보고 "서비스 중단"이라고 단정하면 안 된다. RST 응답과 무응답은 "서버에 닿았는가"라는 질문에서 다른 답을 준다.' },
    { id: 'cmp_mask', title: 'Subnet Mask 오류와 next hop 판단', test: 'ping_srv', cp: 'PC1', variants: [['PC1 Mask = /16', { pc1Mask: 16 }]],
      conditions: 'PC1 → Server ping. PC1의 Subnet Mask만 /16(255.255.0.0)으로 바꾼다. 캡처는 PC1 NIC.',
      candidates: ['PC의 Subnet Mask 설정', '서버 쪽 ARP 응답 문제', 'VLAN 문제'],
      next: 'ARP가 찾는 IP를 본다. Gateway가 아니라 서버 IP를 직접 찾고 있다면, PC1이 서버를 같은 네트워크로 판단했다는 뜻이다. 그다음 ipconfig로 Mask를 확인한다.',
      why: 'Mask가 넓어지면 PC는 다른 네트워크의 서버를 "옆집"으로 착각한다. 그래서 Gateway에 맡기지 않고 직접 ARP를 보낸다.' }
  ];

  // 이해 확인 질문
  var QUESTIONS = {
    q_gwmac: { q: '다른 Subnet의 서버에 접속할 때 왜 Gateway의 MAC이 필요한가?',
      model: 'MAC 주소는 같은 네트워크 구간 안에서만 쓰인다. ARP 브로드캐스트도 라우터를 넘지 못한다. 그래서 PC는 서버의 MAC을 직접 알 수 없다. 대신 다른 네트워크로 가는 문인 Gateway의 MAC을 찾아 프레임을 넘긴다. IP 목적지는 처음부터 끝까지 서버다. 라우터를 지날 때마다 MAC만 새 구간 것으로 바뀐다.',
      points: ['PC가 Subnet Mask로 "내 네트워크 밖"이라고 판단함', 'ARP 브로드캐스트는 라우터를 넘지 않음', '도착 MAC = Gateway, 도착 IP = 서버', '라우터 이후 MAC은 바뀌고 IP는 유지(NAT 없음)'] },
    q_ping_web: { q: 'ping이 성공해도 웹 접속은 왜 실패할 수 있는가?',
      model: 'ping은 ICMP로 "IP까지 닿는가"만 확인한다. 웹 접속에는 그 위의 단계가 더 필요하다. DNS로 이름을 IP로 바꿔야 하고, TCP 80번 포트에서 서비스가 연결을 받아야 하고, HTTP 응답이 와야 한다. 그래서 DNS 문제나 웹 서비스 중지, 포트 차단이 있으면 ping은 되어도 웹은 실패한다.',
      points: ['ping은 ICMP, 웹은 DNS + TCP + HTTP', 'IP 연결 성공 ≠ 서비스 동작', 'DNS 실패·포트 닫힘·중간 차단 같은 예시', '구분하려면 DNS와 TCP 패킷을 따로 확인'] },
    q_dns: { q: 'DNS 응답이 없다는 사실만으로 DNS 서버 장애를 확정할 수 있는가?',
      model: '확정할 수 없다. 응답이 없는 이유는 여러 가지다. PC가 잘못된 DNS 서버 주소로 물었을 수 있다. DNS 서버까지 가는 경로가 끊겼을 수 있다. 서버 서비스가 멈췄을 수 있다. 캡처 지점에서만 안 보였을 수도 있다. 질의의 목적지 IP, 그 IP로의 ping, 서버 쪽 캡처를 차례로 보면서 좁혀야 한다.',
      points: ['질의가 향한 IP 확인', '경로 문제 가능성', '관찰 구간·지점의 한계', '무응답과 오류 응답의 구분'] },
    q_arp: { q: 'ARP Reply가 보이지 않았다는 사실만으로 알 수 없는 것은 무엇인가?',
      model: '"왜" 답이 없는지를 알 수 없다. 그 IP를 쓰는 장비가 아예 없을 수도 있다(잘못된 Gateway 주소). 장비는 있지만 VLAN이 달라 브로드캐스트가 닿지 않았을 수도 있다. Trunk가 그 VLAN을 막았을 수도 있다. 인터페이스가 down일 수도 있다. 또 한 지점에서 안 보였다고 답이 세상에 없었다고 단정할 수도 없다.',
      points: ['ARP가 찾는 IP가 맞는지 따로 확인해야 함', 'VLAN·Trunk·SVI 후보가 남음', '단일 캡처 지점의 한계', '"관찰되지 않음" ≠ "존재하지 않음"'] },
    q_split: { q: 'Gateway ARP에 답이 없는 상황에서 "Access VLAN 오류"와 "SVI down" 두 후보가 남았다. 무엇을 검사하면 구분할 수 있는가?',
      model: '같은 VLAN 10의 PC2로 ping을 보낸다. SVI down이라면 PC1은 여전히 VLAN 10에 있으므로 PC2와는 통신된다. Access VLAN 오류라면 PC1이 VLAN 20에 들어가 있으므로 PC2와도 안 된다. 다른 지점(VLAN 20의 PC3 NIC)에서 PC1의 ARP가 보이는지도 강한 근거가 된다. 마지막으로 show vlan brief와 show ip interface brief로 확인한다.',
      points: ['두 후보가 다르게 예측하는 검사를 고름', '같은 VLAN PC ping', '다른 지점 캡처', '장비 상태 확인은 마지막 확인 단계'] },
    q_scope: { q: '내 캡처가 보여주는 범위와 보여주지 못하는 범위는 무엇인가?',
      model: '내 캡처는 캡처한 지점을 지나간 패킷만 보여 준다. 캡처한 시간 동안의 것만 보여 준다. 필터에 걸린 것만 보여 준다. 반대편에 도착했는지, 다른 VLAN에서 무슨 일이 있었는지, 장비 내부 설정은 보여 주지 못한다. Access Port 캡처에는 VLAN 태그도 보이지 않는다. 그래서 JSON에 캡처 지점, 시간 구간, 필터, 한계를 함께 적는다.',
      points: ['캡처 지점·시간·필터의 범위', '반대편 도착 여부는 모름', 'Access Port에서는 VLAN 태그가 안 보임', 'limitations와 null로 기록'] }
  };

  // 프로토콜별 증거 읽기
  var PROTOCOL_GUIDE = [
    { proto: 'ARP', filter: 'arp', fields: [['arp.opcode', '1 = Request(묻기), 2 = Reply(답)'], ['arp.src.proto_ipv4', '묻는 쪽 IP'], ['arp.dst.proto_ipv4', '찾고 있는 IP ← 가장 중요']],
      mistake: 'Reply가 없으면 곧바로 VLAN 오류라고 판단하기 쉽다. 먼저 "찾고 있는 IP"가 올바른 next hop인지 확인해야 한다.',
      record: '프레임 12–19: ARP Request 8건, 찾는 IP 192.168.10.254, Reply 0건 (PC1 NIC, 10:02:00–10:02:08)' },
    { proto: 'ICMP', filter: 'icmp', fields: [['icmp.type', '8 = Echo Request, 0 = Echo Reply, 3 = Destination Unreachable'], ['ip.src / ip.dst', '누가 누구에게'], ['icmp.seq', '몇 번째 ping인지']],
      mistake: 'type 3(Unreachable)을 "응답이 왔다"로 세기 쉽다. Echo Reply(type 0)와 반드시 나눠 센다.',
      record: '프레임 30–33: Echo Request 4건, Echo Reply 0건. 프레임 31, 33: type 3 from 192.168.10.1' },
    { proto: 'DNS', filter: 'dns', fields: [['dns.flags.response', '0 = 질의, 1 = 응답'], ['dns.flags.rcode', '0 = 정상, 3 = NXDOMAIN(이름 없음)'], ['dns.a', '응답에 담긴 IP'], ['ip.dst (질의)', '어느 DNS 서버에 물었는지']],
      mistake: '"DNS 안 됨" 하나로 뭉치기 쉽다. 무응답, 오류 응답, 잘못된 IP 응답은 서로 다른 관찰이다.',
      record: '프레임 41, 44, 47: Query A web.packetlab.example → 192.168.20.53, Response 0건' },
    { proto: 'TCP', filter: 'tcp.flags.syn == 1 && tcp.flags.ack == 0', fields: [['tcp.flags.syn / tcp.flags.ack', 'SYN=1·ACK=0 → 연결 요청, 둘 다 1 → SYN-ACK'], ['tcp.flags.reset', '1 = RST(거절)'], ['tcp.analysis.retransmission', 'Wireshark가 재전송으로 표시한 패킷']],
      mistake: 'tcp.flags.syn == 1 필터로 세면 SYN-ACK까지 들어간다. 초기 SYN 수와 섞이지 않게 ACK=0 조건을 함께 쓴다.',
      record: '프레임 52: SYN → 192.168.20.20:80, 프레임 53: RST, ACK from 192.168.20.20' },
    { proto: 'HTTP', filter: 'http', fields: [['http.request.method', 'GET 등'], ['http.response.code', '200, 404 등']],
      mistake: 'HTTPS는 암호화되어 http 필터에 보이지 않는다. "HTTP가 안 보인다"가 곧 "요청이 없다"는 뜻은 아니다.',
      record: '프레임 58: GET /, 프레임 60: HTTP/1.1 200 OK' }
  ];

  // 발표용 짧은 경로 (약 2분, 듣는 사람 기준 대사)
  var DEMO = [
    { title: '1. 정상일 때 패킷은 이렇게 간다', route: '#/flow/b', seconds: 30,
      say: '먼저 정상 상태입니다. PC1이 다른 네트워크의 서버로 ping을 보내면, 서버의 MAC이 아니라 Gateway의 MAC을 먼저 찾습니다. 이것이 오늘 모든 비교의 기준선입니다.' },
    { title: '2. 장애 때 처음 달라지는 패킷', route: '#/compare/cmp_gw', seconds: 30,
      say: '같은 테스트를 장애 상태에서 다시 합니다. 왼쪽은 정상, 오른쪽은 장애입니다. 처음 달라지는 곳은 ARP입니다. 답이 없고, 찾는 주소가 192.168.10.254입니다. 여기까지가 관찰한 사실입니다.' },
    { title: '3. 한 지점만 보면 헷갈린다', route: '#/compare/cmp_access', seconds: 30,
      say: '비슷해 보이는 장애도 있습니다. PC1에서만 보면 똑같이 ARP만 반복됩니다. 그래서 다른 지점을 함께 봅니다. PC3 쪽에서 PC1의 ARP가 보이면, PC1이 엉뚱한 VLAN에 들어가 있다는 근거가 됩니다.' },
    { title: '4. 다음 담당자에게 넘기는 데이터', route: '#/json', seconds: 30,
      say: '이렇게 본 것을 packet_summary.json으로 정리해 AI 담당에게 넘깁니다. 숫자는 관찰한 것만 적습니다. 보지 못한 것은 0이 아니라 null과 이유로 적습니다. 정답은 넣지 않습니다.' }
  ];

  var FLOW_STEPS = [
    ['#/home', '시작하기'], ['#/flow/a', '정상 패킷 따라가기'], ['#/compare', '정상·장애 비교'], ['#/lab', '설정 변경 실험'],
    ['#/blind', 'Blind Fault 조사'], ['#/evidence', '실제 증거 읽기'], ['#/json', 'JSON 전달'], ['#/check', '이해 확인']
  ];

  var api = { GLOSSARY: GLOSSARY, explain: explain, LESSONS: LESSONS, COMPARE_CASES: COMPARE_CASES, QUESTIONS: QUESTIONS, PROTOCOL_GUIDE: PROTOCOL_GUIDE, DEMO: DEMO, FLOW_STEPS: FLOW_STEPS, KIND_TERMS: KIND_TERMS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PacketContent = api;
})(typeof window !== 'undefined' ? window : this);
