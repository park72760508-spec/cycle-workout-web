/**
 * Google Places API (New) — Autocomplete + Place Details (Essentials 필드만).
 * sessionToken: 자동완성 세션당 1개 → 선택 후 Details 1회 → 세션 종료.
 *
 * API 키: window.STELVIO_GOOGLE_PLACES_API_KEY 우선, 없으면 Firebase web apiKey.
 * Places API + Places API (New) 가 GCP 프로젝트에서 활성화되어 있어야 함.
 */
(function (global) {
  'use strict';

  var PLACES_BASE = 'https://places.googleapis.com/v1';
  var DEBOUNCE_MS_DEFAULT = 300;
  var MIN_INPUT_LEN = 2;

  /** Autocomplete — Essentials (Pro 필드 제외) */
  var AUTOCOMPLETE_FIELD_MASK = [
    'suggestions.placePrediction.placeId',
    'suggestions.placePrediction.text',
    'suggestions.placePrediction.structuredFormat.mainText',
    'suggestions.placePrediction.structuredFormat.secondaryText',
  ].join(',');

  /** Place Details — 이름·주소·좌표만 */
  var PLACE_DETAILS_FIELD_MASK = 'id,displayName,formattedAddress,location';

  function resolveApiKey() {
    if (global.STELVIO_GOOGLE_PLACES_API_KEY && String(global.STELVIO_GOOGLE_PLACES_API_KEY).trim()) {
      return String(global.STELVIO_GOOGLE_PLACES_API_KEY).trim();
    }
    try {
      if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
        var k = firebase.apps[0].options && firebase.apps[0].options.apiKey;
        if (k && String(k).trim()) return String(k).trim();
      }
    } catch (_e) {}
    return '';
  }

  function newSessionToken() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'stelvio-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function normalizePlaceId(placeId) {
    if (!placeId) return '';
    var s = String(placeId).trim();
    if (s.indexOf('places/') === 0) return s.slice(7);
    return s;
  }

  function placeIdToResourceName(placeId) {
    var id = normalizePlaceId(placeId);
    return id ? 'places/' + encodeURIComponent(id) : '';
  }

  function parseAutocompleteSuggestions(data) {
    var out = [];
    var list = data && Array.isArray(data.suggestions) ? data.suggestions : [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var pred = s && s.placePrediction;
      if (!pred) continue;
      var placeId = pred.placeId || pred.place || '';
      var main =
        (pred.structuredFormat && pred.structuredFormat.mainText && pred.structuredFormat.mainText.text) ||
        (pred.text && pred.text.text) ||
        '';
      var secondary =
        (pred.structuredFormat && pred.structuredFormat.secondaryText && pred.structuredFormat.secondaryText.text) ||
        '';
      var label = String(main || '').trim();
      if (secondary) label = label ? label + ' · ' + String(secondary).trim() : String(secondary).trim();
      if (!label && pred.text && pred.text.text) label = String(pred.text.text).trim();
      if (!placeId && !label) continue;
      out.push({ placeId: placeId, label: label, mainText: String(main || '').trim(), secondaryText: String(secondary).trim() });
    }
    return out;
  }

  function formatPlaceForForm(place) {
    if (!place) return '';
    var name = place.displayName && place.displayName.text ? String(place.displayName.text).trim() : '';
    var addr = place.formattedAddress ? String(place.formattedAddress).trim() : '';
    if (name && addr && addr.indexOf(name) >= 0) return addr;
    if (name && addr) return name + ' (' + addr + ')';
    return name || addr || '';
  }

  /**
   * @param {string} input
   * @param {string} sessionToken
   * @param {{ signal?: AbortSignal, languageCode?: string, regionCode?: string }} [opts]
   */
  async function fetchAutocompleteSuggestions(input, sessionToken, opts) {
    opts = opts || {};
    var apiKey = resolveApiKey();
    if (!apiKey) throw new Error('Google Places API 키가 없습니다.');
    var q = String(input || '').trim();
    if (q.length < MIN_INPUT_LEN) return [];

    var body = {
      input: q,
      sessionToken: sessionToken,
      languageCode: opts.languageCode || 'ko',
      includedRegionCodes: opts.regionCode ? [String(opts.regionCode).toUpperCase()] : ['KR'],
    };

    var res = await fetch(PLACES_BASE + '/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': AUTOCOMPLETE_FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      var errText = await res.text().catch(function () { return ''; });
      throw new Error('Places Autocomplete ' + res.status + (errText ? ': ' + errText.slice(0, 200) : ''));
    }

    var data = await res.json();
    return parseAutocompleteSuggestions(data);
  }

  /**
   * @param {string} placeId
   * @param {string} sessionToken — Autocomplete와 동일 토큰(과금 세션 묶음)
   * @param {{ signal?: AbortSignal, languageCode?: string }} [opts]
   */
  async function fetchPlaceDetails(placeId, sessionToken, opts) {
    opts = opts || {};
    var apiKey = resolveApiKey();
    if (!apiKey) throw new Error('Google Places API 키가 없습니다.');
    var id = normalizePlaceId(placeId);
    if (!id) throw new Error('placeId가 없습니다.');

    var url =
      PLACES_BASE +
      '/places/' +
      encodeURIComponent(id) +
      '?languageCode=' +
      encodeURIComponent(opts.languageCode || 'ko') +
      '&sessionToken=' +
      encodeURIComponent(sessionToken);

    var res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACE_DETAILS_FIELD_MASK,
      },
      signal: opts.signal,
    });

    if (!res.ok) {
      var errText = await res.text().catch(function () { return ''; });
      throw new Error('Place Details ' + res.status + (errText ? ': ' + errText.slice(0, 200) : ''));
    }

    return res.json();
  }

  function createPlacesSession() {
    var token = newSessionToken();
    var closed = false;
    return {
      token: token,
      isClosed: function () { return closed; },
      close: function () { closed = true; },
      renew: function () {
        if (!closed) token = newSessionToken();
        return token;
      },
      getToken: function () { return token; },
    };
  }

  global.stelvioGooglePlaces = {
    DEBOUNCE_MS_DEFAULT: DEBOUNCE_MS_DEFAULT,
    MIN_INPUT_LEN: MIN_INPUT_LEN,
    AUTOCOMPLETE_FIELD_MASK: AUTOCOMPLETE_FIELD_MASK,
    PLACE_DETAILS_FIELD_MASK: PLACE_DETAILS_FIELD_MASK,
    resolveApiKey: resolveApiKey,
    isConfigured: function () { return !!resolveApiKey(); },
    newSessionToken: newSessionToken,
    createPlacesSession: createPlacesSession,
    fetchAutocompleteSuggestions: fetchAutocompleteSuggestions,
    fetchPlaceDetails: fetchPlaceDetails,
    formatPlaceForForm: formatPlaceForForm,
    normalizePlaceId: normalizePlaceId,
    placeIdToResourceName: placeIdToResourceName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
