#!/usr/bin/env bash
# Packet.AI 2번 Packet Analyst — 캡처용 재현 실습망 (Linux network namespace)
#
# 2번이 실제 .pcapng를 얻기 위해 쓰는 캡처 환경이다. 2번이 하는 일(테스트 실행·캡처·상태 관찰)만 제공한다.
#  - 토폴로지 값은 topology.conf에서 읽는다. 네트워크 설계는 1번 담당. IP/VLAN은 1번 명세 반영, 스위치 연결·도메인·포트는 임시값.
#  - 장애 적용과 복구는 4번(SRE) 담당이므로 이 스크립트에 넣지 않는다.
#  - 이 트래픽은 "별도 Linux 환경에서 재현한 트래픽"이다. Packet Tracer 내부 트래픽이 아니다.
#  - 모든 장비는 network namespace 안에 만든다. 호스트(VM/WSL)의 기존 네트워크 설정은 바꾸지 않는다.
#
# 사용법: sudo ./lab.sh <명령> ...   (도움말: ./lab.sh help)
set -Eeuo pipefail
trap 'echo "[오류] 줄 $LINENO 에서 실패: $BASH_COMMAND" >&2; echo "        정리 후 다시: sudo ./lab.sh down && sudo ./lab.sh up" >&2' ERR

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOPOLOGY="${TOPOLOGY:-$HERE/topology.conf}"
[[ -f $TOPOLOGY ]] || { echo "[중단] 토폴로지 파일이 없습니다: $TOPOLOGY" >&2; exit 1; }
# shellcheck source=topology.conf
source "$TOPOLOGY"

HOSTS=(pc1 pc2 pc3 pc4 srv)
SWITCHES=(sw1 sw2 mls1)
L2_SWITCHES=(sw1 sw2)
ALL_NS=("${HOSTS[@]}" "${SWITCHES[@]}")
RUN_DIR="/run/packetlab"
OUT_DIR="${OUT_DIR:-$(cd "$HERE/.." && pwd)}"   # 기본값: 02_packet_capture/ (sudo -E가 막힌 환경에서도 동작)
VLANS=("${!SVI_IP[@]}")

ipof() { echo "${HOST_IP[$1]%/*}"; }   # 주소에서 /prefix 제거

# 캡처 지점: 이름 → "namespace 인터페이스 설명"
declare -A CAP
for _h in "${HOSTS[@]}"; do
  CAP[$_h]="$_h eth0 ${_h} NIC (${HOST_SW[$_h]} ${HOST_PORT[$_h]}, Access VLAN ${HOST_VLAN[$_h]})"
done
for _s in "${L2_SWITCHES[@]}"; do
  CAP[trunk-$_s]="mls1 ${MLS_PORT[$_s]} MLS1 ${MLS_PORT[$_s]} ↔ ${_s^^} ${SW_UPLINK[$_s]} Trunk (802.1Q 태그 보임)"
done

say()  { printf '%s\n' "$*"; }
die()  { printf '[중단] %s\n' "$*" >&2; exit 1; }
need_root() { [[ $EUID -eq 0 ]] || die "root 권한이 필요합니다. sudo ./lab.sh $* 로 실행하세요."; }
nsx() { local ns=$1; shift; ip netns exec "$ns" "$@"; }
is_up() { ip netns list 2>/dev/null | grep -qw mls1; }
is_ready() { [[ -f $RUN_DIR/ready ]]; }   # up이 끝까지 성공했을 때만 생기는 파일

