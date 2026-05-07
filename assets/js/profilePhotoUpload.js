/**
 * 프로필 사진: Cropper.js(CDN) + Firebase Storage + Firestore profileImageUrl
 * 내보내기: 랭킹 확대 팝업(.stelvio-rank-avatar-zoom-img, max 320px) × devicePixelRatio에 맞춘 변 + 512KiB 규칙 내 WebP 우선 인코딩
 * Cropper 설치 대안: npm install cropperjs
 */
(function () {
  'use strict';

  window.STELVIO_DEFAULT_PROFILE_IMAGE_URL =
    window.STELVIO_DEFAULT_PROFILE_IMAGE_URL || 'assets/img/profile-placeholder.svg';

  var _revokeUrl = null;

  function el(id) {
    return document.getElementById(id);
  }

  function destroyCropper() {
    var imgEl = el('stelvioProfileCropImg');
    window.__stelvioProfileCropReady = false;
    if (window.__stelvioProfileCropper) {
      try {
        window.__stelvioProfileCropper.destroy();
      } catch (e) {}
      window.__stelvioProfileCropper = null;
    }
    if (_revokeUrl) {
      try {
        URL.revokeObjectURL(_revokeUrl);
      } catch (e2) {}
      _revokeUrl = null;
    }
    try {
      if (window.__stelvioCropReadyFallbackTimer) {
        clearTimeout(window.__stelvioCropReadyFallbackTimer);
        window.__stelvioCropReadyFallbackTimer = null;
      }
    } catch (eT) {}
    if (imgEl) imgEl.removeAttribute('src');
  }

  function closeCropModal() {
    var modal = el('stelvioProfileCropModal');
    destroyCropper();
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
    window.__stelvioProfileCropTargetUid = null;
  }

  window.stelvioCloseProfileCropModal = closeCropModal;

  function dataUrlToBlob(dataUrl) {
    try {
      var arr = String(dataUrl).split(',');
      if (arr.length < 2) return null;
      var mime = arr[0].match(/:(.*?);/);
      mime = mime && mime[1] ? mime[1] : 'image/jpeg';
      var bstr = atob(arr[1]);
      var n = bstr.length;
      var u8 = new Uint8Array(n);
      for (var i = 0; i < n; i++) u8[i] = bstr.charCodeAt(i);
      return new Blob([u8], { type: mime });
    } catch (e) {
      return null;
    }
  }

  function canvasToOptimizedBlob(canvas, quality) {
    var q = quality != null ? quality : 0.7;
    return new Promise(function (resolve) {
      if (!canvas) {
        resolve(null);
        return;
      }
      function fromDataUrlWebpJpeg() {
        try {
          var webpDu = canvas.toDataURL('image/webp', q);
          if (webpDu && webpDu.indexOf('image/webp') > 0) {
            var b = dataUrlToBlob(webpDu);
            if (b && b.size > 0) {
              resolve(b);
              return;
            }
          }
        } catch (e1) {}
        try {
          var jq = Math.min(0.88, q + 0.12);
          var jpegDu = canvas.toDataURL('image/jpeg', jq);
          var b2 = dataUrlToBlob(jpegDu);
          resolve(b2 && b2.size > 0 ? b2 : null);
        } catch (e2) {
          resolve(null);
        }
      }
      if (typeof canvas.toBlob !== 'function') {
        fromDataUrlWebpJpeg();
        return;
      }
      canvas.toBlob(function (webpBlob) {
        if (webpBlob && webpBlob.size > 0) {
          resolve(webpBlob);
          return;
        }
        canvas.toBlob(
          function (jpegBlob) {
            if (jpegBlob && jpegBlob.size > 0) {
              resolve(jpegBlob);
              return;
            }
            fromDataUrlWebpJpeg();
          },
          'image/jpeg',
          Math.min(0.88, q + 0.12)
        );
      }, 'image/webp', q);
    });
  }

  /** style.css `.stelvio-rank-avatar-zoom-img` max-width(px) 과 동일 — 해상도 맞춤 기준 */
  var PROFILE_RANK_ZOOM_CSS_MAX_PX = 320;
  /** Retina 등 DPR 고려 변 상한·하한 — 업로드·디코딩 부담 완화 */
  var PROFILE_EXPORT_MAX_SIDE = 768;
  var PROFILE_EXPORT_MIN_SIDE = 512;
  /** docs/storage.rules 프로필 write `request.resource.size < 512 * 1024` 여유 */
  var PROFILE_UPLOAD_MAX_BYTES = 500 * 1024;

  function resolveProfileExportPx() {
    var dpr =
      typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1;
    var cappedDpr = Math.min(3, Math.max(1, dpr));
    var need = Math.ceil(PROFILE_RANK_ZOOM_CSS_MAX_PX * cappedDpr);
    if (need < PROFILE_EXPORT_MIN_SIDE) need = PROFILE_EXPORT_MIN_SIDE;
    if (need > PROFILE_EXPORT_MAX_SIDE) need = PROFILE_EXPORT_MAX_SIDE;
    return need;
  }

  function shrinkCanvasToMaxSide(src, maxSide) {
    if (!src || !src.width || !src.height || !maxSide) return src;
    var w = src.width;
    var h = src.height;
    var m = Math.max(w, h);
    if (m <= maxSide) return src;
    var scale = maxSide / m;
    var nw = Math.max(2, Math.round(w * scale));
    var nh = Math.max(2, Math.round(h * scale));
    var c =
      typeof document !== 'undefined' && document.createElement
        ? document.createElement('canvas')
        : null;
    if (!c) return src;
    c.width = nw;
    c.height = nh;
    var ctx = c.getContext('2d');
    if (!ctx) return src;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, nw, nh);
    return c;
  }

  /** Storage 용량 제한 준수: 품질 순차 조정 후 필요 시에만 추가 다운스케일(랭킹 썸네일·목록 표시에는 동일 URL 사용 — 브라우저 다운스케일) */
  async function encodeProfileAvatarBlobForUpload(sourceCanvas) {
    var MAX_BYTES = PROFILE_UPLOAD_MAX_BYTES;
    var qualities = [0.8, 0.72, 0.65, 0.58, 0.52, 0.46];
    var cur = sourceCanvas;
    var round;
    for (round = 0; round < 6; round++) {
      var qi;
      for (qi = 0; qi < qualities.length; qi++) {
        var blobTry = await canvasToOptimizedBlob(cur, qualities[qi]);
        if (blobTry && blobTry.size >= 16 && blobTry.size <= MAX_BYTES) return blobTry;
      }
      var maxSide = Math.max(cur.width, cur.height);
      if (maxSide <= PROFILE_EXPORT_MIN_SIDE) break;
      var nextSide = Math.max(PROFILE_EXPORT_MIN_SIDE, Math.floor(maxSide * 0.86));
      var smaller = shrinkCanvasToMaxSide(cur, nextSide);
      if (!smaller || smaller === cur) break;
      cur = smaller;
    }
    var last = await canvasToOptimizedBlob(cur, 0.42);
    if (!last || last.size < 16) throw new Error('이미지 압축에 실패했습니다.');
    if (last.size > MAX_BYTES)
      throw new Error('파일이 너무 큽니다(512KB 이하 필요). 다른 사진을 선택하거나 잘라 주세요.');
    return last;
  }

  async function uploadProfileImage(uid, blob) {
    var isWebp = blob.type && String(blob.type).indexOf('webp') >= 0;
    var ext = isWebp ? '.webp' : '.jpg';
    var ctype = isWebp ? 'image/webp' : 'image/jpeg';
    var path = 'profile_images/' + uid + '_profile' + ext;
    var uidStr = String(uid);

    /* 기본 앱(compat) 로그인 세션으로 업로드 — 모듈러 Storage(authV9 전용)에 토큰이 없을 때 403 방지 */
    try {
      if (
        typeof firebase !== 'undefined' &&
        firebase.storage &&
        window.auth &&
        window.auth.currentUser &&
        String(window.auth.currentUser.uid) === uidStr
      ) {
        if (typeof window.auth.currentUser.getIdToken === 'function') {
          await window.auth.currentUser.getIdToken(true);
        }
        var storageRef = firebase.storage().ref(path);
        var uploadTask = storageRef.put(blob, { contentType: ctype });
        await new Promise(function (resolve, reject) {
          uploadTask.on(
            'state_changed',
            function () {},
            function (err) {
              reject(err);
            },
            function () {
              resolve();
            }
          );
        });
        return await uploadTask.snapshot.ref.getDownloadURL();
      }
    } catch (compatErr) {
      console.warn('[ProfilePhoto] compat Storage 업로드 실패, authV9 모듈러로 재시도:', compatErr);
    }

    var storageMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js');
    var bucketApp = window.firebaseStorageV9;
    if (!bucketApp) throw new Error('Firebase Storage가 초기화되지 않았습니다.');
    var refFn = storageMod.ref;
    var uploadBytesFn = storageMod.uploadBytes;
    var getDownloadURLFn = storageMod.getDownloadURL;
    if (
      window.authV9 &&
      window.authV9.currentUser &&
      String(window.authV9.currentUser.uid) === uidStr &&
      typeof window.authV9.currentUser.getIdToken === 'function'
    ) {
      await window.authV9.currentUser.getIdToken(true);
    }
    var r = refFn(bucketApp, path);
    await uploadBytesFn(r, blob, { contentType: ctype });
    return getDownloadURLFn(r);
  }

  window.stelvioOpenProfilePhotoPicker = function (targetUserId) {
    var uid = targetUserId != null ? String(targetUserId).trim() : '';
    if (!uid) return;
    var authUid = null;
    if (window.authV9 && window.authV9.currentUser)
      authUid = String(window.authV9.currentUser.uid);
    else if (window.auth && window.auth.currentUser)
      authUid = String(window.auth.currentUser.uid);
    if (!authUid || authUid !== uid) {
      if (typeof showToast === 'function') showToast('본인 계정만 프로필 사진을 변경할 수 있습니다.', 'warning');
      return;
    }
    window.__stelvioProfileCropTargetUid = uid;
    var input = el('stelvioProfileAvatarHiddenFile');
    if (!input) return;
    input.value = '';
    input.click();
  };

  async function onSaveCrop() {
    var uid = window.__stelvioProfileCropTargetUid;
    var cropper = window.__stelvioProfileCropper;
    var saveBtn = el('stelvioProfileCropSave');
    if (!uid) {
      if (typeof showToast === 'function') showToast('로그인 상태를 확인할 수 없습니다.', 'warning');
      return;
    }
    if (!cropper) {
      if (typeof showToast === 'function') showToast('이미지를 불러오는 중입니다. 잠시 후 다시 눌러 주세요.', 'warning');
      return;
    }
    if (!window.__stelvioProfileCropReady) {
      if (typeof showToast === 'function') showToast('이미지가 준비될 때까지 잠시만 기다려 주세요.', 'warning');
      return;
    }
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중...';
    }
    try {
      var exportPx = resolveProfileExportPx();
      var canvas = cropper.getCroppedCanvas({
        width: exportPx,
        height: exportPx,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        fillColor: '#ffffff',
      });
      if (!canvas || !canvas.width || !canvas.height) {
        canvas = cropper.getCroppedCanvas({
          maxWidth: exportPx,
          maxHeight: exportPx,
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
          fillColor: '#ffffff',
        });
      }
      if (!canvas || !canvas.width || !canvas.height || typeof canvas.getContext !== 'function' || !canvas.getContext('2d')) {
        throw new Error('이미지를 처리할 수 없습니다.');
      }
      var blob = await encodeProfileAvatarBlobForUpload(canvas);
      if (!blob || blob.size < 16) throw new Error('압축 결과가 비어 있습니다.');
      var url = await uploadProfileImage(uid, blob);
      var apiFn = typeof window.apiUpdateUser === 'function' ? window.apiUpdateUser : null;
      if (!apiFn) throw new Error('apiUpdateUser를 사용할 수 없습니다.');
      var upd = await apiFn(uid, { profileImageUrl: url });
      if (!upd || !upd.success) throw new Error((upd && upd.error) || 'Firestore 업데이트 실패');

      if (window.currentUser && String(window.currentUser.id) === uid) {
        window.currentUser.profileImageUrl = url;
        try {
          localStorage.setItem('currentUser', JSON.stringify(window.currentUser));
        } catch (eLs) {}
      }
      var cardImg = document.querySelector('[data-stelvio-profile-img="' + uid + '"]');
      var bust = (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
      if (cardImg) cardImg.src = url + bust;

      closeCropModal();
      if (typeof showToast === 'function') showToast('프로필 사진이 저장되었습니다.');

      if (typeof loadUsers === 'function') {
        try {
          await loadUsers();
        } catch (eLu) {
          console.warn('[ProfilePhoto] loadUsers 새로고침:', eLu);
        }
      }
      if (typeof fetchStelvioPeakPowerRanking === 'function') {
        var rankScreen = document.getElementById('stelvioRankingScreen');
        if (rankScreen && rankScreen.classList.contains('active')) {
          try {
            fetchStelvioPeakPowerRanking();
          } catch (eRk) {
            console.warn('[ProfilePhoto] 랭킹보드 새로고침:', eRk);
          }
        }
      }
    } catch (err) {
      console.warn('[ProfilePhoto]', err);
      var msg = err && err.message ? String(err.message) : '저장에 실패했습니다.';
      if (typeof showToast === 'function') showToast(msg, 'error');
      else alert(msg);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '저장';
      }
    }
  }

  function handleFileChosen(ev) {
    var f = ev.target && ev.target.files && ev.target.files[0];
    if (!f) return;
    var modal = el('stelvioProfileCropModal');
    var imgEl = el('stelvioProfileCropImg');
    var uid = window.__stelvioProfileCropTargetUid;
    if (typeof window.Cropper === 'undefined') {
      if (typeof showToast === 'function')
        showToast('이미지 편집 도구 로드 실패. 새로고침 후 다시 시도해 주세요.', 'error');
      return;
    }
    if (!modal || !imgEl || !uid) return;

    var saveBtnInit = el('stelvioProfileCropSave');
    if (saveBtnInit) {
      saveBtnInit.disabled = true;
      saveBtnInit.textContent = '저장';
    }
    destroyCropper();
    var url = URL.createObjectURL(f);
    _revokeUrl = url;
    imgEl.src = url;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');

    requestAnimationFrame(function () {
      try {
        try {
          if (window.__stelvioCropReadyFallbackTimer) clearTimeout(window.__stelvioCropReadyFallbackTimer);
        } catch (e0) {}
        window.__stelvioCropReadyFallbackTimer = setTimeout(function () {
          window.__stelvioCropReadyFallbackTimer = null;
          if (
            window.__stelvioProfileCropper &&
            el('stelvioProfileCropModal') &&
            !el('stelvioProfileCropModal').classList.contains('hidden')
          ) {
            window.__stelvioProfileCropReady = true;
            var sbF = el('stelvioProfileCropSave');
            if (sbF) sbF.disabled = false;
          }
        }, 3200);

        window.__stelvioProfileCropper = new window.Cropper(imgEl, {
          aspectRatio: 1,
          viewMode: 1,
          dragMode: 'move',
          autoCropArea: 1,
          responsive: true,
          background: false,
          movable: true,
          zoomable: true,
          zoomOnTouch: true,
          zoomOnWheel: true,
          ready: function () {
            try {
              if (window.__stelvioCropReadyFallbackTimer) {
                clearTimeout(window.__stelvioCropReadyFallbackTimer);
                window.__stelvioCropReadyFallbackTimer = null;
              }
            } catch (eClr) {}
            window.__stelvioProfileCropReady = true;
            var sb = el('stelvioProfileCropSave');
            if (
              sb &&
              el('stelvioProfileCropModal') &&
              !el('stelvioProfileCropModal').classList.contains('hidden')
            ) {
              sb.disabled = false;
            }
          },
        });
      } catch (eC) {
        console.warn('[ProfilePhoto] Cropper init', eC);
        if (typeof showToast === 'function') showToast('편집기를 열 수 없습니다.', 'error');
        closeCropModal();
      }
    });
  }

  function bindOnce() {
    var fin = el('stelvioProfileAvatarHiddenFile');
    if (fin && !fin.dataset.bound) {
      fin.dataset.bound = '1';
      fin.addEventListener('change', handleFileChosen);
    }
    var cancelBtn = el('stelvioProfileCropCancel');
    var saveBtn = el('stelvioProfileCropSave');
    var backdrop = document.querySelector('#stelvioProfileCropModal .stelvio-profile-crop-modal__backdrop');
    if (cancelBtn && !cancelBtn.dataset.bound) {
      cancelBtn.dataset.bound = '1';
      cancelBtn.addEventListener('click', closeCropModal);
    }
    if (backdrop && !backdrop.dataset.bound) {
      backdrop.dataset.bound = '1';
      backdrop.addEventListener('click', closeCropModal);
    }
    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.dataset.bound = '1';
      saveBtn.addEventListener(
        'click',
        function (ev) {
          if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
          if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
          onSaveCrop();
        },
        true
      );
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindOnce);
  } else {
    bindOnce();
  }
})();
