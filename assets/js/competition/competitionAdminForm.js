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
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminDescription">상세 설명</label>' +
      '  <textarea class="competition-form-input" id="cAdminDescription" rows="4">' + escapeHtml(comp.description) + '</textarea>' +
      '</div>' +
      '<div class="competition-form-field">' +
      '  <label class="competition-form-label" for="cAdminLocation">장소</label>' +
      '  <input class="competition-form-input" id="cAdminLocation" type="text" value="' + escapeHtml(comp.location) + '" />' +
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
    var docRef = await fns.addDoc(fns.collection(db, 'competitions'), Object.assign({}, data, {
      createdAt: fns.serverTimestamp(),
      updatedAt: fns.serverTimestamp(),
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

  /**
   * 생성/수정 폼 바텀시트. competitionBottomSheet.js의 openSheet 프리미티브를 그대로 사용.
   * @param {object|null} comp — null이면 신규 생성, 값이 있으면 수정(comp.id 필요)
   * @param {function} onSaved — 저장 성공 후 호출(목록 새로고침용)
   */
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
        await saveCompetition(isEdit ? comp.id : null, parsed.data);
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
  };
})();
