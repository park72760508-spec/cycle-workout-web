/**
 * RiderDashboardProfile - 라이더 파워 프로필 레이더 차트 + AI 코치 코멘트
 * 대시보드 내 Training Trend 위에 배치
 * @see useRiderAnalysis.js - 점수 계산 및 AI API 호출
 * @see index.html - 인라인 구현 (이 파일은 참조용, 실제 사용은 index.html)
 */

/* global React, useState, useEffect, window */

if (!window.React) { console.warn('React not loaded'); }
var ReactObj = window.React || {};
var useState = ReactObj.useState || null;
var useEffect = ReactObj.useEffect || null;

function RiderDashboardProfile(props) {
  var p = props || {};
  var userProfile = p.userProfile;
  var DashboardCard = p.DashboardCard;
  const [riderLogs, setRiderLogs] = useState([]);
  const [riderLoading, setRiderLoading] = useState(true);
  const [capabilityScores, setCapabilityScores] = useState(null);
  const [tendencyScores, setTendencyScores] = useState(null);
  const [aiComment, setAiComment] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(function fetchRiderLogs() {
    if (!userProfile?.id) {
      setRiderLoading(false);
      return () => {};
    }
    let isMounted = true;
    setRiderLoading(true);
    (async () => {
      try {
        let raw = [];
        if (typeof window.getUserTrainingLogs === 'function' && window.firestoreV9) {
          try {
            raw = await window.getUserTrainingLogs(userProfile.id, { limit: 400 });
            raw = Array.isArray(raw) ? raw : [];
          } catch (e) {
            raw = [];
          }
        }
        if (raw.length === 0 && window.firestore) {
          try {
            const snap = await window.firestore
              .collection('users')
              .doc(userProfile.id)
              .collection('logs')
              .orderBy('date', 'desc')
              .limit(400)
              .get();
            snap.docs.forEach((d) => {
              const dd = d.data();
              const o = { id: d.id };
              if (dd && typeof dd === 'object') { for (const k in dd) { if (dd.hasOwnProperty(k)) o[k] = dd[k]; } }
              raw.push(o);
            });
          } catch (e2) {
            raw = [];
          }
        }
        const today = new Date();
        const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        const fourWeeksAgo = new Date(today);
        fourWeeksAgo.setDate(today.getDate() - 28);
        const fourWeeksStr = fourWeeksAgo.getFullYear() + '-' + String(fourWeeksAgo.getMonth() + 1).padStart(2, '0') + '-' + String(fourWeeksAgo.getDate()).padStart(2, '0');
        const oneYearAgo = new Date(today);
        oneYearAgo.setDate(today.getDate() - 365);
        const oneYearStr = oneYearAgo.getFullYear() + '-' + String(oneYearAgo.getMonth() + 1).padStart(2, '0') + '-' + String(oneYearAgo.getDate()).padStart(2, '0');
        const weight = Number(userProfile.weight) || 0;
        const ftp = Number(userProfile.ftp) || 0;
        if (isMounted) setRiderLogs(raw);
        if (weight <= 0) {
          if (isMounted) {
            setCapabilityScores(null);
            setTendencyScores(null);
          }
        } else {
          const agg4w = window.aggregateMMPFromLogs ? window.aggregateMMPFromLogs(raw, fourWeeksStr, todayStr) : { max_watts: 0, max_1min_watts: 0, max_5min_watts: 0, max_20min_watts: 0 };
          const agg1y = window.aggregateMMPFromLogs ? window.aggregateMMPFromLogs(raw, oneYearStr, todayStr) : agg4w;
          if (isMounted) {
            setCapabilityScores(window.calculateRiderScores ? window.calculateRiderScores(weight, ftp, agg4w) : null);
            setTendencyScores(window.calculateRiderScores ? window.calculateRiderScores(weight, ftp, agg1y) : null);
          }
        }
      } catch (e) {
        console.warn('[RiderProfile] 로그 조회 실패:', e);
      } finally {
        if (isMounted) setRiderLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [userProfile]);

  useEffect(function fetchAIComment() {
    if (!capabilityScores) return;
    let isMounted = true;
    setAiLoading(true);
    (async () => {
      try {
        var isLowSpec = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
        var aiOpts = isLowSpec ? { timeoutMs: 25000, maxRetries: 4 } : { timeoutMs: 10000, maxRetries: 2 };
        const text = await (window.fetchAIProfileAnalysis || (() => { throw new Error('함수 없음'); }))(capabilityScores, aiOpts);
        if (isMounted) setAiComment(text);
      } catch (e) {
        console.warn('[RiderProfile] AI 코멘트 실패:', e);
        if (isMounted) setAiComment(window.FALLBACK_AI_COMMENT || '현재 AI 분석 서버가 혼잡하여 코멘트를 불러올 수 없습니다. 점수를 통해 나의 강점을 확인해 보세요.');
      } finally {
        if (isMounted) setAiLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [capabilityScores]);

  const Recharts = window.Recharts;
  var rc = Recharts || {};
  var RadarChart = rc.RadarChart;
  var Radar = rc.Radar;
  var PolarGrid = rc.PolarGrid;
  var PolarAngleAxis = rc.PolarAngleAxis;
  var PolarRadiusAxis = rc.PolarRadiusAxis;
  var ResponsiveContainer = rc.ResponsiveContainer;
  var Legend = rc.Legend;
  const cap = capabilityScores || {};
  const tend = tendencyScores || capabilityScores || {};
  const radarData = [
    { subject: 'RSPT', 역량: cap.RSPT || 0, 성향: tend.RSPT || 0, fullMark: 10 },
    { subject: 'TSPT', 역량: cap.TSPT || 0, 성향: tend.TSPT || 0, fullMark: 10 },
    { subject: 'PCH', 역량: cap.PCH || 0, 성향: tend.PCH || 0, fullMark: 10 },
    { subject: 'CLMB', 역량: cap.CLMB || 0, 성향: tend.CLMB || 0, fullMark: 10 },
    { subject: 'TTST', 역량: cap.TTST || 0, 성향: tend.TTST || 0, fullMark: 10 },
    { subject: 'ALLR', 역량: cap.ALLR || 0, 성향: tend.ALLR || 0, fullMark: 10 }
  ];

  if (!userProfile?.weight || userProfile.weight <= 0) {
    return (
      <DashboardCard title="STELVIO 헥사곤">
        <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">체중 정보를 입력해 주세요</div>
      </DashboardCard>
    );
  }
  if (riderLoading) {
    return (
      <DashboardCard title="STELVIO 헥사곤">
        <div className="h-[220px] flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <div className="text-sm text-gray-500">데이터 로딩 중...</div>
          </div>
        </div>
      </DashboardCard>
    );
  }
  return (
    <div className="space-y-4">
      <DashboardCard title="STELVIO 헥사곤">
        {RadarChart ? (
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                <PolarRadiusAxis angle={90} domain={[0, 10]} tick={{ fontSize: 10 }} />
                <Radar name="역량 (최근 4주)" dataKey="역량" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} strokeWidth={2} />
                <Radar name="성향 (최근 1년)" dataKey="성향" stroke="#eab308" fill="#eab308" fillOpacity={0.25} strokeWidth={1.5} />
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">Recharts 로드 실패</div>
        )}
      </DashboardCard>
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm" style={{ backgroundColor: 'rgba(249, 250, 251, 0.95)' }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 text-white text-sm font-semibold">AI</span>
          <span className="text-sm font-semibold text-gray-700">AI Coach</span>
        </div>
        {aiLoading ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm">로딩 중...</div>
        ) : (
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{aiComment}</p>
        )}
      </div>
    </div>
  );
}

if (typeof window !== 'undefined') {
  window.RiderDashboardProfile = RiderDashboardProfile;
}
