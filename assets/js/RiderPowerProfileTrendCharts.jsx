/**
 * RiderPowerProfileTrendCharts - 라이더 파워 프로필 세부 트렌드 분석 그래프
 * '훈련 트렌드 (최근 1개월)' 섹션 바로 위에 배치
 * 6개 그래프: TSPT, RSPT, PCH, CLMB, TTTST, ALLR
 * 사용자 프로필의 체중(userProfile.weight)을 활용하여 파워값(W) 산출
 * @see useRiderAnalysis.js - MMP 집계
 */

/* global React, Recharts */

// ========== Mock Data 베이스 (70kg 기준 W/kg → 절대 파워 W)
// 실제 표시 시 userProfile.weight로 스케일 적용: value * (userWeight / 70)
const MOCK_WEEKLY_DATA_BASE = {
  TSPT: [ // Max 파워 (1~5초) - 주간 피크
    { week: 1, name: '1주차', myPower: 720, longTermGoal: 780, shortTermGoal: 750 },
    { week: 2, name: '2주차', myPower: 735, longTermGoal: 780, shortTermGoal: 750 },
    { week: 3, name: '3주차', myPower: 710, longTermGoal: 780, shortTermGoal: 750 },
    { week: 4, name: '4주차', myPower: 745, longTermGoal: 780, shortTermGoal: 750 }
  ],
  RSPT: [ // 1분 파워
    { week: 1, name: '1주차', myPower: 420, longTermGoal: 455, shortTermGoal: 435 },
    { week: 2, name: '2주차', myPower: 430, longTermGoal: 455, shortTermGoal: 435 },
    { week: 3, name: '3주차', myPower: 415, longTermGoal: 455, shortTermGoal: 435 },
    { week: 4, name: '4주차', myPower: 438, longTermGoal: 455, shortTermGoal: 435 }
  ],
  PCH: [ // 5분 파워
    { week: 1, name: '1주차', myPower: 315, longTermGoal: 340, shortTermGoal: 325 },
    { week: 2, name: '2주차', myPower: 322, longTermGoal: 340, shortTermGoal: 325 },
    { week: 3, name: '3주차', myPower: 308, longTermGoal: 340, shortTermGoal: 325 },
    { week: 4, name: '4주차', myPower: 330, longTermGoal: 340, shortTermGoal: 325 }
  ],
  CLMB: [ // 20분 파워
    { week: 1, name: '1주차', myPower: 252, longTermGoal: 273, shortTermGoal: 262 },
    { week: 2, name: '2주차', myPower: 258, longTermGoal: 273, shortTermGoal: 262 },
    { week: 3, name: '3주차', myPower: 248, longTermGoal: 273, shortTermGoal: 262 },
    { week: 4, name: '4주차', myPower: 265, longTermGoal: 273, shortTermGoal: 262 }
  ],
  TTTST: [ // 60분 파워 (1등일 때 예시: 단기목표 = 나의최고 * 1.03)
    { week: 1, name: '1주차', myPower: 228, longTermGoal: 228, shortTermGoal: 235 }, // 1등: 228*1.03≈235
    { week: 2, name: '2주차', myPower: 232, longTermGoal: 232, shortTermGoal: 239 },
    { week: 3, name: '3주차', myPower: 225, longTermGoal: 232, shortTermGoal: 239 },
    { week: 4, name: '4주차', myPower: 235, longTermGoal: 235, shortTermGoal: 242 }
  ]
};

// ALLR 파워 커브 베이스 (70kg 기준)
const MOCK_POWER_CURVE_BASE = [
  { duration: '5s', name: 'Max', power: 720, sortOrder: 1 },
  { duration: '1분', name: '1분', power: 438, sortOrder: 2 },
  { duration: '5분', name: '5분', power: 330, sortOrder: 3 },
  { duration: '10분', name: '10분', power: 295, sortOrder: 4 },
  { duration: '20분', name: '20분', power: 265, sortOrder: 5 },
  { duration: '40분', name: '40분', power: 242, sortOrder: 6 },
  { duration: '60분', name: '60분', power: 235, sortOrder: 7 }
];

