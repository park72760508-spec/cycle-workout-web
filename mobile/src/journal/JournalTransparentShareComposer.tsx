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
import { SHARE_LAYOUT } from "./journalShareFormat";
import type { ShareLog, ShareOverlayOpts } from "./journalShareTypes";

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
  const [overlayHeaderUri, setOverlayHeaderUri] = useState<string | null>(null);
  const [overlayBottomUri, setOverlayBottomUri] = useState<string | null>(null);
  const [bgUri, setBgUri] = useState<string | null>(null);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [posHeader, setPosHeader] = useState({ x: 24, y: 16 });
  const [posBottom, setPosBottom] = useState({ x: 24, y: 280 });
  const [saving, setSaving] = useState(false);
  const [stageSize, setStageSize] = useState({ w: 320, h: 480 });

  const stageShotRef = useRef<ViewShot>(null);
  const headerNatRef = useRef({ w: 1080, h: SHARE_LAYOUT.headerH });
  const bottomNatRef = useRef({ w: 1080, h: SHARE_LAYOUT.bottomH });
  const autoPickRef = useRef(false);
  const dragRef = useRef<{
    kind: "header" | "bottom";
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const isAndroid = Platform.OS === "android";
  const overlayBaseW = stageSize.w * 0.88;
  const stickerW = overlayBaseW * scale;
  const headerDispW = stickerW;
  const headerDispH =
    headerNatRef.current.w > 0
      ? stickerW * (headerNatRef.current.h / headerNatRef.current.w)
      : stickerW * (SHARE_LAYOUT.headerH / 1080);
  const bottomDispW = stickerW;
  const bottomDispH =
    bottomNatRef.current.w > 0
      ? stickerW * (bottomNatRef.current.h / bottomNatRef.current.w)
      : stickerW * (SHARE_LAYOUT.bottomH / 1080);

  const placeOverlayDefault = useCallback(() => {
    const w = overlayBaseW * scale;
    const hH =
      headerNatRef.current.w > 0
        ? w * (headerNatRef.current.h / headerNatRef.current.w)
        : w * (SHARE_LAYOUT.headerH / 1080);
    const bH =
      bottomNatRef.current.w > 0
        ? w * (bottomNatRef.current.h / bottomNatRef.current.w)
        : w * (SHARE_LAYOUT.bottomH / 1080);
    const x = Math.max(8, (stageSize.w - w) * 0.04);
    setPosHeader({ x, y: Math.max(8, stageSize.h * 0.04) });
    setPosBottom({ x, y: Math.max(hH + 16, stageSize.h - bH - stageSize.h * 0.06) });
  }, [overlayBaseW, scale, stageSize.w, stageSize.h]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setErr(null);
    setOverlayHeaderUri(null);
    setOverlayBottomUri(null);
    setScale(DEFAULT_SCALE);
    setPosHeader({ x: 24, y: 16 });
    setPosBottom({ x: 24, y: 280 });
    autoPickRef.current = false;
  }, [visible, log]);

  const onStageLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setStageSize({ w: width, h: height });
  }, []);

  useEffect(() => {
    if (bgUri && overlayHeaderUri && overlayBottomUri) {
      const t = setTimeout(placeOverlayDefault, 80);
      return () => clearTimeout(t);
    }
  }, [bgUri, overlayHeaderUri, overlayBottomUri, stageSize.w, stageSize.h, placeOverlayDefault]);

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

  function makePan(kind: "header" | "bottom") {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !!bgUri,
      onMoveShouldSetPanResponder: () => !!bgUri,
      onPanResponderGrant: (_, g) => {
        const pos = kind === "header" ? posHeader : posBottom;
        dragRef.current = {
          kind,
          startX: g.x0,
          startY: g.y0,
          origX: pos.x,
          origY: pos.y,
        };
      },
      onPanResponderMove: (_, g) => {
        const d = dragRef.current;
        if (!d || d.kind !== kind) return;
        const dx = g.moveX - d.startX;
        const dy = g.moveY - d.startY;
        if (kind === "header") {
          setPosHeader({
            x: clamp(d.origX + dx, -20, stageSize.w - headerDispW + 20),
            y: clamp(d.origY + dy, -20, stageSize.h - headerDispH + 20),
          });
        } else {
          setPosBottom({
            x: clamp(d.origX + dx, -20, stageSize.w - bottomDispW + 20),
            y: clamp(d.origY + dy, -20, stageSize.h - bottomDispH + 20),
          });
        }
      },
      onPanResponderRelease: () => {
        dragRef.current = null;
      },
      onPanResponderTerminate: () => {
        dragRef.current = null;
      },
    });
  }

  const panHeader = useRef(makePan("header")).current;
  const panBottom = useRef(makePan("bottom")).current;

  async function onSave() {
    if (!bgUri || !overlayHeaderUri || !overlayBottomUri) return;
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
        onReady={(pair) => {
          setOverlayHeaderUri(pair.headerUri);
          setOverlayBottomUri(pair.bottomUri);
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
            배경 선택 후 상단·하단 오버레이를 각각 드래그해 맞추세요. 크기는 두 영역이 같이 조절됩니다.
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

              {overlayHeaderUri && !loading ? (
                <View
                  {...panHeader.panHandlers}
                  style={[
                    styles.overlayImgWrap,
                    {
                      width: headerDispW,
                      height: headerDispH,
                      left: posHeader.x,
                      top: posHeader.y,
                      opacity: bgUri ? 1 : 0.45,
                    },
                  ]}
                >
                  <Image
                    source={{ uri: overlayHeaderUri }}
                    style={styles.overlayImage}
                    resizeMode="stretch"
                    onLoad={(e) => {
                      const { width, height } = e.nativeEvent.source;
                      if (width > 0 && height > 0) {
                        headerNatRef.current = { w: width, h: height };
                        if (bgUri) placeOverlayDefault();
                      }
                    }}
                  />
                </View>
              ) : null}
              {overlayBottomUri && !loading ? (
                <View
                  {...panBottom.panHandlers}
                  style={[
                    styles.overlayImgWrap,
                    {
                      width: bottomDispW,
                      height: bottomDispH,
                      left: posBottom.x,
                      top: posBottom.y,
                      opacity: bgUri ? 1 : 0.45,
                    },
                  ]}
                >
                  <Image
                    source={{ uri: overlayBottomUri }}
                    style={styles.overlayImage}
                    resizeMode="stretch"
                    onLoad={(e) => {
                      const { width, height } = e.nativeEvent.source;
                      if (width > 0 && height > 0) {
                        bottomNatRef.current = { w: width, h: height };
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