# ------------------------------------------------------------------ check
cmd_check() {
  need_root check
  local ok=1 c
  say "== 필요한 명령"
  for c in ip bridge dnsmasq python3 dig curl sysctl; do
    if command -v "$c" >/dev/null 2>&1; then say "  OK   $c"; else say "  없음 $c"; ok=0; fi
  done
  if command -v dumpcap >/dev/null 2>&1; then say "  OK   dumpcap (.pcapng로 저장)"
  elif command -v tcpdump >/dev/null 2>&1; then say "  OK   tcpdump (dumpcap이 없어 .pcap으로 저장됨)"
  else say "  없음 dumpcap/tcpdump"; ok=0; fi
  say "== 커널 기능 (임시 namespace로 시험 후 삭제)"
  local t="plchk$$"
  if ip netns add "$t" 2>/dev/null; then
    say "  OK   network namespace"
    ip -n "$t" link add name ta type veth peer name tb 2>/dev/null && say "  OK   veth" || { say "  실패 veth"; ok=0; }
    ip -n "$t" link add name br0 type bridge vlan_filtering 1 2>/dev/null && say "  OK   bridge vlan_filtering (802.1Q 스위치)" || { say "  실패 bridge vlan_filtering"; ok=0; }
    ip -n "$t" link add link br0 name v10 type vlan id 10 2>/dev/null && say "  OK   VLAN 인터페이스 (SVI 역할)" || { say "  실패 VLAN 인터페이스 (8021q)"; ok=0; }
    ip netns del "$t" 2>/dev/null || true
  else say "  실패 network namespace"; ok=0; fi
  say "== 토폴로지 값: $TOPOLOGY"
  say "   출처: $SPEC_SOURCE"
  if [[ $ok -eq 1 ]]; then say "결과: 이 환경에서 실습망을 만들 수 있습니다."
  else
    say "결과: 부족한 항목이 있습니다."
    say "  - 명령이 없으면: sudo apt update && sudo apt install -y iproute2 dnsmasq-base dnsutils curl tcpdump tshark"
    say "  - 커널 기능이 실패하면 이 환경에서는 불가합니다. 일반 Ubuntu VM(예: Mac의 Multipass)을 쓰세요."
    exit 1
  fi
}

# ------------------------------------------------------------------ build
mklink() { # mklink nsA ifA nsB ifB
  local ta="pl${RANDOM}a" tb="pl${RANDOM}b"
  ip link add name "$ta" type veth peer name "$tb"
  ip link set dev "$ta" netns "$1"; ip link set dev "$tb" netns "$3"
  ip -n "$1" link set dev "$ta" name "$2"; ip -n "$3" link set dev "$tb" name "$4"
  ip -n "$1" link set dev "$2" up; ip -n "$3" link set dev "$4" up
}
mkbridge() { ip -n "$1" link add name br0 type bridge vlan_filtering 1 stp_state 0; ip -n "$1" link set dev br0 up; }
access_port() { # ns port vid
  ip -n "$1" link set dev "$2" master br0
  nsx "$1" bridge vlan del dev "$2" vid 1 2>/dev/null || true
  nsx "$1" bridge vlan add dev "$2" vid "$3" pvid untagged
}
trunk_port() { # ns port vid...
  local ns=$1 port=$2; shift 2
  ip -n "$ns" link set dev "$port" master br0
  nsx "$ns" bridge vlan del dev "$port" vid 1 2>/dev/null || true
  local v; for v in "$@"; do nsx "$ns" bridge vlan add dev "$port" vid "$v"; done
}

start_services() {
  mkdir -p "$RUN_DIR/www"
  printf '<!doctype html><title>PacketLab</title><h1>PacketLab Web (재현 실습망)</h1>\n' > "$RUN_DIR/www/index.html"
  nsx srv dnsmasq --conf-file=/dev/null --no-resolv --no-hosts --bind-interfaces \
    --listen-address="$(ipof srv)" --address="/${DOMAIN}/$(ipof srv)" --pid-file="$RUN_DIR/dnsmasq.pid" --user=root
  nsx srv python3 -m http.server "$WEB_PORT" --bind "$(ipof srv)" --directory "$RUN_DIR/www" >/dev/null 2>&1 &
  echo $! > "$RUN_DIR/http.pid"
  sleep 0.5
}

