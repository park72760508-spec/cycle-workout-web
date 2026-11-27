-- 인스타그램 에이전트용 공개 버킷: Instagram API 는 공개 URL 의 영상을 가져가 게시한다.
-- 쓰기는 서비스 롤(GitHub Actions)만 — storage.objects 에 정책을 두지 않으므로 anon/authenticated 는 업로드 불가.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('instagram-media', 'instagram-media', true, 104857600, ARRAY['video/mp4', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
