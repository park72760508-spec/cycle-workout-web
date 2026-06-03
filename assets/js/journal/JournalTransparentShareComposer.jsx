/**
 * 투명 라이딩 오버레이 + 사용자 배경 사진 합성 (사진첩 UI)
 * 상단(제목)·하단(맵+통계) 오버레이 2장 — 각각 드래그, 크기는 동일 비율
 * @global window.JournalTransparentShareComposer
 */
/* global React, useState, useEffect, useRef, useCallback */

(function () {
  'use strict';

  if (!window.React) {
    console.warn('[JournalTransparentShareComposer] React not loaded');
    return;
  }

  var R = window.React;
  var useState = R.useState;
  var useEffect = R.useEffect;
  var useRef = R.useRef;
  var useCallback = R.useCallback;

  var DEFAULT_SCALE = 1;
  var MIN_SCALE = 0.35;
  var MAX_SCALE = 1.6;

  function loadImageFromUrl(url) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function () {
        resolve(im);
      };
      im.onerror = function () {
        reject(new Error('이미지 로드 실패'));
      };
      im.src = url;
    });
  }

  function revokeUrl(url) {
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    }
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function JournalTransparentShareComposer(props) {
    var log = props.log;
    var onClose = props.onClose;
    var shareApi = window.journalTransparentShare;
    var isAndroidUa =
      typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');

    var _loading = useState(true);
    var loading = _loading[0];
    var setLoading = _loading[1];

    var _err = useState(null);
    var err = _err[0];
    var setErr = _err[1];

    var _overlayHeaderUrl = useState(null);
    var overlayHeaderUrl = _overlayHeaderUrl[0];
    var setOverlayHeaderUrl = _overlayHeaderUrl[1];

    var _overlayBottomUrl = useState(null);
    var overlayBottomUrl = _overlayBottomUrl[0];
    var setOverlayBottomUrl = _overlayBottomUrl[1];

    var _bgUrl = useState(null);
    var bgUrl = _bgUrl[0];
    var setBgUrl = _bgUrl[1];

    var _scale = useState(DEFAULT_SCALE);
    var scale = _scale[0];
    var setScale = _scale[1];

    var _posHeader = useState({ x: 24, y: 16 });
    var posHeader = _posHeader[0];
    var setPosHeader = _posHeader[1];

    var _posBottom = useState({ x: 24, y: 280 });
    var posBottom = _posBottom[0];
    var setPosBottom = _posBottom[1];

    var _saving = useState(false);
    var saving = _saving[0];
    var setSaving = _saving[1];

    var _stageSize = useState({ w: 320, h: 480 });
    var stageSize = _stageSize[0];
    var setStageSize = _stageSize[1];

    var stageRef = useRef(null);
    var fileInputRef = useRef(null);
    var headerImgRef = useRef(null);
    var bottomImgRef = useRef(null);
    var dragRef = useRef(null);
    var autoPickDoneRef = useRef(false);

    useEffect(function () {
      var prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      if (document.documentElement) {
        document.documentElement.classList.add('journal-share-composer-open');
      }
      return function () {
        document.body.style.overflow = prev;
        if (document.documentElement) {
          document.documentElement.classList.remove('journal-share-composer-open');
        }
      };
    }, []);

    useEffect(function () {
      var cancelled = false;
      setLoading(true);
      setErr(null);
      if (!shareApi || typeof shareApi.createOverlayPngBlobs !== 'function') {
        setErr('공유 모듈을 불러올 수 없습니다.');
        setLoading(false);
        return;
      }
      shareApi
        .createOverlayPngBlobs(log, props.opts || {})
        .then(function (result) {
          if (cancelled) return;
          setOverlayHeaderUrl(URL.createObjectURL(result.headerBlob));
          setOverlayBottomUrl(URL.createObjectURL(result.bottomBlob));
          setLoading(false);
        })
        .catch(function (e) {
          if (cancelled) return;
          setErr((e && e.message) || '오버레이 생성 실패');
          setLoading(false);
        });
      return function () {
        cancelled = true;
      };
    }, [log]);

    var headerUrlRef = useRef(null);
    var bottomUrlRef = useRef(null);
    var bgUrlRef = useRef(null);
    headerUrlRef.current = overlayHeaderUrl;
    bottomUrlRef.current = overlayBottomUrl;
    bgUrlRef.current = bgUrl;

    useEffect(function () {
      return function () {
        revokeUrl(headerUrlRef.current);
        revokeUrl(bottomUrlRef.current);
        revokeUrl(bgUrlRef.current);
      };
    }, []);

    useEffect(
      function () {
        if (loading || bgUrl || autoPickDoneRef.current) return;
        var inp = fileInputRef.current;
        if (!inp) return;
        var ua = (navigator && navigator.userAgent) || '';
        var mobile = /Android|iPhone|iPad|iPod/i.test(ua);
        if (!mobile) return;
        autoPickDoneRef.current = true;
        var t = setTimeout(function () {
          try {
            inp.click();
          } catch (ePick) {}
        }, 400);
        return function () {
          clearTimeout(t);
        };
      },
      [loading, bgUrl]
    );

    useEffect(function () {
      function measure() {
        var el = stageRef.current;
        if (!el) return;
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setStageSize({ w: rect.width, h: rect.height });
        }
      }
      measure();
      window.addEventListener('resize', measure);
      var t = setTimeout(measure, 120);
      return function () {
        window.removeEventListener('resize', measure);
        clearTimeout(t);
      };
    }, [bgUrl, loading]);

    var overlayBaseW = stageSize.w * 0.88;
    var stickerW = overlayBaseW * scale;

    var headerNat = headerImgRef.current;
    var headerDispW = stickerW;
    var headerDispH =
      headerNat && headerNat.naturalWidth > 0
        ? headerDispW * (headerNat.naturalHeight / headerNat.naturalWidth)
        : headerDispW * (520 / 1080);

    var bottomNat = bottomImgRef.current;
    var bottomDispW = stickerW;
    var bottomDispH =
      bottomNat && bottomNat.naturalWidth > 0
        ? bottomDispW * (bottomNat.naturalHeight / bottomNat.naturalWidth)
        : bottomDispW * (830 / 1080);

    var placeOverlayDefault = useCallback(
      function () {
        var w = overlayBaseW * scale;
        var hH =
          headerNat && headerNat.naturalWidth > 0
            ? w * (headerNat.naturalHeight / headerNat.naturalWidth)
            : w * (520 / 1080);
        var bH =
          bottomNat && bottomNat.naturalWidth > 0
            ? w * (bottomNat.naturalHeight / bottomNat.naturalWidth)
            : w * (830 / 1080);
        var x = Math.max(8, (stageSize.w - w) * 0.04);
        setPosHeader({ x: x, y: Math.max(8, stageSize.h * 0.04) });
        setPosBottom({
          x: x,
          y: Math.max(hH + 16, stageSize.h - bH - Math.max(12, stageSize.h * 0.06)),
        });
      },
      [stageSize.w, stageSize.h, overlayBaseW, scale, headerNat, bottomNat]
    );

    function onStickerLoad(kind) {
      if (bgUrl) {
        setTimeout(placeOverlayDefault, 80);
      }
    }

    function onPickBackground(ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      if (!/^image\//i.test(file.type)) {
        setErr('이미지 파일만 선택할 수 있습니다.');
        return;
      }
      revokeUrl(bgUrl);
      var url = URL.createObjectURL(file);
      setBgUrl(url);
      setErr(null);
      ev.target.value = '';
      setTimeout(placeOverlayDefault, 120);
    }

    function onStickerPointerDown(kind, ev) {
      if (!bgUrl) return;
      ev.preventDefault();
      var el = ev.currentTarget;
      if (el.setPointerCapture) el.setPointerCapture(ev.pointerId);
      var pos = kind === 'header' ? posHeader : posBottom;
      dragRef.current = {
        kind: kind,
        pointerId: ev.pointerId,
        startX: ev.clientX,
        startY: ev.clientY,
        origX: pos.x,
        origY: pos.y,
      };
    }

    function onStickerPointerMove(ev) {
      var d = dragRef.current;
      if (!d || d.pointerId !== ev.pointerId) return;
      var dx = ev.clientX - d.startX;
      var dy = ev.clientY - d.startY;
      var nx = d.origX + dx;
      var ny = d.origY + dy;
      if (d.kind === 'header') {
        var maxX = stageSize.w - headerDispW + 20;
        var maxY = stageSize.h - headerDispH + 20;
        setPosHeader({
          x: clamp(nx, -20, maxX),
          y: clamp(ny, -20, maxY),
        });
      } else {
        var maxXB = stageSize.w - bottomDispW + 20;
        var maxYB = stageSize.h - bottomDispH + 20;
        setPosBottom({
          x: clamp(nx, -20, maxXB),
          y: clamp(ny, -20, maxYB),
        });
      }
    }

    function onStickerPointerUp(ev) {
      var d = dragRef.current;
      if (!d || d.pointerId !== ev.pointerId) return;
      dragRef.current = null;
      try {
        ev.currentTarget.releasePointerCapture(ev.pointerId);
      } catch (e2) {}
    }

    async function onSave() {
      if (!bgUrl || !overlayHeaderUrl || !overlayBottomUrl || !shareApi) return;
      setSaving(true);
      setErr(null);
      try {
        var bgImg = await loadImageFromUrl(bgUrl);
        var headerImg = await loadImageFromUrl(overlayHeaderUrl);
        var bottomImg = await loadImageFromUrl(overlayBottomUrl);
        var blob = await shareApi.compositeShareDualToBlob(bgImg, headerImg, bottomImg, {
          stageW: stageSize.w,
          stageH: stageSize.h,
          headerLeft: posHeader.x,
          headerTop: posHeader.y,
          headerW: headerDispW,
          headerH: headerDispH,
          bottomLeft: posBottom.x,
          bottomTop: posBottom.y,
          bottomW: bottomDispW,
          bottomH: bottomDispH,
        });
        var dateKey = log.date ? String(log.date).replace(/-/g, '') : 'ride';
        var fn = 'stelvio-ride-' + dateKey + '.jpg';
        var saveMethod = await shareApi.savePngBlob(blob, fn);
        shareApi.notifySaveResult(saveMethod);
        if (saveMethod !== 'download-android-fallback') {
          onClose({ saved: true, saveMethod: saveMethod });
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        var msg = (e && e.message) || '저장 실패';
        setErr(msg);
        if (typeof window.showToast === 'function') window.showToast(msg, 'error');
      } finally {
        setSaving(false);
      }
    }

    function renderSticker(url, kind, pos, dispW, dispH, imgRef) {
      if (!url || loading) return null;
      return R.createElement('img', {
        ref: imgRef,
        className:
          'journal-share-composer-overlay-img journal-share-composer-overlay-img--' + kind +
          (bgUrl ? '' : ' is-dimmed'),
        src: url,
        alt: kind === 'header' ? '상단 오버레이' : '하단 오버레이',
        draggable: false,
        style: {
          width: dispW + 'px',
          height: dispH + 'px',
          left: pos.x + 'px',
          top: pos.y + 'px',
          touchAction: 'none',
        },
        onLoad: function () {
          onStickerLoad(kind);
        },
        onPointerDown: function (ev) {
          onStickerPointerDown(kind, ev);
        },
        onPointerMove: onStickerPointerMove,
        onPointerUp: onStickerPointerUp,
        onPointerCancel: onStickerPointerUp,
      });
    }

    return R.createElement(
      'div',
      { className: 'journal-share-composer-overlay', role: 'dialog', 'aria-modal': 'true' },
      R.createElement('div', { className: 'journal-share-composer-panel' },
        R.createElement('header', { className: 'journal-share-composer-header' },
          R.createElement('h2', { className: 'journal-share-composer-title' }, '투명 이미지 사진첩'),
          R.createElement('button', {
            type: 'button',
            className: 'journal-share-composer-close',
            'aria-label': '닫기',
            onClick: function () {
              onClose({ cancelled: true });
            },
          }, '\u00D7')
        ),
        R.createElement('div', { className: 'journal-share-composer-controls journal-share-composer-controls--top' },
          R.createElement('div', { className: 'journal-share-composer-actions-row' },
            R.createElement('label', { className: 'journal-share-composer-action-btn journal-share-composer-pick-btn' },
              '배경 사진 선택',
              R.createElement('input', {
                ref: fileInputRef,
                type: 'file',
                accept: 'image/*',
                className: 'journal-share-composer-file-input',
                onChange: onPickBackground,
              })
            ),
            R.createElement('button', {
              type: 'button',
              className: 'journal-share-composer-action-btn journal-share-composer-save-btn',
              disabled: !bgUrl || loading || saving,
              onClick: onSave,
            }, saving ? '준비 중…' : isAndroidUa ? '저장·공유' : '저장')
          ),
          R.createElement('div', { className: 'journal-share-composer-scale-row' },
            R.createElement('span', { className: 'journal-share-composer-scale-label' }, '크기'),
            R.createElement('button', {
              type: 'button',
              className: 'journal-share-composer-scale-btn',
              disabled: !bgUrl || scale <= MIN_SCALE,
              onClick: function () {
                setScale(function (s) {
                  return clamp(s - 0.08, MIN_SCALE, MAX_SCALE);
                });
              },
            }, '−'),
            R.createElement('input', {
              type: 'range',
              min: String(MIN_SCALE * 100),
              max: String(MAX_SCALE * 100),
              value: Math.round(scale * 100),
              disabled: !bgUrl,
              className: 'journal-share-composer-range',
              onChange: function (e) {
                setScale(Number(e.target.value) / 100);
              },
            }),
            R.createElement('button', {
              type: 'button',
              className: 'journal-share-composer-scale-btn',
              disabled: !bgUrl || scale >= MAX_SCALE,
              onClick: function () {
                setScale(function (s) {
                  return clamp(s + 0.08, MIN_SCALE, MAX_SCALE);
                });
              },
            }, '+'),
            R.createElement('button', {
              type: 'button',
              className: 'journal-share-composer-reset-btn',
              disabled: !bgUrl,
              onClick: placeOverlayDefault,
            }, '위치 초기화')
          )
        ),
        R.createElement('p', { className: 'journal-share-composer-hint' },
          '배경 선택 후 상단·하단 오버레이를 각각 드래그해 맞추세요. 크기는 두 영역이 같이 조절됩니다.'
        ),
        loading
          ? R.createElement('div', { className: 'journal-share-composer-loading' }, '라이딩 오버레이 준비 중…')
          : null,
        err
          ? R.createElement('p', { className: 'journal-share-composer-error' }, err)
          : null,
        R.createElement(
          'div',
          { className: 'journal-share-composer-stage', ref: stageRef },
          bgUrl
            ? R.createElement('img', {
                className: 'journal-share-composer-bg',
                src: bgUrl,
                alt: '',
                draggable: false,
              })
            : R.createElement('div', { className: 'journal-share-composer-bg-placeholder' },
                '배경 사진을 선택하세요'
              ),
          renderSticker(overlayHeaderUrl, 'header', posHeader, headerDispW, headerDispH, headerImgRef),
          renderSticker(overlayBottomUrl, 'bottom', posBottom, bottomDispW, bottomDispH, bottomImgRef)
        )
      )
    );
  }

  window.JournalTransparentShareComposer = JournalTransparentShareComposer;
})();
