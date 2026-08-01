/**
 * 대회 관리자 CRUD — affiliates 관리(assets/js/affiliate/AffiliateScreens.jsx)와 동일하게
 * 관리자(grade=1)는 클라이언트에서 Firestore competitions 컬렉션에 직접 write한다
 * (docs/firestore.rules: competitions는 grade=1만 write 허용, Cloud Function 불필요).
 */
(function () {
  function isAdmin() {
    try {
      var g =
        typeof getLoginUserGrade === 'function'
          ? String(getLoginUserGrade())
          : typeof getViewerGrade === 'function'
            ? String(getViewerGrade())
            : '2';
      return typeof window.isStelvioAdminGrade === 'function' && window.isStelvioAdminGrade(g);
    } catch (e) {
      return false;
    }
  }

  function getFirestoreFns() {
    if (!window.firestoreV9 || !window._firebaseFirestoreFns) return null;
    return { db: window.firestoreV9, fns: window._firebaseFirestoreFns };
  }

  function getCurrentUid() {
    try {
      return (window.authV9 && window.authV9.currentUser && window.authV9.currentUser.uid) || null;
    } catch (e) {
      return null;
    }
  }

  function getStorageFns() {
    if (!window.firebaseStorageV9 || !window._firebaseStorageFns) return null;
    return { storage: window.firebaseStorageV9, fns: window._firebaseStorageFns };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * Toss 가상계좌 발급 지원 은행 코드 — https://docs.tosspayments.com/codes/org-codes 공식 표 기준으로 검증됨.
   * assets/js/competition/competitionBottomSheet.js BANK_OPTIONS · functions/competitionApplyAlimtalk.js
   * TOSS_BANK_CODE_NAME_KO와 동일 목록(단일 출처 아님 — 함께 유지 필요).
   * 자유 입력 텍스트였던 이전 필드는 Toss가 지원하지 않는 코드(예: '10')를 그대로 저장할 수 있어
   * 알림톡에 은행명이 제대로 표기되지 않는 원인이 되었다 — select로 바꿔 원천 차단한다.
   */
  var BANK_OPTIONS = [
    { code: '20', name: '우리은행' },
    { code: '81', name: 'KEB하나은행' },
    { code: '88', name: '신한은행' },
    { code: '06', name: 'KB국민은행' },
    { code: '11', name: 'NH농협은행' },
    { code: '90', name: '카카오뱅크' },
    { code: '92', name: '토스뱅크' },
    { code: '03', name: 'IBK기업은행' },
    { code: '39', name: '경남은행' },
    { code: '34', name: '광주은행' },
    { code: '31', name: 'iM뱅크(대구)' },
    { code: '32', name: '부산은행' },
    { code: '07', name: 'Sh수협은행' },
    { code: '71', name: '우체국예금보험' },
    { code: '37', name: '전북은행' },
  ];

  function bankOptionsHtml(selectedCode) {
    var sel = String(selectedCode || '20');
    return BANK_OPTIONS.map(function (b) {
      return '<option value="' + b.code + '"' + (b.code === sel ? ' selected' : '') + '>' +
        escapeHtml(b.name) + ' (' + b.code + ')</option>';
    }).join('');
  }

  function toDatetimeLocalValue(input) {
    if (!input) return '';
    var d = null;
    if (typeof input.toDate === 'function') d = input.toDate();
    else if (input instanceof Date) d = input;
    else d = new Date(input);
    if (!d || isNaN(d.getTime())) return '';
    var pad = function (n) {
      return String(n).padStart(2, '0');
    };
    return (
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    );
  }

  var WEEKDAY_LABELS_KO = ['일', '월', '화', '수', '목', '금', '토'];

  /** datetime-local 문자열(YYYY-MM-DDTHH:mm) → "2026년 7월 26일 (일) 14:00" 표시용 텍스트 */
  function formatDateTimeDisplayKo(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    var pad = function (n) {
      return String(n).padStart(2, '0');
    };
    return (
      d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일' +
      ' (' + WEEKDAY_LABELS_KO[d.getDay()] + ') ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes())
    );
  }

  var COMPETITION_IMAGE_MAX_PX = 1600;
  var COMPETITION_IMAGE_MAX_BYTES = 2.2 * 1024 * 1024;

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error('이미지를 읽을 수 없습니다.'));
      };
      reader.onload = function (e) {
        resolve(e.target && e.target.result ? e.target.result : '');
      };
      reader.readAsDataURL(file);
    });
  }

  function loadImageElement(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onerror = function () {
        reject(new Error('이미지 형식을 처리할 수 없습니다.'));
      };
      img.onload = function () {
        resolve(img);
      };
      img.src = dataUrl;
    });
  }

  function canvasToJpegBlob(canvas, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(
        function (blob) {
          resolve(blob);
        },
        'image/jpeg',
        quality
      );
    });
  }

  /** 포스터·코스맵 이미지 클라이언트 압축 — openRidingGroupService.compressRidingGroupCoverInput과 동일한 방식 */
  async function compressCompetitionImage(file) {
    if (!file) return file;
    if (file.type && !String(file.type).startsWith('image/')) {
      throw new Error('이미지 파일만 업로드할 수 있습니다.');
    }
    var dataUrl = await readFileAsDataUrl(file);
    var img = await loadImageElement(dataUrl);
    var w = img.naturalWidth || img.width || 0;
    var h = img.naturalHeight || img.height || 0;
    if (!w || !h) throw new Error('이미지 크기를 확인할 수 없습니다.');
    if (w > COMPETITION_IMAGE_MAX_PX || h > COMPETITION_IMAGE_MAX_PX) {
      if (w >= h) {
        h = Math.round((h * COMPETITION_IMAGE_MAX_PX) / w);
        w = COMPETITION_IMAGE_MAX_PX;
      } else {
        w = Math.round((w * COMPETITION_IMAGE_MAX_PX) / h);
        h = COMPETITION_IMAGE_MAX_PX;
      }
    }
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('이미지 처리를 지원하지 않는 환경입니다.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    var quality = 0.88;
    var blob = null;
    for (var attempt = 0; attempt < 8; attempt++) {
      blob = await canvasToJpegBlob(canvas, quality);
      if (!blob) break;
      if (blob.size <= COMPETITION_IMAGE_MAX_BYTES) return blob;
      quality -= 0.1;
      if (quality < 0.35) break;
    }
    if (blob && blob.size <= COMPETITION_IMAGE_MAX_BYTES) return blob;
    throw new Error('이미지 용량이 너무 큽니다. 더 작은 이미지를 선택해 주세요.');
  }

  /** @param {string} kind — 'poster' | 'coursemap' (Storage 파일명 접두사) */
  async function uploadCompetitionImage(competitionId, file, kind) {
    var ctx = getStorageFns();
    if (!ctx) throw new Error('이미지 업로드 서비스가 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
    var blob = await compressCompetitionImage(file);
    var name = kind + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9) + '.jpg';
    var path = 'competitions/' + competitionId + '/' + name;
    var r = ctx.fns.ref(ctx.storage, path);
    await ctx.fns.uploadBytes(r, blob, { contentType: 'image/jpeg' });
    return ctx.fns.getDownloadURL(r);
  }

  /** 코스 GPX 원본 업로드(압축 없음) — assets/js/openRiding/openRidingService.js uploadRideGpx와 동일 방식 */
  async function uploadCompetitionGpx(competitionId, file) {
    var ctx = getStorageFns();
    if (!ctx) throw new Error('GPX 업로드 서비스가 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
    var name = 'course_' + Date.now() + '.gpx';
    var path = 'competitions/' + competitionId + '/' + name;
    var r = ctx.fns.ref(ctx.storage, path);
    var contentType = file && file.type && String(file.type).trim() ? String(file.type).trim() : 'application/gpx+xml';
    await ctx.fns.uploadBytes(r, file, { contentType: contentType });
    return ctx.fns.getDownloadURL(r);
  }

  var CSV_GENDER_LABEL = { M: '남', F: '여' };
  var CSV_NATIONALITY_LABEL = { DOMESTIC: '내국인', FOREIGN: '외국인' };
  var CSV_DIVISION_LABEL = {
    FULL: 'Full', HALF: 'Half', '10K': '10km', '5K': '5km',
    GRANFONDO: '그란폰도', MEDIOFONDO: '메디오폰도',
  };
  var CSV_SIZE_LABEL = { S: 'S (90)', M: 'M (95)', L: 'L (100)', XL: 'XL (105)', XXL: 'XXL (110)' };
  var CSV_START_GROUP_LABEL = { A: 'A조', B: 'B조', C: 'C조' };
  var CSV_BLOOD_TYPE_LABEL = {
    'RH+A': 'RH+ A형', 'RH+B': 'RH+ B형', 'RH+O': 'RH+ O형', 'RH+AB': 'RH+ AB형',
    'RH-A': 'RH- A형', 'RH-B': 'RH- B형', 'RH-O': 'RH- O형', 'RH-AB': 'RH- AB형',
  };
  var CSV_STATUS_LABEL = {
    PAYMENT_WAITING: '입금 대기중',
    PAYMENT_COMPLETED: '신청 완료(입금 확인)',
    CANCELED_UNPAID: '미입금 취소',
    CANCELED_REFUNDED: '취소·환불',
  };

  function formatDateTimeForCsv(input) {
    if (!input) return '';
    var d = null;
    if (typeof input.toDate === 'function') d = input.toDate();
    else if (input instanceof Date) d = input;
    else d = new Date(input);
    if (!d || isNaN(d.getTime())) return '';
    var pad = function (n) {
      return String(n).padStart(2, '0');
    };
    return (
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    );
  }

  function toCsvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  async function fetchApplicantsForCsv(competitionId) {
    var ctx = getFirestoreFns();
    if (!ctx) return [];
    var fns = ctx.fns;
    var q = fns.query(fns.collection(ctx.db, 'race_applications'), fns.where('competitionId', '==', competitionId));
    var snap = await fns.getDocs(q);
    var rows = [];
    snap.forEach(function (d) {
      var data = typeof d.data === 'function' ? d.data() : {};
      rows.push(Object.assign({ id: d.id }, data));
    });
    rows.sort(function (a, b) {
      var at = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      var bt = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return at - bt;
    });
    return rows;
  }

  /** 신청서 내용 + 가상계좌 정보 + 입금 확인 여부를 한 행에 담는다 */
  function buildApplicantsCsv(applications) {
    var header = [
      '신청ID', '신청일시', '이름', '성별', '생년월일(6자리)', '국적', '휴대전화',
      '우편번호', '기본주소', '상세주소',
      '참가부문', '사이즈', '출발그룹',
      '비상연락처 이름', '비상연락처 관계', '비상연락처 전화', '혈액형', '의료특이사항',
      '은행', '계좌번호', '입금기한',
      '신청상태', '입금확인여부', '입금확인일시', '결제금액',
    ];
    var rows = [header];
    applications.forEach(function (app) {
      var a = app.applicant || {};
      var va = app.virtualAccount || {};
      rows.push([
        app.id,
        formatDateTimeForCsv(app.createdAt),
        a.name || '',
        CSV_GENDER_LABEL[a.gender] || a.gender || '',
        a.birth6 || '',
        CSV_NATIONALITY_LABEL[a.nationality] || a.nationality || '',
        a.phone || '',
        a.zipCode || '',
        a.address1 || '',
        a.address2 || '',
        CSV_DIVISION_LABEL[a.division] || a.division || '',
        CSV_SIZE_LABEL[a.size] || a.size || '',
        CSV_START_GROUP_LABEL[a.startGroup] || a.startGroup || '',
        a.emergencyName || '',
        a.emergencyRelation || '',
        a.emergencyPhone || '',
        CSV_BLOOD_TYPE_LABEL[a.bloodType] || a.bloodType || '',
        a.medicalNote || '',
        va.bankName || '',
        va.accountNumber || '',
        formatDateTimeForCsv(va.dueDate),
        CSV_STATUS_LABEL[app.status] || app.status || '',
        app.status === 'PAYMENT_COMPLETED' ? 'Y' : 'N',
        formatDateTimeForCsv(app.paidAt),
        Number(app.amount) || 0,
      ]);
    });
    return rows.map(function (row) {
      return row.map(toCsvCell).join(',');
    }).join('\r\n');
  }

  function downloadCsvFile(filename, csvContent) {
    // BOM 포함 — 한글 데이터가 Excel(Windows)에서 깨지지 않도록
    var blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
  }

  async function downloadApplicantsCsv(comp) {
    if (!comp || !comp.id) return;
    try {
      var applications = await fetchApplicantsForCsv(comp.id);
      if (!applications.length) {
        alert('신청 내역이 없습니다.');
        return;
      }
      var csv = buildApplicantsCsv(applications);
      var safeTitle = String(comp.title || '대회').replace(/[\\/:*?"<>|]/g, '_');
      var filename = safeTitle + '_신청자명단_' + new Date().toISOString().slice(0, 10) + '.csv';
      downloadCsvFile(filename, csv);
    } catch (e) {
      alert((e && e.message) || 'CSV 다운로드에 실패했습니다.');
    }
  }

  /** 포스터(히어로)·코스맵 업로드 필드 — 미리보기 썸네일 + 파일선택 + 제거. wireImageUploadField와 짝을 이룬다 */
  function buildImageUploadFieldHtml(idPrefix, label, existingUrl) {
    var hasExisting = !!existingUrl;
    return (
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label">' + escapeHtml(label) + '</label>' +
      '  <div class="competition-image-upload">' +
      '    <div class="competition-image-preview" id="' + idPrefix + 'Preview"' +
      (hasExisting ? ' style="background-image:url(\'' + escapeHtml(existingUrl) + '\')"' : '') +
      '>' + (hasExisting ? '' : '이미지 없음') + '</div>' +
      '    <div class="competition-image-upload-actions">' +
      '      <input type="file" accept="image/*" id="' + idPrefix + 'File" class="competition-image-file-input" />' +
      '      <label for="' + idPrefix + 'File" class="competition-image-upload-btn">이미지 선택</label>' +
      '      <button type="button" class="competition-image-remove-btn" id="' + idPrefix + 'RemoveBtn"' +
      (hasExisting ? '' : ' style="display:none;"') +
      '>이미지 제거</button>' +
      '    </div>' +
      '  </div>' +
      '</div>'
    );
  }

  /**
   * 코스 지도·고도표(GPX) 업로드 필드 — 라이딩 생성 폼과 동일하게 GPX 업로드 시
   * OpenRidingGpxCoursePanel(지도+고도표+확대/이동 ON/OFF 토글)을 그대로 마운트해 미리보기.
   * wireGpxUploadField와 짝을 이룬다.
   */
  function buildGpxUploadFieldHtml(idPrefix, label, existingUrl) {
    var hasExisting = !!existingUrl;
    return (
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label">' + escapeHtml(label) + '</label>' +
      '  <div class="competition-gpx-upload">' +
      '    <div class="competition-course-gpx-panel" id="' + idPrefix + 'PanelMount"></div>' +
      '    <div class="competition-image-upload-actions">' +
      '      <input type="file" accept=".gpx,application/gpx+xml" id="' + idPrefix + 'File" class="competition-image-file-input" />' +
      '      <label for="' + idPrefix + 'File" class="competition-image-upload-btn">GPX 파일</label>' +
      '      <button type="button" class="competition-image-remove-btn" id="' + idPrefix + 'RemoveBtn"' +
      (hasExisting ? '' : ' style="display:none;"') +
      '>GPX 제거</button>' +
      '    </div>' +
      (hasExisting
        ? '    <p class="competition-form-hint" style="margin:6px 0 0;">이미 등록된 GPX가 있습니다. 새 파일을 선택하면 저장 시 교체됩니다.</p>'
        : '') +
      '  </div>' +
      '</div>'
    );
  }

  /**
   * 네이티브 datetime-local 대신 STELVIO 디자인의 커스텀 달력 팝업을 여는 트리거로 대체.
   * 네이티브 위젯은 브라우저/OS 로케일에 따라 월이 영문(Jan/Feb..)으로 표시되고 디자인도
   * 커스터마이즈할 수 없어, 값 자체는 동일한 hidden input(id 동일)에 보관해 저장 로직은 그대로 둔다.
   */
  function buildDateTimeFieldHtml(id, label, existingValue) {
    var value = toDatetimeLocalValue(existingValue);
    var displayText = value ? formatDateTimeDisplayKo(value) : '날짜·시간을 선택하세요';
    return (
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="' + id + '_trigger">' + escapeHtml(label) + '</label>' +
      '  <button type="button" class="competition-datetime-trigger" id="' + id + '_trigger" data-target="' + id + '">' +
      '    <span class="competition-datetime-trigger-text"' + (value ? '' : ' data-placeholder="1"') + '>' + escapeHtml(displayText) + '</span>' +
      '    <svg class="competition-datetime-trigger-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '      <rect x="3" y="5" width="18" height="16" rx="3" stroke="currentColor" stroke-width="2"/>' +
      '      <path d="M3 9H21" stroke="currentColor" stroke-width="2"/>' +
      '      <path d="M8 3V6M16 3V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '    </svg>' +
      '  </button>' +
      '  <input type="hidden" id="' + id + '" value="' + escapeHtml(value) + '" />' +
      '</div>'
    );
  }

  function buildFormBody(comp) {
    comp = comp || {};
    return (
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminCategory">종목</label>' +
      '  <select class="competition-form-select" id="cAdminCategory">' +
      '    <option value="RUN"' + (comp.category !== 'CYCLE' ? ' selected' : '') + '>RUN (러닝)</option>' +
      '    <option value="CYCLE"' + (comp.category === 'CYCLE' ? ' selected' : '') + '>CYCLE (사이클)</option>' +
      '  </select>' +
      '</div>' +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminTitle">대회명</label>' +
      '  <input class="competition-form-input" id="cAdminTitle" type="text" value="' + escapeHtml(comp.title) + '" />' +
      '</div>' +
      buildImageUploadFieldHtml('cAdminPoster', '포스터(히어로) 이미지', comp.posterImageUrl) +
      buildGpxUploadFieldHtml('cAdminCourseMap', '코스 지도 · 고도표 (GPX)', comp.gpxUrl) +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminDescription">상세 설명</label>' +
      '  <textarea class="competition-form-input" id="cAdminDescription" rows="4">' + escapeHtml(comp.description) + '</textarea>' +
      '</div>' +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminLocation">장소</label>' +
      '  <input class="competition-form-input" id="cAdminLocation" type="text" value="' + escapeHtml(comp.location) + '" />' +
      '</div>' +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminCourseDistance">코스 거리</label>' +
      '  <input class="competition-form-input" id="cAdminCourseDistance" type="text" placeholder="예: 42.195km" value="' + escapeHtml(comp.courseDistance) + '" />' +
      '</div>' +
      buildDateTimeFieldHtml('cAdminRaceDate', '대회 일시', comp.raceDate) +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminEntryFee">참가비(원)</label>' +
      '  <input class="competition-form-input" id="cAdminEntryFee" type="number" min="0" value="' + (Number(comp.entryFee) || 0) + '" />' +
      '</div>' +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminCapacity">정원</label>' +
      '  <input class="competition-form-input" id="cAdminCapacity" type="number" min="1" value="' + (Number(comp.capacity) || 100) + '" />' +
      '</div>' +
      buildDateTimeFieldHtml('cAdminOpensAt', '접수 시작', comp.opensAt) +
      buildDateTimeFieldHtml('cAdminClosesAt', '접수 마감', comp.closesAt) +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminValidHours">가상계좌 입금 기한(시간)</label>' +
      '  <input class="competition-form-input" id="cAdminValidHours" type="number" min="1" value="' + (Number(comp.validHours) || 1) + '" />' +
      '</div>' +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminBank">가상계좌 발급 은행</label>' +
      '  <select class="competition-form-select" id="cAdminBank">' +
           bankOptionsHtml(comp.bankAllowlist && comp.bankAllowlist[0]) +
      '  </select>' +
      '</div>' +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminStatus">접수 상태</label>' +
      '  <select class="competition-form-select" id="cAdminStatus">' +
      '    <option value="open"' + (comp.status !== 'closed' ? ' selected' : '') + '>접수중(open)</option>' +
      '    <option value="closed"' + (comp.status === 'closed' ? ' selected' : '') + '>마감(closed)</option>' +
      '  </select>' +
      '</div>' +
      '<div class="competition-form-error" id="cAdminError"></div>'
    );
  }

  function readFormValues(overlay) {
    var q = function (id) {
      return overlay.querySelector('#' + id);
    };
    var title = q('cAdminTitle').value.trim();
    var capacity = Number(q('cAdminCapacity').value) || 0;
    var opensAtStr = q('cAdminOpensAt').value;
    var closesAtStr = q('cAdminClosesAt').value;
    var bank = q('cAdminBank').value.trim();

    if (!title) return { error: '대회명을 입력해 주세요.' };
    if (!(capacity > 0)) return { error: '정원은 1명 이상이어야 합니다.' };
    if (!opensAtStr || !closesAtStr) return { error: '접수 시작·마감 일시를 입력해 주세요.' };
    if (new Date(closesAtStr).getTime() <= new Date(opensAtStr).getTime()) {
      return { error: '접수 마감은 접수 시작 이후여야 합니다.' };
    }
    if (!bank) return { error: '가상계좌 발급 은행 코드를 입력해 주세요.' };

    var raceDateStr = q('cAdminRaceDate').value;
    return {
      data: {
        category: q('cAdminCategory').value === 'CYCLE' ? 'CYCLE' : 'RUN',
        title: title,
        description: q('cAdminDescription').value.trim(),
        location: q('cAdminLocation').value.trim(),
        courseDistance: q('cAdminCourseDistance').value.trim(),
        raceDate: raceDateStr ? new Date(raceDateStr) : null,
        entryFee: Number(q('cAdminEntryFee').value) || 0,
        capacity: capacity,
        opensAt: new Date(opensAtStr),
        closesAt: new Date(closesAtStr),
        validHours: Number(q('cAdminValidHours').value) || 1,
        bankAllowlist: [bank],
        status: q('cAdminStatus').value === 'closed' ? 'closed' : 'open',
      },
    };
  }

  async function saveCompetition(id, data, redisKeyForNew) {
    var ctx = getFirestoreFns();
    if (!ctx) throw new Error('Firestore가 준비되지 않았습니다.');
    var fns = ctx.fns;
    var db = ctx.db;
    if (id) {
      await fns.updateDoc(fns.doc(db, 'competitions', id), Object.assign({}, data, {
        updatedAt: fns.serverTimestamp(),
      }));
      return id;
    }
    var uid = getCurrentUid();
    if (!uid) throw new Error('로그인이 필요합니다.');
    // 관리자는 즉시 공개(APPROVED), 일반 사용자는 승인 대기(PENDING) — 관리자 승인 후 목록에 노출된다.
    var docRef = await fns.addDoc(fns.collection(db, 'competitions'), Object.assign({}, data, {
      createdAt: fns.serverTimestamp(),
      updatedAt: fns.serverTimestamp(),
      createdBy: uid,
      approvalStatus: isAdmin() ? 'APPROVED' : 'PENDING',
    }));
    // redisKey는 applyForCompetition/getCompetitionStatus가 없으면 자동으로 만들지만,
    // 문서에도 명시해 두면 관리자 화면에서 바로 확인 가능하다.
    await fns.updateDoc(fns.doc(db, 'competitions', docRef.id), {
      redisKey: 'race:' + docRef.id + ':count',
    });
    return docRef.id;
  }

  async function deleteCompetitionDoc(id) {
    var ctx = getFirestoreFns();
    if (!ctx) throw new Error('Firestore가 준비되지 않았습니다.');
    await ctx.fns.deleteDoc(ctx.fns.doc(ctx.db, 'competitions', id));
  }

  /** 관리자 승인/거절 — approvalStatus만 갱신한다(firestore.rules가 생성자 본인의 자가 승인은 차단). */
  async function setApprovalStatus(competitionId, status) {
    var ctx = getFirestoreFns();
    if (!ctx) throw new Error('Firestore가 준비되지 않았습니다.');
    await ctx.fns.updateDoc(ctx.fns.doc(ctx.db, 'competitions', competitionId), {
      approvalStatus: status,
      updatedAt: ctx.fns.serverTimestamp(),
    });
  }

  function approveCompetition(competitionId) {
    return setApprovalStatus(competitionId, 'APPROVED');
  }

  function rejectCompetition(competitionId) {
    return setApprovalStatus(competitionId, 'REJECTED');
  }

  /**
   * 승인제 도입 이전(approvalStatus 필드 없음) 기존 대회 자동 보정 — 관리자가 목록을 열 때마다 1회성으로 채워 넣는다.
   * 일반 사용자 목록 조회는 where('approvalStatus','==','APPROVED') 쿼리를 쓰므로, 필드가 아예 없으면 결과에서 빠진다.
   */
  function backfillLegacyApprovalStatus(rows) {
    var ctx = getFirestoreFns();
    if (!ctx) return Promise.resolve();
    var legacy = (rows || []).filter(function (r) {
      return r.approvalStatus == null;
    });
    if (!legacy.length) return Promise.resolve();
    return Promise.all(
      legacy.map(function (r) {
        return ctx.fns.updateDoc(ctx.fns.doc(ctx.db, 'competitions', r.id), { approvalStatus: 'APPROVED' }).catch(function () {});
      })
    );
  }

  /**
   * 생성/수정 폼 바텀시트. competitionBottomSheet.js의 openSheet 프리미티브를 그대로 사용.
   * @param {object|null} comp — null이면 신규 생성, 값이 있으면 수정(comp.id 필요)
   * @param {function} onSaved — 저장 성공 후 호출(목록 새로고침용)
   */
  /**
   * 이미지 업로드 필드 하나를 wiring — 파일 선택 시 즉시 로컬 미리보기(object URL), 제거 시 미리보기 초기화.
   * 실제 업로드는 저장 버튼 클릭 시(경진 대회 ID가 필요하므로) 별도로 수행한다.
   * @returns {{ getFile: function(): (File|null), isRemoved: function(): boolean }}
   */
  function wireImageUploadField(overlay, idPrefix) {
    var fileInput = overlay.querySelector('#' + idPrefix + 'File');
    var preview = overlay.querySelector('#' + idPrefix + 'Preview');
    var removeBtn = overlay.querySelector('#' + idPrefix + 'RemoveBtn');
    var selectedFile = null;
    var removed = false;

    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      selectedFile = f;
      removed = false;
      preview.style.backgroundImage = 'url(' + URL.createObjectURL(f) + ')';
      preview.textContent = '';
      removeBtn.style.display = '';
    });
    removeBtn.addEventListener('click', function () {
      selectedFile = null;
      removed = true;
      fileInput.value = '';
      preview.style.backgroundImage = '';
      preview.textContent = '이미지 없음';
      removeBtn.style.display = 'none';
    });

    return {
      getFile: function () {
        return selectedFile;
      },
      isRemoved: function () {
        return removed;
      },
    };
  }

  /**
   * 코스 지도·고도표(GPX) 필드 wiring — 파일 선택 시 OpenRidingGpxCoursePanel을 로컬 File로 즉시
   * 재마운트해 미리보기(지도·고도표·ON/OFF 토글까지 라이딩 생성과 동일). 실제 업로드는 저장 시 수행.
   * 시트가 어떤 경로로 닫히든(저장·×·바깥 클릭·Esc) React 루트를 정리한다.
   * @returns {{ getFile: function(): (File|null), isRemoved: function(): boolean }}
   */
  function wireGpxUploadField(overlay, idPrefix, existingGpxUrl) {
    var fileInput = overlay.querySelector('#' + idPrefix + 'File');
    var mountEl = overlay.querySelector('#' + idPrefix + 'PanelMount');
    var removeBtn = overlay.querySelector('#' + idPrefix + 'RemoveBtn');
    var bs = window.competitionBottomSheet;
    var selectedFile = null;
    var removed = false;

    function render() {
      if (!bs || !mountEl || typeof bs.mountGpxCoursePanel !== 'function') return;
      bs.mountGpxCoursePanel(mountEl, {
        gpxUrl: !removed && !selectedFile ? existingGpxUrl || null : null,
        file: selectedFile,
        showEmptyMessage: true,
      });
    }
    render();

    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      selectedFile = f;
      removed = false;
      removeBtn.style.display = '';
      render();
    });
    removeBtn.addEventListener('click', function () {
      selectedFile = null;
      removed = true;
      fileInput.value = '';
      removeBtn.style.display = 'none';
      render();
    });
    if (bs && typeof bs.onSheetClose === 'function') {
      bs.onSheetClose(function () {
        if (typeof bs.unmountGpxCoursePanel === 'function') bs.unmountGpxCoursePanel(mountEl);
      });
    }

    return {
      getFile: function () {
        return selectedFile;
      },
      isRemoved: function () {
        return removed;
      },
    };
  }

  var MINUTE_STEP_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  /** STELVIO 디자인의 커스텀 날짜·시간 선택 팝업 — 월은 항상 숫자("7월")로 표시된다 */
  function openDateTimePickerPopup(initialValue, onConfirm) {
    var now = new Date();
    var base = initialValue ? new Date(initialValue) : now;
    if (isNaN(base.getTime())) base = now;
    var viewYear = base.getFullYear();
    var viewMonth = base.getMonth(); // 0-11
    var selYear = base.getFullYear();
    var selMonth = base.getMonth();
    var selDay = base.getDate();
    var selHour = base.getHours();
    var selMinute = MINUTE_STEP_OPTIONS.reduce(function (closest, m) {
      return Math.abs(m - base.getMinutes()) < Math.abs(closest - base.getMinutes()) ? m : closest;
    }, 0);

    var overlay = document.createElement('div');
    overlay.className = 'competition-datetime-picker-overlay';

    function pad(n) {
      return String(n).padStart(2, '0');
    }

    function buildDaysGridHtml() {
      var firstOfMonth = new Date(viewYear, viewMonth, 1);
      var startWeekday = firstOfMonth.getDay();
      var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      var todayY = now.getFullYear(), todayM = now.getMonth(), todayD = now.getDate();
      var cells = [];
      var i;
      for (i = 0; i < startWeekday; i++) cells.push('<span class="competition-datetime-picker-day is-empty"></span>');
      for (i = 1; i <= daysInMonth; i++) {
        var isSelected = viewYear === selYear && viewMonth === selMonth && i === selDay;
        var isToday = viewYear === todayY && viewMonth === todayM && i === todayD;
        cells.push(
          '<button type="button" class="competition-datetime-picker-day' +
          (isSelected ? ' is-selected' : '') + (isToday && !isSelected ? ' is-today' : '') +
          '" data-day="' + i + '">' + i + '</button>'
        );
      }
      return cells.join('');
    }

    function buildTimeSelectHtml(idSuffix, options, current, formatFn) {
      return (
        '<select class="competition-datetime-picker-select" id="cAdminDtPicker' + idSuffix + '">' +
        options.map(function (v) {
          return '<option value="' + v + '"' + (v === current ? ' selected' : '') + '>' + formatFn(v) + '</option>';
        }).join('') +
        '</select>'
      );
    }

    var hourOptions = [];
    for (var h = 0; h < 24; h++) hourOptions.push(h);

    function render() {
      overlay.innerHTML =
        '<div class="competition-datetime-picker" role="dialog" aria-modal="true" aria-label="날짜·시간 선택">' +
        '  <div class="competition-datetime-picker-header">' +
        '    <button type="button" class="competition-datetime-picker-nav" data-dir="-1" aria-label="이전 달">&lsaquo;</button>' +
        '    <span class="competition-datetime-picker-title">' + viewYear + '년 ' + (viewMonth + 1) + '월</span>' +
        '    <button type="button" class="competition-datetime-picker-nav" data-dir="1" aria-label="다음 달">&rsaquo;</button>' +
        '  </div>' +
        '  <div class="competition-datetime-picker-weekdays">' +
             WEEKDAY_LABELS_KO.map(function (w) { return '<span>' + w + '</span>'; }).join('') +
        '  </div>' +
        '  <div class="competition-datetime-picker-days">' + buildDaysGridHtml() + '</div>' +
        '  <div class="competition-datetime-picker-time-row">' +
        '    <span class="competition-datetime-picker-time-label">시간</span>' +
        buildTimeSelectHtml('Hour', hourOptions, selHour, function (v) { return pad(v) + '시'; }) +
        buildTimeSelectHtml('Minute', MINUTE_STEP_OPTIONS, selMinute, function (v) { return pad(v) + '분'; }) +
        '  </div>' +
        '  <div class="competition-datetime-picker-footer">' +
        '    <button type="button" class="competition-datetime-picker-btn is-cancel">취소</button>' +
        '    <button type="button" class="competition-datetime-picker-btn is-confirm">확인</button>' +
        '  </div>' +
        '</div>';

      overlay.querySelector('.competition-datetime-picker-header').addEventListener('click', function (e) {
        var btn = e.target.closest('.competition-datetime-picker-nav');
        if (!btn) return;
        viewMonth += Number(btn.getAttribute('data-dir'));
        if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
        else if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
        render();
      });
      overlay.querySelector('.competition-datetime-picker-days').addEventListener('click', function (e) {
        var btn = e.target.closest('.competition-datetime-picker-day');
        if (!btn || btn.classList.contains('is-empty')) return;
        selYear = viewYear;
        selMonth = viewMonth;
        selDay = Number(btn.getAttribute('data-day'));
        render();
      });
      overlay.querySelector('.competition-datetime-picker-btn.is-cancel').addEventListener('click', close);
      overlay.querySelector('.competition-datetime-picker-btn.is-confirm').addEventListener('click', function () {
        selHour = Number(overlay.querySelector('#cAdminDtPickerHour').value);
        selMinute = Number(overlay.querySelector('#cAdminDtPickerMinute').value);
        var value =
          selYear + '-' + pad(selMonth + 1) + '-' + pad(selDay) + 'T' + pad(selHour) + ':' + pad(selMinute);
        close();
        if (typeof onConfirm === 'function') onConfirm(value);
      });
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') close();
    }
    function close() {
      document.removeEventListener('keydown', onKeyDown);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKeyDown);
    render();
    document.body.appendChild(overlay);
  }

  function wireDateTimeField(overlay, id) {
    var trigger = overlay.querySelector('#' + id + '_trigger');
    var hiddenInput = overlay.querySelector('#' + id);
    if (!trigger || !hiddenInput) return;
    trigger.addEventListener('click', function () {
      openDateTimePickerPopup(hiddenInput.value, function (value) {
        hiddenInput.value = value;
        var textEl = trigger.querySelector('.competition-datetime-trigger-text');
        textEl.textContent = formatDateTimeDisplayKo(value);
        textEl.removeAttribute('data-placeholder');
      });
    });
  }

  function openForm(comp, onSaved) {
    if (!window.competitionBottomSheet || !window.competitionBottomSheet.openRawSheet) {
      console.error('[competitionAdminForm] competitionBottomSheet.openRawSheet 필요');
      return;
    }
    var isEdit = !!(comp && comp.id);
    var body = buildFormBody(comp || {});
    var footer =
      '<button type="button" class="competition-submit-btn" id="cAdminSaveBtn">' +
      (isEdit ? '수정 저장' : '대회 만들기') +
      '</button>';
    var overlay = window.competitionBottomSheet.openRawSheet(isEdit ? '대회 정보 수정' : '새 대회 만들기', body, footer);
    var saveBtn = overlay.querySelector('#cAdminSaveBtn');
    var errorEl = overlay.querySelector('#cAdminError');
    var posterField = wireImageUploadField(overlay, 'cAdminPoster');
    var courseMapField = wireGpxUploadField(overlay, 'cAdminCourseMap', (comp || {}).gpxUrl);
    wireDateTimeField(overlay, 'cAdminRaceDate');
    wireDateTimeField(overlay, 'cAdminOpensAt');
    wireDateTimeField(overlay, 'cAdminClosesAt');

    saveBtn.addEventListener('click', async function () {
      errorEl.classList.remove('is-visible');
      var parsed = readFormValues(overlay);
      if (parsed.error) {
        errorEl.textContent = parsed.error;
        errorEl.classList.add('is-visible');
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중...';
      try {
        var savedId = await saveCompetition(isEdit ? comp.id : null, parsed.data);

        var imageUpdates = {};
        var posterFile = posterField.getFile();
        var courseMapFile = courseMapField.getFile();
        if (posterFile) {
          saveBtn.textContent = '포스터 이미지 업로드 중...';
          imageUpdates.posterImageUrl = await uploadCompetitionImage(savedId, posterFile, 'poster');
        } else if (posterField.isRemoved()) {
          imageUpdates.posterImageUrl = null;
        }
        if (courseMapFile) {
          saveBtn.textContent = 'GPX 업로드 중...';
          imageUpdates.gpxUrl = await uploadCompetitionGpx(savedId, courseMapFile);
        } else if (courseMapField.isRemoved()) {
          imageUpdates.gpxUrl = null;
        }
        if (Object.keys(imageUpdates).length) {
          await saveCompetition(savedId, imageUpdates);
        }

        window.competitionBottomSheet.closeSheet();
        if (typeof onSaved === 'function') onSaved();
      } catch (e) {
        errorEl.textContent = (e && e.message) || '저장에 실패했습니다.';
        errorEl.classList.add('is-visible');
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? '수정 저장' : '대회 만들기';
      }
    });
  }

  async function confirmAndDelete(comp, onDeleted) {
    if (!comp || !comp.id) return;
    var ok = window.confirm('"' + comp.title + '" 대회를 삭제할까요? 신청 내역은 삭제되지 않지만 목록에서 사라집니다.');
    if (!ok) return;
    try {
      await deleteCompetitionDoc(comp.id);
      if (typeof onDeleted === 'function') onDeleted();
    } catch (e) {
      alert((e && e.message) || '삭제에 실패했습니다.');
    }
  }

  window.competitionAdminForm = {
    isAdmin: isAdmin,
    openForm: openForm,
    confirmAndDelete: confirmAndDelete,
    downloadApplicantsCsv: downloadApplicantsCsv,
    approveCompetition: approveCompetition,
    rejectCompetition: rejectCompetition,
    backfillLegacyApprovalStatus: backfillLegacyApprovalStatus,
  };
})();
