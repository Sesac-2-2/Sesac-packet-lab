#!/usr/bin/env bash
# Packet.AI 4번 Network SRE — 재현 실습망 장애 적용·복구 도구
#
# 02_packet_capture/lab_env/lab.sh 가 만든 재현 실습망(Linux network namespace)에 장애를 한 번에 하나씩 적용하고 되돌린다.
#  - lab.sh는 2번의 캡처 도구라 장애 기능이 없다(역할 경계). 장애 적용·복구는 이 스크립트(4번)가 맡는다.
#  - 토폴로지 값은 lab.sh와 같은 topology.conf(1번 명세 반영)를 읽는다. 값을 여기서 따로 정하지 않는다.
#  - Blind 유지: apply는 원인을 출력하지 않는다. 정답은 저장소 밖($KEY_DIR, root 전용)에 저장하고
#    reveal 명령으로만 공개한다. 정답은 packet_summary JSON이나 AI 입력에 넣지 않는다.
#  - 한계: 같은 사람이 root 권한으로 $KEY_DIR를 열어 보면 정답을 볼 수 있다. 보안 장치가 아니라 절차 장치다.
#
# 사용법: sudo ./fault.sh <명령> ...   (도움말: ./fault.sh help)
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR="${LAB_DIR:-$HERE/../02_packet_capture/lab_env}"
TOPOLOGY="${TOPOLOGY:-$LAB_DIR/topology.conf}"
[[ -f $TOPOLOGY ]] || { echo "[중단] 토폴로지 파일이 없습니다: $TOPOLOGY" >&2; exit 1; }
# shellcheck source=../02_packet_capture/lab_env/topology.conf
source "$TOPOLOGY"

RUN_DIR="/run/packetlab"                              # lab.sh가 쓰는 실행 폴더 (http.pid, www/)
KEY_DIR="${KEY_DIR:-/root/.packetlab_faults}"         # 정답 보관 폴더. 저장소 밖, root 전용. lab.sh down으로 지워지지 않음
DRY_RUN="${DRY_RUN:-0}"                               # 1이면 명령을 실행하지 않고 출력만 (실습망 없이 점검용)

# 장애 대상은 PC1 — 2번의 테스트 6종이 모두 PC1에서 시작하기 때문 (handoff_to_4_sre.md 7절)
TARGET_HOST=pc1

# ---- 4번이 정한 장애 값 (1번 명세에 없는 값. 바꾸려면 여기만 수정) ----
WRONG_GW=192.168.10.254      # VLAN10 대역 안이지만 아무 장비도 쓰지 않는 주소
WRONG_DNS=192.168.20.99      # VLAN20 대역 안이지만 아무 장비도 쓰지 않는 주소
WRONG_PREFIX=16              # 정상 /24 → /16 (255.255.0.0). 192.168.20.x를 같은 Subnet으로 오판하게 됨
WRONG_ACCESS_VLAN=20         # PC1 포트(SW1 Fa0/1)의 Access VLAN 10 → 20
MISSING_TRUNK_VLAN=10        # SW1 Gi0/1 Trunk 허용 목록에서 뺄 VLAN
DOWN_SVI_VLAN=10             # 내릴 SVI (MLS1 Vlan10)

SCENARIOS=(gateway access_vlan trunk_vlan svi_down dns_server subnet_mask web_port)
declare -A SCENARIO_KO=(
  [gateway]="Default Gateway 오류"
  [access_vlan]="Access VLAN 오류"
  [trunk_vlan]="Trunk 허용 VLAN 누락"
  [svi_down]="SVI Down"
  [dns_server]="DNS Server 설정 오류"
  [subnet_mask]="Subnet Mask 오류"
  [web_port]="Server TCP Port 서비스 중단"
)
declare -A SCENARIO_DETAIL=(
  [gateway]="PC1 Default Gateway ${HOST_GW[$TARGET_HOST]} → $WRONG_GW"
  [access_vlan]="SW1 ${HOST_PORT[$TARGET_HOST]} (PC1) Access VLAN ${HOST_VLAN[$TARGET_HOST]} → $WRONG_ACCESS_VLAN"
  [trunk_vlan]="SW1 ${SW_UPLINK[sw1]} Trunk 허용 VLAN에서 $MISSING_TRUNK_VLAN 제거"
  [svi_down]="MLS1 vlan$DOWN_SVI_VLAN (SVI ${SVI_IP[$DOWN_SVI_VLAN]}) shutdown"
  [dns_server]="PC1 DNS Server $DNS_SERVER → $WRONG_DNS"
  [subnet_mask]="PC1 ${HOST_IP[$TARGET_HOST]} → ${HOST_IP[$TARGET_HOST]%/*}/$WRONG_PREFIX"
  [web_port]="Server ${HOST_IP[srv]%/*} TCP/$WEB_PORT 웹 서비스(python http.server) 중지"
)

