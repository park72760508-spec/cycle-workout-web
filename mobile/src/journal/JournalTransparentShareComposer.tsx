/**
 * 웹 JournalTransparentShareComposer 와 동일 UI·기능
 * (배경 선택, 드래그, 크기 슬라이더, 위치 초기화, 저장) — 변경 없음
 * 투명 오버레이 비주얼만 ShareOverlayArtboard / journalTransparentShare 에서 처리
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageSourcePropType,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import ViewShot from "react-native-view-shot";
import { ShareOverlayOffscreen } from "./ShareOverlayOffscreen";
import {
  OVERLAY_ASPECT,
  type ShareLog,
  type ShareOverlayOpts,
} from "./journalShareTypes";

const DEFAULT_SCALE = 1;
const MIN_SCALE = 0.35;
const MAX_SCALE = 1.6;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export type ComposerCloseResult = {
  cancelled?: boolean;
  saved?: boolean;
};

export type JournalTransparentShareComposerProps = {
  visible: boolean;
  log: ShareLog;
  opts?: ShareOverlayOpts;
  logoSource?: ImageSourcePropType;
  onClose: (result?: ComposerCloseResult) => void;
};

export function JournalTransparentShareComposer({
  visible,
  log,
  opts,
  logoSource,
  onClose,
}: JournalTransparentShareComposerProps) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [overlayUri, setOverlayUri] = useState<string | null>(null);
  const [bgUri, setBgUri] = useState<string | null>(null);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [pos, setPos] = useState({ x: 24, y: 24 });
  const [saving, setSaving] = useState(false);
  const [stageSize, setStageSize] = useState({ w: 320, h: 480 });

  const stageShotRef = useRef<ViewShot>(null);
  const overlayNatRef = useRef({ w: 0, h: 0 });
  const autoPickRef = useRef(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const posRef = useRef(pos);
  const scaleRef = useRef(scale);
  const stageSizeRef = useRef(stageSize);
  posRef.current = pos;
  scaleRef.current = scale;
  stageSizeRef.current = stageSize;

  const isAndroid = Platform.OS === "android";
  const overlayBaseW = stageSize.w * 0.88;
  const overlayDispW = overlayBaseW * scale;
  const overlayDispH =
    overlayNatRef.current.w > 0
      ? overlayDispW * (overlayNatRef.current.h / overlayNatRef.current.w)
      : overlayDispW * OVERLAY_ASPECT;

  function overlayLayout() {
    const st = stageSizeRef.current;
    const sc = scaleRef.current;
    const nat = overlayNatRef.current;
    const ow = st.w * 0.88 * sc;
    const oh = nat.w > 0 ? ow * (nat.h / nat.w) : ow * OVERLAY_ASPECT;
    return { ow, oh, maxX: st.w - ow + 20, maxY: st.h - oh + 20 };
  }

  const placeOverlayDefault = useCallback(() => {
    const ow = overlayBaseW * scale;
    const oh =
      overlayNatRef.current.w > 0
        ? ow * (overlayNatRef.current.h / overlayNatRef.current.w)
        : ow * OVERLAY_ASPECT;
    setPos({
      x: Math.max(8, (stageSize.w - ow) * 0.04),
      y: Math.max(8, (stageSize.h - oh) * 0.06),
    });
  }, [overlayBaseW, scale, stageSize.w, stageSize.h]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setErr(null);
    setOverlayUri(null);
    setScale(DEFAULT_SCALE);
    setPos({ x: 24, y: 24 });
    autoPickRef.current = false;
  }, [visible, log]);

  const onStageLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setStageSize({ w: width, h: height });
  }, []);

  useEffect(() => {
    if (bgUri && overlayUri && overlayNatRef.current.w > 0) {
      const t = setTimeout(placeOverlayDefault, 80);
      return () => clearTimeout(t);
    }
  }, [bgUri, overlayUri, stageSize.w, stageSize.h, placeOverlayDefault]);

  const pickBackground = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErr("갤러리 접근 권한이 필요합니다.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setBgUri(result.assets[0].uri);
    setErr(null);
  }, []);

  useEffect(() => {
    if (!visible || loading || bgUri || autoPickRef.current) return;
    autoPickRef.current = true;
    const t = setTimeout(() => {
      pickBackground().catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [visible, loading, bgUri, pickBackground]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !!bgUri,
      onMoveShouldSetPanResponder: () => !!bgUri,
      onPanResponderGrant: (_, g) => {
        dragRef.current = {
          startX: g.x0,
          startY: g.y0,
          origX: posRef.current.x,
          origY: posRef.current.y,
        };
      },
      onPanResponderMove: (_, g) => {
        const d = dragRef.current;
        if (!d) return;
        const { maxX, maxY } = overlayLayout();
        const dx = g.moveX - d.startX;
        const dy = g.moveY - d.startY;
        setPos({
          x: clamp(d.origX + dx, -20, maxX),
          y: clamp(d.origY + dy, -20, maxY),
        });
      },
      onPanResponderRelease: () => {
        dragRef.current = null;
      },
      onPanResponderTerminate: () => {
        dragRef.current = null;
      },
    })
  ).current;

  async function onSave() {
    if (!bgUri || !overlayUri) return;
    setSaving(true);
    setErr(null);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("권한 필요", "사진첩 저장 권한을 허용해 주세요.");
        return;
      }
      const uri = await stageShotRef.current?.capture?.({
        format: "jpg",
        quality: 0.92,
        result: "tmpfile",
      });
      if (!uri) throw new Error("합성 캡처 실패");
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert("저장 완료", "공유 이미지가 사진첩에 저장되었습니다.");
      onClose({ saved: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "저장 실패";
      setErr(msg);
      Alert.alert("오류", msg);
    } finally {
      setSaving(false);
    }
  }

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => onClose({ cancelled: true })}
    >
      <ShareOverlayOffscreen
        log={log}
        opts={opts}
        logoSource={logoSource}
        onReady={(uri) => {
          setOverlayUri(uri);
          setLoading(false);
        }}
        onError={(message) => {
          setErr(message);
          setLoading(false);
        }}
      />

      <View style={styles.overlay}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>투명 이미지 사진첩</Text>
            <Pressable
              style={styles.closeBtn}
              accessibilityLabel="닫기"
              onPress={() => onClose({ cancelled: true })}
            >
              <Text style={styles.closeBtnText}>×</Text>
            </Pressable>
          </View>

          <View style={styles.controlsTop}>
            <View style={styles.actionsRow}>
              <Pressable style={[styles.actionBtn, styles.pickBtn]} onPress={pickBackground}>
                <Text style={styles.pickBtnText}>배경 사진 선택</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, styles.saveBtn, (!bgUri || loading || saving) && styles.btnDisabled]}
                onPress={onSave}
                disabled={!bgUri || loading || saving}
              >
                <Text style={styles.saveBtnText}>
                  {saving ? "준비 중…" : isAndroid ? "저장·공유" : "저장"}
                </Text>
              </Pressable>
            </View>

            <View style={styles.scaleRow}>
              <Text style={styles.scaleLabel}>크기</Text>
              <Pressable
                style={styles.scaleBtn}
                disabled={!bgUri || scale <= MIN_SCALE}
                onPress={() => setScale((s) => clamp(s - 0.08, MIN_SCALE, MAX_SCALE))}
              >
                <Text style={styles.scaleBtnText}>−</Text>
              </Pressable>
              <View style={styles.rangeTrack}>
                <View
                  style={[
                    styles.rangeFill,
                    {
                      width: `${((scale - MIN_SCALE) / (MAX_SCALE - MIN_SCALE)) * 100}%`,
                    },
                  ]}
                />
              </View>
              <Pressable
                style={styles.scaleBtn}
                disabled={!bgUri || scale >= MAX_SCALE}
                onPress={() => setScale((s) => clamp(s + 0.08, MIN_SCALE, MAX_SCALE))}
              >
                <Text style={styles.scaleBtnText}>+</Text>
              </Pressable>
              <Pressable
                style={styles.resetBtn}
                disabled={!bgUri}
                onPress={placeOverlayDefault}
              >
                <Text style={styles.resetBtnText}>위치 초기화</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.hint}>
            배경 선택 후 오버레이를 드래그·크기 조절하여 맞추세요.
          </Text>

          {loading ? (
            <Text style={styles.loading}>라이딩 오버레이 준비 중…</Text>
          ) : null}
          {err ? <Text style={styles.error}>{err}</Text> : null}

          <View style={styles.stage} onLayout={onStageLayout}>
            <ViewShot
              ref={stageShotRef}
              style={StyleSheet.absoluteFill}
              options={{ format: "jpg", quality: 0.92 }}
            >
              {bgUri ? (
                <Image source={{ uri: bgUri }} style={styles.bgImage} resizeMode="contain" />
              ) : (
                <View style={styles.bgPlaceholder}>
                  <Text style={styles.bgPlaceholderText}>배경 사진을 선택하세요</Text>
                </View>
              )}

              {overlayUri && !loading ? (
                <View
                  {...panResponder.panHandlers}
                  style={[
                    styles.overlayImgWrap,
                    {
                      width: overlayDispW,
                      height: overlayDispH,
                      left: pos.x,
                      top: pos.y,
                      opacity: bgUri ? 1 : 0.45,
                    },
                  ]}
                >
                  <Image
                    source={{ uri: overlayUri }}
                    style={styles.overlayImage}
                    resizeMode="stretch"
                    onLoad={(e) => {
                      const { width, height } = e.nativeEvent.source;
                      if (width > 0 && height > 0) {
                        overlayNatRef.current = { w: width, h: height };
                        if (bgUri) placeOverlayDefault();
                      }
                    }}
                  />
                </View>
              ) : null}
            </ViewShot>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    padding: 12,
  },
  panel: {
    flex: 1,
    maxHeight: "92%",
    backgroundColor: "#fafafa",
    borderRadius: 16,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#18181b",
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: {
    fontSize: 28,
    color: "#52525b",
    lineHeight: 30,
  },
  controlsTop: {
    paddingHorizontal: 14,
    paddingBottom: 6,
    gap: 10,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
  },
  pickBtn: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.35)",
  },
  pickBtnText: {
    color: "#5b21b6",
    fontWeight: "600",
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: "#7c3aed",
  },
  saveBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  scaleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  scaleLabel: {
    fontSize: 13,
    color: "#52525b",
    minWidth: 28,
  },
  scaleBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#e4e4e7",
    alignItems: "center",
    justifyContent: "center",
  },
  scaleBtnText: {
    fontSize: 20,
    color: "#3f3f46",
    fontWeight: "600",
  },
  rangeTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#e4e4e7",
    overflow: "hidden",
  },
  rangeFill: {
    height: "100%",
    backgroundColor: "#7c3aed",
    borderRadius: 3,
  },
  resetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#f4f4f5",
    borderWidth: 1,
    borderColor: "#d4d4d8",
  },
  resetBtnText: {
    fontSize: 12,
    color: "#52525b",
    fontWeight: "600",
  },
  hint: {
    textAlign: "center",
    fontSize: 12,
    color: "#71717a",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  loading: {
    textAlign: "center",
    color: "#71717a",
    fontSize: 13,
    marginBottom: 6,
  },
  error: {
    textAlign: "center",
    color: "#dc2626",
    fontSize: 13,
    marginBottom: 6,
    paddingHorizontal: 16,
  },
  stage: {
    flex: 1,
    marginHorizontal: 12,
    marginBottom: 14,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#27272a",
    minHeight: 200,
  },
  bgImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  } as ViewStyle,
  bgPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  bgPlaceholderText: {
    color: "#a1a1aa",
    fontSize: 15,
  },
  overlayImgWrap: {
    position: "absolute",
  },
  overlayImage: {
    width: "100%",
    height: "100%",
  },
});
