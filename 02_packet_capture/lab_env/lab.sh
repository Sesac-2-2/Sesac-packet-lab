#!/usr/bin/env bash
# Packet.AI 2번 Packet Analyst — 별도 재현 실습망 (Linux network namespace)
#
# 과제 네트워크(VLAN 10/20, L2 스위치 2대, L3 스위치 SVI, DNS/Web 서버)를
# Linux VM 한 대(또는 WSL2) 안에 만들고, 장애를 번호로 켜고 끄고, 원하는 링크에서 캡처한다.
#
# 주의
#  - 이 트래픽은 "별도 환경에서 재현한 트래픽"이다. Packet Tracer 내부 트래픽이 아니다.
#  - 모든 장비는 network namespace 안에 만든다. 호스트(VM/WSL)의 기존 네트워크 설정은 바꾸지 않는다.
#  - 장애 스위치는 2번의 캡처 연습·재현용이다. 팀 실제 사례의 장애 주입과 case_id 매핑은 4번(SRE) 담당이다.
#
# 사용법: sudo ./lab.sh <명령> ...   (도움말: ./lab.sh help)
set -euo pipefail

DOMAIN="web.packetlab.example"
HOSTS=(pc1 pc2 pc3 pc4 srv)
SWITCHES=(swa swb l3)
ALL_NS=("${HOSTS[@]}" "${SWITCHES[@]}")
RUN_DIR="/run/packetlab"
OUT_DIR="${OUT_DIR:-$PWD}"

declare -A IP=([pc1]=192.168.10.10 [pc2]=192.168.10.11 [pc3]=192.168.20.10 [pc4]=192.168.20.11 [srv]=192.168.20.100)
declare -A GW=([pc1]=192.168.10.1 [pc2]=192.168.10.1 [pc3]=192.168.20.1 [pc4]=192.168.20.1 [srv]=192.168.20.1)

# 캡처 지점: 이름 → "namespace 인터페이스 설명"
declare -A CAP=(
  [pc1]="pc1 eth0 PC1 NIC (SW-A p1, Access VLAN 10)"
  [pc2]="pc2 eth0 PC2 NIC (SW-B p1, Access VLAN 10)"
  [pc3]="pc3 eth0 PC3 NIC (SW-A p2, Access VLAN 20)"
  [pc4]="pc4 eth0 PC4 NIC (SW-B p2, Access VLAN 20)"
  [srv]="srv eth0 Server NIC (SW-B p24, Access VLAN 20)"
  [trunk-a]="l3 ga L3SW↔SW-A Trunk (802.1Q 태그 보임)"
  [trunk-b]="l3 gb L3SW↔SW-B Trunk (802.1Q 태그 보임)"
)

FAULT_NAMES=(
  ""
  "PC1 Default Gateway = 192.168.10.254"
  "SW-A p1(PC1 포트) Access VLAN = 20"
  "L3SW↔SW-B Trunk에서 VLAN 20 제거"
  "L3SW SVI vlan10 down"
  "PC1 DNS 서버 = 192.168.20.53"
  "PC1 Subnet Mask = /16"
  "Server Web 서비스 중지 (TCP 80 → RST)"
  "Server TCP 80 패킷 폐기 (응답 없음)"
  "Server DNS 서비스 중지"
)

say()  { printf '%s\n' "$*"; }
die()  { printf '[중단] %s\n' "$*" >&2; exit 1; }
need_root() { [[ $EUID -eq 0 ]] || die "root 권한이 필요합니다. sudo ./lab.sh $* 로 실행하세요."; }
nsx() { local ns=$1; shift; ip netns exec "$ns" "$@"; }
is_up() { ip netns list 2>/dev/null | grep -qw l3; }