say() { printf '%s\n' "$*"; }
die() { printf '[중단] %s\n' "$*" >&2; exit 1; }
need_root() { [[ $DRY_RUN == 1 || $EUID -eq 0 ]] || die "root 권한이 필요합니다. sudo ./fault.sh ... 로 실행하세요."; }
run() { if [[ $DRY_RUN == 1 ]]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi; }
nsx() { local ns=$1; shift; run ip netns exec "$ns" "$@"; }
lab_ready() { [[ $DRY_RUN == 1 ]] || { ip netns list 2>/dev/null | grep -qw mls1 && [[ -f $RUN_DIR/ready ]]; }; }
now() { date '+%F %T'; }

# case_id 규칙은 2번 summarize_pcap.py validate와 같게 맞춘다 (handoff_to_4_sre.md 3절)
check_case_id() {
  local id=$1
  [[ $id =~ ^FAULT-[0-9]{2}$ ]] || die "case_id 형식: FAULT-01, FAULT-02 … (입력: $id)"
}
key_file() { echo "$KEY_DIR/$1.env"; }
kv() { # kv 파일 키 → 값
  local line; line=$(grep -m1 "^$2=" "$1" 2>/dev/null) || return 1; echo "${line#*=}"
}
set_kv() { # set_kv 파일 키 값
  local f=$1 k=$2 v=$3
  if grep -q "^$k=" "$f"; then sed -i "s|^$k=.*|$k=$v|" "$f"; else printf '%s=%s\n' "$k" "$v" >> "$f"; fi
}
active_case() { # 복구되지 않은 사례 1개 (없으면 빈 문자열)
  local f; for f in "$KEY_DIR"/FAULT-*.env; do
    [[ -e $f ]] || continue
    [[ -z $(kv "$f" RECOVERED_AT || true) ]] && { basename "$f" .env; return 0; }
  done
  return 0
}
used_scenarios() { local f; for f in "$KEY_DIR"/FAULT-*.env; do [[ -e $f ]] && kv "$f" SCENARIO; done; return 0; }

# ------------------------------------------------------------------ 장애 적용 / 되돌리기
apply_scenario() {
  local h=$TARGET_HOST
  case "$1" in
    gateway)     run ip -n "$h" route replace default via "$WRONG_GW" ;;
    access_vlan) nsx "${HOST_SW[$h]}" bridge vlan del dev "${HOST_PORT[$h]}" vid "${HOST_VLAN[$h]}"
                 nsx "${HOST_SW[$h]}" bridge vlan add dev "${HOST_PORT[$h]}" vid "$WRONG_ACCESS_VLAN" pvid untagged ;;
    trunk_vlan)  nsx sw1 bridge vlan del dev "${SW_UPLINK[sw1]}" vid "$MISSING_TRUNK_VLAN" ;;
    svi_down)    run ip -n mls1 link set dev "vlan$DOWN_SVI_VLAN" down ;;
    dns_server)  if [[ $DRY_RUN == 1 ]]; then say "[dry-run] resolv.conf(pc1) ← nameserver $WRONG_DNS"
                 else printf 'nameserver %s\n' "$WRONG_DNS" > "/etc/netns/$h/resolv.conf"; fi ;;
    subnet_mask) run ip -n "$h" addr del "${HOST_IP[$h]}" dev eth0
                 run ip -n "$h" addr add "${HOST_IP[$h]%/*}/$WRONG_PREFIX" dev eth0
                 run ip -n "$h" route replace default via "${HOST_GW[$h]}" ;;   # 주소를 지우면 기본 경로도 사라지므로 다시 넣음
    web_port)    stop_web ;;
    *) die "알 수 없는 시나리오: $1" ;;
  esac
}
revert_scenario() {
  local h=$TARGET_HOST
  case "$1" in
    gateway)     run ip -n "$h" route replace default via "${HOST_GW[$h]}" ;;
    access_vlan) nsx "${HOST_SW[$h]}" bridge vlan del dev "${HOST_PORT[$h]}" vid "$WRONG_ACCESS_VLAN"
                 nsx "${HOST_SW[$h]}" bridge vlan add dev "${HOST_PORT[$h]}" vid "${HOST_VLAN[$h]}" pvid untagged ;;
    trunk_vlan)  nsx sw1 bridge vlan add dev "${SW_UPLINK[sw1]}" vid "$MISSING_TRUNK_VLAN" ;;
    svi_down)    run ip -n mls1 link set dev "vlan$DOWN_SVI_VLAN" up ;;
    dns_server)  if [[ $DRY_RUN == 1 ]]; then say "[dry-run] resolv.conf(pc1) ← nameserver $DNS_SERVER"
                 else printf 'nameserver %s\n' "$DNS_SERVER" > "/etc/netns/$h/resolv.conf"; fi ;;
    subnet_mask) run ip -n "$h" addr del "${HOST_IP[$h]%/*}/$WRONG_PREFIX" dev eth0
                 run ip -n "$h" addr add "${HOST_IP[$h]}" dev eth0
                 run ip -n "$h" route replace default via "${HOST_GW[$h]}" ;;
    web_port)    start_web ;;
    *) die "알 수 없는 시나리오: $1" ;;
  esac
}
stop_web() {
  if [[ $DRY_RUN == 1 ]]; then say "[dry-run] kill \$(cat $RUN_DIR/http.pid)"; return; fi
  [[ -f $RUN_DIR/http.pid ]] || die "웹 서비스 PID 파일이 없습니다: $RUN_DIR/http.pid"
  kill "$(cat "$RUN_DIR/http.pid")" 2>/dev/null || true
}
start_web() { # lab.sh start_services의 웹 부분과 같은 명령
  if [[ $DRY_RUN == 1 ]]; then say "[dry-run] srv: python3 -m http.server $WEB_PORT --bind ${HOST_IP[srv]%/*}"; return; fi
  ip netns exec srv python3 -m http.server "$WEB_PORT" --bind "${HOST_IP[srv]%/*}" --directory "$RUN_DIR/www" >/dev/null 2>&1 &
  echo $! > "$RUN_DIR/http.pid"
  sleep 0.5
}