cmd_up() {
  need_root up
  is_up && die "이미 실습망이 있습니다(중간에 실패한 것 포함). sudo ./lab.sh down 후 up 하세요."
  mkdir -p "$RUN_DIR"
  local ns h v
  for ns in "${ALL_NS[@]}"; do
    ip netns add "$ns"
    nsx "$ns" sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1 || true
    ip -n "$ns" link set dev lo up
  done
  for ns in "${SWITCHES[@]}"; do mkbridge "$ns"; done
  # 호스트 ↔ 스위치 (Access Port)
  for h in "${HOSTS[@]}"; do
    mklink "$h" eth0 "${HOST_SW[$h]}" "${HOST_PORT[$h]}"
    access_port "${HOST_SW[$h]}" "${HOST_PORT[$h]}" "${HOST_VLAN[$h]}"
  done
  # 스위치 ↔ MLS1 (Trunk)
  local sw
  for sw in "${L2_SWITCHES[@]}"; do
    mklink "$sw" "${SW_UPLINK[$sw]}" mls1 "${MLS_PORT[$sw]}"
    # shellcheck disable=SC2086
    trunk_port "$sw" "${SW_UPLINK[$sw]}" ${TRUNK_VLANS[$sw]}
    # shellcheck disable=SC2086
    trunk_port mls1 "${MLS_PORT[$sw]}" ${TRUNK_VLANS[$sw]}
  done
  # L3 스위치: 브리지 자신에 VLAN을 허용하고 VLAN 인터페이스(SVI)를 만든다
  for v in "${VLANS[@]}"; do
    nsx mls1 bridge vlan add dev br0 vid "$v" self
    ip -n mls1 link add link br0 name "vlan$v" type vlan id "$v"
    ip -n mls1 addr add "${SVI_IP[$v]}" dev "vlan$v"
    ip -n mls1 link set dev "vlan$v" up
  done
  nsx mls1 sysctl -qw net.ipv4.ip_forward=1
  # 호스트 주소·Gateway·DNS
  for h in "${HOSTS[@]}"; do
    ip -n "$h" addr add "${HOST_IP[$h]}" dev eth0
    ip -n "$h" route add default via "${HOST_GW[$h]}"
    mkdir -p "/etc/netns/$h"
    printf 'nameserver %s\n' "$DNS_SERVER" > "/etc/netns/$h/resolv.conf"
  done
  start_services
  date '+%F %T' > "$RUN_DIR/ready"
  say "실습망을 만들었습니다. 토폴로지 값 출처: $SPEC_SOURCE"
  say "캡처 지점: ${!CAP[*]}"
  say "다음: sudo ./lab.sh test all  으로 동작을 확인하세요."
}

cmd_down() {
  need_root down
  cmd_capture_stop all >/dev/null 2>&1 || true
  local f ns h
  for f in "$RUN_DIR"/dnsmasq.pid "$RUN_DIR"/http.pid; do [[ -f $f ]] && kill "$(cat "$f")" 2>/dev/null || true; done
  for ns in "${ALL_NS[@]}"; do
    ip netns pids "$ns" 2>/dev/null | xargs -r kill 2>/dev/null || true
    ip netns del "$ns" 2>/dev/null || true
  done
  for h in "${HOSTS[@]}"; do rm -rf "/etc/netns/$h"; done
  rm -rf "$RUN_DIR"
  say "실습망을 지웠습니다."
}

# ------------------------------------------------------------------ tests (PC1에서 실행)
run_test() {
  local name=$1 rc=0
  say "---- $(date '+%H:%M:%S') 테스트 $name"
  case "$name" in
    ping_pc2) nsx pc1 ping -c 4 -W 1 "$(ipof pc2)" || rc=$? ;;
    ping_gw)  nsx pc1 ping -c 4 -W 1 "${HOST_GW[pc1]}" || rc=$? ;;
    ping_pc3) nsx pc1 ping -c 4 -W 1 "$(ipof pc3)" || rc=$? ;;
    ping_srv) nsx pc1 ping -c 4 -W 1 "$(ipof srv)" || rc=$? ;;
    dns)      nsx pc1 dig +tries=3 +time=2 +nocookie "$DOMAIN" A || rc=$? ;;
    web)      nsx pc1 curl -sS -m 10 -o /dev/null -w 'HTTP %{http_code}\n' "http://$DOMAIN:$WEB_PORT/" || rc=$? ;;
    *) die "테스트 이름: ping_pc2 ping_gw ping_pc3 ping_srv dns web all" ;;
  esac
  say "---- $(date '+%H:%M:%S') 끝 (exit $rc)"
}
cmd_test() {
  need_root test
  is_up || die "실습망이 없습니다. sudo ./lab.sh up 먼저."
  is_ready || die "실습망이 완성되지 않았습니다 (up이 중간에 실패). sudo ./lab.sh down 후 up 하세요."
  local t=${1:-all}
  if [[ $t == all ]]; then
    local x; for x in ping_pc2 ping_gw ping_pc3 ping_srv dns web; do run_test "$x"; sleep 3; done
  else run_test "$t"; fi
}
cmd_flush() {
  need_root flush
  local ns; for ns in "${HOSTS[@]}" mls1; do ip -n "$ns" neigh flush all 2>/dev/null || true; done
  say "모든 호스트와 MLS1의 ARP 캐시를 비웠습니다. (이 실습망의 PC에는 DNS 캐시가 없습니다)"
}

