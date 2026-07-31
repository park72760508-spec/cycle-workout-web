/**
 * 대회 신청서 작성 폼 — "신청하기" 클릭 시 가상계좌를 바로 발급하는 대신, 참가자 정보를 먼저 받는다.
 * 제출("작성 완료, 신청하기") 시 competitionScreen.js가 주입한 onSubmit(applicant)을 호출하며,
 * onSubmit이 resolve하면 시트를 닫고, reject하면 에러를 표시하고 재시도할 수 있도록 열어둔다
 * (competitionBottomSheet.showRefundFormSheet와 동일한 onSubmit 패턴).
 */
(function () {
  var GENDER_OPTIONS = [
    { value: 'M', label: '남' },
    { value: 'F', label: '여' },
  ];
  var NATIONALITY_OPTIONS = [
    { value: 'DOMESTIC', label: '내국인' },
    { value: 'FOREIGN', label: '외국인' },
  ];
  var DIVISION_OPTIONS = {
    RUN: [
      { value: 'FULL', label: 'Full' },
      { value: 'HALF', label: 'Half' },
      { value: '10K', label: '10km' },
      { value: '5K', label: '5km' },
    ],
    CYCLE: [
      { value: 'GRANFONDO', label: '그란폰도' },
      { value: 'MEDIOFONDO', label: '메디오폰도' },
    ],
  };
  var SIZE_OPTIONS = [
    { value: 'S', label: 'S (90)' },
    { value: 'M', label: 'M (95)' },
    { value: 'L', label: 'L (100)' },
    { value: 'XL', label: 'XL (105)' },
    { value: 'XXL', label: 'XXL (110)' },
  ];
  /** CYCLE 출발 그룹 — 맞춤 필터 설정의 관심 레벨(입문~상급) 기준. A조가 가장 빠른(상급) 조. */
  var CYCLE_START_GROUP_OPTIONS = [
    { value: 'A', label: 'A조', levelLabel: '상급' },
    { value: 'B', label: 'B조', levelLabel: '중상급' },
    { value: 'C', label: 'C조', levelLabel: '중급' },
    { value: 'D', label: 'D조', levelLabel: '초급' },
    { value: 'E', label: 'E조', levelLabel: '입문' },
  ];
  /** RUN 출발 그룹 — 10k 페이스 기준(초/km 이내). E조는 상한 없음(느린 러너 기본 조). */
  var RUN_START_GROUP_OPTIONS = [
    { value: 'A', label: 'A조', maxSec: 240 },
    { value: 'B', label: 'B조', maxSec: 300 },
    { value: 'C', label: 'C조', maxSec: 360 },
    { value: 'D', label: 'D조', maxSec: 480 },
    { value: 'E', label: 'E조', maxSec: Infinity },
  ];
  var BLOOD_TYPE_OPTIONS = [
    { value: 'RH+A', label: 'RH+ A형' },
    { value: 'RH+B', label: 'RH+ B형' },
    { value: 'RH+O', label: 'RH+ O형' },
    { value: 'RH+AB', label: 'RH+ AB형' },
    { value: 'RH-A', label: 'RH- A형' },
    { value: 'RH-B', label: 'RH- B형' },
    { value: 'RH-O', label: 'RH- O형' },
    { value: 'RH-AB', label: 'RH- AB형' },
  ];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isCycle(comp) {
    return comp && comp.category === 'CYCLE';
  }

  function formatPhoneDigits(raw) {
    var numbers = String(raw || '').replace(/\D/g, '').slice(0, 11);
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 7) return numbers.slice(0, 3) + '-' + numbers.slice(3);
    return numbers.slice(0, 3) + '-' + numbers.slice(3, 7) + '-' + numbers.slice(7, 11);
  }

  function wirePhoneAutoHyphen(inputEl, onChange) {
    inputEl.setAttribute('inputmode', 'numeric');
    inputEl.setAttribute('maxlength', '13');
    inputEl.setAttribute('placeholder', '010-1234-5678');
    inputEl.addEventListener('input', function () {
      var prevLength = inputEl.value.length;
      var cursorPos = inputEl.selectionStart == null ? prevLength : inputEl.selectionStart;
      var formatted = formatPhoneDigits(inputEl.value);
      inputEl.value = formatted;
      var newPos = Math.max(0, cursorPos + (formatted.length - prevLength));
      inputEl.setSelectionRange(newPos, newPos);
      if (typeof onChange === 'function') onChange(formatted);
    });
  }

  function wireDigitsOnlyInput(inputEl, maxLen) {
    inputEl.setAttribute('inputmode', 'numeric');
    inputEl.setAttribute('maxlength', String(maxLen));
    inputEl.addEventListener('input', function () {
      var cleaned = inputEl.value.replace(/\D/g, '').slice(0, maxLen);
      if (inputEl.value !== cleaned) inputEl.value = cleaned;
    });
  }

  function isValidPhone(v) {
    return /^010-\d{4}-\d{4}$/.test(String(v || ''));
  }

  function isValidBirth6(digits) {
    if (!/^\d{6}$/.test(String(digits || ''))) return false;
    var mm = Number(digits.slice(2, 4));
    var dd = Number(digits.slice(4, 6));
    if (mm < 1 || mm > 12) return false;
    var daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1];
    return dd >= 1 && dd <= daysInMonth;
  }

  function chipGroupHtml(groupName, options, columns, selectedValue, disabledValues) {
    var cls = 'competition-chip-group' + (columns ? ' competition-chip-group--' + columns + 'col' : '');
    return (
      '<div class="' + cls + '" data-chip-group="' + groupName + '">' +
      options
        .map(function (opt) {
          var sel = selectedValue && opt.value === selectedValue ? ' is-selected' : '';
          var isDisabled = !!(disabledValues && disabledValues.indexOf(opt.value) !== -1);
          var disabledCls = isDisabled ? ' is-disabled' : '';
          var disabledAttr = isDisabled ? ' disabled' : '';
          return (
            '<button type="button" class="competition-chip' + sel + disabledCls + '" data-value="' + escapeHtml(opt.value) + '"' + disabledAttr + '>' +
            escapeHtml(opt.label) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /** 섹션 하나를 카드로 감싼다 — 접고 펼치는 동작 없이 1~5번이 항상 모두 펼쳐져 보인다 */
  function buildAccordionItemHtml(section, index) {
    return (
      '<div class="competition-accordion-item' + (section.extraClass ? ' ' + section.extraClass : '') + '">' +
      '  <div class="competition-accordion-header">' +
      '    <span class="competition-accordion-step">' + (index + 1) + '</span>' +
      '    <span class="competition-accordion-header-text">' +
      '      <span class="competition-accordion-title">' + escapeHtml(section.title) +
      (section.badge ? ' <span class="competition-form-required-badge">' + escapeHtml(section.badge) + '</span>' : '') +
      '</span>' +
      '    </span>' +
      '  </div>' +
      '  <div class="competition-accordion-body" id="' + section.id + '-body">' +
      section.bodyHtml +
      '  </div>' +
      '</div>'
    );
  }

  function buildSectionPersonal(a) {
    a = a || {};
    return (
      '<div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppName">이름</label>' +
      '    <input class="competition-form-input" id="cAppName" type="text" placeholder="실명을 입력해 주세요" value="' + escapeHtml(a.name) + '" />' +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label">성별</label>' +
      chipGroupHtml('gender', GENDER_OPTIONS, 2, a.gender) +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppBirth6">생년월일 (6자리, 예: 960101)</label>' +
      '    <input class="competition-form-input" id="cAppBirth6" type="text" placeholder="YYMMDD" value="' + escapeHtml(a.birth6) + '" />' +
      '  </div>' +
      '  <div class="competition-form-field" style="margin-bottom:0;">' +
      '    <label class="competition-form-label">국적</label>' +
      chipGroupHtml('nationality', NATIONALITY_OPTIONS, 2, a.nationality) +
      '  </div>'
    );
  }

  function buildSectionContact(a) {
    a = a || {};
    return (
      '<div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppPhone">휴대전화 번호</label>' +
      '    <input class="competition-form-input" id="cAppPhone" type="tel" placeholder="010-1234-5678" value="' + escapeHtml(a.phone) + '" />' +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppZip">배송지 주소 (기념품 발송)</label>' +
      '    <div class="competition-address-row">' +
      '      <input class="competition-form-input" id="cAppZip" type="text" placeholder="우편번호" readonly value="' + escapeHtml(a.zipCode) + '" />' +
      '      <button type="button" class="competition-address-search-btn" id="cAppZipSearchBtn">우편번호 찾기</button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <input class="competition-form-input" id="cAppAddress1" type="text" placeholder="기본 주소 (우편번호 찾기로 자동 입력)" readonly value="' + escapeHtml(a.address1) + '" />' +
      '  </div>' +
      '  <div class="competition-form-field" style="margin-bottom:0;">' +
      '    <input class="competition-form-input" id="cAppAddress2" type="text" placeholder="상세 주소 (동/호수 등)" value="' + escapeHtml(a.address2) + '" />' +
      '  </div>'
    );
  }

  function buildSectionRace(comp, a) {
    a = a || {};
    var cycle = isCycle(comp);
    var divisions = cycle ? DIVISION_OPTIONS.CYCLE : DIVISION_OPTIONS.RUN;
    var sizeLabel = cycle ? '져지 사이즈' : '기념품(티셔츠) 사이즈';
    var startGroupBlock = cycle
      ? (
        '<div class="competition-form-field" style="margin-bottom:0;">' +
        '    <label class="competition-form-label">출발 그룹</label>' +
        '    <p class="competition-form-hint" id="cAppStartGroupPaceStatus">항속 능력 확인 중…</p>' +
        chipGroupHtml('startGroup', CYCLE_START_GROUP_OPTIONS, 5, a.startGroup) +
        '    <p class="competition-form-hint">A조(35km/h~), B조(~35km/h), C조(~32km/h), D조(~28km/h), E조(~25km/h)</p>' +
        '  </div>'
      )
      : (
        '<div class="competition-form-field" style="margin-bottom:0;">' +
        '    <label class="competition-form-label">출발 그룹' +
        '      <span class="competition-form-hint-inline" id="cAppStartGroupPaceStatus">10k 페이스 확인 중…</span>' +
        '    </label>' +
        chipGroupHtml('startGroup', RUN_START_GROUP_OPTIONS, 5, a.startGroup) +
        '    <p class="competition-form-hint">A조(4분 이내), B조(5분 이내), C조(6분 이내), D조(8분 이내), E조(9분 초과) / 10km 페이스 기준</p>' +
        '  </div>'
      );
    return (
      '<div class="competition-form-field">' +
      '    <label class="competition-form-label">참가 부문</label>' +
      chipGroupHtml('division', divisions, null, a.division) +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label">' + escapeHtml(sizeLabel) + '</label>' +
      chipGroupHtml('size', SIZE_OPTIONS, null, a.size) +
      '  </div>' +
      startGroupBlock
    );
  }

  function buildSectionMedical(a) {
    a = a || {};
    var bloodOptionsHtml = BLOOD_TYPE_OPTIONS.map(function (o) {
      var sel = a.bloodType === o.value ? ' selected' : '';
      return '<option value="' + o.value + '"' + sel + '>' + escapeHtml(o.label) + '</option>';
    }).join('');
    return (
      '<p class="competition-form-hint">대회 중 응급 상황 대비용으로만 사용되며, 신속한 대응을 위해 정확히 입력해 주세요.</p>' +
      '<div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppEmergencyName">비상 연락처 — 이름</label>' +
      '    <input class="competition-form-input" id="cAppEmergencyName" type="text" placeholder="비상 연락처 이름" value="' + escapeHtml(a.emergencyName) + '" />' +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppEmergencyRelation">참가자와의 관계</label>' +
      '    <input class="competition-form-input" id="cAppEmergencyRelation" type="text" placeholder="예: 배우자, 부모, 형제자매" value="' + escapeHtml(a.emergencyRelation) + '" />' +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppEmergencyPhone">비상 연락처 — 휴대전화 번호</label>' +
      '    <input class="competition-form-input" id="cAppEmergencyPhone" type="tel" placeholder="010-1234-5678" value="' + escapeHtml(a.emergencyPhone) + '" />' +
      '    <div class="competition-form-error-inline" id="cAppEmergencyPhoneError">비상 연락처는 본인의 연락처와 동일할 수 없습니다.</div>' +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppBloodType">혈액형</label>' +
      '    <select class="competition-form-select" id="cAppBloodType">' +
      '      <option value="" disabled' + (a.bloodType ? '' : ' selected') + '>선택해 주세요</option>' +
      bloodOptionsHtml +
      '    </select>' +
      '  </div>' +
      '  <div class="competition-form-field" style="margin-bottom:0;">' +
      '    <label class="competition-form-label" for="cAppMedicalNote">의료 특이사항 (선택)</label>' +
      '    <textarea class="competition-form-input" id="cAppMedicalNote" rows="3" placeholder="심혈관계 질환, 천식, 알레르기 등 대회 중 응급 대응에 참고할 사항을 자유롭게 적어 주세요">' + escapeHtml(a.medicalNote) + '</textarea>' +
      '  </div>'
    );
  }

  function buildSectionAgreements(a) {
    var checkedAttr = a ? ' checked' : '';
    return (
      '<div class="competition-agreement-row is-all">' +
      '    <input type="checkbox" class="competition-agreement-checkbox" id="cAppAgreeAll"' + checkedAttr + ' />' +
      '    <label class="competition-agreement-label is-all" for="cAppAgreeAll">전체 동의하기</label>' +
      '  </div>' +
      '  <div class="competition-agreement-row">' +
      '    <input type="checkbox" class="competition-agreement-checkbox" id="cAppAgreePrivacyCollect" data-required-agree="1"' + checkedAttr + ' />' +
      '    <label class="competition-agreement-label" for="cAppAgreePrivacyCollect">' +
      '      <span class="competition-agreement-required">[필수]</span>개인정보 수집 및 이용 동의' +
      '      <div class="competition-agreement-detail">신청자 성명·생년월일·연락처·주소 등을 대회 참가 접수 및 운영 목적으로 수집·이용하는 것에 동의합니다.</div>' +
      '    </label>' +
      '  </div>' +
      '  <div class="competition-agreement-row">' +
      '    <input type="checkbox" class="competition-agreement-checkbox" id="cAppAgreePrivacyThirdParty" data-required-agree="1"' + checkedAttr + ' />' +
      '    <label class="competition-agreement-label" for="cAppAgreePrivacyThirdParty">' +
      '      <span class="competition-agreement-required">[필수]</span>개인정보 제3자 제공 동의' +
      '      <div class="competition-agreement-detail">기록 측정 업체(스마트칩), 택배사, 상해보험사 등 대회 운영에 필요한 업체에 신청 정보가 제공되는 것에 동의합니다.</div>' +
      '    </label>' +
      '  </div>' +
      '  <div class="competition-agreement-row" style="border-bottom:none;">' +
      '    <input type="checkbox" class="competition-agreement-checkbox" id="cAppAgreeMedicalWaiver" data-required-agree="1"' + checkedAttr + ' />' +
      '    <label class="competition-agreement-label" for="cAppAgreeMedicalWaiver">' +
      '      <span class="competition-agreement-required">[필수]</span>의료 면책 및 참가자 유의사항 동의' +
      '      <div class="competition-agreement-detail">본인의 건강 상태를 확인하고 참가하며, 대회 중 발생하는 부상 및 사고에 대해 주최 측에 책임을 묻지 않습니다.</div>' +
      '    </label>' +
      '  </div>'
    );
  }

  function wireChipGroups(overlay, state) {
    var groups = overlay.querySelectorAll('[data-chip-group]');
    for (var i = 0; i < groups.length; i++) {
      (function (groupEl) {
        var groupName = groupEl.getAttribute('data-chip-group');
        var chips = groupEl.querySelectorAll('.competition-chip');
        for (var j = 0; j < chips.length; j++) {
          (function (chip) {
            if (chip.classList.contains('is-selected')) {
              state[groupName] = chip.getAttribute('data-value');
            }
            chip.addEventListener('click', function () {
              if (chip.disabled || chip.classList.contains('is-disabled')) return;
              for (var k = 0; k < chips.length; k++) chips[k].classList.remove('is-selected');
              chip.classList.add('is-selected');
              state[groupName] = chip.getAttribute('data-value');
            });
          })(chips[j]);
        }
      })(groups[i]);
    }
  }

  function wireAgreements(overlay) {
    var allCb = overlay.querySelector('#cAppAgreeAll');
    var childCbs = Array.prototype.slice.call(overlay.querySelectorAll('[data-required-agree]'));
    allCb.addEventListener('change', function () {
      childCbs.forEach(function (cb) {
        cb.checked = allCb.checked;
      });
    });
    childCbs.forEach(function (cb) {
      cb.addEventListener('change', function () {
        allCb.checked = childCbs.every(function (c) {
          return c.checked;
        });
      });
    });
  }

  /**
   * 우편번호 찾기 — Daum 우편번호 서비스를 최초 클릭 시에만 지연 로드한다.
   * .open()은 내부적으로 window.open() 팝업을 띄우는데, 스크립트 지연 로드 후 콜백에서 호출되면
   * 사용자 제스처 컨텍스트가 끊겨 iOS Safari 등에서 팝업 차단에 걸린다(신고된 증상과 일치).
   * .embed()는 팝업 대신 오버레이 안에 iframe으로 직접 렌더링하므로 아이폰·안드로이드 모두에서
   * 팝업 차단과 무관하게 항상 표시된다.
   */
  function openDaumPostcode(onComplete) {
    function launch() {
      var overlay = document.createElement('div');
      overlay.className = 'competition-postcode-overlay';
      overlay.innerHTML =
        '<div class="competition-postcode-modal">' +
        '  <div class="competition-postcode-header">' +
        '    <span>주소 검색</span>' +
        '    <button type="button" class="competition-postcode-close" aria-label="닫기">&times;</button>' +
        '  </div>' +
        '  <div class="competition-postcode-embed"></div>' +
        '</div>';
      document.body.appendChild(overlay);

      var removed = false;
      var remove = function () {
        if (removed) return;
        removed = true;
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      };
      overlay.querySelector('.competition-postcode-close').addEventListener('click', remove);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) remove();
      });

      new window.daum.Postcode({
        oncomplete: function (data) {
          var addr = data.userSelectedType === 'R' ? data.roadAddress : data.jibunAddress;
          var extra = '';
          if (data.userSelectedType === 'R') {
            if (data.bname) extra += data.bname;
            if (data.buildingName) extra += extra ? ', ' + data.buildingName : data.buildingName;
            if (extra) addr += ' (' + extra + ')';
          }
          remove();
          onComplete({ zonecode: data.zonecode, address: addr });
        },
        width: '100%',
        height: '100%',
      }).embed(overlay.querySelector('.competition-postcode-embed'));
    }
    if (window.daum && window.daum.Postcode) {
      launch();
      return;
    }
    var script = document.createElement('script');
    script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    script.onload = launch;
    script.onerror = function () {
      alert('우편번호 서비스를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    };
    document.body.appendChild(script);
  }

  function wireAddressSearch(overlay) {
    var btn = overlay.querySelector('#cAppZipSearchBtn');
    btn.addEventListener('click', function () {
      openDaumPostcode(function (result) {
        overlay.querySelector('#cAppZip').value = result.zonecode;
        overlay.querySelector('#cAppAddress1').value = result.address;
        var addr2 = overlay.querySelector('#cAppAddress2');
        addr2.focus();
      });
    });
  }

  function wireEmergencyPhoneCheck(overlay) {
    var phoneEl = overlay.querySelector('#cAppPhone');
    var emergencyEl = overlay.querySelector('#cAppEmergencyPhone');
    var errorEl = overlay.querySelector('#cAppEmergencyPhoneError');
    var check = function () {
      var same =
        phoneEl.value && emergencyEl.value && phoneEl.value === emergencyEl.value && isValidPhone(phoneEl.value);
      errorEl.classList.toggle('is-visible', !!same);
    };
    phoneEl.addEventListener('input', check);
    emergencyEl.addEventListener('input', check);
  }

  function resolveCurrentUid() {
    try {
      return (window.authV9 && window.authV9.currentUser && window.authV9.currentUser.uid) || null;
    } catch (e) {
      return null;
    }
  }

  /** 10k 페이스(초/km) → RUN_START_GROUP_OPTIONS 인덱스(0=A조 가장 빠름 … 4=E조). */
  function computeRunStartGroupTierIndex(paceSec) {
    var sec = Number(paceSec);
    if (!isFinite(sec) || sec <= 0) return null;
    for (var i = 0; i < RUN_START_GROUP_OPTIONS.length; i++) {
      if (sec <= RUN_START_GROUP_OPTIONS[i].maxSec) return i;
    }
    return RUN_START_GROUP_OPTIONS.length - 1;
  }

  /**
   * 신청자의 10k 페이스로 출발 그룹 자격을 조회한다.
   * 10k 기록이 없으면 7k → 5k 피크 페이스에 리겔 피로도(패널티)를 적용해 유추한다
   * (runDashboardPace.resolveRunCrewLevelPaceFromEfforts — 러닝 크루 레벨 판정과 동일 로직).
   */
  function fetchRunStartGroupPaceInfo() {
    var uid = resolveCurrentUid();
    var pace = window.runDashboardPace;
    if (
      !uid ||
      typeof window.getUserRunEfforts !== 'function' ||
      !pace ||
      typeof pace.resolveRunCrewLevelPaceFromEfforts !== 'function'
    ) {
      return Promise.resolve({ tierIndex: null, paceSec: null, display: null, inferred: false });
    }
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - 90);
    var cutoffStr =
      cutoff.getFullYear() +
      '-' +
      String(cutoff.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(cutoff.getDate()).padStart(2, '0');
    return window
      .getUserRunEfforts(uid, { limit: 600 })
      .then(function (efforts) {
        var res = pace.resolveRunCrewLevelPaceFromEfforts(efforts, cutoffStr) || {};
        var paceSec = res.secPerKm != null && res.secPerKm > 0 ? res.secPerKm : null;
        return {
          tierIndex: computeRunStartGroupTierIndex(paceSec),
          paceSec: paceSec,
          display: res.display || null,
          inferred: !!res.inferred
        };
      })
      .catch(function () {
        return { tierIndex: null, paceSec: null, display: null, inferred: false };
      });
  }

  /**
   * tierIndex(0=A조 가장 빠름/어려움 … 마지막=가장 느림/쉬움)보다 빠른(자격 없는) 조 버튼을
   * 비활성화하고, 선택돼 있었다면 해제한다. RUN·CYCLE 출발 그룹 공용.
   */
  function applyStartGroupEligibility(overlay, chipState, tierIndex, options) {
    var groupEl = overlay.querySelector('[data-chip-group="startGroup"]');
    if (!groupEl) return;
    var chips = groupEl.querySelectorAll('.competition-chip');
    for (var i = 0; i < chips.length; i++) {
      var chip = chips[i];
      var value = chip.getAttribute('data-value');
      var optIdx = -1;
      for (var j = 0; j < options.length; j++) {
        if (options[j].value === value) {
          optIdx = j;
          break;
        }
      }
      var disabled = optIdx >= 0 && optIdx < tierIndex;
      chip.disabled = disabled;
      chip.classList.toggle('is-disabled', disabled);
      if (disabled && chipState.startGroup === value) {
        chip.classList.remove('is-selected');
        chipState.startGroup = null;
      }
    }
  }

  function wireRunStartGroupPace(overlay, comp, chipState) {
    if (isCycle(comp)) return;
    var statusEl = overlay.querySelector('#cAppStartGroupPaceStatus');
    fetchRunStartGroupPaceInfo().then(function (info) {
      if (info.tierIndex == null) {
        if (statusEl) statusEl.textContent = '최근 90일 러닝 기록이 없어 전체 조 선택이 가능합니다.';
        return;
      }
      applyStartGroupEligibility(overlay, chipState, info.tierIndex, RUN_START_GROUP_OPTIONS);
      if (statusEl) {
        statusEl.textContent = '나의 10k 페이스 ' + (info.display || '-') + (info.inferred ? ' (유추)' : '') + ' 기준';
      }
    });
  }

  /** 맞춤 필터 설정 > 관심 레벨과 동일한 판정: 프로필 FTP·체중 → 평지 개인 평속(km/h) → 레벨 라벨. */
  function resolveCurrentProfileFtpWeight() {
    var u = null;
    try {
      u = (typeof window !== 'undefined' && window.currentUser) ? window.currentUser : null;
      if (!u) u = JSON.parse(localStorage.getItem('currentUser') || 'null');
    } catch (e) {
      u = null;
    }
    var ftp = u && Number(u.ftp) > 0 ? Number(u.ftp) : 0;
    var weight = u && Number(u.weight) > 0 ? Number(u.weight) : 0;
    return { ftp: ftp, weight: weight, ok: ftp > 0 && weight > 0 };
  }

  /**
   * 맞춤 필터 설정 > 관심 레벨의 "현실 지표"와 동일: 최근 6개월 60분 최고 평균 파워(랭킹 산출)로
   * 항속 능력을 구한다. 랭킹 데이터에 60분 피크가 없으면 { watts: 0 }을 반환해 FTP 폴백을 타게 한다.
   */
  function fetchCyclePeak60WattsInfo(uid) {
    if (!uid) return Promise.resolve({ watts: 0, weightKg: 0 });
    var params = new URLSearchParams({ period: 'rolling6m', duration: '60min', gender: 'all', uid: String(uid) });
    var url = 'https://us-central1-stelvio-ai.cloudfunctions.net/getPeakPowerRanking?' + params.toString();
    return fetch(url, { method: 'GET', mode: 'cors' })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.success) return { watts: 0, weightKg: 0 };
        var cu = data.currentUser || null;
        var watts = cu && Number(cu.watts) > 0 ? Number(cu.watts) : 0;
        var weightKg = cu && Number(cu.weightKg) > 0 ? Number(cu.weightKg) : 0;
        return { watts: watts, weightKg: weightKg };
      })
      .catch(function () {
        return { watts: 0, weightKg: 0 };
      });
  }

  /** 관심 레벨 라벨(입문~상급) → CYCLE_START_GROUP_OPTIONS 인덱스(0=A조 상급 … 4=E조 입문). */
  var CYCLE_LEVEL_TO_START_GROUP_VALUE = { 상급: 'A', 중상급: 'B', 중급: 'C', 초급: 'D', 입문: 'E' };
  function computeCycleStartGroupTierIndex(soloKmh) {
    var v = Number(soloKmh);
    if (!isFinite(v) || v <= 0) return null;
    var labelFn =
      typeof window !== 'undefined' && typeof window.getOpenRidingSoloTierLevelLabelFromKmH === 'function'
        ? window.getOpenRidingSoloTierLevelLabelFromKmH
        : null;
    if (!labelFn) return null;
    var levelLabel = labelFn(v);
    var groupValue = CYCLE_LEVEL_TO_START_GROUP_VALUE[levelLabel];
    for (var i = 0; i < CYCLE_START_GROUP_OPTIONS.length; i++) {
      if (CYCLE_START_GROUP_OPTIONS[i].value === groupValue) return i;
    }
    return null;
  }

  function wireCycleStartGroupPace(overlay, comp, chipState) {
    if (!isCycle(comp)) return;
    var statusEl = overlay.querySelector('#cAppStartGroupPaceStatus');
    var prof = resolveCurrentProfileFtpWeight();
    var refFn =
      typeof window !== 'undefined' && typeof window.getFilterInterestReferenceSoloSpeedKmH === 'function'
        ? window.getFilterInterestReferenceSoloSpeedKmH
        : null;
    if (!refFn) {
      if (statusEl) statusEl.textContent = '프로필에 FTP·체중을 입력하면 전체 조 선택이 가능합니다.';
      return;
    }
    var uid = resolveCurrentUid();
    fetchCyclePeak60WattsInfo(uid).then(function (peakInfo) {
      var weightForCalc = peakInfo.weightKg > 0 ? peakInfo.weightKg : prof.weight;
      if (!(weightForCalc > 0)) {
        if (statusEl) statusEl.textContent = '프로필에 FTP·체중을 입력하면 전체 조 선택이 가능합니다.';
        return;
      }
      var soloKmh = refFn(peakInfo.watts, prof.ftp, weightForCalc);
      if (soloKmh == null) {
        if (statusEl) statusEl.textContent = '프로필에 FTP·체중을 입력하면 전체 조 선택이 가능합니다.';
        return;
      }
      var tierIndex = computeCycleStartGroupTierIndex(soloKmh);
      if (tierIndex == null) {
        if (statusEl) statusEl.textContent = '';
        return;
      }
      applyStartGroupEligibility(overlay, chipState, tierIndex, CYCLE_START_GROUP_OPTIONS);
      if (statusEl) {
        statusEl.innerHTML = '나의 항속 능력<br>' + soloKmh + 'km/h';
      }
    });
  }

  function validateAndCollect(overlay, comp, chipState) {
    var q = function (id) {
      return overlay.querySelector('#' + id);
    };
    var name = q('cAppName').value.trim();
    var birth6 = q('cAppBirth6').value.trim();
    var phone = q('cAppPhone').value.trim();
    var zip = q('cAppZip').value.trim();
    var address1 = q('cAppAddress1').value.trim();
    var address2 = q('cAppAddress2').value.trim();
    var emergencyName = q('cAppEmergencyName').value.trim();
    var emergencyRelation = q('cAppEmergencyRelation').value.trim();
    var emergencyPhone = q('cAppEmergencyPhone').value.trim();
    var bloodType = q('cAppBloodType').value;
    var medicalNote = q('cAppMedicalNote').value.trim();
    var validDivisions = (isCycle(comp) ? DIVISION_OPTIONS.CYCLE : DIVISION_OPTIONS.RUN).map(function (o) {
      return o.value;
    });

    if (!name) return { error: '이름을 입력해 주세요.', sectionId: 'personal' };
    if (!chipState.gender) return { error: '성별을 선택해 주세요.', sectionId: 'personal' };
    if (!isValidBirth6(birth6)) return { error: '생년월일 6자리를 정확히 입력해 주세요(예: 960101).', sectionId: 'personal' };
    if (!chipState.nationality) return { error: '국적을 선택해 주세요.', sectionId: 'personal' };
    if (!isValidPhone(phone)) return { error: '휴대전화 번호를 정확히 입력해 주세요(010-XXXX-XXXX).', sectionId: 'contact' };
    if (!zip || !address1) return { error: '우편번호 찾기로 배송지 주소를 입력해 주세요.', sectionId: 'contact' };
    if (!address2) return { error: '상세 주소를 입력해 주세요.', sectionId: 'contact' };
    if (!chipState.division || validDivisions.indexOf(chipState.division) === -1) {
      return { error: '참가 부문을 선택해 주세요.', sectionId: 'race' };
    }
    if (!chipState.size) return { error: '기념품 사이즈를 선택해 주세요.', sectionId: 'race' };
    if (!chipState.startGroup) return { error: '출발 그룹을 선택해 주세요.', sectionId: 'race' };
    if (!emergencyName) return { error: '비상 연락처 이름을 입력해 주세요.', sectionId: 'medical' };
    if (!emergencyRelation) return { error: '참가자와의 관계를 입력해 주세요.', sectionId: 'medical' };
    if (!isValidPhone(emergencyPhone)) {
      return { error: '비상 연락처 번호를 정확히 입력해 주세요(010-XXXX-XXXX).', sectionId: 'medical' };
    }
    if (emergencyPhone === phone) {
      return { error: '비상 연락처는 본인의 연락처와 동일할 수 없습니다.', sectionId: 'medical' };
    }
    if (!bloodType) return { error: '혈액형을 선택해 주세요.', sectionId: 'medical' };
    var agreeAll =
      overlay.querySelector('#cAppAgreePrivacyCollect').checked &&
      overlay.querySelector('#cAppAgreePrivacyThirdParty').checked &&
      overlay.querySelector('#cAppAgreeMedicalWaiver').checked;
    if (!agreeAll) return { error: '필수 약관에 모두 동의해 주세요.', sectionId: 'agreements' };

    return {
      data: {
        name: name,
        gender: chipState.gender,
        birth6: birth6,
        nationality: chipState.nationality,
        phone: phone,
        zipCode: zip,
        address1: address1,
        address2: address2,
        division: chipState.division,
        size: chipState.size,
        startGroup: chipState.startGroup,
        emergencyName: emergencyName,
        emergencyRelation: emergencyRelation,
        emergencyPhone: emergencyPhone,
        bloodType: bloodType,
        medicalNote: medicalNote,
        agreements: {
          privacyCollect: true,
          privacyThirdParty: true,
          medicalWaiver: true,
        },
      },
    };
  }

  /**
   * @param {object} comp — competitions 문서(category 포함)
   * @param {function(object): Promise} onSubmit — 검증된 applicant 데이터를 넘겨받아 실제 신청 API를 호출하는 콜백.
   *   resolve하면 시트를 닫고, reject(Error)하면 에러 문구를 표시하고 폼을 유지한다.
   */
  function openApplicationForm(comp, onSubmit, existingApplicant) {
    if (!window.competitionBottomSheet || !window.competitionBottomSheet.openRawSheet) {
      console.error('[competitionApplicationForm] competitionBottomSheet.openRawSheet 필요');
      return;
    }
    var isEdit = !!existingApplicant;
    var chipState = { gender: null, nationality: null, division: null, size: null, startGroup: null };
    var sportLabel = isCycle(comp) ? 'CYCLE' : 'RUN';
    var sections = [
      { id: 'personal', title: '기본 인적 정보', badge: '필수', bodyHtml: buildSectionPersonal(existingApplicant) },
      { id: 'contact', title: '연락처 및 배송지 정보', badge: '필수', bodyHtml: buildSectionContact(existingApplicant) },
      {
        id: 'race',
        title: '대회 참가 정보 — ' + sportLabel,
        badge: '필수',
        bodyHtml: buildSectionRace(comp, existingApplicant),
      },
      {
        id: 'medical',
        title: '안전 및 의료 정보',
        badge: '필수',
        bodyHtml: buildSectionMedical(existingApplicant),
        extraClass: 'is-medical',
      },
      { id: 'agreements', title: '약관 동의', badge: '', bodyHtml: buildSectionAgreements(existingApplicant) },
    ];
    var body =
      sections.map(buildAccordionItemHtml).join('') +
      '<div class="competition-form-error" id="cAppError"></div>';
    var submitLabel = isEdit ? '수정 완료' : '작성 완료, 신청하기';
    var footer = '<button type="button" class="competition-submit-btn" id="cAppSubmitBtn">' + submitLabel + '</button>';
    var overlay = window.competitionBottomSheet.openRawSheet(isEdit ? '신청서 수정' : '참가 신청서 작성', body, footer);

    wireChipGroups(overlay, chipState);
    wireRunStartGroupPace(overlay, comp, chipState);
    wireCycleStartGroupPace(overlay, comp, chipState);
    wireAgreements(overlay);
    wireAddressSearch(overlay);
    wireDigitsOnlyInput(overlay.querySelector('#cAppBirth6'), 6);
    wirePhoneAutoHyphen(overlay.querySelector('#cAppPhone'));
    wirePhoneAutoHyphen(overlay.querySelector('#cAppEmergencyPhone'));
    wireEmergencyPhoneCheck(overlay);

    var submitBtn = overlay.querySelector('#cAppSubmitBtn');
    var errorEl = overlay.querySelector('#cAppError');
    submitBtn.addEventListener('click', async function () {
      errorEl.classList.remove('is-visible');
      var parsed = validateAndCollect(overlay, comp, chipState);
      if (parsed.error) {
        errorEl.textContent = parsed.error;
        errorEl.classList.add('is-visible');
        if (parsed.sectionId) {
          var sectionBodyEl = overlay.querySelector('#' + parsed.sectionId + '-body');
          if (sectionBodyEl) sectionBodyEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = isEdit ? '수정 중...' : '제출 중...';
      try {
        await onSubmit(parsed.data);
        window.competitionBottomSheet.closeSheet();
      } catch (e) {
        errorEl.textContent = (e && e.message) || '신청서 제출에 실패했습니다. 잠시 후 다시 시도해 주세요.';
        errorEl.classList.add('is-visible');
        submitBtn.disabled = false;
        submitBtn.textContent = submitLabel;
      }
    });
  }

  window.competitionApplicationForm = {
    open: openApplicationForm,
  };
})();
