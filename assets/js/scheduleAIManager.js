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
    return (window.currentUser && window.currentUser.id) || (JSON.parse(localStorage.getItem('currentUser') || 'null')?.id) || '';
  }

  /**
   * AI 스케줄 화면 로드 (진입 시 호출)
   */
  window.loadAIScheduleScreen = async function () {
    const calendarEl = document.getElementById('aiScheduleCalendar');
    const subHeaderEl = document.getElementById('aiScheduleSubHeader');
    if (!calendarEl) return;

    const userId = getUserId();
    if (!userId) {
      calendarEl.innerHTML = '<div class="error-message">사용자 정보를 찾을 수 없습니다.</div>';
      if (subHeaderEl) subHeaderEl.textContent = '스케줄을 생성해주세요';
      return;
    }

    calendarEl.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>캘린더를 불러오는 중...</p></div>';

    try {
      aiScheduleData = await loadAIScheduleFromFirebase(userId);
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
    const db = getDb();
    if (!db) throw new Error('Firebase Database를 사용할 수 없습니다.');

    const ref = db.ref('users/' + userId + '/training_schedule');
    const snapshot = await ref.once('value');
    const val = snapshot.val();
    if (!val) return null;

    const data = {
      scheduleName: val.scheduleName || '내 훈련 스케줄',
      days: val.days || {},
      meta: val.meta || {}
    };
    return data;
  };

  /**
   * Firebase Realtime Database에 AI 스케줄 저장
   */
  window.saveAIScheduleToFirebase = async function (userId, data) {
    const db = getDb();
    if (!db) throw new Error('Firebase Database를 사용할 수 없습니다.');

    const ref = db.ref('users/' + userId + '/training_schedule');
    await ref.set(data);
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

    const userId = getUserId();
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayData = aiScheduleData && aiScheduleData.days && aiScheduleData.days[dateStr];
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
    if (aiScheduleData && aiScheduleData.days && userId) {
      const pastDates = Object.keys(aiScheduleData.days).filter(d => d < todayStr);
      Promise.all(pastDates.map(async (dateStr) => {
        const completed = await getIsCompletedForDate(userId, dateStr);
        if (aiScheduleData.days[dateStr].isCompleted !== completed) {
          aiScheduleData.days[dateStr].isCompleted = completed;
          try {
            await window.saveAIScheduleToFirebase(userId, aiScheduleData);
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
   * 스케줄 생성 설정 모달 열기
   */
  window.openScheduleCreateAIModal = function () {
    const modal = document.getElementById('scheduleCreateAIModal');
    const userInfoEl = document.getElementById('aiScheduleUserInfo');
    if (!modal || !userInfoEl) return;
    updateScheduleProgress(false);

    const user = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (!user) {
      if (typeof showToast === 'function') showToast('사용자 정보를 찾을 수 없습니다.', 'error');
      return;
    }

    const age = user.age ?? user.birthYear ? (new Date().getFullYear() - user.birthYear) : '-';
    const sex = user.sex || user.gender || '-';
    const ftp = user.ftp || 0;
    const weight = user.weight || 0;
    const challenge = user.challenge || 'Fitness';

    userInfoEl.innerHTML = `
      나이: ${age}세 | 성별: ${sex} | FTP: ${ftp}W | 몸무게: ${weight}kg<br>
      훈련 목적: ${challenge}
    `;

    const eventDate = document.getElementById('aiScheduleEventDate');
    if (eventDate) {
      const d = new Date();
      d.setMonth(d.getMonth() + 2);
      eventDate.value = d.toISOString().split('T')[0];
    }

    document.getElementById('aiScheduleEventDistance').value = 100;
    document.getElementById('aiScheduleEventGoal').value = '완주';

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
      if (json?.error) throw new Error(json.error.message || 'Gemini API 오류');
      var text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      var parsed = [];
      try {
        var cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (e) {
        var match = text.match(/\[[\s\S]*\]/);
        if (match) parsed = JSON.parse(match[0]);
        else throw new Error('JSON 파싱 실패: ' + (e && e.message));
      }
      if (!Array.isArray(parsed)) throw new Error('배열 형식이 아닙니다.');
      return parsed;
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
   * Gemini API로 훈련 스케줄 생성 (Step-by-Step 월별 생성)
   */
  window.generateScheduleWithGemini = async function () {
    var btn = document.getElementById('btnGenerateAISchedule');
    var btnRow = document.getElementById('aiScheduleBtnRow');
    var userId = getUserId();
    var apiKey = (localStorage.getItem('geminiApiKey') || (document.getElementById('settingsGeminiApiKey') && document.getElementById('settingsGeminiApiKey').value) || '').trim();

    if (!apiKey) {
      if (confirm('Gemini API 키가 설정되지 않았습니다.\n환경 설정에서 API 키를 입력해주세요.\n\n지금 환경 설정을 열까요?')) {
        if (typeof openSettingsModal === 'function') openSettingsModal();
        else if (typeof showScreen === 'function') showScreen('myCareerScreen');
      }
      return;
    }

    var user = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (!user) {
      if (typeof showToast === 'function') showToast('사용자 정보를 찾을 수 없습니다.', 'error');
      return;
    }

    var eventDateStr = document.getElementById('aiScheduleEventDate') && document.getElementById('aiScheduleEventDate').value;
    var eventDistance = document.getElementById('aiScheduleEventDistance') && document.getElementById('aiScheduleEventDistance').value;
    var eventGoal = document.getElementById('aiScheduleEventGoal') && document.getElementById('aiScheduleEventGoal').value;

    if (!eventDateStr || !eventDistance) {
      if (typeof showToast === 'function') showToast('대회 일정과 거리를 입력해주세요.', 'error');
      return;
    }

    var indoorDays = Array.from(document.querySelectorAll('input[name="aiIndoorDays"]:checked')).map(function (cb) { return parseInt(cb.value, 10); });
    var outdoorDays = Array.from(document.querySelectorAll('input[name="aiOutdoorDays"]:checked')).map(function (cb) { return parseInt(cb.value, 10); });
    var indoorLimit = (document.getElementById('aiScheduleIndoorTimeLimit') && document.getElementById('aiScheduleIndoorTimeLimit').value) || '120';
    var outdoorLimit = (document.getElementById('aiScheduleOutdoorTimeLimit') && document.getElementById('aiScheduleOutdoorTimeLimit').value) || '180';

    var dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    var indoorStr = indoorDays.length ? indoorDays.map(function (d) { return dayNames[d]; }).join(', ') : '없음';
    var outdoorStr = outdoorDays.length ? outdoorDays.map(function (d) { return dayNames[d]; }).join(', ') : '없음';

    var age = user.age != null ? user.age : (user.birthYear ? (new Date().getFullYear() - user.birthYear) : 30);
    var sex = user.sex || user.gender || '-';
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
    var eventDate = new Date(eventDateStr);
    if (eventDate < today) {
      updateScheduleProgress(false);
      if (btn) { btn.disabled = false; btn.textContent = '스케줄 생성'; }
      if (btnRow) btnRow.style.display = 'flex';
      if (typeof showToast === 'function') showToast('대회 일정이 과거입니다.', 'error');
      return;
    }

    var monthsToGenerate = [];
    var y = today.getFullYear();
    var m = today.getMonth();
    var ey = eventDate.getFullYear();
    var em = eventDate.getMonth();
    while (y < ey || (y === ey && m <= em)) {
      monthsToGenerate.push({ year: y, month: m });
      m++;
      if (m > 11) { m = 0; y++; }
    }

    updateScheduleProgress(true, '스케줄 생성 준비 완료', monthsToGenerate.length + '개월 생성 예정');

    var modelName = localStorage.getItem('geminiModelName') || 'gemini-2.0-flash-exp';
    var scheduleName = eventGoal + ' ' + eventDistance + 'km (' + eventDateStr + ')';
    var allDays = {};
    var meta = {
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

        var baseContext = `당신은 세계 최고의 사이클링 코치입니다.

**이번 요청에서는 오직 ${ym.year}년 ${ym.month + 1}월의 스케줄만 생성하시오.** 다른 달은 생성하지 마세요.

**사용자 프로필:** 나이 ${age}세, 성별 ${sex}, FTP ${ftp}W, 몸무게 ${weight}kg
**훈련 목표:** ${goal}${isEliteOrPro ? ' (Elite/Pro: 고강도·높은 TSS)' : ' (일반 동호인: 회복·지속 가능성 중시)'}
**제약:** 인도어 요일 ${indoorStr} (최대 ${indoorLimit}분), 아웃도어 요일 ${outdoorStr} (최대 ${outdoorLimit}분)
**대회:** ${eventDateStr}, ${eventDistance}km, ${eventGoal}
${workoutsContext}
${prevContext}

**엄격한 지침:**
- 주말(토/일)에는 사용자가 설정한 아웃도어/인도어 선호도와 시간 제한을 엄격히 준수하시오.
- 주중에는 회복과 인터벌을 적절히 분배하여 TSS 급증을 방지하시오.
- 이번 요청에서는 ${ym.year}년 ${ym.month + 1}월에 해당하는 날짜만 포함하시오.

**출력:** JSON 배열만. 다른 텍스트 없음.
[
  { "date": "YYYY-MM-DD", "workoutName": "String", "workoutId": "String 또는 빈 문자열", "duration": Number(분), "predictedTSS": Number, "type": "Indoor"|"Outdoor", "description": "String" }
]`;

        var parsed = await generateMonthlySchedule(apiKey, {
          year: ym.year,
          month: ym.month,
          prompt: baseContext,
          modelName: modelName
        });

        for (var j = 0; j < parsed.length; j++) {
          var item = parsed[j];
          var date = item.date || item.dateStr;
          if (!date) continue;
          var d = String(date).slice(0, 10);
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
        }

        var data = {
          scheduleName: scheduleName,
          days: allDays,
          meta: meta
        };
        await window.saveAIScheduleToFirebase(userId, data);
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
      console.error('generateScheduleWithGemini:', err);
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

    const userId = getUserId();
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