# ------------------------------------------------------------------ capture
cmd_capture() {
  need_root capture
  local sub=${1:-}; shift || true
  case "$sub" in
    start) cmd_capture_start "$@" ;;
    stop)  cmd_capture_stop "${1:-all}" ;;
    list)  local k; for k in "${!CAP[@]}"; do say "  $k : ${CAP[$k]#* * }"; done ;;
    *) die "사용법: sudo ./lab.sh capture <start 지점 파일이름|stop [지점|all]|list>" ;;
  esac
}
cmd_capture_start() {
  local point=${1:-} file=${2:-}
  [[ -n $point && -n $file ]] || die "사용법: sudo ./lab.sh capture start <지점> <파일이름.pcapng>"
  [[ -n ${CAP[$point]:-} ]] || die "지점 이름: ${!CAP[*]}"
  is_ready || die "실습망이 없거나 완성되지 않았습니다."
  [[ $file == */* ]] || file="$OUT_DIR/$file"
  [[ -e $file ]] && die "$file 이 이미 있습니다. 다른 이름을 쓰거나 지우세요."
  local ns ifc; read -r ns ifc _ <<<"${CAP[$point]}"
  local pidf="$RUN_DIR/cap_${point}.pid"
  [[ -f $pidf ]] && die "$point 에서 이미 캡처 중입니다."
  local log="$RUN_DIR/cap_${point}.log"
  # - 함수(nsx)가 아니라 명령을 직접 백그라운드로 실행해야 $!가 캡처 프로그램 자신의 PID가 된다.
  # - dumpcap은 sudo로 실행해도 스스로 권한을 내려놓고 파일을 열어 "Permission denied"가 날 수 있다.
  #   그래서 캡처 데이터는 표준 출력(-w -)으로 받고, 파일은 이 스크립트(root)가 연다.
  if command -v dumpcap >/dev/null 2>&1; then
    ip netns exec "$ns" dumpcap -q -i "$ifc" -w - >"$file" 2>"$log" &
  else
    [[ $file == *.pcapng ]] && say "dumpcap이 없어 pcap 형식으로 저장합니다. 파일 이름을 .pcap으로 바꾸는 것을 권합니다."
    ip netns exec "$ns" tcpdump -U -i "$ifc" -w - >"$file" 2>"$log" &
  fi
  local pid=$!
  echo "$pid $file" > "$pidf"
  sleep 1.5
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pidf"; [[ -s $file ]] || rm -f "$file"
    say "[실패] 캡처가 시작되지 않았습니다: $point → $file"
    say "---- 캡처 프로그램 출력 ($log)"; cat "$log" 2>/dev/null || true
    die "위 오류를 확인하세요."
  fi
  say "캡처 시작 $(date '+%H:%M:%S'): $point → $file (PID $pid)"
  say "캡처 지점 설명: ${CAP[$point]#* * }"
}
cmd_capture_stop() {
  local which=$1 f
  for f in "$RUN_DIR"/cap_*.pid; do
    [[ -e $f ]] || continue
    local p=${f##*/cap_}; p=${p%.pid}
    [[ $which == all || $which == "$p" ]] || continue
    local pid file; read -r pid file <"$f"
    kill -TERM "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -0 "$pid" 2>/dev/null && { kill -KILL "$pid" 2>/dev/null || true; say "[경고] $p 캡처가 제때 끝나지 않아 강제 종료했습니다. 파일 끝이 잘렸을 수 있습니다."; }
    rm -f "$f"
    if [[ ! -s $file ]]; then
      say "[실패] $p 캡처 파일이 없거나 비어 있습니다: $file"
      say "---- 캡처 프로그램 출력 ($RUN_DIR/cap_${p}.log)"; cat "$RUN_DIR/cap_${p}.log" 2>/dev/null || true
      continue
    fi
    if [[ -n ${SUDO_USER:-} ]]; then chown "$SUDO_USER" "$file" 2>/dev/null || true; fi
    local n="?"; command -v capinfos >/dev/null 2>&1 && n=$(capinfos -Mc "$file" 2>/dev/null | awk -F': *' '/Number of packets/{print $2}')
    say "캡처 종료 $(date '+%H:%M:%S'): $p → $file ($(stat -c %s "$file") bytes, 패킷 ${n}개)"
  done
}

# ------------------------------------------------------------------ status (관찰만)
cmd_status() {
  need_root status
  is_up || { say "실습망 없음"; return 0; }
  say "== 토폴로지 값 출처: $SPEC_SOURCE"
  say "== [ipconfig 대응] PC1 주소·라우팅·DNS"
  ip -n pc1 -br addr show dev eth0; ip -n pc1 route; cat /etc/netns/pc1/resolv.conf
  local sw
  for sw in "${L2_SWITCHES[@]}"; do
    say "== [show vlan brief 대응] ${sw^^} 포트별 VLAN (PVID = Access VLAN)"
    nsx "$sw" bridge vlan show
  done
  say "== [show interfaces trunk 대응] MLS1 포트별 허용 VLAN (gi0_1=SW1, gi0_2=SW2)"
  nsx mls1 bridge vlan show
  say "== [show ip interface brief 대응] MLS1 SVI"
  ip -n mls1 -br addr show type vlan
  say "== Server 서비스 (LISTEN 중인 포트)"
  nsx srv ss -ltnu 2>/dev/null || true
  local f; for f in "$RUN_DIR"/cap_*.pid; do [[ -e $f ]] && say "캡처 중: ${f##*/}"; done
  return 0
}

cmd_help() {
  cat <<EOF
Packet.AI 2번 캡처용 재현 실습망 (Linux network namespace)
토폴로지 값: $TOPOLOGY  ($SPEC_SOURCE)

  sudo ./lab.sh check                   이 환경에서 실습망을 만들 수 있는지 점검
  sudo ./lab.sh up | down               실습망 만들기 / 지우기 (up 직후는 모든 ARP 캐시가 비어 있음)
  sudo ./lab.sh status                  현재 설정 관찰 (IOS show 명령에 대응)
  sudo ./lab.sh test <이름|all>         PC1에서 테스트: ping_pc2 ping_gw ping_pc3 ping_srv dns web
  sudo ./lab.sh flush                   ARP 캐시 비우기
  sudo ./lab.sh capture list            캡처 지점 목록
  sudo ./lab.sh capture start <지점> <파일>
  sudo ./lab.sh capture stop [지점|all]

장애 적용과 복구는 4번(SRE) 담당이라 이 스크립트에는 없습니다.
저장 위치: $OUT_DIR (기본값: lab_env의 상위 폴더 = 02_packet_capture/)
EOF
}

main() {
  local cmd=${1:-help}; shift || true
  case "$cmd" in
    check) cmd_check ;; up) cmd_up ;; down) cmd_down ;; status) cmd_status ;;
    test) cmd_test "$@" ;; flush) cmd_flush ;; capture) cmd_capture "$@" ;;
    help|-h|--help) cmd_help ;;
    *) die "알 수 없는 명령: $cmd (./lab.sh help)" ;;
  esac
}
main "$@"
