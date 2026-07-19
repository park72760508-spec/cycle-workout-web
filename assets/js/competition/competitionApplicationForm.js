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
  var START_GROUP_OPTIONS = [
    { value: 'A', label: 'A조' },
    { value: 'B', label: 'B조' },
    { value: 'C', label: 'C조' },
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

  function chipGroupHtml(groupName, options, columns) {
    var cls = 'competition-chip-group' + (columns === 2 ? ' competition-chip-group--2col' : '');
    return (
      '<div class="' + cls + '" data-chip-group="' + groupName + '">' +
      options
        .map(function (opt) {
          return (
            '<button type="button" class="competition-chip" data-value="' + escapeHtml(opt.value) + '">' +
            escapeHtml(opt.label) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function buildSectionPersonal() {
    return (
      '<div class="competition-form-section">' +
      '  <h4 class="competition-form-section-title">기본 인적 정보 <span class="competition-form-required-badge">필수</span></h4>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppName">이름</label>' +
      '    <input class="competition-form-input" id="cAppName" type="text" placeholder="실명을 입력해 주세요" />' +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label">성별</label>' +
      chipGroupHtml('gender', GENDER_OPTIONS, 2) +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppBirth6">생년월일 (6자리, 예: 960101)</label>' +
      '    <input class="competition-form-input" id="cAppBirth6" type="text" placeholder="YYMMDD" />' +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label">국적</label>' +
      chipGroupHtml('nationality', NATIONALITY_OPTIONS, 2) +
      '  </div>' +
      '</div>'
    );
  }

  function buildSectionContact() {
    return (
      '<div class="competition-form-section">' +
      '  <h4 class="competition-form-section-title">연락처 및 배송지 정보 <span class="competition-form-required-badge">필수</span></h4>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppPhone">휴대전화 번호</label>' +
      '    <input class="competition-form-input" id="cAppPhone" type="tel" placeholder="010-1234-5678" />' +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppZip">배송지 주소 (기념품 발송)</label>' +
      '    <div class="competition-address-row">' +
      '      <input class="competition-form-input" id="cAppZip" type="text" placeholder="우편번호" readonly />' +
      '      <button type="button" class="competition-address-search-btn" id="cAppZipSearchBtn">우편번호 찾기</button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <input class="competition-form-input" id="cAppAddress1" type="text" placeholder="기본 주소 (우편번호 찾기로 자동 입력)" readonly />' +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <input class="competition-form-input" id="cAppAddress2" type="text" placeholder="상세 주소 (동/호수 등)" />' +
      '  </div>' +
      '</div>'
    );
  }

  function buildSectionRace(comp) {
    var cycle = isCycle(comp);
    var sportLabel = cycle ? 'CYCLE' : 'RUN';
    var divisions = cycle ? DIVISION_OPTIONS.CYCLE : DIVISION_OPTIONS.RUN;
    var sizeLabel = cycle ? '져지 사이즈' : '기념품(티셔츠) 사이즈';
    return (
      '<div class="competition-form-section">' +
      '  <h4 class="competition-form-section-title">대회 참가 정보 — ' + escapeHtml(sportLabel) + ' <span class="competition-form-required-badge">필수</span></h4>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label">참가 부문</label>' +
      chipGroupHtml('division', divisions) +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label">' + escapeHtml(sizeLabel) + '</label>' +
      chipGroupHtml('size', SIZE_OPTIONS) +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label">출발 그룹</label>' +
      chipGroupHtml('startGroup', START_GROUP_OPTIONS) +
      '  </div>' +
      '</div>'
    );
  }

  function buildSectionMedical() {
    var bloodOptionsHtml = BLOOD_TYPE_OPTIONS.map(function (o) {
      return '<option value="' + o.value + '">' + escapeHtml(o.label) + '</option>';
    }).join('');
    return (
      '<div class="competition-form-section-medical">' +
      '  <h4 class="competition-form-section-title">안전 및 의료 정보 <span class="competition-form-required-badge">필수</span></h4>' +
      '  <p class="competition-form-hint">대회 중 응급 상황 대비용으로만 사용되며, 신속한 대응을 위해 정확히 입력해 주세요.</p>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppEmergencyName">비상 연락처 — 이름</label>' +
      '    <input class="competition-form-input" id="cAppEmergencyName" type="text" placeholder="비상 연락처 이름" />' +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppEmergencyRelation">참가자와의 관계</label>' +
      '    <input class="competition-form-input" id="cAppEmergencyRelation" type="text" placeholder="예: 배우자, 부모, 형제자매" />' +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppEmergencyPhone">비상 연락처 — 휴대전화 번호</label>' +
      '    <input class="competition-form-input" id="cAppEmergencyPhone" type="tel" placeholder="010-1234-5678" />' +
      '    <div class="competition-form-error-inline" id="cAppEmergencyPhoneError">비상 연락처는 본인의 연락처와 동일할 수 없습니다.</div>' +
      '  </div>' +
      '  <div class="competition-form-field">' +
      '    <label class="competition-form-label" for="cAppBloodType">혈액형</label>' +
      '    <select class="competition-form-select" id="cAppBloodType">' +
      '      <option value="" disabled selected>선택해 주세요</option>' +
      bloodOptionsHtml +
      '    </select>' +
      '  </div>' +
      '  <div class="competition-form-field" style="margin-bottom:0;">' +
      '    <label class="competition-form-label" for="cAppMedicalNote">의료 특이사항 (선택)</label>' +
      '    <textarea class="competition-form-input" id="cAppMedicalNote" rows="3" placeholder="심혈관계 질환, 천식, 알레르기 등 대회 중 응급 대응에 참고할 사항을 자유롭게 적어 주세요"></textarea>' +
      '  </div>' +
      '</div>'
    );
  }

  function buildSectionAgreements() {
    return (
      '<div class="competition-form-section" style="margin-bottom:8px;">' +
      '  <h4 class="competition-form-section-title">약관 동의</h4>' +
      '  <div class="competition-agreement-row is-all">' +
      '    <input type="checkbox" class="competition-agreement-checkbox" id="cAppAgreeAll" />' +
      '    <label class="competition-agreement-label is-all" for="cAppAgreeAll">전체 동의하기</label>' +
      '  </div>' +
      '  <div class="competition-agreement-row">' +
      '    <input type="checkbox" class="competition-agreement-checkbox" id="cAppAgreePrivacyCollect" data-required-agree="1" />' +
      '    <label class="competition-agreement-label" for="cAppAgreePrivacyCollect">' +
      '      <span class="competition-agreement-required">[필수]</span>개인정보 수집 및 이용 동의' +
      '      <div class="competition-agreement-detail">신청자 성명·생년월일·연락처·주소 등을 대회 참가 접수 및 운영 목적으로 수집·이용하는 것에 동의합니다.</div>' +
      '    </label>' +
      '  </div>' +
      '  <div class="competition-agreement-row">' +
      '    <input type="checkbox" class="competition-agreement-checkbox" id="cAppAgreePrivacyThirdParty" data-required-agree="1" />' +
      '    <label class="competition-agreement-label" for="cAppAgreePrivacyThirdParty">' +
      '      <span class="competition-agreement-required">[필수]</span>개인정보 제3자 제공 동의' +
      '      <div class="competition-agreement-detail">기록 측정 업체(스마트칩), 택배사, 상해보험사 등 대회 운영에 필요한 업체에 신청 정보가 제공되는 것에 동의합니다.</div>' +
      '    </label>' +
      '  </div>' +
      '  <div class="competition-agreement-row">' +
      '    <input type="checkbox" class="competition-agreement-checkbox" id="cAppAgreeMedicalWaiver" data-required-agree="1" />' +
      '    <label class="competition-agreement-label" for="cAppAgreeMedicalWaiver">' +
      '      <span class="competition-agreement-required">[필수]</span>의료 면책 및 참가자 유의사항 동의' +
      '      <div class="competition-agreement-detail">본인의 건강 상태를 확인하고 참가하며, 대회 중 발생하는 부상 및 사고에 대해 주최 측에 책임을 묻지 않습니다.</div>' +
      '    </label>' +
      '  </div>' +
      '</div>' +
      '<div class="competition-form-error" id="cAppError"></div>'
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
            chip.addEventListener('click', function () {
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

  /** 우편번호 찾기 — Daum 우편번호 서비스를 최초 클릭 시에만 지연 로드한다 */
  function openDaumPostcode(onComplete) {
    function launch() {
      new window.daum.Postcode({
        oncomplete: function (data) {
          var addr = data.userSelectedType === 'R' ? data.roadAddress : data.jibunAddress;
          var extra = '';
          if (data.userSelectedType === 'R') {
            if (data.bname) extra += data.bname;
            if (data.buildingName) extra += extra ? ', ' + data.buildingName : data.buildingName;
            if (extra) addr += ' (' + extra + ')';
          }
          onComplete({ zonecode: data.zonecode, address: addr });
        },
      }).open();
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

    if (!name) return { error: '이름을 입력해 주세요.' };
    if (!chipState.gender) return { error: '성별을 선택해 주세요.' };
    if (!isValidBirth6(birth6)) return { error: '생년월일 6자리를 정확히 입력해 주세요(예: 960101).' };
    if (!chipState.nationality) return { error: '국적을 선택해 주세요.' };
    if (!isValidPhone(phone)) return { error: '휴대전화 번호를 정확히 입력해 주세요(010-XXXX-XXXX).' };
    if (!zip || !address1) return { error: '우편번호 찾기로 배송지 주소를 입력해 주세요.' };
    if (!address2) return { error: '상세 주소를 입력해 주세요.' };
    if (!chipState.division || validDivisions.indexOf(chipState.division) === -1) {
      return { error: '참가 부문을 선택해 주세요.' };
    }
    if (!chipState.size) return { error: '기념품 사이즈를 선택해 주세요.' };
    if (!chipState.startGroup) return { error: '출발 그룹을 선택해 주세요.' };
    if (!emergencyName) return { error: '비상 연락처 이름을 입력해 주세요.' };
    if (!emergencyRelation) return { error: '참가자와의 관계를 입력해 주세요.' };
    if (!isValidPhone(emergencyPhone)) return { error: '비상 연락처 번호를 정확히 입력해 주세요(010-XXXX-XXXX).' };
    if (emergencyPhone === phone) return { error: '비상 연락처는 본인의 연락처와 동일할 수 없습니다.' };
    if (!bloodType) return { error: '혈액형을 선택해 주세요.' };
    var agreeAll =
      overlay.querySelector('#cAppAgreePrivacyCollect').checked &&
      overlay.querySelector('#cAppAgreePrivacyThirdParty').checked &&
      overlay.querySelector('#cAppAgreeMedicalWaiver').checked;
    if (!agreeAll) return { error: '필수 약관에 모두 동의해 주세요.' };

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
  function openApplicationForm(comp, onSubmit) {
    if (!window.competitionBottomSheet || !window.competitionBottomSheet.openRawSheet) {
      console.error('[competitionApplicationForm] competitionBottomSheet.openRawSheet 필요');
      return;
    }
    var chipState = { gender: null, nationality: null, division: null, size: null, startGroup: null };
    var body =
      buildSectionPersonal() + buildSectionContact() + buildSectionRace(comp) + buildSectionMedical() + buildSectionAgreements();
    var footer = '<button type="button" class="competition-submit-btn" id="cAppSubmitBtn">작성 완료, 신청하기</button>';
    var overlay = window.competitionBottomSheet.openRawSheet('참가 신청서 작성', body, footer);

    wireChipGroups(overlay, chipState);
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
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = '제출 중...';
      try {
        await onSubmit(parsed.data);
        window.competitionBottomSheet.closeSheet();
      } catch (e) {
        errorEl.textContent = (e && e.message) || '신청서 제출에 실패했습니다. 잠시 후 다시 시도해 주세요.';
        errorEl.classList.add('is-visible');
        submitBtn.disabled = false;
        submitBtn.textContent = '작성 완료, 신청하기';
      }
    });
  }

  window.competitionApplicationForm = {
    open: openApplicationForm,
  };
})();
