/**
 * AI 훈련 스케줄 관리 모듈
 * Firebase Realtime Database: users/{userId}/training_schedule
 * Gemini API를 통한 스케줄 자동 생성
 */
(function () {
  'use strict';

  let aiScheduleCurrentMonth = new Date().getMonth();
  let aiScheduleCurrentYear = new Date().getFullYear();
  let aiScheduleData = null;  // { scheduleName, days: { "YYYY-MM-DD": {...} }, meta }
  let scheduleDetailCurrentDate = null;
  let scheduleDetailCurrentDay = null;

  function getDb() {
    return (typeof window !== 'undefined' && window.db) || (typeof firebase !== 'undefined' && firebase.database && firebase.database());
  }

  function getUserId() {
    return (window.currentUser && window.currentUser.id) || (function () { try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) { return null; } }())?.id || '';
  }

  function getUserIdForRTDB() {
    var u = null;
    if (typeof window.authV9 !== 'undefined' && window.authV9 && window.authV9.currentUser) u = window.authV9.currentUser.uid;
    if (!u && typeof window.auth !== 'undefined' && window.auth && window.auth.currentUser) u = window.auth.currentUser.uid;
    if (!u && typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) u = firebase.auth().currentUser.uid;
    if (u) return u;
    return getUserId();
  }

  /**
   * AI 스케줄 화면 로드 (진입 시 호출)
   */
  window.loadAIScheduleScreen = async function () {
    const calendarEl = document.getElementById('aiScheduleCalendar');
    const subHeaderEl = document.getElementById('aiScheduleSubHeader');
    if (!calendarEl) return;

    var userId = getUserIdForRTDB() || getUserId();
    if (!userId) {
      calendarEl.innerHTML = '<div class="error-message">사용자 정보를 찾을 수 없습니다.</div>';
      if (subHeaderEl) subHeaderEl.textContent = '스케줄을 생성해주세요';
      return;
    }

    calendarEl.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>캘린더를 불러오는 중...</p></div>';

    try {
      console.log('[AI스케줄] loadAIScheduleScreen: userId=' + userId);
      aiScheduleData = await loadAIScheduleFromFirebase(userId);
      console.log('[AI스케줄] loadAIScheduleScreen: aiScheduleData=', aiScheduleData ? { scheduleName: aiScheduleData.scheduleName, daysCount: aiScheduleData.days ? Object.keys(aiScheduleData.days).length : 0 } : null);
      if (subHeaderEl) {
        subHeaderEl.textContent = aiScheduleData && aiScheduleData.scheduleName
          ? aiScheduleData.scheduleName
          : '스케줄을 생성해주세요';
      }
      renderAIScheduleCalendar();
    } catch (err) {
      console.error('loadAIScheduleScreen error:', err);
      calendarEl.innerHTML = '<div class="error-message">스케줄을 불러오는데 실패했습니다.</div>';
    }
  };

  /**
   * Firebase Realtime Database에서 AI 스케줄 로드
   */
  window.loadAIScheduleFromFirebase = async function (userId) {
    console.log('[AI스케줄] loadAIScheduleFromFirebase 시작', { userId: userId, path: 'users/' + userId + '/training_schedule' });
    try {
      var db = getDb();
      if (!db) {
        console.error('[AI스케줄] loadAIScheduleFromFirebase: getDb() null');
        throw new Error('Firebase Database를 사용할 수 없습니다.');
      }

      var ref = db.ref('users/' + userId + '/training_schedule');
      var snapshot = await ref.once('value');
      var val = snapshot.val();
      console.log('[AI스케줄] loadAIScheduleFromFirebase 응답', { hasData: !!val, daysCount: val && val.days ? Object.keys(val.days).length : 0 });
      if (val) {
        return {
          scheduleName: val.scheduleName || '내 훈련 스케줄',
          days: val.days || {},
          meta: val.meta || {}
        };
      }
    } catch (e) {
      console.warn('[AI스케줄] Firebase 로드 실패:', e);
    }
    try {
      var fallback = localStorage.getItem('aiScheduleFallback_' + userId);
      if (fallback) {
        var parsed = JSON.parse(fallback);
        if (parsed && parsed.days) return parsed;
      }
    } catch (e2) {}
    return null;
  };

  /**
   * Firebase Realtime Database에 AI 스케줄 저장
   */
  window.saveAIScheduleToFirebase = async function (userId, data) {
    var path = 'users/' + userId + '/training_schedule';
    console.log('[AI스케줄] saveAIScheduleToFirebase 시작', { userId: userId, path: path, daysCount: data && data.days ? Object.keys(data.days).length : 0 });
    var db = getDb();
    if (!db) {
      console.error('[AI스케줄] saveAIScheduleToFirebase: getDb() null');
      throw new Error('Firebase Database를 사용할 수 없습니다.');
    }
    var authUid = (typeof window.authV9 !== 'undefined' && window.authV9 && window.authV9.currentUser) ? window.authV9.currentUser.uid : ((typeof window.auth !== 'undefined' && window.auth && window.auth.currentUser) ? window.auth.currentUser.uid : null);
    console.log('[AI스케줄] saveAIScheduleToFirebase auth 확인', { authUid: authUid, userId: userId, match: authUid === userId });

    var ref = db.ref(path);
    await ref.set(data);
    console.log('[AI스케줄] saveAIScheduleToFirebase 완료', { path: path });
  };

  /**
   * 해당 날짜의 훈련 완료 여부 조회 (Firebase logs)
   */
  async function getIsCompletedForDate(userId, dateStr) {
    try {
      if (typeof window.getTrainingLogsByDateRange !== 'function') return false;
      const d = new Date(dateStr);
      const logs = await window.getTrainingLogsByDateRange(userId, d.getFullYear(), d.getMonth());
      const MIN_DURATION_SEC = 600;
      for (let i = 0; i < logs.length; i++) {
        let logDate = logs[i].date;
        if (logDate && typeof logDate.toDate === 'function') {
          logDate = logDate.toDate().toISOString().split('T')[0];
        } else if (logDate && typeof logDate !== 'string') {
          logDate = (logDate.toISOString && logDate.toISOString()) ? logDate.toISOString().split('T')[0] : String(logDate).slice(0, 10);
        }
        if (logDate === dateStr) {
          const sec = Number(logs[i].duration_sec ?? logs[i].time ?? logs[i].duration ?? 0);
          if (sec >= MIN_DURATION_SEC) return true;
        }
      }
    } catch (e) {
      console.warn('getIsCompletedForDate:', e);
    }
    return false;
  }

  /**
   * AI 스케줄 캘린더 렌더링
   */
  function renderAIScheduleCalendar() {
    const container = document.getElementById('aiScheduleCalendar');
    if (!container) return;

    if (!aiScheduleData) {
      aiScheduleData = { scheduleName: '', days: {}, meta: {} };
    }

    const year = aiScheduleCurrentYear;
    const month = aiScheduleCurrentMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startBlank = firstDay.getDay();
    const totalDays = lastDay.getDate();
    const todayStr = new Date().toISOString().split('T')[0];
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

    let html = `
      <div class="ai-schedule-calendar-header">
        <button type="button" class="mini-calendar-nav-btn" onclick="aiScheduleNavigate('prev')" aria-label="이전 달">&lt;</button>
        <span class="mini-calendar-month-year">${year}년 ${month + 1}월</span>
        <button type="button" class="mini-calendar-nav-btn" onclick="aiScheduleNavigate('next')" aria-label="다음 달">&gt;</button>
      </div>
      <div class="ai-schedule-weekdays">
        ${weekdays.map(w => `<div class="ai-schedule-weekday">${w}</div>`).join('')}
      </div>
      <div class="ai-schedule-grid">
    `;

    for (let i = 0; i < startBlank; i++) {
      html += '<div class="ai-schedule-day ai-schedule-day-empty"></div>';
    }

    var rtdbUserId = getUserIdForRTDB() || getUserId();
    var startDateFilter = (aiScheduleData && aiScheduleData.meta && aiScheduleData.meta.startDate) ? aiScheduleData.meta.startDate : todayStr;
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const rawDayData = aiScheduleData && aiScheduleData.days && aiScheduleData.days[dateStr];
      const dayData = (rawDayData && dateStr >= startDateFilter) ? rawDayData : null;
      const hasSchedule = !!dayData;
      const isPast = dateStr < todayStr;
      const isToday = dateStr === todayStr;

      let cellClass = 'ai-schedule-day';
      if (hasSchedule) cellClass += ' ai-schedule-day-has';
      if (isPast) cellClass += ' ai-schedule-day-past';
      if (isToday) cellClass += ' ai-schedule-day-today';

      let statusHtml = '';
      if (hasSchedule && isPast) {
        const isCompleted = dayData.isCompleted === true;
        if (isCompleted) {
          statusHtml = '<span class="ai-schedule-status ai-schedule-status-done" title="완료">✓</span>';
        } else {
          statusHtml = '<span class="ai-schedule-status ai-schedule-status-missed" title="미수행">✗</span>';
        }
      }

      const clickHandler = hasSchedule
        ? `onclick="if(typeof openScheduleDetailModal==='function')openScheduleDetailModal('${dateStr}')"`
        : '';

      html += `<div class="${cellClass}" ${clickHandler} data-date="${dateStr}">
        <span class="ai-schedule-day-num">${d}</span>${statusHtml}
      </div>`;
    }

    html += '</div>';
    container.innerHTML = html;

    // 과거 날짜 isCompleted 동기화 (비동기)
    if (aiScheduleData && aiScheduleData.days && rtdbUserId) {
      const pastDates = Object.keys(aiScheduleData.days).filter(d => d < todayStr && d >= startDateFilter);
      Promise.all(pastDates.map(async (dateStr) => {
        const completed = await getIsCompletedForDate(rtdbUserId, dateStr);
        if (aiScheduleData.days[dateStr].isCompleted !== completed) {
          aiScheduleData.days[dateStr].isCompleted = completed;
          try {
            await window.saveAIScheduleToFirebase(rtdbUserId, aiScheduleData);
          } catch (e) {
            console.warn('isCompleted sync fail:', e);
          }
          return true;
        }
        return false;
      })).then(results => {
        if (results.some(Boolean)) renderAIScheduleCalendar();
      });
    }
  }

  window.aiScheduleNavigate = function (dir) {
    if (dir === 'prev') {
      aiScheduleCurrentMonth--;
      if (aiScheduleCurrentMonth < 0) {
        aiScheduleCurrentMonth = 11;
        aiScheduleCurrentYear--;
      }
    } else {
      aiScheduleCurrentMonth++;
      if (aiScheduleCurrentMonth > 11) {
        aiScheduleCurrentMonth = 0;
        aiScheduleCurrentYear++;
      }
    }
    renderAIScheduleCalendar();
  };

  /**
   * 사용자 정보 로드 (인증 시점과 동일하게 Firestore users/{uid}에서 최신 조회)
   * 나이(birth_year/birthYear), 성별(gender/sex) 포함 - 로그인 시 저장된 데이터 사용
   */
  async function loadUserForScheduleModal() {
    var authUid = getUserIdForRTDB();
    var userId = authUid || getUserId();
    if (!userId) return null;

    var user = window.currentUser || (function () { try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) { return null; } })();
    if (!user) user = { id: userId };

    var firestoreUser = null;
    try {
      if (typeof window.getUserByUid === 'function') {
        firestoreUser = await window.getUserByUid(userId);
      }
      if (!firestoreUser && typeof window.apiGetUser === 'function') {
        var res = await window.apiGetUser(userId);
        if (res && res.success && res.item) firestoreUser = res.item;
      }
      if (!firestoreUser && window.firestore && window.firestore.collection) {
        var doc = await window.firestore.collection('users').doc(userId).get();
        if (doc && doc.exists) firestoreUser = { id: userId, ...doc.data() };
      }
    } catch (e) {
      console.warn('[loadUserForScheduleModal] Firestore 사용자 조회 실패:', e);
    }

    if (firestoreUser) {
      user = Object.assign({}, user, firestoreUser);
      if (firestoreUser.birth_year != null || firestoreUser.gender != null) {
        var merged = Object.assign({}, window.currentUser || {}, user);
        window.currentUser = merged;
        try { localStorage.setItem('currentUser', JSON.stringify(merged)); } catch (e2) {}
      }
    }

    console.log('[loadUserForScheduleModal] 사용자:', { id: user.id, birth_year: user.birth_year || user.birthYear, gender: user.gender || user.sex });
    return user;
  }

  /**
   * 스케줄 생성 설정 모달 열기
   */
  window.openScheduleCreateAIModal = async function () {
    const modal = document.getElementById('scheduleCreateAIModal');
    const userInfoEl = document.getElementById('aiScheduleUserInfo');
    if (!modal || !userInfoEl) return;
    updateScheduleProgress(false);

    const user = await loadUserForScheduleModal();
    if (!user || !user.id) {
      if (typeof showToast === 'function') showToast('사용자 정보를 찾을 수 없습니다.', 'error');
      return;
    }

    var birthYear = user.birth_year != null ? user.birth_year : user.birthYear;
    var age = (user.age != null && user.age !== '') ? user.age : (birthYear ? (new Date().getFullYear() - parseInt(birthYear, 10)) : '-');
    var sex = user.gender || user.sex || '-';
    var hasAgeGender = (birthYear || age !== '-') && (sex !== '-' && sex !== '');
    const ftp = user.ftp || 0;
    const weight = user.weight || 0;
    const challenge = user.challenge || 'Fitness';

    userInfoEl.innerHTML = `
      나이: ${age}세 | 성별: ${sex} | FTP: ${ftp}W | 몸무게: ${weight}kg<br>
      훈련 목적: ${challenge}
      ${!hasAgeGender ? '<br><span style="color:#e67e22;font-size:0.9em;">나이·성별이 없습니다. 사용자 관리에서 프로필을 수정하면 맞춤형 스케줄에 반영됩니다.</span>' : ''}
    `;

    var today = new Date();
    var startDateEl = document.getElementById('aiScheduleStartDate');
    if (startDateEl) {
      startDateEl.value = today.toISOString().split('T')[0];
    }
    var eventDateEl = document.getElementById('aiScheduleEventDate');
    if (eventDateEl) {
      var d = new Date(today);
      d.setMonth(d.getMonth() + 2);
      eventDateEl.value = d.toISOString().split('T')[0];
    }

    var distEl = document.getElementById('aiScheduleEventDistance');
    if (distEl) distEl.value = 100;
    var goalEl = document.getElementById('aiScheduleEventGoal');
    if (goalEl) goalEl.value = '완주';

    ['aiIndoorDays', 'aiOutdoorDays'].forEach(name => {
      document.querySelectorAll(`input[name="${name}"]`).forEach(cb => cb.checked = false);
    });
    document.querySelectorAll('input[name="aiIndoorDays"][value="1"], input[name="aiIndoorDays"][value="2"], input[name="aiIndoorDays"][value="3"]').forEach(cb => cb.checked = true);
    document.querySelectorAll('input[name="aiOutdoorDays"][value="0"], input[name="aiOutdoorDays"][value="6"]').forEach(cb => cb.checked = true);

    modal.style.display = 'flex';
  };

  window.closeScheduleCreateAIModal = function () {
    const modal = document.getElementById('scheduleCreateAIModal');
    if (modal) modal.style.display = 'none';
  };

  /**
   * 워크아웃 메타데이터 경량화 (Steps, Power Data 제외)
   * 필드: id, title, category, duration_min, tss_predicted, target_level
   */
  function fetchLightweightWorkouts() {
    return new Promise(function (resolve) {
      if (!window.GAS_URL) {
        resolve([]);
        return;
      }
      fetch(window.GAS_URL + '?action=getWorkoutsByCategory&categories=Endurance,Tempo,SweetSpot,Threshold,VO2Max,Recovery,Active%20Recovery,Anaerobic%20Capacity')
        .then(function (r) { return r.json(); })
        .then(function (result) {
          if (!result?.success || !Array.isArray(result.items)) {
            resolve([]);
            return;
          }
          const authorToCategory = {
            'Active Recovery': 'Recovery',
            'Endurance': 'Endurance',
            'Tempo': 'Tempo',
            'Sweet Spot': 'SweetSpot',
            'SweetSpot': 'SweetSpot',
            'Threshold': 'Threshold',
            'VO2 Max': 'VO2Max',
            'VO2Max': 'VO2Max',
            'Anaerobic Capacity': 'Anaerobic',
            'Neuromuscular': 'Anaerobic'
          };
          const items = result.items.slice(0, 30).map(function (w) {
            var author = String(w.author || '').trim();
            var cat = authorToCategory[author] || (author || 'Endurance');
            var sec = Number(w.total_seconds) || 0;
            var durMin = Math.round(sec / 60) || 60;
            var tssPred = Math.round(durMin * 0.6) || 40;
            return {
              id: w.id,
              title: w.title || '훈련',
              category: cat,
              duration_min: durMin,
              tss_predicted: tssPred,
              target_level: 'Intermediate'
            };
          });
          resolve(items);
        })
        .catch(function () { resolve([]); });
    });
  }

  /**
   * Gemini 응답 JSON 파싱 (보정 + 개별 객체 추출 폴백)
   */
  function parseGeminiScheduleJson(text) {
    if (!text || typeof text !== 'string') return [];
    var raw = text.replace(/```json\n?|\n?```/g, '').trim();
    var match = raw.match(/\[[\s\S]*\]/);
    if (match) raw = match[0];

    var fix = raw
      .replace(/'([^']*)'\s*:/g, '"$1":')
      .replace(/,(\s*[}\]])/g, '$1');

    function tryParse(s) {
      try {
        var arr = JSON.parse(s);
        return Array.isArray(arr) ? arr : [];
      } catch (_) {
        return null;
      }
    }

    var result = tryParse(fix);
    if (result) return result;

    result = tryParse(fix.replace(/:\s*'([^']*)'/g, function (_, s) {
      return ': "' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, '') + '"';
    }));
    if (result) return result;

    result = tryParse(raw);
    if (result) return result;

    var collected = [];
    var i = 0;
    while (i < fix.length) {
      var start = fix.indexOf('{', i);
      if (start < 0) break;
      var depth = 1;
      var pos = start + 1;
      var inStr = false;
      var strChar = '';
      var escape = false;
      while (pos < fix.length && depth > 0) {
        var c = fix[pos];
        if (escape) { escape = false; pos++; continue; }
        if (c === '\\' && inStr) { escape = true; pos++; continue; }
        if (inStr) {
          if (c === strChar) inStr = false;
          pos++;
          continue;
        }
        if (c === '"' || c === "'") { inStr = true; strChar = c; pos++; continue; }
        if (c === '{') depth++;
        else if (c === '}') depth--;
        pos++;
      }
      if (depth === 0) {
        var objStr = fix.substring(start, pos)
          .replace(/:\s*'([^']*)'/g, function (_, s) {
            return ': "' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, '') + '"';
          });
        try {
          var obj = JSON.parse(objStr);
          if (obj && (obj.date || obj.dateStr)) collected.push(obj);
        } catch (_) {}
      }
      i = start + 1;
    }
    if (collected.length > 0) return collected;
    console.error('[AI스케줄] parseGeminiScheduleJson 실패', { rawLength: (text || '').length, rawPreview: (text || '').substring(0, 500) });
    throw new Error('JSON 파싱 실패. 개별 객체 추출도 되지 않았습니다.');
  }

  /**
   * 해당 월의 스케줄을 Gemini에 요청하여 생성 (generateMonthlySchedule)
   */
  function generateMonthlySchedule(apiKey, opts) {
    var year = opts.year;
    var month = opts.month;
    var month1Indexed = month + 1;
    var prompt = opts.prompt;
    var modelName = opts.modelName || 'gemini-2.0-flash-exp';

    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelName + ':generateContent?key=' + apiKey;
    var body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json'
      }
    };

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) { return res.json(); }).then(function (json) {
      if (json?.error) {
        console.error('[AI스케줄] Gemini API 오류', { error: json.error, code: json.error?.code, message: json.error?.message });
        throw new Error(json.error.message || 'Gemini API 오류');
      }
      var text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) {
        console.error('[AI스케줄] Gemini 응답 텍스트 없음', { json: json, candidates: json?.candidates });
        throw new Error('Gemini 응답에 텍스트가 없습니다.');
      }
      try {
        var parsed = parseGeminiScheduleJson(text);
        if (!Array.isArray(parsed)) throw new Error('배열 형식이 아닙니다.');
        return parsed;
      } catch (parseErr) {
        console.error('[AI스케줄] Gemini 응답 파싱 실패', { parseErr: parseErr, textPreview: text.substring(0, 800) });
        throw parseErr;
      }
    });
  }

  /**
   * Phase 1: 매크로 전략(주기화) JSON 파싱
   * @returns {{ week: number, focus: string, phase: string, intensity: string, description: string }[]}
   */
  function parseMacroStrategyJson(text) {
    if (!text || typeof text !== 'string') return [];
    var raw = text.replace(/```json\n?|\n?```/g, '').trim();
    var match = raw.match(/\[[\s\S]*\]/);
    if (match) raw = match[0];
    raw = raw.replace(/'([^']*)'\s*:/g, '"$1":').replace(/,(\s*[}\]])/g, '$1');
    try {
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.map(function (o, i) {
        return {
          week: (o.week != null ? o.week : i + 1),
          focus: String(o.focus || '').trim() || '훈련',
          phase: String(o.phase || '').trim() || 'Base',
          intensity: String(o.intensity || '').trim() || '중',
          description: String(o.description || '').trim() || ''
        };
      });
    } catch (e) {
      console.warn('[AI스케줄] parseMacroStrategyJson 실패:', e);
      return [];
    }
  }

  /**
   * Phase 1: 매크로 전략(Elite Periodization) Gemini API 호출
   * @returns {Promise<{ week: number, focus: string, phase: string, intensity: string, description: string }[]>}
   */
  function generateMacroStrategyPhase1(apiKey, opts) {
    var totalWeeks = opts.totalWeeks || 1;
    var goal = opts.goal || 'Fitness';
    var eventGoal = opts.eventGoal || '완주';
    var eventDistance = opts.eventDistance || 100;
    var modelName = opts.modelName || 'gemini-2.0-flash-exp';

    var eventSpecificity = '';
    var g = String(eventGoal).toLowerCase();
    if (g.indexOf('gran') >= 0 || g.indexOf('그란') >= 0 || eventDistance >= 100) {
      eventSpecificity = '**Event Specificity (Gran Fondo/장거리):** Endurance, SweetSpot 비중을 높이고, 장거리 지속력을 강화하시오.';
    } else if (g.indexOf('race') >= 0 || g.indexOf('경기') >= 0 || g.indexOf('criterium') >= 0 || eventDistance < 80) {
      eventSpecificity = '**Event Specificity (Criterium/Race/단거리):** VO2Max, Anaerobic 비중을 높이고, 순간 파워 및 스프린트 능력을 강화하시오.';
    } else {
      eventSpecificity = '**Event Specificity:** 대회 거리(' + eventDistance + 'km)와 목표(' + eventGoal + ')에 맞게 균형있게 배분하시오.';
    }

    var prompt = `당신은 UCI 월드투어 팀의 수석 코치입니다.

사용자의 대회까지 남은 기간은 총 **${totalWeeks}주**입니다.

**선형 주기화(Linear Periodization)** 또는 **블록 주기화(Block Periodization)** 이론을 적용하여 주차별 테마를 설계하시오.

**[필수 적용 로직]**
1. **Phase Division:** 전체 기간을 Base(기초) -> Build(강화) -> Specialty(특화) -> Taper(조절) 단계로 나누시오. (기간이 짧으면 비율을 조정: 예 4주면 Base1주, Build1주, Specialty1주, Taper1주)
2. **Recovery Week:** 부상 방지와 초보상(Supercompensation)을 위해, **3주 또는 4주 훈련 후 반드시 1주의 '회복(Recovery)' 주간**을 배치하시오.
3. ${eventSpecificity}

**대회:** ${eventGoal}, ${eventDistance}km
**사용자 훈련 목표:** ${goal}

**Output Format (JSON 배열):**
정확히 ${totalWeeks}개의 객체를, week 1부터 week ${totalWeeks}까지 순서대로 출력하시오.
각 객체는 focus(테마), phase(단계), intensity(강도: 상/중/하), description(코칭 조언 한 줄)을 포함.

[
  { "week": 1, "focus": "기초 유산소", "phase": "Base", "intensity": "하", "description": "..." },
  { "week": 2, "focus": "지구력 기반", "phase": "Base", "intensity": "중", "description": "..." }
]
반드시 유효한 JSON 배열만 출력. 작은따옴표 금지, trailing comma 금지.`;

    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelName + ':generateContent?key=' + apiKey;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 4096, responseMimeType: 'application/json' }
      })
    }).then(function (r) { return r.json(); }).then(function (json) {
      if (json?.error) throw new Error(json.error.message || 'Gemini API 오류');
      var text2 = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      var parsed = parseMacroStrategyJson(text2);
      return parsed;
    });
  }

  /**
   * 훈련 시작일 ~ 대회일 사이의 총 주차 계산 (기간이 1일 미만이어도 1주로 간주)
   * @param {Date} start - 훈련 시작일
   * @param {Date} end - 대회일
   * @returns {number}
   */
  function calculateTotalWeeks(start, end) {
    var ms = end.getTime() - start.getTime();
    var days = Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
    return Math.max(1, Math.ceil(days / 7));
  }

  /**
   * 특정 날짜가 훈련 시작일로부터 몇 주차인지 반환 (1-based)
   * @param {string} dateStr - YYYY-MM-DD
   * @param {string} startDateStr - YYYY-MM-DD
   * @returns {number}
   */
  function getWeekIndex(dateStr, startDateStr) {
    var d = new Date(dateStr);
    var s = new Date(startDateStr);
    var ms = d.getTime() - s.getTime();
    var days = Math.floor(ms / (24 * 60 * 60 * 1000));
    return Math.max(1, Math.min(Math.floor(days / 7) + 1, 999));
  }

  /**
   * 사용자 설정(인도어/아웃도어 요일)에 맞는 훈련 날짜 목록 생성
   * @param {Date} start - 훈련 시작일
   * @param {Date} end - 대회일(끝)
   * @param {number[]} indoorDays - 인도어 요일 (0=일..6=토)
   * @param {number[]} outdoorDays - 아웃도어 요일
   * @returns {{dateStr: string, type: string, dayOfWeek: number}[]}
   */
  function computeTrainingDates(start, end, indoorDays, outdoorDays) {
    var dates = [];
    var d = new Date(start);
    d.setHours(0, 0, 0, 0);
    var endMs = end.getTime();
    var dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    while (d.getTime() <= endMs) {
      var dow = d.getDay();
      var dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (indoorDays.indexOf(dow) >= 0) {
        dates.push({ dateStr: dateStr, type: 'Indoor', dayOfWeek: dow, dayName: dayNames[dow] });
      } else if (outdoorDays.indexOf(dow) >= 0) {
        dates.push({ dateStr: dateStr, type: 'Outdoor', dayOfWeek: dow, dayName: dayNames[dow] });
      }
      d.setDate(d.getDate() + 1);
    }
    return dates;
  }

  /**
   * 이전 달 마지막 주 요약 생성 (문맥 체이닝용)
   */
  function summarizeLastWeek(days) {
    if (!days || typeof days !== 'object') return null;
    var keys = Object.keys(days).sort();
    if (keys.length === 0) return null;
    var lastDate = keys[keys.length - 1];
    var d = new Date(lastDate);
    d.setDate(d.getDate() - 6);
    var weekStart = d.toISOString().split('T')[0];
    var weekDays = [];
    var totalTSS = 0;
    var maxTSS = 0;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] >= weekStart && keys[i] <= lastDate) {
        weekDays.push(days[keys[i]]);
        var tss = Number(days[keys[i]].predictedTSS) || 0;
        totalTSS += tss;
        if (tss > maxTSS) maxTSS = tss;
      }
    }
    return {
      sessions: weekDays.length,
      totalTSS: totalTSS,
      maxSingleTSS: maxTSS,
      lastDate: lastDate
    };
  }

  /**
   * Progress UI 업데이트
   */
  function updateScheduleProgress(visible, mainText, detailText) {
    var section = document.getElementById('aiScheduleProgressSection');
    var textEl = document.getElementById('aiScheduleProgressText');
    var detailEl = document.getElementById('aiScheduleProgressDetail');
    if (section) section.style.display = visible ? 'block' : 'none';
    if (textEl) textEl.textContent = mainText || '';
    if (detailEl) detailEl.textContent = detailText || '';
  }

  /**
   * 진행사항 로그 (콘솔 + UI)
   */
  var _scheduleLogs = [];
  function scheduleLog(step, message, data) {
    var line = '[AI스케줄] [' + step + '] ' + message;
    _scheduleLogs.push({ step: step, msg: message, data: data, ts: new Date().toISOString() });
    console.log(line, data !== undefined ? data : '');
    var detailEl = document.getElementById('aiScheduleProgressDetail');
    if (detailEl) detailEl.textContent = '[' + step + '] ' + message;
  }

  window.getAIScheduleLogs = function () { return _scheduleLogs.slice(); };

  /**
   * Gemini API로 훈련 스케줄 생성 (Step-by-Step 월별 생성)
   */
  window.generateScheduleWithGemini = async function () {
    _scheduleLogs = [];
    scheduleLog('START', '스케줄 생성 시작', {});

    var btn = document.getElementById('btnGenerateAISchedule');
    var btnRow = document.getElementById('aiScheduleBtnRow');
    var userId = getUserId();
    var rtdbUid = getUserIdForRTDB();
    scheduleLog('USER', 'getUserId=' + (userId || '(없음)') + ', getUserIdForRTDB=' + (rtdbUid || '(없음)'), { userId: userId, rtdbUid: rtdbUid });

    var apiKey = (localStorage.getItem('geminiApiKey') || (document.getElementById('settingsGeminiApiKey') && document.getElementById('settingsGeminiApiKey').value) || '').trim();

    if (!apiKey) {
      if (confirm('Gemini API 키가 설정되지 않았습니다.\n환경 설정에서 API 키를 입력해주세요.\n\n지금 환경 설정을 열까요?')) {
        if (typeof openSettingsModal === 'function') openSettingsModal();
        else if (typeof showScreen === 'function') showScreen('myCareerScreen');
      }
      return;
    }

    var user = await loadUserForScheduleModal();
    if (!user || !user.id) {
      scheduleLog('ERROR', '사용자 정보 없음', { user: user });
      if (typeof showToast === 'function') showToast('사용자 정보를 찾을 수 없습니다.', 'error');
      return;
    }
    scheduleLog('USER', 'user.id=' + user.id, {});

    var startDateStr = document.getElementById('aiScheduleStartDate') && document.getElementById('aiScheduleStartDate').value;
    var eventDateStr = document.getElementById('aiScheduleEventDate') && document.getElementById('aiScheduleEventDate').value;
    var eventDistance = document.getElementById('aiScheduleEventDistance') && document.getElementById('aiScheduleEventDistance').value;
    var eventGoal = document.getElementById('aiScheduleEventGoal') && document.getElementById('aiScheduleEventGoal').value;

    if (!startDateStr || !eventDateStr || !eventDistance) {
      scheduleLog('ERROR', '필수 입력 누락: startDate=' + startDateStr + ', eventDate=' + eventDateStr + ', distance=' + eventDistance, {});
      if (typeof showToast === 'function') showToast('훈련 시작일, 대회 일정, 거리를 입력해주세요.', 'error');
      return;
    }
    scheduleLog('INPUT', '시작일=' + startDateStr + ', 대회일=' + eventDateStr + ', 거리=' + eventDistance + 'km', {});

    var startDate = new Date(startDateStr);
    var eventDate = new Date(eventDateStr);
    if (startDate > eventDate) {
      if (typeof showToast === 'function') showToast('훈련 시작일은 대회 일정보다 이전이어야 합니다.', 'error');
      return;
    }

    var indoorDays = Array.from(document.querySelectorAll('input[name="aiIndoorDays"]:checked')).map(function (cb) { return parseInt(cb.value, 10); });
    var outdoorDays = Array.from(document.querySelectorAll('input[name="aiOutdoorDays"]:checked')).map(function (cb) { return parseInt(cb.value, 10); });
    var indoorLimit = (document.getElementById('aiScheduleIndoorTimeLimit') && document.getElementById('aiScheduleIndoorTimeLimit').value) || '120';
    var outdoorLimit = (document.getElementById('aiScheduleOutdoorTimeLimit') && document.getElementById('aiScheduleOutdoorTimeLimit').value) || '180';

    var dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    var indoorStr = indoorDays.length ? indoorDays.map(function (d) { return dayNames[d]; }).join(', ') : '없음';
    var outdoorStr = outdoorDays.length ? outdoorDays.map(function (d) { return dayNames[d]; }).join(', ') : '없음';

    var birthYear = user.birth_year != null ? user.birth_year : user.birthYear;
    var age = (user.age != null && user.age !== '') ? user.age : (birthYear ? (new Date().getFullYear() - parseInt(birthYear, 10)) : 30);
    var sex = user.gender || user.sex || '-';
    var ftp = user.ftp || 0;
    var weight = user.weight || 0;
    var g = String(user.challenge || 'Fitness').trim().toLowerCase();
    var goal = g === 'granfondo' ? 'Granfondo' : g === 'racing' ? 'Racing' : g === 'elite' ? 'Elite' : g === 'pro' ? 'Pro' : 'Fitness';
    var isEliteOrPro = goal === 'Elite' || goal === 'Pro';

    if (btn) { btn.disabled = true; btn.textContent = '생성 중...'; }
    if (btnRow) btnRow.style.display = 'none';
    updateScheduleProgress(true, '사용자 목표 분석 중...', '');

    var lightweightWorkouts = [];
    try {
      lightweightWorkouts = await fetchLightweightWorkouts();
    } catch (e) {
      console.warn('워크아웃 로드 실패:', e);
    }
    scheduleLog('WORKOUTS', '로드된 워크아웃 ' + lightweightWorkouts.length + '개', { count: lightweightWorkouts.length });

    var taperStartStr = (function () {
      var d = new Date(eventDate);
      d.setDate(d.getDate() - 7);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();

    var workoutsContext = lightweightWorkouts.length
      ? '\n**필수: 아래 워크아웃 목록에서만 선택하시오. workoutId는 반드시 목록의 id 값 중 하나를 사용. "훈련" 같은 임의의 이름·빈 workoutId 사용 금지.**\n```\n' + JSON.stringify(lightweightWorkouts, null, 2) + '\n```\n각 날짜마다 다른 워크아웃을 다양하게 배정. 동일 훈련 연속 반복 금지.'
      : '\n워크아웃 API를 사용할 수 없습니다. workoutId는 빈 문자열로 두고, workoutName과 duration·predictedTSS를 구체적으로 작성하시오. (예: Z2 기초 지구력 60분, Sweet Spot 인터벌 45분 등)';

    var today = new Date();
    if (eventDate < today) {
      updateScheduleProgress(false);
      if (btn) { btn.disabled = false; btn.textContent = '스케줄 생성'; }
      if (btnRow) btnRow.style.display = 'flex';
      if (typeof showToast === 'function') showToast('대회 일정이 과거입니다.', 'error');
      return;
    }

    var rtdbUserId = getUserIdForRTDB() || user.id;
    scheduleLog('RTDB', 'Firebase 저장용 userId=' + rtdbUserId + ', getDb=' + (getDb() ? 'OK' : 'NULL'), {
      rtdbUserId: rtdbUserId,
      hasDb: !!getDb(),
      authV9: !!(typeof window.authV9 !== 'undefined' && window.authV9 && window.authV9.currentUser),
      authCompat: !!(typeof window.auth !== 'undefined' && window.auth && window.auth.currentUser)
    });

    var monthsToGenerate = [];
    var y = startDate.getFullYear();
    var m = startDate.getMonth();
    var ey = eventDate.getFullYear();
    var em = eventDate.getMonth();
    while (y < ey || (y === ey && m <= em)) {
      monthsToGenerate.push({ year: y, month: m });
      m++;
      if (m > 11) { m = 0; y++; }
    }

    var trainingDates = computeTrainingDates(startDate, eventDate, indoorDays, outdoorDays);
    scheduleLog('DATES', '계산된 훈련일 ' + trainingDates.length + '일: 인도어(' + indoorStr + '), 아웃도어(' + outdoorStr + ')', { count: trainingDates.length, sample: trainingDates.slice(0, 5) });

    if (trainingDates.length === 0) {
      scheduleLog('ERROR', '훈련 가능한 날짜가 없습니다. 인도어/아웃도어 요일을 최소 하나씩 선택하세요.', {});
      updateScheduleProgress(false);
      if (btn) { btn.disabled = false; btn.textContent = '스케줄 생성'; }
      if (btnRow) btnRow.style.display = 'flex';
      if (typeof showToast === 'function') showToast('인도어 또는 아웃도어 요일을 최소 하나씩 선택해주세요.', 'error');
      return;
    }

    var byMonth = {};
    var totalWeeks = calculateTotalWeeks(startDate, eventDate);
    scheduleLog('WEEKS', '대회까지 총 ' + totalWeeks + '주', { totalWeeks: totalWeeks });

    for (var k = 0; k < trainingDates.length; k++) {
      var td = trainingDates[k];
      var ymKey = td.dateStr.substring(0, 7);
      td.taper = td.dateStr >= taperStartStr;
      td.weekIndex = getWeekIndex(td.dateStr, startDateStr);
      if (!byMonth[ymKey]) byMonth[ymKey] = [];
      byMonth[ymKey].push(td);
    }
    var monthKeys = Object.keys(byMonth).sort();

    scheduleLog('MONTHS', '월별 분할: ' + monthKeys.join(', ') + ' (총 ' + trainingDates.length + '일)', { byMonth: monthKeys.map(function (mk) { return mk + ':' + byMonth[mk].length + '일'; }) });
    updateScheduleProgress(true, 'Phase 1 매크로 전략 생성 중...', totalWeeks + '주 주기화 설계');

    var modelName = localStorage.getItem('geminiModelName') || 'gemini-2.0-flash-exp';
    var scheduleName = eventGoal + ' ' + eventDistance + 'km (' + eventDateStr + ')';
    var allDays = {};
    var macroStrategy = [];

    try {
      macroStrategy = await generateMacroStrategyPhase1(apiKey, {
        totalWeeks: totalWeeks,
        goal: goal,
        eventGoal: eventGoal,
        eventDistance: Number(eventDistance),
        modelName: modelName
      });

      if (macroStrategy.length !== totalWeeks) {
        scheduleLog('PHASE1_VALIDATE', '매크로 주차 불일치: 생성=' + macroStrategy.length + ', 필요=' + totalWeeks + ' → 보정', { generated: macroStrategy.length, expected: totalWeeks });
        while (macroStrategy.length < totalWeeks) {
          var lastIdx = Math.max(0, macroStrategy.length - 1);
          var last = (macroStrategy[lastIdx] && macroStrategy[lastIdx].phase) ? macroStrategy[lastIdx] : { focus: '훈련', phase: 'Base', intensity: '중', description: '' };
          macroStrategy.push({ week: macroStrategy.length + 1, focus: last.focus, phase: last.phase, intensity: last.intensity, description: last.description });
        }
        if (macroStrategy.length > totalWeeks) macroStrategy = macroStrategy.slice(0, totalWeeks);
      }
      scheduleLog('PHASE1', '매크로 전략 수신: ' + macroStrategy.length + '주', { phases: macroStrategy.map(function (m) { return m.week + ':' + m.phase; }) });
    } catch (phase1Err) {
      scheduleLog('PHASE1_FALLBACK', '매크로 전략 생성 실패, 기본값 사용: ' + (phase1Err && phase1Err.message), { error: phase1Err });
      for (var w = 1; w <= totalWeeks; w++) {
        var phase = w <= Math.ceil(totalWeeks * 0.25) ? 'Base' : w <= Math.ceil(totalWeeks * 0.5) ? 'Build' : w <= Math.ceil(totalWeeks * 0.85) ? 'Specialty' : 'Taper';
        macroStrategy.push({ week: w, focus: phase === 'Taper' ? '회복·컨디션 조절' : '훈련', phase: phase, intensity: phase === 'Taper' ? '하' : '중', description: '' });
      }
    }

    var meta = {
      startDate: startDateStr,
      eventDate: eventDateStr,
      eventDistance: Number(eventDistance),
      eventGoal: eventGoal,
      createdAt: new Date().toISOString(),
      goal: goal,
      indoorDays: indoorDays,
      outdoorDays: outdoorDays,
      indoorLimit: indoorLimit,
      outdoorLimit: outdoorLimit,
      totalWeeks: totalWeeks,
      macroStrategy: macroStrategy
    };

    try {
      for (var i = 0; i < monthKeys.length; i++) {
        var ymKey = monthKeys[i];
        var monthDates = byMonth[ymKey];
        var label = ymKey.replace('-', '년 ') + '월';
        updateScheduleProgress(true, label + ' 스케줄 생성 중...', (i + 1) + '/' + monthKeys.length + ' 개월 (' + monthDates.length + '일)');

        var dateListJson = JSON.stringify(monthDates.map(function (t) {
          var wIdx = t.weekIndex || 1;
          var m = macroStrategy[wIdx - 1];
          return {
            date: t.dateStr,
            type: t.type,
            dayName: t.dayName,
            taper: !!t.taper,
            week: wIdx,
            focus: (m && m.focus) ? m.focus : '',
            phase: (m && m.phase) ? m.phase : ''
          };
        }));

        var macroContext = macroStrategy.length > 0
          ? '\n**주차별 매크로 전략 (Phase 1 주기화):** 이번 월의 날짜에 해당하는 주차 테마(focus, phase)에 맞춰 워크아웃을 선택하시오. Base→Endurance/SweetSpot, Build→Threshold, Specialty→대회 특화, Taper→Recovery만.\n이번 월 날짜별 주차·테마 샘플: ' + monthDates.slice(0, 6).map(function (t) {
            var m = macroStrategy[(t.weekIndex || 1) - 1];
            return t.dateStr + '(주' + (t.weekIndex || 1) + ':' + ((m && m.phase) || '-') + '/' + ((m && m.focus) || '-') + ')';
          }).join(', ') + '\n'
          : '';

        var taperNote = monthDates.some(function (t) { return t.taper; })
          ? '\n**[필수] 대회 1주 전(taper=true) 컨디션 조절:** taper가 true인 날짜는 시합 당일 최상의 퍼포먼스를 위해 반드시 다음을 적용하시오:\n- duration: 30~45분 이하\n- predictedTSS: 25~40 이하 (평상시의 40~50% 수준)\n- workoutName: Recovery, Active Recovery, Z1~Z2 기초 유지만 사용\n- 고강도(Threshold, VO2max, Anaerobic 등) 절대 금지'
          : '';

        var baseContext = `당신은 세계 최고의 사이클링 코치입니다. Phase 1 매크로 전략(주기화)과 경기 1주 전 테이퍼링을 정확히 반영하는 것이 핵심입니다.

**아래 지정된 날짜에 대해, 각 날짜당 정확히 1개씩 훈련을 생성하시오. 날짜 순서와 개수를 변경하지 마시오.**
**각 날짜의 week/focus/phase에 맞는 훈련 유형을 선택하시오.** (Base→Endurance/SweetSpot, Build→Threshold/SweetSpot, Specialty→대회 특화, Taper→Recovery만)
${macroContext}

**생성할 날짜 목록 (반드시 이 목록의 모든 날짜에 대해 1개씩 생성):**
${dateListJson}

**대회 1주 전(taper: true) 컨디션 조절 [필수]:** taper가 true인 날짜는 평상시 강도가 적용되면 시합날 최상의 퍼포먼스를 낼 수 없습니다. 반드시 강도·TSS를 크게 낮추고 Recovery/Active Recovery 위주로만 배정하시오.
${taperNote}

**사용자 프로필:** 나이 ${age}세, 성별 ${sex}, FTP ${ftp}W, 몸무게 ${weight}kg
**훈련 목표:** ${goal}${isEliteOrPro ? ' (Elite/Pro: 고강도·높은 TSS)' : ' (일반 동호인: 회복·지속 가능성 중시)'}
**제약:** 인도어일은 최대 ${indoorLimit}분, 아웃도어일은 최대 ${outdoorLimit}분
**대회:** ${eventDateStr}, ${eventDistance}km, ${eventGoal}
${workoutsContext}

**출력 규칙:**
- 위 날짜 목록의 각 항목에 대해 정확히 1개씩, 같은 순서대로 JSON 배열로 출력.
- type 필드는 각 날짜의 Indoor/Outdoor 값을 그대로 사용.
- 반드시 유효한 JSON 배열만 출력. 작은따옴표 금지, 큰따옴표만 사용. trailing comma 금지. description은 한 줄로.
[
  { "date": "YYYY-MM-DD", "workoutName": "String", "workoutId": "String 또는 빈 문자열", "duration": Number(분), "predictedTSS": Number, "type": "Indoor"|"Outdoor", "description": "String" }
]`;

        scheduleLog('GEMINI', label + ' API 요청 (' + monthDates.length + '일)', { count: monthDates.length });
        var parsed = await generateMonthlySchedule(apiKey, {
          year: parseInt(ymKey.substring(0, 4), 10),
          month: parseInt(ymKey.substring(5, 7), 10) - 1,
          prompt: baseContext,
          modelName: modelName
        });

        scheduleLog('GEMINI', label + ' 응답: ' + (parsed ? parsed.length : 0) + '건 (예상 ' + monthDates.length + '건)', { parsedCount: parsed ? parsed.length : 0, expected: monthDates.length });

        var workoutIdx = 0;
        var recoveryWorkouts = lightweightWorkouts.filter(function (w) {
          var c = (w.category || '').toLowerCase();
          return c.indexOf('recovery') >= 0 || c.indexOf('endurance') >= 0;
        });
        if (recoveryWorkouts.length === 0) recoveryWorkouts = lightweightWorkouts;

        var addedThisMonth = 0;
        for (var j = 0; j < monthDates.length; j++) {
          var td = monthDates[j];
          var item = parsed && parsed[j] ? parsed[j] : null;
          var dateStr = td.dateStr;
          var wName = (item && item.workoutName) ? item.workoutName : '';
          var wId = (item && item.workoutId) ? String(item.workoutId).trim() : '';
          var isEmpty = !wId && (!wName || wName === '훈련');
          if (isEmpty && lightweightWorkouts.length > 0) {
            var fallback = td.taper && recoveryWorkouts.length > 0
              ? recoveryWorkouts[j % recoveryWorkouts.length]
              : lightweightWorkouts[workoutIdx % lightweightWorkouts.length];
            wId = fallback.id || '';
            wName = fallback.title || fallback.name || '훈련';
            var dur = fallback.duration_min || 60;
            var tss = fallback.tss_predicted || Math.round(dur * 0.6);
            if (td.taper) {
              dur = Math.min(dur, 45);
              tss = Math.min(tss, 40);
            }
            allDays[dateStr] = {
              workoutName: wName,
              workoutId: wId,
              duration: Math.round(Number(item && item.duration) || dur),
              predictedTSS: Math.round(Number(item && item.predictedTSS) || tss),
              type: td.type,
              description: (item && item.description) ? item.description : ''
            };
            scheduleLog('FALLBACK', dateStr + ' 빈 훈련 -> 워크아웃 할당: ' + wName + '(id:' + wId + ')' + (td.taper ? ' [테이퍼]' : ''), {});
            workoutIdx++;
          } else {
            var dur = Math.round(Number(item && item.duration) || 60);
            var tss = Math.round(Number(item && item.predictedTSS) || 50);
            if (td.taper) {
              dur = Math.min(dur, 45);
              tss = Math.min(tss, 40);
              var isHeavy = /threshold|vo2|anaerobic|sweet spot|tempo/i.test(wName || '');
              if (isHeavy && recoveryWorkouts.length > 0) {
                var r = recoveryWorkouts[j % recoveryWorkouts.length];
                wName = r.title || r.name || 'Active Recovery';
                wId = r.id || '';
                dur = Math.min(r.duration_min || 40, 45);
                tss = Math.min(r.tss_predicted || 30, 40);
              }
            }
            allDays[dateStr] = {
              workoutName: wName || '훈련',
              workoutId: wId || '',
              duration: dur,
              predictedTSS: tss,
              type: td.type,
              description: (item && item.description) ? item.description : ''
            };
          }
          addedThisMonth++;
        }
        scheduleLog('PARSE', label + ' 반영: ' + addedThisMonth + '일 (전체 ' + Object.keys(allDays).length + '일)', { added: addedThisMonth, total: Object.keys(allDays).length });
      }

      var data = {
        scheduleName: scheduleName,
        days: allDays,
        meta: meta
      };

      var totalDays = Object.keys(allDays).length;
      scheduleLog('SAVE', 'Firebase 저장 시도: path=users/' + rtdbUserId + '/training_schedule, days=' + totalDays + '일', { path: 'users/' + rtdbUserId + '/training_schedule', totalDays: totalDays });
      updateScheduleProgress(true, 'Firebase에 저장 중...', '저장 경로: users/' + rtdbUserId + '/training_schedule');

      try {
        await window.saveAIScheduleToFirebase(rtdbUserId, data);
        scheduleLog('SAVE', 'Firebase 저장 성공', { path: 'users/' + rtdbUserId + '/training_schedule' });
      } catch (saveErr) {
        scheduleLog('SAVE_FAIL', 'Firebase 저장 실패: ' + (saveErr && (saveErr.message || saveErr.code || String(saveErr))), {
          error: saveErr,
          message: saveErr && saveErr.message,
          code: saveErr && saveErr.code,
          stack: saveErr && saveErr.stack
        });
        console.error('[AI스케줄] Firebase 저장 실패:', saveErr);
        var msg = saveErr && (saveErr.message || saveErr.code || '') ? String(saveErr.message || saveErr.code) : '저장 실패';
        if (/permission|PERMISSION_DENIED|unauthorized/i.test(msg)) {
          if (typeof showToast === 'function') showToast('저장 권한이 없습니다. 로그인 상태와 Realtime Database 규칙을 확인하세요.', 'error');
        } else {
          if (typeof showToast === 'function') showToast('Firebase 저장 실패: ' + msg, 'error');
        }
        try {
          localStorage.setItem('aiScheduleFallback_' + rtdbUserId, JSON.stringify(data));
        } catch (e) {}
      }

      updateScheduleProgress(true, '완료!', '스케줄이 저장되었습니다.');
      aiScheduleData = { scheduleName: scheduleName, days: allDays, meta: meta };

      var subHeader = document.getElementById('aiScheduleSubHeader');
      if (subHeader) subHeader.textContent = scheduleName;
      renderAIScheduleCalendar();

      var taperDaysCount = trainingDates.filter(function (t) { return t.taper; }).length;

      setTimeout(function () {
        updateScheduleProgress(false);
        closeScheduleCreateAIModal();
        if (typeof showAIScheduleResultModal === 'function') {
          showAIScheduleResultModal({
            scheduleName: scheduleName,
            days: allDays,
            meta: meta,
            taperDaysCount: taperDaysCount,
            taperStartStr: taperStartStr
          });
        }
        if (typeof showToast === 'function') showToast('스케줄이 생성되었습니다.');
      }, 800);
    } catch (err) {
      scheduleLog('ERROR', '스케줄 생성 실패: ' + (err.message || err), { error: err, stack: err && err.stack });
      console.error('[AI스케줄] generateScheduleWithGemini 오류', err);
      updateScheduleProgress(false);
      if (typeof showToast === 'function') showToast('스케줄 생성 실패: ' + (err.message || '오류'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '스케줄 생성'; }
      if (btnRow) btnRow.style.display = 'flex';
    }
  };

  /**
   * 스케줄 상세 모달 열기
   */
  window.openScheduleDetailModal = async function (dateStr) {
    const modal = document.getElementById('scheduleDetailModal');
    const infoEl = document.getElementById('scheduleDetailInfo');
    const graphEl = document.getElementById('scheduleDetailGraph');
    const dateInput = document.getElementById('scheduleDetailDateInput');
    const startBtn = document.getElementById('btnStartScheduleTraining');

    if (!modal || !aiScheduleData || !aiScheduleData.days || !aiScheduleData.days[dateStr]) return;

    scheduleDetailCurrentDate = dateStr;
    scheduleDetailCurrentDay = aiScheduleData.days[dateStr];

    const d = scheduleDetailCurrentDay;
    infoEl.innerHTML = `
      <p><strong>${d.workoutName}</strong></p>
      <p>운동 시간: ${d.duration}분 | 예상 TSS: ${d.predictedTSS}</p>
      <p>날짜: ${dateStr} | 타입: ${d.type || 'Indoor'}</p>
    `;

    if (dateInput) dateInput.value = dateStr;

    graphEl.innerHTML = '';
    if (d.workoutId && window.GAS_URL) {
      try {
        const res = await fetch(`${window.GAS_URL}?action=getWorkout&id=${d.workoutId}`);
        const r = await res.json();
        if (r?.success && r.item?.segments?.length) {
          const segs = r.item.segments;
          const canvas = document.createElement('canvas');
          canvas.id = 'scheduleDetailGraphCanvas';
          canvas.width = 320;
          canvas.height = 120;
          graphEl.appendChild(canvas);
          if (typeof drawSegmentGraph === 'function') {
            drawSegmentGraph(segs, -1, 'scheduleDetailGraphCanvas');
          } else if (typeof renderSegmentedWorkoutGraph === 'function') {
            const div = document.createElement('div');
            div.className = 'segmented-workout-graph';
            graphEl.innerHTML = '';
            graphEl.appendChild(div);
            renderSegmentedWorkoutGraph(div, segs, { maxHeight: 100 });
          }
        }
      } catch (e) {
        console.warn('워크아웃 세그먼트 로드 실패:', e);
      }
    }

    if (startBtn) {
      startBtn.onclick = function () {
        startScheduleDetailTraining();
      };
    }

    modal.style.display = 'flex';
  };

  window.closeScheduleDetailModal = function () {
    const modal = document.getElementById('scheduleDetailModal');
    if (modal) modal.style.display = 'none';
    scheduleDetailCurrentDate = null;
    scheduleDetailCurrentDay = null;
  };

  /**
   * AI 훈련 계획 수립 결과·효과 분석 팝업 표시 (모바일 훈련 결과 팝업 디자인 동일)
   * @param {Object} data - { scheduleName, days, meta, taperDaysCount, taperStartStr }
   */
  window.showAIScheduleResultModal = function (data) {
    var modal = document.getElementById('aiScheduleResultModal');
    var bodyEl = document.getElementById('aiScheduleResultBody');
    var effectEl = document.getElementById('aiScheduleResultEffect');
    if (!modal || !bodyEl || !effectEl) return;

    var meta = (data && data.meta) || {};
    var days = (data && data.days) || {};
    var scheduleName = (data && data.scheduleName) || '훈련 스케줄';
    var taperCount = (data && data.taperDaysCount) || 0;
    var taperStartStr = data && data.taperStartStr;

    var keys = Object.keys(days).sort();
    var totalDays = keys.length;

    var byMonth = {};
    var totalTSS = 0;
    var taperTSS = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var d = days[k];
      var tss = Number(d.predictedTSS) || 0;
      totalTSS += tss;
      if (taperStartStr && k >= taperStartStr) taperTSS += tss;
      var ym = k.substring(0, 7);
      if (!byMonth[ym]) byMonth[ym] = 0;
      byMonth[ym]++;
    }

    var monthSummary = Object.keys(byMonth).sort().map(function (ym) {
      return ym.replace('-', '/') + ': ' + byMonth[ym] + '일';
    }).join(', ');

    var statStyle = 'background: rgba(0, 212, 170, 0.1); border: 1px solid rgba(0, 212, 170, 0.3); border-radius: 6px; padding: 8px 10px; text-align: center;';
    var statLabel = 'font-size: 0.7em; color: #aaa; margin-bottom: 3px; font-weight: 500;';
    var statValue = 'font-size: 1.1em; font-weight: bold; color: #00d4aa; text-shadow: 0 0 8px rgba(0, 212, 170, 0.4);';

    bodyEl.innerHTML = ''
      + '<div class="mobile-result-stat-item" style="' + statStyle + '"><div style="' + statLabel + '">대회 일정</div><div style="' + statValue + '">' + (meta.eventDate || '-') + '</div></div>'
      + '<div class="mobile-result-stat-item" style="' + statStyle + '"><div style="' + statLabel + '">대회 거리</div><div style="' + statValue + '">' + (meta.eventDistance || '-') + 'km</div></div>'
      + '<div class="mobile-result-stat-item" style="' + statStyle + '"><div style="' + statLabel + '">훈련 목표</div><div style="' + statValue + '">' + (meta.eventGoal || '-') + '</div></div>'
      + '<div class="mobile-result-stat-item" style="' + statStyle + '"><div style="' + statLabel + '">총 훈련일</div><div style="' + statValue + '">' + totalDays + '일</div></div>'
      + '<div class="mobile-result-stat-item" style="' + statStyle + '"><div style="' + statLabel + '">예상 총 TSS</div><div style="' + statValue + '">' + totalTSS.toLocaleString() + '</div></div>'
      + '<div class="mobile-result-stat-item" style="' + statStyle + '"><div style="' + statLabel + '">테이퍼 기간</div><div style="' + statValue + '">' + taperCount + '일</div></div>';

    var effectText = '';
    if (taperCount > 0) {
      effectText += '경기 1주 전 컨디션 조절(테이퍼링)이 적용되었습니다. 대회 직전 훈련 강도를 낮춰 시합 당일 최상의 퍼포먼스를 발휘할 수 있도록 설계되었습니다.';
      if (taperTSS > 0) {
        var taperShare = totalTSS > 0 ? Math.round((taperTSS / totalTSS) * 100) : 0;
        effectText += ' 테이퍼 구간 TSS는 전체의 약 ' + taperShare + '% 수준으로 조절되었습니다.';
      }
    } else {
      effectText += '설정된 대회 일정이 훈련 기간 내에 있어 테이퍼 구간이 포함되지 않았습니다.';
    }
    effectText += ' 월별 훈련 분포: ' + (monthSummary || '-') + '.';
    effectEl.textContent = effectText;

    modal.classList.remove('hidden');
  };

  window.closeAIScheduleResultModal = function () {
    var modal = document.getElementById('aiScheduleResultModal');
    if (modal) modal.classList.add('hidden');
  };

  /**
   * 스케줄 상세 날짜 변경
   */
  window.updateScheduleDetailDate = async function () {
    const newDate = document.getElementById('scheduleDetailDateInput')?.value;
    if (!newDate || !scheduleDetailCurrentDate || !scheduleDetailCurrentDay || !aiScheduleData) return;

    var userId = getUserIdForRTDB() || getUserId();
    if (!userId) return;

    delete aiScheduleData.days[scheduleDetailCurrentDate];
    aiScheduleData.days[newDate] = scheduleDetailCurrentDay;

    await window.saveAIScheduleToFirebase(userId, aiScheduleData);
    closeScheduleDetailModal();
    renderAIScheduleCalendar();
    if (typeof showToast === 'function') showToast('날짜가 변경되었습니다.');
  };

  /**
   * 훈련 시작: 컨디션 보정(RPE 모달) -> 훈련 준비 -> 대시보드(노트북/모바일)
   */
  window.startScheduleDetailTraining = function () {
    if (!scheduleDetailCurrentDay || !scheduleDetailCurrentDate) return;

    const workoutId = scheduleDetailCurrentDay.workoutId;

    closeScheduleDetailModal();

    function doStart() {
      window.rpeModalSource = 'solo';
      if (typeof showRPEModal === 'function') {
        showRPEModal('solo');
      } else if (typeof showRPEModalForSoloTraining === 'function') {
        showRPEModalForSoloTraining();
      } else if (typeof showScreen === 'function') {
        showScreen('trainingReadyScreen');
      }
    }

    if (workoutId && window.GAS_URL) {
      fetch(`${window.GAS_URL}?action=getWorkout&id=${workoutId}`)
        .then(r => r.json())
        .then(function (result) {
          if (result?.success && result.item) {
            window.currentWorkout = result.item;
            try {
              localStorage.setItem('currentWorkout', JSON.stringify(result.item));
            } catch (e) {}
          }
          doStart();
        })
        .catch(function () {
          doStart();
        });
    } else {
      doStart();
    }
  };

})();
