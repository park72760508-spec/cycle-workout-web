/**
 * 오프스크린(화면 밖) 투명 PNG 캡처 + 갤러리 저장 — React Native
 *
 * 설치:
 *   npm install react-native-svg react-native-view-shot
 *   npx expo install expo-media-library
 *   (또는) npm install @react-native-camera-roll/camera-roll
 */
import React, { useRef } from "react";
import { StyleSheet, Text, View, Pressable, Alert } from "react-native";
import ViewShot from "react-native-view-shot";
import * as MediaLibrary from "expo-media-library";
import Svg, { Path, Text as SvgText } from "react-native-svg";
import { decodePolyline, latLngsToSvgPath } from "./stravaPolyline";
import type { RideRouteLog } from "./RidingCourseSvgBackground";

type ShareLog = RideRouteLog & {
  title?: string;
  distance_km?: number;
  duration_sec?: number;
  elevation_gain?: number;
  avg_watts?: number;
  avg_speed_kmh?: number;
};

type Props = {
  log: ShareLog;
  onDone?: () => void;
};

function summaryLines(log: ShareLog): string[] {
  const dist = Number(log.distance_km) || 0;
  const sec = Number(log.duration_sec) || 0;
  const elev = log.elevation_gain != null ? Number(log.elevation_gain) : null;
  const watts = log.avg_watts != null ? Number(log.avg_watts) : null;
  const spd = log.avg_speed_kmh != null ? Number(log.avg_speed_kmh) : null;
  return [
    dist > 0 ? `${dist.toFixed(1)} km` : "-",
    sec > 0 ? `${Math.floor(sec / 60)} min` : "-",
    elev != null && elev > 0 ? `${Math.round(elev)} m` : "-",
    watts != null && watts > 0 ? `${Math.round(watts)} W` : "-",
    spd != null && spd > 0 ? `${spd.toFixed(1)} km/h` : "-",
  ];
}

/** 화면에 보이지 않는 캡처 전용 뷰 (흰색 선·글자, 투명 배경) */
function OffscreenShareArt({ log }: { log: ShareLog }) {
  const poly = log.summary_polyline ? String(log.summary_polyline).trim() : "";
  const latlngs = poly ? decodePolyline(poly) : [];
  const courseD = latlngs.length >= 2 ? latLngsToSvgPath(latlngs, 1000, 480, 0.1) : "";
  const elev = Array.isArray(log.elevation_profile) ? log.elevation_profile : [];
  const lines = summaryLines(log);
  const title = (log.title || "STELVIO Ride").slice(0, 40);

  return (
    <Svg width={1080} height={1350} viewBox="0 0 1080 1350">
      {courseD ? (
        <Path
          d={courseD}
          transform="translate(60, 520)"
          stroke="#FFFFFF"
          strokeWidth={6}
          fill="none"
        />
      ) : null}
      <SvgText x={60} y={80} fill="#FFFFFF" fontSize={42} fontWeight="700">
        {title}
      </SvgText>
      {lines.map((line, i) => (
        <SvgText
          key={i}
          x={60}
          y={140 + i * 52}
          fill="#FFFFFF"
          fontSize={36}
          fontWeight="600"
        >
          {line}
        </SvgText>
      ))}
    </Svg>
  );
}

export function TransparentShareCapture({ log, onDone }: Props) {
  const shotRef = useRef<ViewShot>(null);

  async function save() {
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("권한 필요", "사진첩 저장 권한을 허용해 주세요.");
        return;
      }
      const uri = await shotRef.current?.capture?.({
        format: "png",
        quality: 1,
        result: "tmpfile",
      });
      if (!uri) throw new Error("캡처 실패");
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert("저장 완료", "투명 공유 이미지가 사진첩에 저장되었습니다.");
      onDone?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "저장 실패";
      Alert.alert("오류", msg);
    }
  }

  return (
    <>
      <Pressable style={styles.btn} onPress={save}>
        <Text style={styles.btnText}>투명 이미지 다운로드(공유)</Text>
      </Pressable>
      {/* 오프스크린: 앱 UI와 분리된 흰색+투명 렌더 */}
      <View style={styles.offscreen} pointerEvents="none">
        <ViewShot ref={shotRef} options={{ format: "png", quality: 1 }}>
          <View style={styles.captureRoot}>
            <OffscreenShareArt log={log} />
          </View>
        </ViewShot>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignSelf: "flex-end",
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.35)",
  },
  btnText: { color: "#5b21b6", fontWeight: "600", fontSize: 13 },
  offscreen: {
    position: "absolute",
    left: -10000,
    top: 0,
    width: 1080,
    height: 1350,
    opacity: 1,
  },
  captureRoot: {
    width: 1080,
    height: 1350,
    backgroundColor: "transparent",
  },
});