// 고유 ID 생성 (여러 차트에서 gradient ID 충돌 방지)
let _chartId = 0;
function nextChartId() { return 'pp-' + (++_chartId); }

// ========== 주간 트렌드 차트 (TSPT, RSPT, PCH, CLMB, TTTST) ==========
function PowerProfileWeekTrendChart({ title, description, data, DashboardCard }) {
  const Recharts = window.Recharts;
  const { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } = Recharts || {};
  const cid = nextChartId();

  if (!Recharts || !data || data.length === 0) {
    return (
      <DashboardCard>
        <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">
          Recharts 또는 데이터 없음
        </div>
      </DashboardCard>
    );
  }

  const formatW = (v) => (v != null && !isNaN(v) ? Math.round(v) + 'W' : '-');

  return (
    <DashboardCard>
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={cid + '-fillMy'} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={cid + '-fillLong'} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#EF4444" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#EF4444" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={cid + '-fillShort'} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#F97316" stopOpacity={0.1} />
                <stop offset="100%" stopColor="#F97316" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#6b7280" />
            <YAxis
              tick={{ fontSize: 11 }}
              stroke="#6b7280"
              tickFormatter={(v) => v + 'W'}
              domain={['auto', 'auto']}
            />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }}
              formatter={(value) => [formatW(value), '']}
              labelFormatter={(label) => '주차: ' + label}
            />
            <Legend
              wrapperStyle={{ fontSize: 10 }}
              formatter={(value, entry) => {
                const colors = { '나의 달성도': '#3B82F6', '장기 목표': 'rgba(239,68,68,0.7)', '단기 목표': 'rgba(249,115,22,0.7)' };
                return <span style={{ color: colors[value] || '#374151' }}>{value}</span>;
              }}
            />
            <Area
              type="monotone"
              dataKey="shortTermGoal"
              stroke="rgba(249,115,22,0.5)"
              fill={'url(#' + cid + '-fillShort)'}
              strokeWidth={2}
              name="단기 목표"
              dot={false}
              connectNulls
            />
            <Area
              type="monotone"
              dataKey="longTermGoal"
              stroke="rgba(239,68,68,0.5)"
              fill={'url(#' + cid + '-fillLong)'}
              strokeWidth={2}
              name="장기 목표"
              dot={false}
              connectNulls
            />
            <Area
              type="monotone"
              dataKey="myPower"
              stroke="#3B82F6"
              fill={'url(#' + cid + '-fillMy)'}
              strokeWidth={2.5}
              name="나의 달성도"
              dot={{ r: 4, fill: '#3B82F6', stroke: '#fff', strokeWidth: 1 }}
              activeDot={{ r: 5, fill: '#3B82F6', stroke: '#fff', strokeWidth: 2 }}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </DashboardCard>
  );
}

// ========== 파워 커브 차트 (ALLR - Duration 기반) ==========
function PowerProfileCurveChart({ DashboardCard, powerCurveData }) {
  const Recharts = window.Recharts;
  const { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } = Recharts || {};
  const cid = nextChartId();
  const data = powerCurveData || [];

  if (!Recharts || !data.length) {
    return (
      <DashboardCard>
        <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">
          Recharts 또는 데이터 없음
        </div>
      </DashboardCard>
    );
  }

  const formatW = (v) => (v != null && !isNaN(v) ? Math.round(v) + 'W' : '-');

  return (
    <DashboardCard>
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-gray-800">ALLR - 전 구간 파워 커브</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          5분~60분 구간의 완만한 유지 여부 확인. 최근 1개월 Overall Power Curve (단위: W)
        </p>
      </div>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id={cid + '-fillCurve'} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="duration" tick={{ fontSize: 11 }} stroke="#6b7280" />
            <YAxis
              tick={{ fontSize: 11 }}
              stroke="#6b7280"
              tickFormatter={(v) => v + 'W'}
              domain={['auto', 'auto']}
            />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }}
              formatter={(value) => [formatW(value), '']}
              labelFormatter={(label) => '시간: ' + label}
            />
            <Area
              type="monotone"
              dataKey="power"
              stroke="#3B82F6"
              fill={'url(#' + cid + '-fillCurve)'}
              strokeWidth={2.5}
              name="파워"
              dot={{ r: 4, fill: '#3B82F6', stroke: '#fff', strokeWidth: 1 }}
              activeDot={{ r: 5, fill: '#3B82F6', stroke: '#fff', strokeWidth: 2 }}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </DashboardCard>
  );
}