# ------------------------------------------------------------------ 명령
cmd_apply() {
  need_root
  local id=${1:-}; [[ -n $id ]] || die "사용법: sudo ./fault.sh apply FAULT-01 [--scenario 이름]"
  check_case_id "$id"; shift
  local scenario=""
  if [[ ${1:-} == --scenario ]]; then scenario=${2:-}; [[ -n $scenario ]] || die "--scenario 뒤에 이름이 필요합니다 (./fault.sh scenarios)"; fi
  lab_ready || die "실습망이 없습니다. 먼저: cd $LAB_DIR && sudo ./lab.sh up"
  mkdir -p "$KEY_DIR"; chmod 700 "$KEY_DIR"
  [[ -e $(key_file "$id") ]] && die "$id 는 이미 사용한 case_id입니다. 새 번호를 쓰세요 (./fault.sh cases)"
  local act; act=$(active_case)
  [[ -z $act ]] || die "$act 가 아직 복구되지 않았습니다. 한 번에 장애 하나만 적용합니다 (sudo ./fault.sh recover $act)"

  local mode=manual
  if [[ -z $scenario ]]; then # Blind 모드: 아직 쓰지 않은 시나리오 중 무작위
    mode=random
    local used pool=() s; used=" $(used_scenarios | tr '\n' ' ') "
    for s in "${SCENARIOS[@]}"; do [[ $used == *" $s "* ]] || pool+=("$s"); done
    ((${#pool[@]})) || pool=("${SCENARIOS[@]}")   # 모두 썼으면 전체에서 다시 고름
    scenario=${pool[RANDOM % ${#pool[@]}]}
  fi
  [[ -n ${SCENARIO_KO[$scenario]:-} ]] || die "알 수 없는 시나리오: $scenario (./fault.sh scenarios)"

  local f; f=$(key_file "$id")
  local rc log="$KEY_DIR/last_apply.log"   # Blind 모드에서는 명령 출력도 원인을 드러내므로 화면 대신 로그로
  set +e
  if [[ $mode == random ]]; then (set -e; apply_scenario "$scenario") > "$log" 2>&1; else (set -e; apply_scenario "$scenario"); fi
  rc=$?; set -e
  if ((rc)); then
    [[ $mode == random ]] && die "적용 실패(exit $rc). 원인 보호를 위해 상세는 $log 에만 남겼습니다. 분석 담당자가 아닌 사람이 확인하세요."
    die "적용 실패(exit $rc)"
  fi
  { echo "CASE_ID=$id"; echo "SCENARIO=$scenario"; echo "MODE=$mode"; echo "APPLIED_AT=$(now)"
    echo "REVEALED_AT="; echo "RECOVERED_AT="; } > "$f"
  chmod 600 "$f"
  say "$id 장애 적용 완료: $(kv "$f" APPLIED_AT)"
  if [[ $mode == random ]]; then
    say "원인은 출력하지 않았습니다(Blind). 분석을 제출한 뒤: sudo ./fault.sh reveal $id"
  else
    say "적용한 시나리오: ${SCENARIO_KO[$scenario]} — 이 화면을 분석 담당자에게 보여 주지 마세요."
  fi
  say "다음(2번): cd $LAB_DIR && sudo ./lab.sh flush → capture start → test all → capture stop"
  say "            status 명령은 원인을 보여 주므로 분석 제출 전에는 실행하지 않습니다."
}

cmd_reveal() {
  need_root
  local id=${1:-}; check_case_id "$id"
  local f; f=$(key_file "$id"); [[ -e $f ]] || die "$id 기록이 없습니다."
  if [[ -z $(kv "$f" REVEALED_AT || true) ]]; then
    if [[ ${2:-} != --yes ]]; then
      say "정답을 보면 Blind 분석이 끝납니다. packet_analysis.md와 packet_summary_$id.json을 먼저 제출했나요?"
      read -r -p "제출했으면 yes 입력: " ans
      [[ $ans == yes ]] || die "취소했습니다."
    fi
    set_kv "$f" REVEALED_AT "$(now)"
  fi
  local s; s=$(kv "$f" SCENARIO)
  say "$id 실제 원인: ${SCENARIO_KO[$s]}"
  say "  변경 내용: ${SCENARIO_DETAIL[$s]}"
  say "  적용: $(kv "$f" APPLIED_AT) · 공개: $(kv "$f" REVEALED_AT) · 방식: $(kv "$f" MODE)"
  say "  기록 위치: 04_incident_response/incident_cases.md 의 '분석 후 정답 대조' (JSON에는 넣지 않음)"
}

cmd_recover() {
  need_root
  local id=${1:-}; check_case_id "$id"
  local f; f=$(key_file "$id"); [[ -e $f ]] || die "$id 기록이 없습니다."
  [[ -z $(kv "$f" RECOVERED_AT || true) ]] || die "$id 는 이미 복구했습니다: $(kv "$f" RECOVERED_AT)"
  if [[ -z $(kv "$f" REVEALED_AT || true) && ${2:-} != --force ]]; then
    die "$id 정답이 아직 공개되지 않았습니다. 순서: 분석 제출 → reveal → recover (강제: recover $id --force)"
  fi
  lab_ready || die "실습망이 없습니다. lab.sh down/up을 했다면 이미 정상 상태이므로: sudo ./fault.sh close $id"
  local s; s=$(kv "$f" SCENARIO)
  revert_scenario "$s"
  set_kv "$f" RECOVERED_AT "$(now)"
  say "$id 복구 완료: $(kv "$f" RECOVERED_AT)"
  say "  되돌린 내용: ${SCENARIO_DETAIL[$s]} → 1번 명세 값"
  say "다음: sudo ./fault.sh verify   (그리고 2번이 같은 테스트로 recovered_$id.pcapng 캡처)"
}

cmd_close() { # lab.sh down/up으로 이미 정상화된 경우 기록만 닫는다
  need_root
  local id=${1:-}; check_case_id "$id"
  local f; f=$(key_file "$id"); [[ -e $f ]] || die "$id 기록이 없습니다."
  set_kv "$f" RECOVERED_AT "$(now) (lab.sh down/up으로 재생성)"
  say "$id 기록을 닫았습니다."
}

cmd_verify() { # 1번 명세 값과 현재 설정 비교. 장애가 걸린 상태에서 실행하면 원인이 드러나므로 복구 후에만 쓴다
  need_root
  local act; act=$(active_case)
  if [[ -n $act && ${1:-} != --force ]]; then
    local f; f=$(key_file "$act")
    [[ -n $(kv "$f" REVEALED_AT || true) ]] || die "$act 가 적용 중이고 정답 공개 전입니다. verify는 원인을 보여 주므로 복구 후 실행하세요."
  fi
  lab_ready || die "실습망이 없습니다."
  local h=$TARGET_HOST ok=0 bad=0
  chk() { if [[ $2 == "$3" ]]; then say "  [정상] $1: $2"; ok=$((ok+1)); else say "  [다름] $1: 현재 '$2' / 명세 '$3'"; bad=$((bad+1)); fi; }
  say "== 설정 검증 (기준: topology.conf = 1번 명세)"
  chk "PC1 IP/Mask" "$(ip -n "$h" -o -4 addr show dev eth0 | awk '{print $4}' | head -1)" "${HOST_IP[$h]}"
  chk "PC1 Default Gateway" "$(ip -n "$h" route show default | awk '{print $3}' | head -1)" "${HOST_GW[$h]}"
  chk "PC1 DNS Server" "$(awk '/^nameserver/{print $2; exit}' "/etc/netns/$h/resolv.conf")" "$DNS_SERVER"
  chk "SW1 ${HOST_PORT[$h]} Access VLAN(PVID)" \
      "$(ip netns exec "${HOST_SW[$h]}" bridge -j vlan show dev "${HOST_PORT[$h]}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(" ".join(str(v["vlan"]) for x in d for v in x["vlans"] if "PVID" in v.get("flags",[])))')" \
      "${HOST_VLAN[$h]}"
  chk "SW1 ${SW_UPLINK[sw1]} Trunk 허용 VLAN" \
      "$(ip netns exec sw1 bridge -j vlan show dev "${SW_UPLINK[sw1]}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(" ".join(sorted(str(v["vlan"]) for x in d for v in x["vlans"])))')" \
      "$(tr ' ' '\n' <<<"${TRUNK_VLANS[sw1]}" | sort | xargs)"
  local v; for v in "${!SVI_IP[@]}"; do
    chk "MLS1 vlan$v 상태" "$(ip -n mls1 -br link show dev "vlan$v" | awk '{print $2}')" "UP"
  done
  chk "Server TCP/$WEB_PORT LISTEN" "$(ip netns exec srv ss -Hltn "sport = :$WEB_PORT" | wc -l | tr -d ' ')" "1"
  chk "Server UDP/53 LISTEN" "$(ip netns exec srv ss -Hlun 'sport = :53' | wc -l | tr -d ' ')" "1"
  say "== 결과: 정상 $ok · 다름 $bad"
  say "   설정 검증만으로 복구 완료를 확정하지 않습니다. 패킷 검증은 2번의 recovered 캡처와 Baseline 비교로 합니다."
  ((bad == 0))
}

cmd_cases() { # 정답 없이 사례 목록만
  mkdir -p "$KEY_DIR" 2>/dev/null || true
  local f any=0
  for f in "$KEY_DIR"/FAULT-*.env; do
    [[ -e $f ]] || continue; any=1
    printf '  %s  적용 %s · 공개 %s · 복구 %s\n' "$(kv "$f" CASE_ID)" "$(kv "$f" APPLIED_AT)" \
      "$(kv "$f" REVEALED_AT || true)" "$(kv "$f" RECOVERED_AT || true)"
  done
  ((any)) || say "  기록된 사례 없음"
}

cmd_scenarios() {
  say "지원 시나리오 (--scenario 이름). 무작위 Blind 모드는 이 중 아직 쓰지 않은 것을 고릅니다."
  local s; for s in "${SCENARIOS[@]}"; do printf '  %-12s %s — %s\n' "$s" "${SCENARIO_KO[$s]}" "${SCENARIO_DETAIL[$s]}"; done
}

cmd_help() {
  cat <<EOF
Packet.AI 4번 Network SRE — 재현 실습망 장애 적용·복구 (한 번에 1건)
토폴로지 값: $TOPOLOGY
정답 보관: $KEY_DIR (저장소 밖, root 전용)

  sudo ./fault.sh apply FAULT-01                   Blind: 무작위 시나리오 적용, 원인은 출력 안 함
  sudo ./fault.sh apply FAULT-01 --scenario 이름   지정한 시나리오 적용 (분석 담당자가 아닌 사람이 실행할 때)
  sudo ./fault.sh cases                            사례 목록 (원인 없이 시각만)
  sudo ./fault.sh reveal FAULT-01                  분석 제출 후 정답 공개
  sudo ./fault.sh recover FAULT-01                 복구 (reveal 이후에만. 강제: --force)
  sudo ./fault.sh verify                           설정이 1번 명세와 같은지 검증 (복구 후)
  sudo ./fault.sh close FAULT-01                   lab.sh down/up으로 이미 정상화한 사례의 기록만 닫기
  ./fault.sh scenarios                             시나리오 목록 (분석 담당자는 분석 전에 보지 않아도 됨)

  DRY_RUN=1 ./fault.sh ...                         실행하지 않고 명령만 출력 (점검용)
EOF
}

main() {
  local cmd=${1:-help}; shift || true
  case "$cmd" in
    apply) cmd_apply "$@" ;; reveal) cmd_reveal "$@" ;; recover) cmd_recover "$@" ;;
    verify) cmd_verify "$@" ;; close) cmd_close "$@" ;; cases) cmd_cases ;;
    scenarios) cmd_scenarios ;; help|-h|--help) cmd_help ;;
    *) die "알 수 없는 명령: $cmd (./fault.sh help)" ;;
  esac
}
main "$@"
