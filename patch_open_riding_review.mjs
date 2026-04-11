import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, 'assets', 'js', 'openRiding', 'OpenRidingScreens.jsx');

const oldHint = `              <span className="text-xs text-slate-500 leading-tight font-medium">
                {reviewMergedLog
�기 하면 라이��� 후기를 확인하실 수 있습니다.'
                  : role !== 'participant' && hostPublicReviewWindow
                    ? openRidingIsRideScheduleDayTodaySeoul(ride) &&
                      !guestHostSummaryOnRide &&
                      !isOpenRidingPastBySeoulDate(ride)
                      ? '오�� 일정입니다. 방장의 ���련일지에 라이���이 반영되면 종료로 보고 방장 후기 요약�니다. (+)��러 최신 상태를 불러오세요.'
                      : '방장 후기가 등록되면 요약이 표시��니다.'
                    : '라이���이 종료되면 후기 자동 작성��니다.'}
              </span>`;

const newHint = `              <span className="text-xs text-slate-500 leading-tight font-medium">
                {reviewMergedLog
�기 하면 라이��� 후기를 확인하실 수 있습니다.'
                  : role === 'participant' && hostPublicReviewWindow
                    ? joinApplyClosedBySchedule
                      ? '종료된 일정입니다.��러 후기 요약을 확인하세요.'
                      : openRidingIsRideScheduleDayTodaySeoul(ride) &&
                          !rideDocHostSummaryMatchesRideDate(ride, rideYmdHint) &&
                          !isOpenRidingPastBySeoulDate(ride)
                        ? '오�� 일정�련일지��이 반영되면 종료·후기 요약이 표시�� 수 있습니다. (+)를�러 최신 상태를 불러오세요.'
                        : '해당 일정일 STRAVA 기록이 ���련일지에 반�인 후기가 표시되고, 없으면 방장 후기가 표시��니다.'
                    : role !== 'participant' && hostPublicReviewWindow
                      ? openRidingIsRideScheduleDayTodaySeoul(ride) &&
                          !guestHostSummaryOnRide &&
                          !isOpenRidingPastBySeoulDate(ride)
                        ? '오�� 일정입니다.��련일지에 라이���이 반영되면 종료로 보고 방장 후기 요약이 표시��니다. (+)를 다시 ���러 최신 상태를 불러오세요.'
                        : '방장 후기가 등록되면 요약�니다.'
                      : '라이���이 종료되면 후기 자동 작성��니다.'}
              </span>`;

const oldPart = `              {role === 'participant' ? (
                reviewLogsLoading ? (
                  <p className="text-xs text-slate-500 m-0">��러오는 중…</p>
                ) : reviewMergedLog ? (
                  <OpenRidingRideReviewSummaryContent log={reviewMergedLog} />
                ) : (
                  <p className="text-xs text-slate-500 m-0 leading-relaxed">
                    이 일정일에 STRAVA 라이��� 기록이 없거나 아직 라이���이 종료되지 않았습니다.
                  </p>
                )
              ) : hostPublicReviewWindow ? (`;

const newPart = `              {role === 'participant' ? (
                reviewLogsLoading ? (
                  <p className="text-xs text-slate-500 m-0">��러오는 중…</p>
                ) : reviewMergedLog ? (
                  <div className="w-full min-w-0 space-y-2">
                    {reviewMergedLogSource === 'host_fallback' ? (
                      <p className="text-xs text-slate-600 m-0 font-semibold">방장 후기 (본인 STRAVA 기록 없음)</p>
                    ) : null}
                    <OpenRidingRideReviewSummaryContent log={reviewMergedLog} />
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 m-0 leading-relaxed">
                    이 일정일에 ��인 STR�� 기록이 없고, 방장 공개 후기도 아직 없거나 종료 조건에 해당하지 않습니다.
                  </p>
                )
              ) : hostPublicReviewWindow ? (`;

let text = fs.readFileSync(p, 'utf8');
if (!text.includes(oldHint)) {
  console.error('oldHint not found');
  process.exit(1);
}
if (!text.includes(oldPart)) {
  console.error('oldPart not found');
  process.exit(1);
}
text = text.replace(oldHint, newHint);
text = text.replace(oldPart, newPart);
fs.writeFileSync(p, text, 'utf8');
console.log('patched ok');
