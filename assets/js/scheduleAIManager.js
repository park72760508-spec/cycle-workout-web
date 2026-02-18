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
   * 사용자 정보 로드 (currentUser/localStorage + Firestore 병합)
   * 나이(birth_year/birthYear), 성별(gender/sex)는 Firestore users/{uid}에서 조회
   */
  async function loadUserForScheduleModal() {
    var userId = getUserId() || getUserIdForRTDB();
    if (!userId) return null;
    var user = window.currentUser || (function () { try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) { return null; } })();
    if (!user) user = { id: userId };

    var firestoreUser = null;
    try {
      if (typeof window.getUserByUid === 'function') {
        firestoreUser = await window.getUserByUid(userId);
      }
      if (!firestoreUser) {
        var authUid = getUserIdForRTDB();
        if (authUid && authUid !== userId && typeof window.getUserByUid === 'function') {
          firestoreUser = await window.getUserByUid(authUid);
        }
      }
      if (!firestoreUser && typeof window.apiGetUser === 'function') {
        var res = await window.apiGetUser(userId);
        if (res && res.success && res.item) firestoreUser = res.item;
        if (!firestoreUser) {
          var uid2 = getUserIdForRTDB();
          if (uid2 && uid2 !== userId) {
            res = await window.apiGetUser(uid2);
            if (res && res.success && res.item) firestoreUser = res.item;
          }
        }
      }
      if (!firestoreUser && window.firestore && window.firestore.collection) {
        var doc = await window.firestore.collection('users').doc(userId).get();
        if (doc && doc.exists) {
          firestoreUser = { id: userId, ...doc.data() };
        }
        if (!firestoreUser) {
          var uid2 = getUserIdForRTDB();
          if (uid2 && uid2 !== userId) {
            doc = await window.firestore.collection('users').doc(uid2).get();
            if (doc && doc.exists) firestoreUser = { id: uid2, ...doc.data() };
          }
        }
      }
    } catch (e) {
      console.warn('[loadUserForScheduleModal] Firestore 사용자 조회 실패:', e);
    }

    if (firestoreUser) {
      user = Object.assign({}, user, firestoreUser);
    }

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
    const ftp = user.ftp || 0;
    const weight = user.weight || 0;
    const challenge = user.challenge || 'Fitness';

    userInfoEl.innerHTML = `
      나이: ${age}세 | 성별: ${sex} | FTP: ${ftp}W | 몸무게: ${weight}kg<br>
      훈련 목적: ${challenge}
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

    var workoutsContext = lightweightWorkouts.length
      ? '\n**사용 가능한 워크아웃 메타데이터 (경량화):**\n' + JSON.stringify(lightweightWorkouts, null, 2) + '\n위 워크아웃 중 id를 workoutId로 매칭하거나, 유사 스펙으로 추천하세요.'
      : '\n워크아웃 정보가 없습니다. workoutName, duration, predictedTSS를 적절히 생성하세요.';

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

    scheduleLog('MONTHS', '생성할 월 ' + monthsToGenerate.length + '개: ' + monthsToGenerate.map(function (x) { return x.year + '-' + (x.month + 1); }).join(', '), monthsToGenerate);
    updateScheduleProgress(true, '스케줄 생성 준비 완료', monthsToGenerate.length + '개월 생성 예정');

    var modelName = localStorage.getItem('geminiModelName') || 'gemini-2.0-flash-exp';
    var scheduleName = eventGoal + ' ' + eventDistance + 'km (' + eventDateStr + ')';
    var allDays = {};
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
      outdoorLimit: outdoorLimit
    };

    try {
      for (var i = 0; i < monthsToGenerate.length; i++) {
        var ym = monthsToGenerate[i];
        var label = ym.year + '년 ' + (ym.month + 1) + '월';
        updateScheduleProgress(true, label + ' 스케줄 생성 중...', (i + 1) + '/' + monthsToGenerate.length + ' 개월');

        var prevSummary = i > 0 ? summarizeLastWeek(allDays) : null;
        var prevContext = prevSummary
          ? '\n**이전 달 마지막 주 요약 (문맥 유지):**\n- 훈련 횟수: ' + prevSummary.sessions + '회\n- 주간 TSS: ' + prevSummary.totalTSS + '\n- 최대 단일 TSS: ' + prevSummary.maxSingleTSS + '\n- 마지막 훈련일: ' + prevSummary.lastDate + '\n→ 이에 맞춰 이번 달 강도와 회복을 조정하세요.'
          : '';

        var monthStart = new Date(ym.year, ym.month, 1);
        var monthEnd = new Date(ym.year, ym.month + 1, 0);
        var effectiveStart = startDate > monthStart ? startDate : monthStart;
        var effectiveStartStr = effectiveStart.getFullYear() + '-' + String(effectiveStart.getMonth() + 1).padStart(2, '0') + '-' + String(effectiveStart.getDate()).padStart(2, '0');
        var msDiff = monthEnd - effectiveStart;
        var daysInRange = Math.max(1, Math.floor(msDiff / (24 * 60 * 60 * 1000)) + 1);
        var expectedMinDays = Math.max(10, Math.min(25, Math.floor(daysInRange * 0.5)));

        var baseContext = `당신은 세계 최고의 사이클링 코치입니다.

