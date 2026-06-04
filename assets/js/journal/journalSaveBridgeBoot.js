/**
 * Stelvio 앱 → Chrome 저장 화면 (?journalSave=1 또는 journal-save-bridge.html)
 * index.html SPA rewrite 시에도 동작
 */
(function (global) {
  'use strict';

  function parseBridgeParams() {
    var params = new URLSearchParams(global.location.search || '');
    if (params.get('journalSave') === '1' && params.get('url')) {
      return {
        imgUrl: params.get('url') || '',
        fileName: params.get('name') || 'stelvio-ride.jpg',
      };
    }
    if (/journal-save-bridge\.html$/i.test(global.location.pathname || '')) {
      return {
        imgUrl: params.get('url') || '',
        fileName: params.get('name') || 'stelvio-ride.jpg',
      };
    }
    return null;
  }

  var bridgeParams = parseBridgeParams();
  if (!bridgeParams || !bridgeParams.imgUrl) return;

  global.__JOURNAL_SAVE_BRIDGE_MODE__ = true;

  function safeFileName(name) {
    var fileName = String(name || 'stelvio-ride.jpg');
    if (!/\.(jpg|jpeg|png)$/i.test(fileName)) fileName += '.jpg';
    return fileName;
  }

  function injectStyles() {
    if (global.document.getElementById('journalSaveBridgeStyles')) return;
    var style = global.document.createElement('style');
    style.id = 'journalSaveBridgeStyles';
    style.textContent =
      'html.journal-save-bridge-mode,html.journal-save-bridge-mode body{height:100%;margin:0;overflow:hidden;background:#0f172a!important}' +
      'html.journal-save-bridge-mode body>*:not(#journalSaveBridgeRoot){display:none!important}' +
      '#journalSaveBridgeRoot{position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;' +
      'font-family:Pretendard,"Noto Sans KR",sans-serif;color:#f8fafc;padding:env(safe-area-inset-top,12px) 16px env(safe-area-inset-bottom,16px);' +
      'background:#0f172a;box-sizing:border-box}' +
      '#journalSaveBridgeRoot *{box-sizing:border-box}' +
      '#journalSaveBridgeRoot h1{font-size:1.05rem;font-weight:700;margin:0 0 8px;text-align:center;color:#e9d5ff}' +
      '#journalSaveBridgeRoot .jsb-hint{font-size:13px;line-height:1.55;color:#94a3b8;text-align:center;margin:0 0 12px}' +
      '#journalSaveBridgeRoot .jsb-preview-wrap{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;margin-bottom:12px}' +
      '#journalSaveBridgeRoot .jsb-preview{max-width:100%;max-height:calc(100dvh - 260px);object-fit:contain;border-radius:10px;background:#1e293b}' +
      '#journalSaveBridgeRoot .jsb-btn{width:100%;padding:15px 16px;font-size:16px;font-weight:700;border:none;border-radius:10px;cursor:pointer;margin-bottom:10px}' +
      '#journalSaveBridgeRoot .jsb-btn-primary{color:#fff;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);box-shadow:0 4px 14px rgba(102,126,234,.35)}' +
      '#journalSaveBridgeRoot .jsb-btn-secondary{color:#e2e8f0;background:rgba(51,65,85,.95);border:1px solid #64748b}' +
      '#journalSaveBridgeRoot .jsb-btn:disabled{opacity:.55}' +
      '#journalSaveBridgeRoot .jsb-status{font-size:13px;text-align:center;margin:8px 0;line-height:1.5}' +
      '#journalSaveBridgeRoot .jsb-status.err{color:#fca5a5}' +
      '#journalSaveBridgeRoot .jsb-status.ok{color:#86efac}';
    global.document.head.appendChild(style);
    global.document.documentElement.classList.add('journal-save-bridge-mode');
  }

  function blobFromImageUrl(url) {
    return fetch(url, { mode: 'cors', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('fetch failed');
        return r.blob();
      })
      .catch(function () {
        return new Promise(function (resolve, reject) {
          var im = new Image();
          im.crossOrigin = 'anonymous';
          im.onload = function () {
            try {
              var c = global.document.createElement('canvas');
              c.width = im.naturalWidth;
              c.height = im.naturalHeight;
              c.getContext('2d').drawImage(im, 0, 0);
              c.toBlob(
                function (b) {
                  if (b) resolve(b);
                  else reject(new Error('canvas blob failed'));
                },
                'image/jpeg',
                0.92
              );
            } catch (e) {
              reject(e);
            }
          };
          im.onerror = reject;
          im.src = url;
        });
      });
  }

  function fileFromBlob(blob, fileName) {
    var mime = blob.type || 'image/jpeg';
    if (mime.indexOf('jpeg') < 0 && mime.indexOf('jpg') < 0) mime = 'image/jpeg';
    return new File([blob], fileName, { type: mime });
  }

  function triggerDownload(blob, fileName) {
    var a = global.document.createElement('a');
    var u = URL.createObjectURL(blob);
    a.href = u;
    a.download = fileName;
    global.document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(u);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 3000);
  }

  function mountBridgeUi() {
    injectStyles();
    var fileName = safeFileName(bridgeParams.fileName);
    var imgUrl = bridgeParams.imgUrl;

    var root = global.document.createElement('div');
    root.id = 'journalSaveBridgeRoot';
    root.innerHTML =
      '<h1>라이딩 이미지 저장</h1>' +
      '<p class="jsb-hint">① 「Google 포토·갤러리로 저장」을 누르고<br><strong>Google 포토</strong> 또는 <strong>갤러리</strong>를 선택하세요.<br>' +
      '② 목록에 없으면 「파일로 다운로드」 후 갤러리·다운로드 폴더에서 확인하세요.</p>' +
      '<div class="jsb-preview-wrap"><img class="jsb-preview" id="jsbPreview" alt="저장할 라이딩 이미지" /></div>' +
      '<p class="jsb-status err" id="jsbStatus" hidden></p>' +
      '<button type="button" class="jsb-btn jsb-btn-primary" id="jsbBtnShare" disabled>Google 포토·갤러리로 저장</button>' +
      '<button type="button" class="jsb-btn jsb-btn-secondary" id="jsbBtnDownload" disabled>파일로 다운로드</button>';

    global.document.body.appendChild(root);

    var preview = global.document.getElementById('jsbPreview');
    var btnShare = global.document.getElementById('jsbBtnShare');
    var btnDownload = global.document.getElementById('jsbBtnDownload');
    var statusEl = global.document.getElementById('jsbStatus');

    function setStatus(msg, ok) {
      if (!statusEl) return;
      if (!msg) {
        statusEl.hidden = true;
        return;
      }
      statusEl.hidden = false;
      statusEl.textContent = msg;
      statusEl.className = 'jsb-status ' + (ok ? 'ok' : 'err');
    }

    preview.src = imgUrl;
    preview.onload = function () {
      btnShare.disabled = false;
      btnDownload.disabled = false;
    };
    preview.onerror = function () {
      setStatus('이미지를 불러오지 못했습니다. STELVIO 앱에서 다시 시도해 주세요.', false);
    };

    btnShare.addEventListener('click', function () {
      btnShare.disabled = true;
      setStatus('준비 중…', false);
      blobFromImageUrl(imgUrl)
        .then(function (blob) {
          var file = fileFromBlob(blob, fileName);
          if (
            global.navigator &&
            global.navigator.share &&
            global.navigator.canShare &&
            global.navigator.canShare({ files: [file] })
          ) {
            return global.navigator
              .share({
                files: [file],
                title: 'STELVIO Ride',
                text: 'STELVIO 라이딩 기록 이미지',
              })
              .then(function () {
                setStatus(
                  '공유가 완료되었습니다. Google 포토·갤러리 앱에서 저장·업로드를 확인하세요.',
                  true
                );
              });
          }
          triggerDownload(blob, fileName);
          setStatus(
            '다운로드가 시작되었습니다. 알림창·다운로드 폴더 또는 갤러리에서 확인하세요.',
            true
          );
        })
        .catch(function (e) {
          setStatus(
            e && e.name === 'AbortError'
              ? '취소되었습니다.'
              : '저장에 실패했습니다. 「파일로 다운로드」를 이용해 주세요.',
            false
          );
        })
        .finally(function () {
          btnShare.disabled = false;
        });
    });

    btnDownload.addEventListener('click', function () {
      btnDownload.disabled = true;
      blobFromImageUrl(imgUrl)
        .then(function (blob) {
          triggerDownload(blob, fileName);
          setStatus(
            '다운로드가 시작되었습니다. Chrome 알림 또는 「내 파일 → 다운로드」에서 확인하세요.',
            true
          );
        })
        .catch(function () {
          setStatus('다운로드에 실패했습니다.', false);
        })
        .finally(function () {
          btnDownload.disabled = false;
        });
    });
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', mountBridgeUi);
  } else {
    mountBridgeUi();
  }
})(typeof window !== 'undefined' ? window : globalThis);
