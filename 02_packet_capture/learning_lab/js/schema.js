/* packet_summary.json 검증기 — data_contract.md 7절 규칙과 1:1 대응
 * summarize_pcap.py validate 와 같은 규칙을 쓴다 (tests/ 에서 같은 fixture로 두 구현을 비교).
 */
(function (root) {
  'use strict';

  var SUPPORTED_VERSIONS = ['0.1-draft'];
  var BASE_FIELDS = ['case_id', 'source_ip', 'destination_ip', 'arp_request_count', 'arp_reply_count',
    'icmp_request_count', 'icmp_reply_count', 'dns_query_count', 'tcp_syn_count', 'notes'];
  var BASE_COUNTS = ['arp_request_count', 'arp_reply_count', 'icmp_request_count', 'icmp_reply_count', 'dns_query_count', 'tcp_syn_count'];
  var EXTRA_COUNTS = ['dns_response_count', 'tcp_syn_ack_count', 'tcp_rst_count'];
  var EXTRA_FIELDS = ['schema_version', 'capture_file', 'evidence_source', 'capture_point', 'test_description',
    'analysis_scope', 'dns_response_count', 'tcp_syn_ack_count', 'tcp_rst_count', 'evidence', 'limitations', 'null_reasons'];
  var EVIDENCE_SOURCES = ['wireshark_capture', 'packet_tracer_simulation', 'example'];
  var REF_TYPES = ['frame', 'pt_event', 'example_event'];
  var HINT_WORDS = ['gateway', 'gw', 'vlan', 'trunk', 'svi', 'dns', 'mask', 'subnet', 'port', 'web', 'http', 'tcp', 'arp', 'icmp'];
  var EXAMPLE_MARK = '[교육용 예제]';

  function isIPv4(s) {
    if (typeof s !== 'string') return false;
    var p = s.split('.');
    if (p.length !== 4) return false;
    return p.every(function (x) { return /^\d{1,3}$/.test(x) && +x <= 255 && String(+x) === x; });
  }
  function isCount(v) { return v === null || (typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0); }
  function typeName(v) { return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v; }
  function hintWords(s) {
    if (typeof s !== 'string') return [];
    var tokens = s.toLowerCase().split(/[^a-z0-9]+/);
    return HINT_WORDS.filter(function (w) { return tokens.indexOf(w) >= 0; });
  }

  // 반환: {errors:[{field,message}], warnings:[{field,message}], valid:boolean}
  function validate(obj) {
    var errors = [], warnings = [];
    function err(f, m) { errors.push({ field: f, message: m }); }
    function warn(f, m) { warnings.push({ field: f, message: m }); }

    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      err('(root)', Array.isArray(obj)
        ? '최상위가 배열입니다. 과제 형식은 사례 하나를 담은 단일 객체입니다 (여러 사례 형식은 아직 합의 전).'
        : '최상위가 JSON 객체가 아닙니다.');
      return { errors: errors, warnings: warnings, valid: false };
    }

    BASE_FIELDS.forEach(function (f) {
      if (!Object.prototype.hasOwnProperty.call(obj, f)) err(f, '필수 필드가 없습니다 (과제 HTML 기본 필드).');
    });

    if ('case_id' in obj && (typeof obj.case_id !== 'string' || obj.case_id.trim() === '')) err('case_id', '비어 있지 않은 문자열이어야 합니다. 지금 타입: ' + typeName(obj.case_id));
    ['source_ip', 'destination_ip'].forEach(function (f) {
      if (f in obj && !isIPv4(obj[f])) err(f, 'IPv4 주소 형식(예: 192.168.10.10)이어야 합니다. 지금 값: ' + JSON.stringify(obj[f]));
    });
    if ('notes' in obj && typeof obj.notes !== 'string') err('notes', '문자열이어야 합니다. 지금 타입: ' + typeName(obj.notes));

    var nullReasons = obj.null_reasons;
    if ('null_reasons' in obj && (nullReasons === null || typeof nullReasons !== 'object' || Array.isArray(nullReasons))) {
      err('null_reasons', '객체여야 합니다 (예: {"dns_query_count": "capture filter가 icmp만 저장"}).');
      nullReasons = {};
    }
    nullReasons = nullReasons || {};

    BASE_COUNTS.concat(EXTRA_COUNTS).forEach(function (f) {
      if (!(f in obj)) return;
      var v = obj[f];
      if (!isCount(v)) {
        err(f, '0 이상의 정수 또는 null이어야 합니다. 지금 값: ' + JSON.stringify(v) + (typeof v === 'string' ? ' (따옴표를 뺀 숫자로 적어야 합니다)' : ''));
      } else if (v === null && !(typeof nullReasons[f] === 'string' && nullReasons[f].trim())) {
        err(f, 'null이면 null_reasons.' + f + '에 이유가 있어야 합니다 (미수집·미분석·관찰 불가를 0과 구분하기 위해).');
      }
    });

    if ('schema_version' in obj) {
      if (SUPPORTED_VERSIONS.indexOf(obj.schema_version) < 0) err('schema_version', '지원하지 않는 버전입니다: ' + JSON.stringify(obj.schema_version) + ' (지원: ' + SUPPORTED_VERSIONS.join(', ') + ')');
    } else {
      warn('schema_version', '없습니다. 과제 HTML 기본 형식으로 처리합니다.');
    }

    var src = obj.evidence_source;
    if ('evidence_source' in obj && EVIDENCE_SOURCES.indexOf(src) < 0) err('evidence_source', '허용값이 아닙니다: ' + JSON.stringify(src) + ' (허용: ' + EVIDENCE_SOURCES.join(', ') + ')');
    if (typeof obj.notes === 'string') {
      var marked = obj.notes.indexOf(EXAMPLE_MARK) >= 0;
      if (src === 'example' && !marked) err('notes', '교육용 예제(evidence_source = example)는 notes에 "' + EXAMPLE_MARK + '" 표시가 있어야 합니다.');
      if (src && src !== 'example' && marked) err('notes', '실제 증거(evidence_source = ' + src + ')인데 "' + EXAMPLE_MARK + '" 표시가 있습니다.');
      if (!('evidence_source' in obj) && marked) warn('evidence_source', 'notes에 교육용 표시가 있습니다. evidence_source: "example"을 함께 적어 주세요.');
    }

    ['case_id', 'capture_file'].forEach(function (f) {
      var h = hintWords(obj[f]);
      if (h.length) err(f, '원인을 암시하는 단어(' + h.join(', ') + ')가 있습니다. Blind Fault 입력이 오염됩니다. 익명 ID(예: FAULT-03)를 쓰세요.');
    });

    if ('evidence' in obj) {
      if (!Array.isArray(obj.evidence)) err('evidence', '배열이어야 합니다.');
      else obj.evidence.forEach(function (e, i) {
        var f = 'evidence[' + i + ']';
        if (e === null || typeof e !== 'object' || Array.isArray(e)) { err(f, '객체여야 합니다.'); return; }
        if (typeof e.observation !== 'string' || !e.observation.trim()) err(f + '.observation', '관찰 내용(문자열)이 필요합니다.');
        if (REF_TYPES.indexOf(e.ref_type) < 0) err(f + '.ref_type', '허용값: ' + REF_TYPES.join(', '));
        if (e.ref_type === 'frame' && !(typeof e.frame_number === 'number' && e.frame_number >= 1 && Math.floor(e.frame_number) === e.frame_number)) err(f + '.frame_number', 'ref_type이 frame이면 1 이상의 정수 frame_number가 필요합니다.');
        if (e.ref_type === 'pt_event' && !(typeof e.event_id === 'string' && e.event_id.trim())) err(f + '.event_id', 'ref_type이 pt_event이면 event_id(문자열)가 필요합니다.');
        if (src === 'wireshark_capture' && e.ref_type && e.ref_type !== 'frame') warn(f + '.ref_type', 'Wireshark 캡처 증거인데 ref_type이 frame이 아닙니다.');
      });
    }

    if ('limitations' in obj) {
      if (!Array.isArray(obj.limitations) || !obj.limitations.every(function (x) { return typeof x === 'string'; })) err('limitations', '문자열 배열이어야 합니다.');
    } else warn('limitations', '없습니다. 이 캡처로 알 수 없는 것을 적어 두면 3번이 과신하지 않습니다.');

    if ('analysis_scope' in obj) {
      var sc = obj.analysis_scope;
      if (sc === null || typeof sc !== 'object' || Array.isArray(sc)) err('analysis_scope', '객체여야 합니다.');
      else {
        if (sc.count_basis !== undefined) {
          var cb = sc.count_basis;
          if (cb === null || typeof cb !== 'object') err('analysis_scope.count_basis', '객체여야 합니다.');
          else {
            if (['packets', 'transactions'].indexOf(cb.unit) < 0) err('analysis_scope.count_basis.unit', 'packets 또는 transactions 이어야 합니다.');
            if (typeof cb.retransmissions_included !== 'boolean') err('analysis_scope.count_basis.retransmissions_included', 'true/false 여야 합니다.');
          }
        } else warn('analysis_scope.count_basis', '없습니다. 패킷 수인지 고유 요청 수인지 알 수 없습니다.');
        if (sc.arp_targets !== undefined && !(Array.isArray(sc.arp_targets) && sc.arp_targets.every(isIPv4))) err('analysis_scope.arp_targets', 'IPv4 문자열 배열이어야 합니다.');
      }
    } else warn('analysis_scope', '없습니다. 어떤 구간·필터·기준으로 셌는지 3번이 알 수 없습니다.');

    if ('tcp_syn_count' in obj && typeof obj.tcp_syn_count === 'number' && obj.tcp_syn_count > 0 && !('tcp_syn_ack_count' in obj)) warn('tcp_syn_ack_count', 'SYN은 있는데 SYN-ACK 집계가 없습니다. 응답 유무를 판단하기 어렵습니다.');

    Object.keys(obj).forEach(function (k) {
      if (BASE_FIELDS.indexOf(k) < 0 && EXTRA_FIELDS.indexOf(k) < 0) warn(k, '계약에 없는 필드입니다. 3번 프로그램은 무시할 수 있습니다.');
    });

    return { errors: errors, warnings: warnings, valid: errors.length === 0 };
  }

  var api = { validate: validate, BASE_FIELDS: BASE_FIELDS, BASE_COUNTS: BASE_COUNTS, EXTRA_COUNTS: EXTRA_COUNTS, EXTRA_FIELDS: EXTRA_FIELDS, SUPPORTED_VERSIONS: SUPPORTED_VERSIONS, EXAMPLE_MARK: EXAMPLE_MARK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PacketSchema = api;
})(typeof window !== 'undefined' ? window : this);
