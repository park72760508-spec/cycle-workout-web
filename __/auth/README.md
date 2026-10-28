Firebase Auth 보조 페이지 직접 제공(2026-10-29)

원본: https://stelvio-ai.firebaseapp.com/__/auth/iframe , iframe.js (Firebase 공식 '도우미 코드 직접 호스팅' 방식)
앱(WebView)에서는 authDomain 을 stelvio.ai.kr 로 바꿔, Firebase 로그인 모듈이 시작할 때 불러오는 숨은 iframe 이
stelvio-ai.firebaseapp.com 이 아니라 이 도메인에서 열리게 한다. (iOS 앱이 외부 도메인 iframe 을 사파리로 열던 문제)
GitHub Pages 는 확장자 없는 파일을 HTML 로 주지 않으므로 iframe/index.html 폴더 형태로 둔다.
