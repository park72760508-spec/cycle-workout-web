/* 관리자 환경설정 > 인스타그램 업로드 (2026-11-27)
 * 연결 정보(GitHub 토큰 + 비밀값 5개) 입력·검증·등록, 영상 만들기/게시 실행, 주차별 게시 현황·승인.
 * 서버: Cloud Function instagramAgentAdmin (관리자 grade=1 전용). 비밀값은 화면에 다시 표시하지 않는다(설정됨/미설정만). */
(function () {
  'use strict';

  var SECRETS = [
    { key: 'ANTHROPIC_API_KEY', label: 'Claude API 키', ph: 'sk-ant-…', hint: '주간 콘텐츠 기획용. console.anthropic.com 에서 발급' },
    { key: 'IG_USER_ID', label: '인스타그램 계정 ID', ph: '숫자 ID', hint: '선택 — 자동 게시용. Graph API: GET /{페이지ID}?fields=instagram_business_account', optional: true },
    { key: 'IG_ACCESS_TOKEN', label: '인스타그램 액세스 토큰', ph: '만료 없는 페이지 토큰', hint: '선택 — 자동 게시용. 계정 ID 와 함께 입력해야 연결을 확인합니다', optional: true }
  ];
  var STATUS_KO = { draft: '초안', approved: '승인됨', published: '게시됨', failed: '실패', rejected: '거부됨' };
  var STATUS_COLOR = { draft: '#64748b', approved: '#2563eb', published: '#16a34a', failed: '#dc2626', rejected: '#94a3b8' };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function kst(iso) {
    if (!iso) return '-';
    var d = new Date(new Date(iso).getTime() + 9 * 3600e3);
    return d.toISOString().replace('T', ' ').slice(5, 16);
  }

  async function call(body) {
    var u = (window.authV9 && window.authV9.currentUser) || (window.auth && window.auth.currentUser);
    if (!u) throw new Error('로그인이 필요합니다.');
    var tok = await u.getIdToken();
    var pid = (window.authV9 && window.authV9.app && window.authV9.app.options && window.authV9.app.options.projectId) || 'stelvio-ai';
    var r = await fetch('https://us-central1-' + pid + '.cloudfunctions.net/instagramAgentAdmin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify(body)
    });
    var d = null;
    try { d = await r.json(); } catch (e) { throw new Error('서버 응답을 읽을 수 없습니다.'); }
    if (!r.ok || !d || d.success !== true) throw new Error((d && d.error) || 'HTTP ' + r.status);
    return d;
  }

  var INPUT = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;';
  var SEC_TITLE = 'font-size:13px;font-weight:700;color:#111827;margin:0 0 8px;';

  function chip(ok, text, optional) {
    var style = ok ? 'background:#ecfdf5;color:#047857;' : (optional ? 'background:#f1f5f9;color:#64748b;' : 'background:#fef2f2;color:#b91c1c;');
    return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:600;margin:0 4px 4px 0;' + style + '">' +
      (ok ? '✓ ' : (optional ? '– ' : '! ')) + esc(text) + (!ok && optional ? ' (선택)' : '') + '</span>';
  }

  function openInstagramAgentModal() {
    var old = document.getElementById('instagramAgentModal');
    if (old) old.remove();
    var ov = document.createElement('div');
    ov.id = 'instagramAgentModal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:12px;';
    ov.innerHTML =
      '<div style="background:#fff;color:#111;border-radius:14px;width:100%;max-width:520px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.3);">' +
      '<div style="padding:14px 16px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">' +
      '<strong style="font-size:15px;">인스타그램 업로드 <span style="font-weight:500;color:#7c3aed;">@stelvioai</span></strong>' +
      '<button type="button" id="igmClose" aria-label="닫기" style="border:none;background:none;font-size:22px;cursor:pointer;line-height:1;">×</button></div>' +
      '<div id="igmBody" style="overflow-y:auto;padding:14px 16px 18px;flex:1;"><p style="text-align:center;color:#6b7280;font-size:13px;padding:30px 0;">불러오는 중…</p></div></div>';
    document.body.appendChild(ov);
    var body = ov.querySelector('#igmBody');
    ov.querySelector('#igmClose').onclick = function () { ov.remove(); };
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });

    var busy = false;
    function setMsg(id, text, ok) {
      var el = body.querySelector('#' + id);
      if (!el) return;
      el.textContent = text || '';
      el.style.color = ok ? '#15803d' : '#b91c1c';
      el.style.display = text ? 'block' : 'none';
    }
    async function guarded(btn, label, fn) {
      if (busy) return;
      busy = true;
      var prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = label;
      try { await fn(); } finally { busy = false; btn.disabled = false; btn.textContent = prev; }
    }

    function render(st) {
      var weeks = st.weeks || [];
      var secretsOk = st.secrets || {};
      var supabaseOk = !!(secretsOk.SUPABASE_URL && secretsOk.SUPABASE_SERVICE_KEY);
      var html = '';

      // 1) 연결 상태
      html += '<div style="margin-bottom:16px;"><p style="' + SEC_TITLE + '">연결 상태</p>' +
        chip(st.github, 'GitHub 토큰') +
        SECRETS.map(function (s) { return chip(!!secretsOk[s.key], s.label, s.optional); }).join('') +
        chip(supabaseOk, 'Supabase 저장소(서버 연결)') + '</div>';

      // 2) 연결 정보 입력
      html += '<div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin-bottom:16px;">' +
        '<p style="' + SEC_TITLE + '">연결 정보 입력</p>' +
        '<p style="font-size:11.5px;color:#64748b;line-height:1.5;margin:0 0 10px;">입력한 값은 서버가 실제 연결을 확인한 뒤 GitHub Actions 저장소 비밀값으로 암호화해 등록합니다. 저장 후에는 화면에 다시 표시되지 않으며, 바꾸려면 다시 입력하세요.</p>' +
        '<label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">GitHub 토큰 <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" style="font-weight:400;color:#2e74e8;">발급</a></label>' +
        '<div style="display:flex;gap:6px;margin-bottom:4px;"><input id="igmGh" type="password" autocomplete="off" placeholder="github_pat_…" style="' + INPUT + 'flex:1;" />' +
        '<button type="button" id="igmGhSave" class="btn btn-default-style" style="white-space:nowrap;padding:0 14px;">저장</button></div>' +
        '<p style="font-size:11px;color:#94a3b8;margin:0 0 12px;line-height:1.45;">Fine-grained 토큰 · 저장소 cycle-workout-web · 권한: Actions·Secrets 읽기/쓰기, Issues 읽기/쓰기, Contents·Metadata 읽기</p>' +
        '<p id="igmGhMsg" style="display:none;font-size:12px;margin:0 0 10px;"></p>' +
        SECRETS.map(function (s) {
          return '<label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">' + esc(s.label) + ' <code style="font-weight:400;color:#94a3b8;font-size:10.5px;">' + s.key + '</code></label>' +
            '<input data-secret="' + s.key + '" type="password" autocomplete="off" placeholder="' + esc(s.ph) + (secretsOk[s.key] ? ' (설정됨 — 바꿀 때만 입력)' : '') + '" style="' + INPUT + 'margin-bottom:3px;" />' +
            '<p style="font-size:11px;color:#94a3b8;margin:0 0 10px;line-height:1.4;">' + esc(s.hint) + '</p>';
        }).join('') +
        '<div style="background:#f5f3ff;border-radius:8px;padding:9px 11px;margin:2px 0 12px;font-size:11.5px;color:#4c1d95;line-height:1.5;">' +
        '<b>Supabase 저장소</b>(URL·서비스 키)는 입력하지 않습니다. 서버가 이미 사용 중인 연결을 가져와 자동으로 등록합니다.' +
        (supabaseOk ? '<label style="display:flex;align-items:center;gap:6px;margin-top:6px;color:#475569;"><input type="checkbox" id="igmSbAgain" /> 서버 연결을 다시 등록</label>' : '') + '</div>' +
        '<button type="button" id="igmSave" class="btn stelvio-purple-btn" style="width:100%;border:none;font-weight:600;padding:10px;">저장 및 연결 확인</button>' +
        '<p id="igmSaveMsg" style="display:none;font-size:12px;margin:8px 0 0;line-height:1.5;white-space:pre-line;"></p>' +
        '<details style="margin-top:12px;"><summary style="font-size:12px;color:#7c3aed;cursor:pointer;">Meta 앱·토큰 발급 방법</summary>' +
        '<ol style="font-size:11.5px;color:#475569;line-height:1.6;padding-left:18px;margin:8px 0 0;">' +
        '<li><a href="https://developers.facebook.com" target="_blank" rel="noopener" style="color:#2e74e8;">developers.facebook.com</a> → 앱 만들기(비즈니스) → <b>Instagram Graph API</b> 추가</li>' +
        '<li><a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noopener" style="color:#2e74e8;">Graph API 탐색기</a>에서 권한(<code>instagram_basic</code>, <code>instagram_content_publish</code>, <code>instagram_manage_insights</code>, <code>pages_show_list</code>, <code>pages_read_engagement</code>)으로 사용자 토큰 발급</li>' +
        '<li>장기 토큰으로 교환: <code>/oauth/access_token?grant_type=fb_exchange_token&amp;client_id=앱ID&amp;client_secret=앱시크릿&amp;fb_exchange_token=사용자토큰</code></li>' +
        '<li><code>GET /me/accounts</code> → 페이지의 <code>access_token</code> = <b>만료 없는 페이지 토큰</b></li>' +
        '<li><code>GET /{페이지ID}?fields=instagram_business_account</code> → 계정 ID</li></ol></details></div>';

      // 3) 영상 게시하기
      function runLine(label, r) {
        if (!r) return '<div style="font-size:11.5px;color:#94a3b8;">' + label + ': 실행 기록 없음</div>';
        var t = r.status !== 'completed' ? '실행 중…' : (r.conclusion === 'success' ? '성공' : '실패(' + esc(r.conclusion) + ')');
        var c = r.status !== 'completed' ? '#2563eb' : (r.conclusion === 'success' ? '#16a34a' : '#dc2626');
        return '<div style="font-size:11.5px;color:#64748b;">' + label + ': <b style="color:' + c + ';">' + t + '</b> · ' + kst(r.at) + ' · <a href="' + esc(r.url) + '" target="_blank" rel="noopener" style="color:#2e74e8;">로그</a></div>';
      }
      var allSet = st.github && supabaseOk && !!secretsOk.ANTHROPIC_API_KEY; // 기획·영상 제작에 필요한 것
      var igSet = !!(secretsOk.IG_USER_ID && secretsOk.IG_ACCESS_TOKEN); // 자동 게시에만 필요
      html += '<div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin-bottom:16px;">' +
        '<p style="' + SEC_TITLE + '">영상 게시하기</p>' +
        (allSet ? '' : '<p style="font-size:11.5px;color:#b45309;margin:0 0 10px;">GitHub 토큰, Supabase, Claude API 키를 설정하면 실행할 수 있습니다.</p>') +
        '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;">' +
        '<button type="button" id="igmPlan" class="btn stelvio-purple-btn" style="border:none;font-weight:600;padding:10px;"' + (allSet ? '' : ' disabled') + '>이번 주 기획·영상 만들기</button>' +
        '<div style="display:flex;gap:6px;">' +
        '<button type="button" id="igmDry" class="btn btn-default-style" style="flex:1;"' + (st.github ? '' : ' disabled') + '>샘플 영상 시험</button>' +
        '<button type="button" id="igmPub" class="btn btn-default-style" style="flex:1;"' + (allSet && igSet ? '' : ' disabled') + ' title="' + (igSet ? '' : '인스타 연결 정보가 없어 자동 게시는 꺼져 있습니다') + '">게시 시각 확인·게시</button></div></div>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:#64748b;margin-bottom:8px;"><input type="checkbox" id="igmForce" /> 이번 주 기획이 이미 있어도 다시 만들기</label>' +
        runLine('기획·제작', (st.runs || {}).weekly) + runLine('게시', (st.runs || {}).publish) +
        '<p id="igmRunMsg" style="display:none;font-size:12px;margin:8px 0 0;"></p>' +
        (igSet
          ? '<p style="font-size:11px;color:#94a3b8;margin:8px 0 0;line-height:1.45;">매주 월요일 09:00 에 자동으로 기획·제작되고, 아래에서 승인하면 예정 시각(기본 화·금 19:00)에 자동 게시됩니다. 샘플 영상 시험은 게시하지 않으며 결과 영상은 GitHub Actions 실행 결과의 아티팩트로 확인합니다.</p>'
          : '<p style="font-size:11px;color:#475569;background:#f8fafc;border-radius:8px;padding:8px 10px;margin:8px 0 0;line-height:1.5;"><b>반자동 운영 중</b> — 매주 월요일 09:00 에 영상·캡션이 만들어져 GitHub Issue 에 올라옵니다. Issue 의 미리보기 링크에서 영상을 폰에 저장하고 Instagram 앱에서 직접 올려 주세요. (인스타 연결 정보를 등록하면 자동 게시로 바뀝니다.) 샘플 영상 시험은 게시하지 않으며 결과 영상은 GitHub Actions 실행 결과의 아티팩트로 확인합니다.</p>') + '</div>';

      // 4) 게시 현황
      html += '<div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><p style="' + SEC_TITLE + 'margin:0;">게시 현황</p>' +
        '<button type="button" id="igmRefresh" class="btn btn-default-style" style="padding:2px 10px;font-size:12px;">새로고침</button></div>';
      if (!weeks.length) {
        html += '<p style="font-size:12px;color:#94a3b8;text-align:center;padding:14px 0;">아직 기획된 주차가 없습니다.</p>';
      }
      weeks.forEach(function (w) {
        var canApprove = igSet && w.issue && w.issue.state === 'open' && !w.issue.approved && w.status === 'draft';
        html += '<div style="border:1px solid #e5e7eb;border-radius:10px;margin-bottom:10px;overflow:hidden;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f8fafc;">' +
          '<span style="font-size:13px;font-weight:700;">' + esc(w.week) + ' <span style="font-weight:600;color:' + (STATUS_COLOR[w.status] || '#64748b') + ';font-size:11px;">' + esc(STATUS_KO[w.status] || w.status) + '</span></span>' +
          (canApprove ? '<button type="button" class="btn stelvio-purple-btn igm-approve" data-week="' + esc(w.week) + '" style="border:none;font-weight:600;padding:5px 14px;font-size:12px;">승인</button>'
            : (w.issue ? '<a href="' + esc(w.issue.url) + '" target="_blank" rel="noopener" style="font-size:11px;color:#2e74e8;">Issue #' + w.issue.number + '</a>' : '')) + '</div>';
        (w.posts || []).forEach(function (p) {
          html += '<div style="padding:9px 12px;border-top:1px solid #f1f5f9;font-size:12px;">' +
            '<div style="display:flex;justify-content:space-between;gap:8px;"><b style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(p.title) + '</b>' +
            '<span style="flex:none;font-weight:600;color:' + (STATUS_COLOR[p.status] || '#64748b') + ';">' + esc(STATUS_KO[p.status] || p.status) + '</span></div>' +
            '<div style="color:#64748b;margin-top:2px;">예정 ' + kst(p.publishAt) + ' KST' +
            (p.videoUrl ? ' · <a href="' + esc(p.videoUrl) + '" target="_blank" rel="noopener" style="color:#2e74e8;">영상 보기</a>' : ' · 영상 준비 전') +
            (p.permalink ? ' · <a href="' + esc(p.permalink) + '" target="_blank" rel="noopener" style="color:#2e74e8;">인스타 게시물</a>' : '') + '</div>' +
            (p.error ? '<div style="color:#dc2626;margin-top:2px;">' + esc(p.error) + '</div>' : '') +
            '<details style="margin-top:4px;"><summary style="cursor:pointer;color:#7c3aed;">캡션 보기</summary><div style="white-space:pre-wrap;color:#334155;margin-top:4px;line-height:1.5;">' + esc(p.caption) + '</div></details></div>';
        });
        html += '</div>';
      });
      html += '</div>';

      body.innerHTML = html;
      wire(st);
    }

    function wire(st) {
      var supabaseOk = !!(st && st.secrets && st.secrets.SUPABASE_URL && st.secrets.SUPABASE_SERVICE_KEY);
      var q = function (id) { return body.querySelector('#' + id); };
      q('igmRefresh').onclick = function () { load(); };

      q('igmGhSave').onclick = function () {
        var btn = this;
        var tok = q('igmGh').value.trim();
        if (!tok) { setMsg('igmGhMsg', 'GitHub 토큰을 입력해 주세요.', false); return; }
        guarded(btn, '확인 중…', async function () {
          try {
            await call({ action: 'saveGithub', githubToken: tok });
            q('igmGh').value = '';
            await load();
            setMsg('igmGhMsg', 'GitHub 토큰이 저장되었습니다.', true);
          } catch (e) { setMsg('igmGhMsg', e.message, false); }
        });
      };

      q('igmSave').onclick = function () {
        var btn = this;
        var values = {};
        body.querySelectorAll('input[data-secret]').forEach(function (i) { if (i.value.trim()) values[i.getAttribute('data-secret')] = i.value.trim(); });
        var sbAgain = q('igmSbAgain');
        var useSb = !supabaseOk || !!(sbAgain && sbAgain.checked); // 미등록이면 자동으로 함께 등록
        if (!Object.keys(values).length && !useSb) { setMsg('igmSaveMsg', '저장할 값을 입력해 주세요.', false); return; }
        guarded(btn, '연결 확인 중…', async function () {
          try {
            var d = await call({ action: 'saveConnection', values: values, useServerSupabase: useSb });
            var lines = ['저장됨: ' + d.saved.join(', ')];
            if (d.checks && d.checks.instagram) lines.push('인스타그램 연결 확인: @' + (d.checks.instagram.username || '?') + ' (게시물 ' + (d.checks.instagram.mediaCount == null ? '?' : d.checks.instagram.mediaCount) + '개)');
            if (d.checks && d.checks.anthropic) lines.push('Claude API 키 확인됨');
            if (d.checks && d.checks.supabase) lines.push('Supabase 저장소(instagram-media) 확인됨');
            await load();
            setMsg('igmSaveMsg', lines.join('\n'), true);
          } catch (e) { setMsg('igmSaveMsg', e.message, false); }
        });
      };

      function run(id, label, payload, confirmText) {
        q(id).onclick = function () {
          if (confirmText && !window.confirm(confirmText)) return;
          guarded(this, '요청 중…', async function () {
            try {
              await call(Object.assign({ action: 'run' }, payload()));
              setMsg('igmRunMsg', label + ' 실행을 요청했습니다. 몇 분 뒤 새로고침하면 진행 상태가 보입니다.', true);
              setTimeout(load, 8000);
            } catch (e) { setMsg('igmRunMsg', e.message, false); }
          });
        };
      }
      run('igmPlan', '기획·영상 제작', function () { return { workflow: 'weekly', mode: 'plan', force: q('igmForce').checked }; },
        '이번 주 릴스를 기획하고 영상을 만듭니다(약 10~20분, Claude API 사용). 게시는 승인 후에만 이루어집니다. 계속할까요?');
      run('igmDry', '샘플 영상 시험', function () { return { workflow: 'weekly', mode: 'dry-run' }; });
      run('igmPub', '게시 확인', function () { return { workflow: 'publish' }; },
        '승인되었고 예정 시각이 지난 릴스를 지금 게시합니다. 계속할까요?');

      body.querySelectorAll('.igm-approve').forEach(function (b) {
        b.onclick = function () {
          var week = b.getAttribute('data-week');
          if (!window.confirm(week + ' 초안을 승인합니다. 예정 시각이 되면 @stelvioai 에 자동으로 게시됩니다. 계속할까요?')) return;
          guarded(b, '승인 중…', async function () {
            try { await call({ action: 'approve', week: week }); await load(); } catch (e) { setMsg('igmRunMsg', e.message, false); }
          });
        };
      });
    }

    async function load() {
      try { render(await call({ action: 'status' })); }
      catch (e) { body.innerHTML = '<p style="text-align:center;color:#dc2626;font-size:13px;padding:30px 8px;">불러오지 못했습니다: ' + esc(e.message) + '</p>'; }
    }
    load();
  }

  window.openInstagramAgentModal = openInstagramAgentModal;
})();
