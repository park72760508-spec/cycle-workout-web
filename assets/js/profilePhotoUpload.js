/**
 * 프로필 사진: Cropper.js(CDN) + Firebase Storage + Firestore profileImageUrl
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

  function canvasToOptimizedBlob(canvas, quality) {
    var q = quality != null ? quality : 0.7;
    return new Promise(function (resolve) {
      if (!canvas || typeof canvas.toBlob !== 'function') {
        resolve(null);
        return;
      }
      canvas.toBlob(
        function (webpBlob) {
          if (webpBlob && webpBlob.size > 0) {
            resolve(webpBlob);
            return;
          }
          canvas.toBlob(
            function (jpegBlob) {
              resolve(jpegBlob);
            },
            'image/jpeg',
            Math.min(0.88, q + 0.12)
          );
        },
        'image/webp',
        q
      );
    });
  }

  async function uploadProfileImage(uid, blob) {
    var storageMod = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js');
    var bucketApp = window.firebaseStorageV9;
    if (!bucketApp) throw new Error('Firebase Storage가 초기화되지 않았습니다.');
    var refFn = storageMod.ref;
    var uploadBytesFn = storageMod.uploadBytes;
    var getDownloadURLFn = storageMod.getDownloadURL;
    var isWebp = blob.type && String(blob.type).indexOf('webp') >= 0;
    var ext = isWebp ? '.webp' : '.jpg';
    var ctype = isWebp ? 'image/webp' : 'image/jpeg';
    var path = 'profile_images/' + uid + '_profile' + ext;
    var r = refFn(bucketApp, path);
    await uploadBytesFn(r, blob, { contentType: ctype });
    return getDownloadURLFn(r);
  }

  window.stelvioOpenProfilePhotoPicker = function (targetUserId) {
    var uid = targetUserId != null ? String(targetUserId).trim() : '';
    if (!uid) return;
    var authUser = window.authV9 && window.authV9.currentUser;
    if (!authUser || String(authUser.uid) !== uid) {
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
    if (!uid || !cropper) return;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중...';
    }
    try {
      var canvas = cropper.getCroppedCanvas({
        width: 150,
        height: 150,
        imageSmoothingQuality: 'high',
      });
      if (!canvas || !canvas.getContext || !canvas.getContext('2d')) {
        throw new Error('이미지를 처리할 수 없습니다.');
      }
      var blob = await canvasToOptimizedBlob(canvas, 0.7);
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
      if (cardImg) cardImg.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();

      closeCropModal();
      if (typeof showToast === 'function') showToast('프로필 사진이 저장되었습니다.');
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

    destroyCropper();
    var url = URL.createObjectURL(f);
    _revokeUrl = url;
    imgEl.src = url;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');

    requestAnimationFrame(function () {
      try {
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
      saveBtn.addEventListener('click', function () {
        onSaveCrop();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindOnce);
  } else {
    bindOnce();
  }
})();