# ------------------------------------------------------------------ check
cmd_check() {
  need_root check
  local ok=1 c
  say "== 필요한 명령"
  for c in ip bridge dnsmasq python3 dig curl iptables sysctl; do
    if command -v "$c" >/dev/null 2>&1; then say "  OK   $c"; else say "  없음 $c"; ok=0; fi
  done
  if command -v dumpcap >/dev/null 2>&1; then say "  OK   dumpcap (.pcapng로 저장)"
  elif command -v tcpdump >/dev/null 2>&1; then say "  OK   tcpdump (dumpcap이 없어 .pcap으로 저장됨)"
  else say "  없음 dumpcap/tcpdump"; ok=0; fi
  say "== 커널 기능 (임시 namespace로 시험 후 삭제)"
  local t="plchk$$" f=0
  ip netns add "$t" 2>/dev/null && say "  OK   network namespace" || { say "  실패 network namespace"; ok=0; f=1; }
  if [[ $f -eq 0 ]]; then
    ip -n "$t" link add name ta type veth peer name tb 2>/dev/null && say "  OK   veth" || { say "  실패 veth"; ok=0; }
    ip -n "$t" link add name br0 type bridge vlan_filtering 1 2>/dev/null && say "  OK   bridge vlan_filtering (802.1Q 스위치)" || { say "  실패 bridge vlan_filtering"; ok=0; }
    ip -n "$t" link add link br0 name v10 type vlan id 10 2>/dev/null && say "  OK   VLAN 인터페이스 (SVI 역할)" || { say "  실패 VLAN 인터페이스 (8021q)"; ok=0; }
    nsx "$t" iptables -L -n >/dev/null 2>&1 && say "  OK   iptables (장애 8번에 필요)" || say "  경고 iptables 사용 불가 → 장애 8번만 쓸 수 없음"
    ip netns del "$t" 2>/dev/null || true
  fi
  if [[ $ok -eq 1 ]]; then say "결과: 이 환경에서 실습망을 만들 수 있습니다."
  else
    say "결과: 부족한 항목이 있습니다."
    say "  - 명령이 없으면: sudo apt update && sudo apt install -y iproute2 dnsmasq-base dnsutils curl iptables tcpdump tshark"
    say "  - 커널 기능이 실패하면 이 환경(예: WSL2 커널)에서는 불가합니다. Mac의 Multipass Ubuntu 같은 일반 Ubuntu VM을 쓰세요."
    return 1
  fi
}

# ------------------------------------------------------------------ build
mklink() { # mklink nsA ifA nsB ifB
  local ta="pl${RANDOM}a" tb="pl${RANDOM}b"
  ip link add name "$ta" type veth peer name "$tb"
  ip link set "$ta" netns "$1"; ip link set "$tb" netns "$3"
  ip -n "$1" link set "$ta" name "$2"; ip -n "$3" link set "$tb" name "$4"
  ip -n "$1" link set "$2" up; ip -n "$3" link set "$4" up
}
mkbridge() { ip -n "$1" link add name br0 type bridge vlan_filtering 1 stp_state 0; ip -n "$1" link set br0 up; }
access_port() { # ns port vid
  ip -n "$1" link set "$2" master br0
  nsx "$1" bridge vlan del dev "$2" vid 1 2>/dev/null || true
  nsx "$1" bridge vlan add dev "$2" vid "$3" pvid untagged
}
trunk_port() { # ns port vid...
  local ns=$1 port=$2; shift 2
  ip -n "$ns" link set "$port" master br0
  nsx "$ns" bridge vlan del dev "$port" vid 1 2>/dev/null || true
  local v; for v in "$@"; do nsx "$ns" bridge vlan add dev "$port" vid "$v"; done
}

start_services() {
  mkdir -p "$RUN_DIR/www"
  printf '<!doctype html><title>PacketLab</title><h1>PacketLab Web (재현 실습망)</h1>\n' > "$RUN_DIR/www/index.html"
  nsx srv dnsmasq --conf-file=/dev/null --no-resolv --no-hosts --bind-interfaces \
    --listen-address="${IP[srv]}" --address="/${DOMAIN}/${IP[srv]}" --pid-file="$RUN_DIR/dnsmasq.pid" --user=root
  nsx srv python3 -m http.server 80 --bind "${IP[srv]}" --directory "$RUN_DIR/www" >/dev/null 2>&1 &
  echo $! > "$RUN_DIR/http.pid"
  sleep 0.5
}

