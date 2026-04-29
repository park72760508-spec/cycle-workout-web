/**
 * 예시: React Native에서 `calculateLevelProgress`로 세로 10단계 인디케이터 렌더
 * 프로젝트 루트의 RN 앱으로 복사해 사용하면 됩니다. (본 저장소는 웹 중심)
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { calculateLevelProgress } from './calculateLevelProgress';

type Props = {
  percentile: number;
  /** 스택 칸 방식 사용 시 true (기본) */
  useStepCells?: boolean;
};

/** 10개 세로 칸(아래부터 채움): 낮은 퍼센트일수록 아래쪽 칸이 많이 활성화 */
export function HeptagonLevelStepsIndicator({ percentile, useStepCells = true }: Props) {
  const prog = calculateLevelProgress(percentile);
  const { filledSteps, fillRatio, currentLevel } = prog;

  if (!useStepCells) {
    return <HeptagonLevelFillRatioBar percentile={percentile} />;
  }

  /**
   * column-reverse: 첫 번째 자식이 시각적으로 맨 아래.
   * 아래에서부터 filledSteps개만 ON (낮은 퍼센트일수록 아래 칸이 더 많이 켜짐).
   */
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{currentLevel}</Text>
      <View style={styles.column}>
        {Array.from({ length: 10 }, (_, i) => (
          <View
            key={i}
            style={[styles.cell, i < filledSteps ? styles.cellOn : styles.cellOff]}
          />
        ))}
      </View>
      <Text style={styles.meta}>{`${filledSteps}/10 칸 (${(fillRatio * 100).toFixed(1)}%)`}</Text>
    </View>
  );
}

/** 단일 세로 바: height 비율로 연속 채움(bar는 아래에서 위로 채워짐) */
export function HeptagonLevelFillRatioBar({ percentile }: Pick<Props, 'percentile'>) {
  const { fillRatio, currentLevel } = calculateLevelProgress(percentile);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{currentLevel}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { flex: Math.max(0.001, fillRatio) }]} />
        <View style={{ flex: Math.max(0.001, 1 - fillRatio) }} />
      </View>
      <Text style={styles.meta}>{`fillRatio ${fillRatio.toFixed(3)}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 6 },
  label: { fontSize: 14, fontWeight: '700' },
  meta: { fontSize: 11, color: '#666' },
  column: {
    width: 28,
    height: 200,
    flexDirection: 'column-reverse',
    justifyContent: 'flex-start',
    gap: 3,
  },
  cell: {
    flex: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  cellOn: {
    backgroundColor: '#2563eb',
    borderColor: '#1d4ed8',
  },
  cellOff: {
    backgroundColor: 'rgba(0,0,0,0.06)',
    borderColor: 'rgba(0,0,0,0.12)',
  },
  track: {
    width: 28,
    height: 200,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.08)',
    flexDirection: 'column-reverse',
  },
  fill: {
    width: '100%',
    backgroundColor: '#2563eb',
  },
});
