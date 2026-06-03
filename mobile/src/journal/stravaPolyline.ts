/**
 * Strava encoded polyline → SVG path (React Native용)
 * 패키지: @mapbox/polyline (선택) 또는 아래 디코더 사용
 */
export function decodePolyline(encoded: string, precision = 5): [number, number][] {
  const enc = String(encoded || "").trim();
  if (!enc) return [];
  const factor = Math.pow(10, precision);
  let index = 0;
  let lat = 0;
  let lng = 0;
  const out: [number, number][] = [];
  while (index < enc.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = enc.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = enc.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;
    out.push([lat / factor, lng / factor]);
  }
  return out;
}

export function latLngsToSvgPath(
  latlngs: [number, number][],
  viewW = 400,
  viewH = 200,
  padRatio = 0.08
): string {
  if (!latlngs.length) return "";
  let minLat = latlngs[0][0];
  let maxLat = latlngs[0][0];
  let minLng = latlngs[0][1];
  let maxLng = latlngs[0][1];
  for (const p of latlngs) {
    minLat = Math.min(minLat, p[0]);
    maxLat = Math.max(maxLat, p[0]);
    minLng = Math.min(minLng, p[1]);
    maxLng = Math.max(maxLng, p[1]);
  }
  const latSpan = maxLat - minLat || 1e-6;
  const lngSpan = maxLng - minLng || 1e-6;
  const padX = viewW * padRatio;
  const padY = viewH * padRatio;
  const innerW = viewW - padX * 2;
  const innerH = viewH - padY * 2;
  const scale = Math.min(innerW / lngSpan, innerH / latSpan);
  const usedW = lngSpan * scale;
  const usedH = latSpan * scale;
  const offX = padX + (innerW - usedW) / 2;
  const offY = padY + (innerH - usedH) / 2;
  const project = (pt: [number, number]) => {
    const x = offX + (pt[1] - minLng) * scale;
    const y = offY + (maxLat - pt[0]) * scale;
    return [x, y] as const;
  };
  const p0 = project(latlngs[0]);
  let d = `M ${p0[0].toFixed(2)} ${p0[1].toFixed(2)}`;
  for (let i = 1; i < latlngs.length; i++) {
    const pi = project(latlngs[i]);
    d += ` L ${pi[0].toFixed(2)} ${pi[1].toFixed(2)}`;
  }
  return d;
}