cmd_up() {
  need_root up
  is_up && die "이미 실습망이 있습니다. 다시 만들려면 sudo ./lab.sh down 후 up 하세요."
  mkdir -p "$RUN_DIR"
  local ns h
  for ns in "${ALL_NS[@]}"; do
    ip netns add "$ns"
    nsx "$ns" sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1 || true
    ip -n "$ns" link set lo up
  done
  for ns in "${SWITCHES[@]}"; do mkbridge "$ns"; done
  # 케이블
  mklink pc1 eth0 swa p1; mklink pc3 eth0 swa p2
  mklink pc2 eth0 swb p1; mklink pc4 eth0 swb p2; mklink srv eth0 swb p24
  mklink swa up l3 ga;    mklink swb up l3 gb
  # Access / Trunk
  access_port swa p1 10; access_port swa p2 20
  access_port swb p1 10; access_port swb p2 20; access_port swb p24 20
  trunk_port swa up 10 20; trunk_port swb up 10 20
  trunk_port l3 ga 10 20;  trunk_port l3 gb 10 20
  # L3 스위치: 브리지 자신에 VLAN을 허용하고 VLAN 인터페이스(SVI)를 만든다
  nsx l3 bridge vlan add dev br0 vid 10 self
  nsx l3 bridge vlan add dev br0 vid 20 self
  ip -n l3 link add link br0 name vlan10 type vlan id 10
  ip -n l3 link add link br0 name vlan20 type vlan id 20
  ip -n l3 addr add 192.168.10.1/24 dev vlan10; ip -n l3 addr add 192.168.20.1/24 dev vlan20
  ip -n l3 link set vlan10 up; ip -n l3 link set vlan20 up
  nsx l3 sysctl -qw net.ipv4.ip_forward=1
  # 호스트
  for h in "${HOSTS[@]}"; do
    ip -n "$h" addr add "${IP[$h]}/24" dev eth0
    ip -n "$h" route add default via "${GW[$h]}"
    mkdir -p "/etc/netns/$h"
    printf 'nameserver %s\n' "${IP[srv]}" > "/etc/netns/$h/resolv.conf"
  done
  start_services
  echo 0 > "$RUN_DIR/fault"
  say "실습망을 만들었습니다 (정상 상태). 캡처 지점: ${!CAP[*]}"
  say "다음: sudo ./lab.sh test all  으로 정상 동작을 확인하세요."
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
  local keep="$RUN_DIR/.blind_answer"; local ans=""
  [[ -f $keep ]] && ans=$(cat "$keep")
  rm -rf "$RUN_DIR"
  if [[ -n $ans && ${1:-} == "--keep-blind" ]]; then mkdir -p "$RUN_DIR"; echo "$ans" > "$keep"; chmod 600 "$keep"; fi
  say "실습망을 지웠습니다."
}

