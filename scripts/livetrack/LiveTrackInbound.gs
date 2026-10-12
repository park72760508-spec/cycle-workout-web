/**
 * STELVIO — Garmin LiveTrack 초대 메일 자동 전달 (Google Apps Script, 무료)
 *
 * 설치(수신 전용 Gmail 계정에서 1회):
 *  1. https://script.google.com → 새 프로젝트 → 이 파일 내용 붙여넣기 → 저장
 *  2. 프로젝트 설정(톱니) → 스크립트 속성 추가
 *       STELVIO_TOKEN = (functions/.env.stelvio-ai 의 LIVETRACK_INBOUND_TOKEN 값)
 *  3. 편집기에서 함수 installTrigger 선택 → 실행 → Gmail 권한 허용 (1분 주기 트리거 생성)
 *
 * 동작: 1분마다 Garmin이 보낸 안 읽은 LiveTrack 메일을 찾아 Cloud Function(liveTrackInbound)에 전달하고,
 * 처리한 스레드는 읽음 + 라벨(stelvio-livetrack-done)로 표시한다. 30일 지난 처리 메일은 휴지통으로 이동.
 */
var ENDPOINT = 'https://asia-northeast3-stelvio-ai.cloudfunctions.net/liveTrackInbound';
var DONE_LABEL = 'stelvio-livetrack-done';

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('forwardLiveTrackMails').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('cleanupOldMails').timeBased().everyDays(1).atHour(4).create();
  forwardLiveTrackMails();
}

function forwardLiveTrackMails() {
  var token = PropertiesService.getScriptProperties().getProperty('STELVIO_TOKEN');
  if (!token) throw new Error('스크립트 속성 STELVIO_TOKEN 이 없습니다.');
  var threads = GmailApp.search('is:unread from:garmin.com newer_than:2d', 0, 20);
  if (!threads.length) return;
  var label = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  var messages = [];
  var msgThreads = [];
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      if (!m.isUnread()) return;
      messages.push({
        id: m.getId(),
        from: m.getFrom(),
        to: m.getTo(),
        cc: m.getCc(),
        deliveredTo: m.getHeader('Delivered-To') + ' ' + m.getHeader('X-Original-To'),
        subject: m.getSubject(),
        body: m.getPlainBody().slice(0, 20000),
        html: m.getBody().slice(0, 60000)
      });
      msgThreads.push(m);
    });
  });
  if (!messages.length) return;
  var res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Stelvio-Token': token },
    payload: JSON.stringify({ messages: messages }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    console.warn('liveTrackInbound 응답 ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    return; // 다음 주기에 재시도(읽음 처리 안 함)
  }
  msgThreads.forEach(function (m) { m.markRead(); });
  threads.forEach(function (th) { th.addLabel(label); });
}

function cleanupOldMails() {
  GmailApp.search('label:' + DONE_LABEL + ' older_than:30d', 0, 100).forEach(function (th) { th.moveToTrash(); });
}
