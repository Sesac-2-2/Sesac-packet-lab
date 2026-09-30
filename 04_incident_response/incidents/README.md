# incidents/

`sudo ./fault.sh export <case_id>`가 만드는 `incident_<case_id>.json`이 저장되는 곳이다. `dashboard.html`이 읽는다.

- 이 파일에는 **실제 원인**이 들어 있다. `fault.sh`는 분석 제출 후 `reveal`을 실행한 사례만 내보낸다.
- 아직 분석하지 않은 사례가 있는 동안에는 이 폴더를 분석 담당자와 3번 AI 입력에 공유하지 않는다.
- 2번 `packet_summary_*.json`과 3번 AI 입력에 이 파일의 내용을 넣지 않는다.
- 현재 파일 없음 (진행한 사례 없음).