# ------------------------------------------------------------------ faults
apply_fault() {
  case "$1" in
    1) ip -n pc1 route replace default via 192.168.10.254 ;;
    2) nsx swa bridge vlan del dev p1 vid 10; nsx swa bridge vlan add dev p1 vid 20 pvid untagged ;;
    3) nsx l3 bridge vlan del dev gb vid 20 ;;
    4) ip -n l3 link set vlan10 down ;;
    5) printf 'nameserver 192.168.20.53\n' > /etc/netns/pc1/resolv.conf ;;
    6) ip -n pc1 addr flush dev eth0; ip -n pc1 addr add 192.168.10.10/16 dev eth0; ip -n pc1 route replace default via 192.168.10.1 ;;
    7) kill "$(cat "$RUN_DIR/http.pid")" ;;
    8) nsx srv iptables -A INPUT -p tcp --dport 80 -j DROP ;;
    9) kill "$(cat "$RUN_DIR/dnsmasq.pid")" ;;
    *) die "장애 번호는 1~9 입니다." ;;
  esac
}
cmd_fault() {
  need_root fault
  local arg=${1:-}
  case "$arg" in
    list) local i; for i in $(seq 1 9); do say "  $i) ${FAULT_NAMES[$i]}"; done ;;
    clear)
      cmd_down --keep-blind >/dev/null; cmd_up >/dev/null
      say "정상 상태로 되돌렸습니다 (실습망을 다시 만들었으므로 모든 ARP 캐시도 비었습니다)." ;;
    random)
      local n=$(( RANDOM % 9 + 1 ))
      cmd_down >/dev/null; cmd_up >/dev/null; apply_fault "$n"
      echo "$n" > "$RUN_DIR/.blind_answer"; chmod 600 "$RUN_DIR/.blind_answer"; echo "blind" > "$RUN_DIR/fault"
      say "장애 하나를 적용했습니다 (번호 비공개). 분석을 마친 뒤 sudo ./lab.sh fault reveal 로 확인하세요."
      say "주의: 같은 기기에 답이 저장되므로 완전한 Blind가 아닙니다. 진짜 Blind 연습은 다른 사람이 적용해야 합니다." ;;
    reveal)
      [[ -f $RUN_DIR/.blind_answer ]] || die "공개할 Blind 답이 없습니다."
      local n; n=$(cat "$RUN_DIR/.blind_answer"); say "적용된 장애: $n) ${FAULT_NAMES[$n]}" ;;
    [1-9])
      cmd_down >/dev/null; cmd_up >/dev/null; apply_fault "$arg"; echo "$arg" > "$RUN_DIR/fault"
      say "장애 $arg 적용: ${FAULT_NAMES[$arg]} (다른 장애는 없음, ARP 캐시 비어 있음)" ;;
    *) die "사용법: sudo ./lab.sh fault <1-9|list|clear|random|reveal>" ;;
  esac
}

