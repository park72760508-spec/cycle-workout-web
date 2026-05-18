/**
 * 출발 장소 — Places API (New) 자동완성 (debounce 300ms+, sessionToken, Essentials 필드만).
 * API 미설정 시 일반 텍스트 입력으로 폴백.
 */
/* global React, stelvioGooglePlaces */
var useState = React.useState;
var useEffect = React.useEffect;
var useRef = React.useRef;

function DepartureLocationPlaceInput(props) {
  var value = props.value != null ? String(props.value) : '';
  var onChange = props.onChange || function () {};
  var disabled = !!props.disabled;
  var debounceMs =
    props.debounceMs != null && Number.isFinite(Number(props.debounceMs))
      ? Math.max(300, Math.floor(Number(props.debounceMs)))
      : (window.stelvioGooglePlaces && window.stelvioGooglePlaces.DEBOUNCE_MS_DEFAULT) || 300;

  var placesEnabled =
    !disabled && window.stelvioGooglePlaces && typeof window.stelvioGooglePlaces.isConfigured === 'function'
      ? window.stelvioGooglePlaces.isConfigured()
      : false;

  var inputRef = useRef(null);
  var sessionRef = useRef(null);
  var debounceTimerRef = useRef(null);
  var fetchGenRef = useRef(0);
  var abortRef = useRef(null);
  var mountedRef = useRef(true);
  var skipNextFetchRef = useRef(false);
  var lastSelectedLabelRef = useRef('');

  var stSuggest = useState([]);
  var suggestions = stSuggest[0];
  var setSuggestions = stSuggest[1];
  var stOpen = useState(false);
  var listOpen = stOpen[0];
  var setListOpen = stOpen[1];
  var stLoading = useState(false);
  var loading = stLoading[0];
  var setLoading = stLoading[1];

  function ensureSession() {
    if (!sessionRef.current || sessionRef.current.isClosed()) {
      sessionRef.current = window.stelvioGooglePlaces.createPlacesSession();
    }
    return sessionRef.current;
  }

  function clearDebounce() {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }

  function abortInflight() {
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch (_e) {}
      abortRef.current = null;
    }
  }

  function closeSession() {
    if (sessionRef.current && !sessionRef.current.isClosed()) {
      sessionRef.current.close();
    }
  }

  useEffect(function () {
    mountedRef.current = true;
    return function () {
      mountedRef.current = false;
      clearDebounce();
      abortInflight();
      closeSession();
    };
  }, []);

  /** 수정 폼 hydrate 등 외부 reset 시에만 세션·요청 초기화 (value 타이핑마다 실행하면 debounce가 깨짐) */
  var resetKey = props.resetKey != null ? String(props.resetKey) : 'default';
  useEffect(
    function () {
      if (!placesEnabled) return;
      skipNextFetchRef.current = true;
      lastSelectedLabelRef.current = value;
      setSuggestions([]);
      setListOpen(false);
      setLoading(false);
      clearDebounce();
      abortInflight();
      closeSession();
    },
    [resetKey, placesEnabled]
  );

  function scheduleAutocomplete(query) {
    if (!placesEnabled) return;
    clearDebounce();
    abortInflight();

    var q = String(query || '').trim();
    if (q.length < (window.stelvioGooglePlaces.MIN_INPUT_LEN || 2)) {
      setSuggestions([]);
      setListOpen(false);
      setLoading(false);
      return;
    }

    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    if (lastSelectedLabelRef.current && q === lastSelectedLabelRef.current) {
      return;
    }

    debounceTimerRef.current = setTimeout(function () {
      debounceTimerRef.current = null;
      if (!mountedRef.current) return;

      var gen = ++fetchGenRef.current;
      var session = ensureSession();
      var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      abortRef.current = ac;

      setLoading(true);
      window.stelvioGooglePlaces
        .fetchAutocompleteSuggestions(q, session.getToken(), { signal: ac && ac.signal })
        .then(function (rows) {
          if (!mountedRef.current || gen !== fetchGenRef.current) return;
          setSuggestions(rows || []);
          setListOpen((rows || []).length > 0);
          setLoading(false);
        })
        .catch(function (err) {
          if (!mountedRef.current || gen !== fetchGenRef.current) return;
          if (err && err.name === 'AbortError') return;
          setSuggestions([]);
          setListOpen(false);
          setLoading(false);
        })
        .finally(function () {
          if (abortRef.current === ac) abortRef.current = null;
        });
    }, debounceMs);
  }

  function handleInputChange(e) {
    var next = e && e.target ? e.target.value : '';
    onChange(next);
    if (!placesEnabled) return;
    scheduleAutocomplete(next);
  }

  function handleFocus() {
    if (!placesEnabled) return;
    ensureSession();
    var q = String(value || '').trim();
    if (q.length >= (window.stelvioGooglePlaces.MIN_INPUT_LEN || 2) && suggestions.length) {
      setListOpen(true);
    }
  }

  function handleBlur() {
    setTimeout(function () {
      if (!mountedRef.current) return;
      setListOpen(false);
    }, 180);
  }

  async function handlePick(item) {
    if (!item || !placesEnabled) return;
    clearDebounce();
    abortInflight();
    setListOpen(false);
    setSuggestions([]);
    setLoading(true);

    var session = ensureSession();
    var token = session.getToken();
    var gen = ++fetchGenRef.current;
    var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortRef.current = ac;

    try {
      var place = await window.stelvioGooglePlaces.fetchPlaceDetails(item.placeId, token, {
        signal: ac && ac.signal,
      });
      if (!mountedRef.current || gen !== fetchGenRef.current) return;
      var formatted = window.stelvioGooglePlaces.formatPlaceForForm(place) || item.label || '';
      skipNextFetchRef.current = true;
      lastSelectedLabelRef.current = formatted;
      onChange(formatted);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      var fallback = item.label || '';
      skipNextFetchRef.current = true;
      lastSelectedLabelRef.current = fallback;
      onChange(fallback);
    } finally {
      if (mountedRef.current) setLoading(false);
      session.close();
      if (abortRef.current === ac) abortRef.current = null;
    }
  }

  if (!placesEnabled) {
    return (
      <label className="block font-medium text-slate-700">
        출발 장소
        <input
          className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
          value={value}
          disabled={disabled}
          onChange={function (e) { onChange(e.target.value); }}
        />
      </label>
    );
  }

  return (
    <label className="block font-medium text-slate-700 relative">
      출발 장소
      <input
        ref={inputRef}
        type="text"
        className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
        value={value}
        disabled={disabled}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {loading ? (
        <span className="absolute right-2 top-9 text-[10px] text-slate-400" aria-hidden="true">
          검색…
        </span>
      ) : null}
      {listOpen && suggestions.length ? (
        <ul
          className="absolute z-30 left-0 right-0 mt-0.5 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg text-sm"
          role="listbox"
        >
          {suggestions.map(function (s, idx) {
            return (
              <li key={(s.placeId || s.label || '') + '-' + idx} role="option">
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-800 border-0 bg-transparent"
                  onMouseDown={function (e) {
                    e.preventDefault();
                    handlePick(s);
                  }}
                >
                  {s.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </label>
  );
}

if (typeof window !== 'undefined') {
  window.DepartureLocationPlaceInput = DepartureLocationPlaceInput;
}
