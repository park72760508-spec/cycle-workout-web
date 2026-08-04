-- open_rides에 group_firestore_doc_id(생성 출처 클럽/크루의 Firestore 문서 ID) 컬럼 추가.
-- 클럽/크루 상세 화면에 "이 그룹의 모임만" 보여주는 캘린더를 추가하려는데, 지금까지 rides
-- 문서에는 어느 그룹에서 생성됐는지 연결하는 필드가 아예 없었다(클럽 상세의 "모임 생성" 버튼은
-- 초대 명단만 미리 채울 뿐 그룹과의 연결을 저장하지 않았음). 방장이 클럽/크루 상세에서
-- "모임 생성"으로 만든 라이딩만 이 값이 채워지고, 일반 라이딩 생성 화면에서 만든 모임은
-- NULL로 남는다(기존 모임도 이 기능 이전 생성분이라 전부 NULL).
-- riding_groups.id(uuid)가 아니라 firestore_doc_id(text)를 그대로 저장한다 — 클라이언트가
-- 화면에서 들고 있는 groupId는 항상 Firestore 문서 ID이므로, uuid5 파생 알고리즘을 클라이언트에
-- 이식할 필요 없이 문자열을 그대로 비교할 수 있게 하기 위함(open_rides.firestore_doc_id와
-- 동일한 패턴).
ALTER TABLE public.open_rides
  ADD COLUMN IF NOT EXISTS group_firestore_doc_id text;

CREATE INDEX IF NOT EXISTS idx_open_rides_group_firestore_doc_id
  ON public.open_rides (group_firestore_doc_id);