# ------------------------------------------------------------------ tests
run_test() {
  local name=$1 rc=0
  say "---- $(date '+%H:%M:%S') 테스트 $name"
  case "$name" in
    ping_pc2) nsx pc1 ping -c 4 -W 1 192.168.10.11 || rc=$? ;;
    ping_gw)  nsx pc1 ping -c 4 -W 1 192.168.10.1 || rc=$? ;;
    ping_pc3) nsx pc1 ping -c 4 -W 1 192.168.20.10 || rc=$? ;;
    ping_srv) nsx pc1 ping -c 4 -W 1 "${IP[srv]}" || rc=$? ;;
    dns)      nsx pc1 dig +tries=3 +time=2 +nocookie "$DOMAIN" A || rc=$? ;;
    web)      nsx pc1 curl -sS -m 10 -o /dev/null -w 'HTTP %{http_code}\n' "http://$DOMAIN/" || rc=$? ;;
    *) die "테스트 이름: ping_pc2 ping_gw ping_pc3 ping_srv dns web all" ;;
  esac
  say "---- $(date '+%H:%M:%S') 끝 (exit $rc)"
}
cmd_test() {
  need_root test
  is_up || die "실습망이 없습니다. sudo ./lab.sh up 먼저."
  local t=${1:-all}
  if [[ $t == all ]]; then
    local x; for x in ping_pc2 ping_gw ping_pc3 ping_srv dns web; do run_test "$x"; sleep 3; done
  else run_test "$t"; fi
}
cmd_flush() {
  need_root flush
  local ns; for ns in "${HOSTS[@]}" l3; do ip -n "$ns" neigh flush all 2>/dev/null || true; done
  say "모든 호스트와 L3SW의 ARP 캐시를 비웠습니다. (이 실습망의 PC에는 DNS 캐시가 없습니다)"
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
  is_up || die "실습망이 없습니다."
  [[ $file == */* ]] || file="$OUT_DIR/$file"
  [[ -e $file ]] && die "$file 이 이미 있습니다. 다른 이름을 쓰거나 지우세요."
  local ns ifc; read -r ns ifc _ <<<"${CAP[$point]}"
  local pidf="$RUN_DIR/cap_${point}.pid"
  [[ -f $pidf ]] && die "$point 에서 이미 캡처 중입니다."
  if command -v dumpcap >/dev/null 2>&1; then
    nsx "$ns" dumpcap -q -i "$ifc" -w "$file" >/dev/null 2>&1 &
  else
    [[ $file == *.pcapng ]] && say "dumpcap이 없어 pcap 형식으로 저장합니다. 파일 이름을 .pcap으로 바꾸는 것을 권합니다."
    nsx "$ns" tcpdump -q -U -i "$ifc" -w "$file" >/dev/null 2>&1 &
  fi
  echo "$! $file" > "$pidf"
  sleep 1
  say "캡처 시작 $(date '+%H:%M:%S'): $point → $file"
  say "캡처 지점 설명: ${CAP[$point]#* * }"
}
cmd_capture_stop() {
  local which=$1 f
  for f in "$RUN_DIR"/cap_*.pid; do
    [[ -e $f ]] || continue
    local p=${f##*/cap_}; p=${p%.pid}
    [[ $which == all || $which == "$p" ]] || continue
    local pid file; read -r pid file <"$f"
    kill -INT "$pid" 2>/dev/null || true; sleep 1
    rm -f "$f"
    if [[ -n ${SUDO_USER:-} && -f $file ]]; then chown "$SUDO_USER" "$file" 2>/dev/null || true; fi
    say "캡처 종료 $(date '+%H:%M:%S'): $p → $file"
  done
}

# ------------------------------------------------------------------ status
cmd_status() {
  need_root status
  is_up || { say "실습망 없음"; return 0; }
  local fault; fault=$(cat "$RUN_DIR/fault" 2>/dev/null || echo "?")
  say "== 적용된 장애: $([[ $fault == blind ]] && echo '비공개 (Blind)' || { [[ $fault == 0 ]] && echo '없음 (정상)' || echo "$fault"; })"
  say "== [ipconfig 대응] PC1 주소·라우팅·DNS"
  ip -n pc1 -br addr show dev eth0; ip -n pc1 route; cat /etc/netns/pc1/resolv.conf
  say "== [show vlan brief 대응] SW-A 포트별 VLAN (PVID = Access VLAN)"
  nsx swa bridge vlan show
  say "== [show interfaces trunk 대응] L3SW 포트별 허용 VLAN (ga=SW-A, gb=SW-B)"
  nsx l3 bridge vlan show
  say "== [show ip interface brief 대응] L3SW SVI"
  ip -n l3 -br addr show type vlan
  say "== Server 서비스 (LISTEN 중인 포트)"
  nsx srv ss -ltnu 2>/dev/null || true
  local f; for f in "$RUN_DIR"/cap_*.pid; do [[ -e $f ]] && say "캡처 중: ${f##*/}"; done
  return 0
}

cmd_help() {
  cat <<EOF
Packet.AI 2번 재현 실습망 (Linux network namespace)

  sudo ./lab.sh check                   이 환경에서 실습망을 만들 수 있는지 점검
  sudo ./lab.sh up | down               실습망 만들기 / 지우기
  sudo ./lab.sh status                  현재 설정 보기 (IOS show 명령에 대응)
  sudo ./lab.sh test <이름|all>         PC1에서 테스트: ping_pc2 ping_gw ping_pc3 ping_srv dns web
  sudo ./lab.sh flush                   ARP 캐시 비우기
  sudo ./lab.sh capture list            캡처 지점 목록
  sudo ./lab.sh capture start <지점> <파일>
  sudo ./lab.sh capture stop [지점|all]
  sudo ./lab.sh fault list              장애 목록 (1~9)
  sudo ./lab.sh fault <번호>            정상으로 다시 만든 뒤 장애 하나 적용
  sudo ./lab.sh fault clear             정상으로 되돌리기
  sudo ./lab.sh fault random | reveal   번호를 숨긴 장애 적용 / 분석 후 공개

저장 위치: OUT_DIR 환경변수 (기본값: 현재 폴더)
EOF
}

main() {
  local cmd=${1:-help}; shift || true
  case "$cmd" in
    check) cmd_check ;; up) cmd_up ;; down) cmd_down ;; status) cmd_status ;;
    test) cmd_test "$@" ;; flush) cmd_flush ;; capture) cmd_capture "$@" ;; fault) cmd_fault "$@" ;;
    help|-h|--help) cmd_help ;;
    *) die "알 수 없는 명령: $cmd (./lab.sh help)" ;;
  esac
}
main "$@"
