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
      buildImageUploadFieldHtml('cAdminCourseMap', '코스맵 이미지', comp.courseMapImageUrl) +
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
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminRaceDate">대회 일시</label>' +
      '  <input class="competition-form-input" id="cAdminRaceDate" type="datetime-local" value="' + toDatetimeLocalValue(comp.raceDate) + '" />' +
      '</div>' +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminEntryFee">참가비(원)</label>' +
      '  <input class="competition-form-input" id="cAdminEntryFee" type="number" min="0" value="' + (Number(comp.entryFee) || 0) + '" />' +
      '</div>' +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminCapacity">정원</label>' +
      '  <input class="competition-form-input" id="cAdminCapacity" type="number" min="1" value="' + (Number(comp.capacity) || 100) + '" />' +
      '</div>' +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminOpensAt">접수 시작</label>' +
      '  <input class="competition-form-input" id="cAdminOpensAt" type="datetime-local" value="' + toDatetimeLocalValue(comp.opensAt) + '" />' +
      '</div>' +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminClosesAt">접수 마감</label>' +
      '  <input class="competition-form-input" id="cAdminClosesAt" type="datetime-local" value="' + toDatetimeLocalValue(comp.closesAt) + '" />' +
      '</div>' +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminValidHours">가상계좌 입금 기한(시간)</label>' +
      '  <input class="competition-form-input" id="cAdminValidHours" type="number" min="1" value="' + (Number(comp.validHours) || 1) + '" />' +
      '</div>' +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminBank">가상계좌 발급 은행 코드</label>' +
      '  <input class="competition-form-input" id="cAdminBank" type="text" placeholder="예: 20" value="' +
        escapeHtml((comp.bankAllowlist && comp.bankAllowlist[0]) || '20') + '" />' +
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
    var courseMapField = wireImageUploadField(overlay, 'cAdminCourseMap');

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
          saveBtn.textContent = '코스맵 이미지 업로드 중...';
          imageUpdates.courseMapImageUrl = await uploadCompetitionImage(savedId, courseMapFile, 'coursemap');
        } else if (courseMapField.isRemoved()) {
          imageUpdates.courseMapImageUrl = null;
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
  };
})();
