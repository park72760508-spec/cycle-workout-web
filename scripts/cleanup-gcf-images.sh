#!/bin/bash
# Cloud Functions 컨테이너 이미지 안전 정리 (2026-10-23)
#
# 배경: Artifact Registry 자동 정리 규칙(firebase-functions-cleanup, "하루 지난 이미지 전부 삭제")이
#       운영 중인 함수 이미지까지 지워 2026-10-23 06:19 KST 부터 모든 함수가 시작 실패했다.
#       → 저장소 자동 규칙은 끄고(firebase functions:artifacts:setpolicy --none), 이 스크립트로만 정리한다.
#
# 지우지 않는 것(안전장치):
#   1) Cloud Run 리비전(지금 서비스 중 + 롤백용 이전 리비전 전부)이 참조하는 이미지
#   2) 패키지(이미지 이름)마다 가장 최근 버전 1개
#   3) 만든 지 7일(KEEP_DAYS) 안 된 이미지
# 사용: scripts/cleanup-gcf-images.sh            # 삭제 후보만 출력(기본)
#       scripts/cleanup-gcf-images.sh --apply    # 실제 삭제
set -euo pipefail
PROJECT=stelvio-ai
REGIONS="us-central1 asia-northeast3"
KEEP_DAYS=${KEEP_DAYS:-7}
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

for R in $REGIONS; do
  REPO="$R-docker.pkg.dev/$PROJECT/gcf-artifacts"
  gcloud run revisions list --region "$R" --project "$PROJECT" --format='value(spec.containers[0].image)' > "$TMP/refs-$R.txt"
  gcloud artifacts docker images list "$REPO" --include-tags --format=json > "$TMP/imgs-$R.json"
  python3 - "$TMP/refs-$R.txt" "$TMP/imgs-$R.json" "$KEEP_DAYS" "$R" > "$TMP/del-$R.txt" <<'PY'
import json, sys, datetime
refs_f, imgs_f, keep_days, region = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
refs = [l.strip() for l in open(refs_f) if l.strip()]
ref_digests = {r.split('@', 1)[1] for r in refs if '@' in r}
ref_tags = {r for r in refs if '@' not in r}  # 태그로 참조하면 그 패키지는 통째로 보존
imgs = json.load(open(imgs_f))
now = datetime.datetime.now(datetime.timezone.utc)
by_pkg = {}
for im in imgs:
    by_pkg.setdefault(im['package'], []).append(im)
out = []
kept = 0
for pkg, lst in by_pkg.items():
    lst.sort(key=lambda x: x.get('createTime', ''), reverse=True)
    pkg_tag_referenced = any(t.startswith(pkg + ':') for t in ref_tags)
    for i, im in enumerate(lst):
        dg = im['version']
        ct = datetime.datetime.fromisoformat(im['createTime'].replace('Z', '+00:00'))
        age = (now - ct).days
        if i == 0 or dg in ref_digests or pkg_tag_referenced or age < keep_days:
            kept += 1
            continue
        out.append(f"{pkg}@{dg}\t{age}d")
if out: print('\n'.join(out))
sys.stderr.write(f"[{region}] 이미지 {len(imgs)}개 중 보존 {kept}개, 삭제 후보 {len(out)}개 (리비전 참조 {len(ref_digests)}개)\n")
PY
  if [ -s "$TMP/del-$R.txt" ]; then
    cut -f1 "$TMP/del-$R.txt" | sed 's#.*/gcf-artifacts/##' | sed 's/^/  삭제 후보: /'
    if [ $APPLY = 1 ]; then
      while IFS=$'\t' read -r ref _age; do
        gcloud artifacts docker images delete "$ref" --project "$PROJECT" --delete-tags --quiet >/dev/null 2>&1 \
          && echo "  삭제: ${ref##*/}" || echo "  삭제 실패: ${ref##*/}"
      done < "$TMP/del-$R.txt"
    fi
  fi
done
[ $APPLY = 1 ] || echo "(목록만 출력 — 실제 삭제는 --apply)"