// 체중 기반 Mock 데이터 스케일 (70kg 기준 → 사용자 체중 적용)
function scaleMockDataByWeight(baseData, userWeight) {
  const w = Number(userWeight) || 70;
  const scale = w / 70;
  if (scale === 1) return baseData;
  return baseData.map(function(row) {
    var out = {};
    for (var k in row) {
      out[k] = (typeof row[k] === 'number' && (k === 'myPower' || k === 'longTermGoal' || k === 'shortTermGoal' || k === 'power')) ? Math.round(row[k] * scale) : row[k];
    }
    return out;
  });
}

function scaleWeeklyDataByWeight(baseObj, userWeight) {
  var w = Number(userWeight) || 70;
  var scale = w / 70;
  if (scale === 1) return baseObj;
  var out = {};
  for (var key in baseObj) {
    out[key] = baseObj[key].map(function(row) {
      var r = {};
      for (var k in row) {
        r[k] = (typeof row[k] === 'number' && (k === 'myPower' || k === 'longTermGoal' || k === 'shortTermGoal')) ? Math.round(row[k] * scale) : row[k];
      }
      return r;
    });
  }
  return out;
}

// ========== 메인 컴포넌트 ==========
function RiderPowerProfileTrendCharts({ DashboardCard, userProfile }) {
  var Card = DashboardCard || function(props) { return <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">{props.children}</div>; };
  var userWeight = userProfile && Number(userProfile.weight);
  var scaledWeekly = scaleWeeklyDataByWeight(MOCK_WEEKLY_DATA_BASE, userWeight);
  var scaledCurve = scaleMockDataByWeight(MOCK_POWER_CURVE_BASE, userWeight);

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-800 px-1">
        라이더 파워 프로필 세부 트렌드
        {userWeight > 0 ? <span className="text-xs font-normal text-gray-500 ml-2">(체중 {userWeight}kg 기준)</span> : null}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="min-w-0">
          <PowerProfileWeekTrendChart
            title="TSPT - Max 파워 (1~5초)"
            description="순수한 신경근 파워와 최대 근력이 폭발하는 지점"
            data={scaledWeekly.TSPT}
            DashboardCard={Card}
          />
        </div>
        <div className="min-w-0">
          <PowerProfileWeekTrendChart
            title="RSPT - 1분 파워"
            description="무산소 용량의 한계치, 롱 스프린트 능력 지표"
            data={scaledWeekly.RSPT}
            DashboardCard={Card}
          />
        </div>
        <div className="min-w-0">
          <PowerProfileWeekTrendChart
            title="PCH - 5분 파워"
            description="VO2 Max 구간, 짧고 강한 언덕 어택 특화"
            data={scaledWeekly.PCH}
            DashboardCard={Card}
          />
        </div>
        <div className="min-w-0">
          <PowerProfileWeekTrendChart
            title="CLMB - 20분 파워"
            description="젖산 역치와 VO2 Max의 혼합 구간, 클라이머의 핵심 지표"
            data={scaledWeekly.CLMB}
            DashboardCard={Card}
          />
        </div>
        <div className="min-w-0">
          <PowerProfileWeekTrendChart
            title="TTTST - 60분 파워"
            description="순수 젖산 역치(FTP) 구간, 1시간 꾸준한 파워 유지 능력"
            data={scaledWeekly.TTTST}
            DashboardCard={Card}
          />
        </div>
        <div className="min-w-0">
          <PowerProfileCurveChart DashboardCard={Card} powerCurveData={scaledCurve} />
        </div>
      </div>
    </div>
  );
}

if (typeof window !== 'undefined') {
  window.RiderPowerProfileTrendCharts = RiderPowerProfileTrendCharts;
  window.PowerProfileWeekTrendChart = PowerProfileWeekTrendChart;
  window.PowerProfileCurveChart = PowerProfileCurveChart;
}