**이번 요청에서는 오직 ${ym.year}년 ${ym.month + 1}월의 스케줄만 생성하시오.** 다른 달은 생성하지 마세요.
**필수: 해당 월(${ym.year}-${String(ym.month + 1).padStart(2, '0')})에서 훈련시작일(${effectiveStartStr}) 이후의 거의 모든 훈련 가능일을 포함하시오. 최소 ${expectedMinDays}일 이상 생성. 주 4~6회 훈련 × 4주 = 16~24일 수준으로 꽉 채우시오. 절대 1주(7일)만 생성하지 마시오.**

**사용자 프로필:** 나이 ${age}세, 성별 ${sex}, FTP ${ftp}W, 몸무게 ${weight}kg
**훈련 목표:** ${goal}${isEliteOrPro ? ' (Elite/Pro: 고강도·높은 TSS)' : ' (일반 동호인: 회복·지속 가능성 중시)'}
**제약:** 인도어 요일 ${indoorStr} (최대 ${indoorLimit}분), 아웃도어 요일 ${outdoorStr} (최대 ${outdoorLimit}분)
**훈련 시작일:** ${startDateStr} (이 날짜 이전의 날짜는 절대 포함하지 마시오.)
**대회:** ${eventDateStr}, ${eventDistance}km, ${eventGoal}
${workoutsContext}
${prevContext}

**엄격한 지침:**
- 주말(토/일)에는 사용자가 설정한 아웃도어/인도어 선호도와 시간 제한을 엄격히 준수하시오.
- 주중에는 회복과 인터벌을 적절히 분배하여 TSS 급증을 방지하시오.
- 이번 요청에서는 ${ym.year}년 ${ym.month + 1}월에 해당하는 날짜만 포함하시오. 해당 월 내 훈련 가능한 거의 모든 날을 포함해야 함(예: 주 4~6회 훈련 × 4주 = 16~24일).
- 모든 날짜는 훈련 시작일(${startDateStr}) 이후 또는 당일이어야 한다. 그 이전 날짜는 절대 포함하지 마시오.

**출력 규칙:** 반드시 유효한 JSON 배열만 출력. 작은따옴표 사용 금지, 모든 키와 문자열 값은 큰따옴표(")만 사용. 마지막 요소 뒤 쉼표 금지(trailing comma 금지). description에는 줄바꿈 넣지 말고 한 줄로.
[
  { "date": "YYYY-MM-DD", "workoutName": "String", "workoutId": "String 또는 빈 문자열", "duration": Number(분), "predictedTSS": Number, "type": "Indoor"|"Outdoor", "description": "String" }
]`;

        scheduleLog('GEMINI', label + ' API 요청 중...', { year: ym.year, month: ym.month + 1 });
        var parsed = await generateMonthlySchedule(apiKey, {
          year: ym.year,
          month: ym.month,
          prompt: baseContext,
          modelName: modelName
        });

        scheduleLog('GEMINI', label + ' 응답 파싱 완료: ' + (parsed ? parsed.length : 0) + '건', { parsedCount: parsed ? parsed.length : 0, sample: parsed && parsed[0] ? parsed[0] : null });

        var addedThisMonth = 0;
        for (var j = 0; j < parsed.length; j++) {
          var item = parsed[j];
          var date = item.date || item.dateStr;
          if (!date) continue;
          var d = String(date).slice(0, 10);
          if (d < startDateStr) continue;
          var yr = parseInt(d.substring(0, 4), 10);
          var mo = parseInt(d.substring(5, 7), 10) - 1;
          if (yr !== ym.year || mo !== ym.month) continue;
          allDays[d] = {
            workoutName: item.workoutName || '훈련',
            workoutId: item.workoutId || '',
            duration: Math.round(Number(item.duration) || 60),
            predictedTSS: Math.round(Number(item.predictedTSS) || 50),
            type: item.type === 'Outdoor' ? 'Outdoor' : 'Indoor',
            description: item.description || ''
          };
          addedThisMonth++;
        }
        scheduleLog('PARSE', label + ' 추가됨: ' + addedThisMonth + '일 (전체 누적: ' + Object.keys(allDays).length + '일)', { added: addedThisMonth, total: Object.keys(allDays).length });
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

      setTimeout(function () {
        updateScheduleProgress(false);
        closeScheduleCreateAIModal();
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
