"use strict";
/**
 * 인스타그램 에이전트 관리자 API (2026-11-27) — 관리자 환경설정 > 인스타그램 업로드 화면용.
 * 비밀값 5개는 GitHub Actions 저장소 비밀값으로만 저장한다(암호화 등록·읽기 불가). GitHub 토큰만 Firestore adminSecrets 에 둔다
 * (클라이언트 읽기 규칙 없음 = 서버 전용; appConfig 는 공개 읽기라 쓰면 안 됨).
 * action: status | saveGithub | saveConnection | run | approve
 */
const REPO = "park72760508-spec/cycle-workout-web";
const SECRET_NAMES = ["ANTHROPIC_API_KEY", "IG_USER_ID", "IG_ACCESS_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_KEY"];
const WORKFLOWS = { weekly: "instagram-weekly.yml", publish: "instagram-publish.yml" };
const GRAPH = "https://graph.facebook.com/v23.0";

const clean = (v) => String(v == null ? "" : v).replace(/^﻿/, "").trim().replace(/^["']+|["']+$/g, "").trim();

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

function createGithub(token, f = fetch) {
  return async function gh(method, path, body) {
    const res = await f(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "stelvio-instagram-agent",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    let j = null;
    try { j = await res.json(); } catch (_e) { /* 빈 응답 */ }
    if (!res.ok) throw new HttpError(res.status, `GitHub ${res.status}: ${(j && j.message) || "요청 실패"}`);
    return j;
  };
}

/** GitHub 저장소 비밀값용 sealed box 암호화 */
async function encryptForGithub(publicKeyB64, value) {
  const sodium = require("libsodium-wrappers");
  await sodium.ready;
  const key = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL);
  const enc = sodium.crypto_box_seal(sodium.from_string(value), key);
  return sodium.to_base64(enc, sodium.base64_variants.ORIGINAL);
}

async function checkAnthropic(key, f) {
  const r = await f("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
  if (r.status === 401) throw new HttpError(400, "Claude API 키가 올바르지 않습니다.");
  if (!r.ok) throw new HttpError(400, `Claude API 확인 실패(${r.status})`);
}

async function checkInstagram(id, token, f) {
  const r = await f(`${GRAPH}/${encodeURIComponent(id)}?fields=username,media_count&access_token=${encodeURIComponent(token)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new HttpError(400, `인스타그램 연결 확인 실패: ${(j.error && j.error.message) || r.status}`);
  return { username: j.username || "", mediaCount: j.media_count };
}

async function checkSupabase(url, key, f) {
  const base = url.replace(/\/$/, "");
  const r = await f(`${base}/storage/v1/bucket/instagram-media`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (r.status === 404) throw new HttpError(400, "Supabase 에 instagram-media 버킷이 없습니다(마이그레이션 필요).");
  if (!r.ok) throw new HttpError(400, `Supabase 연결 확인 실패(${r.status}) — URL 과 서비스 키를 확인하세요.`);
}

/** 입력값 검증 → 검증된 { name: value } 와 확인 결과. 일부만 입력하면 그것만 처리 */
async function validateValues(input, f) {
  const v = {};
  for (const n of SECRET_NAMES) { const x = clean(input && input[n]); if (x) v[n] = x; }
  if (!Object.keys(v).length) throw new HttpError(400, "저장할 값을 입력해 주세요.");
  const checks = {};
  if (v.ANTHROPIC_API_KEY) {
    if (!/^sk-ant-/.test(v.ANTHROPIC_API_KEY)) throw new HttpError(400, "Claude API 키는 sk-ant- 로 시작합니다.");
    await checkAnthropic(v.ANTHROPIC_API_KEY, f);
    checks.anthropic = "ok";
  }
  if (v.IG_USER_ID || v.IG_ACCESS_TOKEN) {
    if (!(v.IG_USER_ID && v.IG_ACCESS_TOKEN)) throw new HttpError(400, "IG_USER_ID 와 IG_ACCESS_TOKEN 은 함께 입력해야 연결을 확인할 수 있습니다.");
    if (!/^\d+$/.test(v.IG_USER_ID)) throw new HttpError(400, "IG_USER_ID 는 숫자여야 합니다.");
    checks.instagram = await checkInstagram(v.IG_USER_ID, v.IG_ACCESS_TOKEN, f);
  }
  if (v.SUPABASE_URL || v.SUPABASE_SERVICE_KEY) {
    if (!(v.SUPABASE_URL && v.SUPABASE_SERVICE_KEY)) throw new HttpError(400, "SUPABASE_URL 과 SUPABASE_SERVICE_KEY 는 함께 입력해야 연결을 확인할 수 있습니다.");
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(v.SUPABASE_URL)) throw new HttpError(400, "SUPABASE_URL 형식이 올바르지 않습니다(https://<프로젝트>.supabase.co).");
    await checkSupabase(v.SUPABASE_URL, v.SUPABASE_SERVICE_KEY, f);
    checks.supabase = "ok";
  }
  return { values: v, checks };
}

async function readQueue(gh) {
  let files = [];
  try { files = await gh("GET", `/repos/${REPO}/contents/agents/instagram/queue?ref=main`); } catch (e) { if (e.status !== 404) throw e; }
  const weeks = files.map((x) => x.name).filter((n) => /^\d{4}-W\d\d\.json$/.test(n)).sort().slice(-3).reverse();
  const out = [];
  for (const name of weeks) {
    const j = await gh("GET", `/repos/${REPO}/contents/agents/instagram/queue/${name}?ref=main`);
    const plan = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
    out.push({
      week: plan.week, status: plan.status,
      posts: (plan.posts || []).map((p) => ({ id: p.id, title: p.title, status: p.status, publishAt: p.publishAt, caption: p.caption, videoUrl: p.videoUrl || "", permalink: p.permalink || "", error: p.error || "" })),
    });
  }
  return out;
}

function createHandler({ admin, verifyAuth, setCors, fetchImpl }) {
  const f = fetchImpl || fetch;
  const cfgRef = () => admin.firestore().collection("adminSecrets").doc("instagramAgent");
  const getToken = async () => { const s = await cfgRef().get(); return clean(s.exists ? (s.data() || {}).githubToken : ""); };

  return async function handler(req, res) {
    setCors(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ success: false, error: "POST만 허용됩니다." }); return; }
    try {
      const decoded = await verifyAuth(req);
      const caller = await admin.firestore().collection("users").doc(decoded.uid).get();
      if (String((caller.data() || {}).grade) !== "1") throw new HttpError(403, "관리자만 사용할 수 있습니다.");
      const body = typeof req.body === "object" && req.body !== null ? req.body : {};
      const action = String(body.action || "status");

      if (action === "saveGithub") {
        const token = clean(body.githubToken);
        if (!token) throw new HttpError(400, "GitHub 토큰을 입력해 주세요.");
        const gh = createGithub(token, f);
        await gh("GET", `/repos/${REPO}`); // 저장소 접근 확인
        await gh("GET", `/repos/${REPO}/actions/secrets/public-key`); // Secrets 권한 확인
        await gh("GET", `/repos/${REPO}/actions/workflows/${WORKFLOWS.weekly}`); // Actions 권한 확인
        await cfgRef().set({ githubToken: token, updatedAt: new Date().toISOString() }, { merge: true });
        res.status(200).json({ success: true });
        return;
      }

      const token = await getToken();
      if (!token) {
        if (action === "status") { res.status(200).json({ success: true, github: false, secrets: {}, runs: {}, weeks: [] }); return; }
        throw new HttpError(400, "먼저 GitHub 토큰을 저장해 주세요.");
      }
      const gh = createGithub(token, f);

      if (action === "status") {
        const list = await gh("GET", `/repos/${REPO}/actions/secrets?per_page=100`);
        const have = new Set((list.secrets || []).map((s) => s.name));
        const secrets = {};
        SECRET_NAMES.forEach((n) => { secrets[n] = have.has(n); });
        const runs = {};
        for (const [k, wf] of Object.entries(WORKFLOWS)) {
          const r = await gh("GET", `/repos/${REPO}/actions/workflows/${wf}/runs?per_page=1`);
          const run = r.workflow_runs && r.workflow_runs[0];
          runs[k] = run ? { status: run.status, conclusion: run.conclusion, at: run.created_at, url: run.html_url } : null;
        }
        const weeks = await readQueue(gh);
        const issues = await gh("GET", `/repos/${REPO}/issues?labels=ig-draft&state=all&per_page=10`);
        weeks.forEach((w) => {
          const i = (issues || []).find((x) => String(x.title).includes(w.week));
          w.issue = i ? { number: i.number, url: i.html_url, state: i.state, approved: (i.labels || []).some((l) => l.name === "ig-approved") } : null;
        });
        res.status(200).json({ success: true, github: true, secrets, runs, weeks });
        return;
      }

      if (action === "saveConnection") {
        const { values, checks } = await validateValues(body.values, f);
        const pk = await gh("GET", `/repos/${REPO}/actions/secrets/public-key`);
        for (const [name, value] of Object.entries(values)) {
          await gh("PUT", `/repos/${REPO}/actions/secrets/${name}`, { encrypted_value: await encryptForGithub(pk.key, value), key_id: pk.key_id });
        }
        res.status(200).json({ success: true, saved: Object.keys(values), checks });
        return;
      }

      if (action === "run") {
        const wf = WORKFLOWS[String(body.workflow)];
        if (!wf) throw new HttpError(400, "알 수 없는 작업입니다.");
        const inputs = {};
        if (body.workflow === "weekly") {
          inputs.mode = body.mode === "dry-run" ? "dry-run" : "plan";
          inputs.force = body.force ? "true" : "false";
        }
        await gh("POST", `/repos/${REPO}/actions/workflows/${wf}/dispatches`, { ref: "main", inputs });
        res.status(200).json({ success: true });
        return;
      }

      if (action === "approve") {
        const week = clean(body.week);
        if (!/^\d{4}-W\d\d$/.test(week)) throw new HttpError(400, "주차 형식이 올바르지 않습니다.");
        const issues = await gh("GET", `/repos/${REPO}/issues?labels=ig-draft&state=open&per_page=20`);
        const issue = (issues || []).find((x) => String(x.title).includes(week));
        if (!issue) throw new HttpError(404, `${week} 승인 대기 Issue 를 찾지 못했습니다.`);
        await gh("POST", `/repos/${REPO}/issues/${issue.number}/labels`, { labels: ["ig-approved"] });
        res.status(200).json({ success: true, issue: issue.number });
        return;
      }

      throw new HttpError(400, "알 수 없는 action");
    } catch (e) {
      const status = e && e.status ? e.status : 500;
      console.error("[instagramAgentAdmin]", e && e.message ? e.message : e);
      res.status(status).json({ success: false, error: e && e.message ? e.message : String(e) });
    }
  };
}

module.exports = { createHandler, validateValues, encryptForGithub, createGithub, SECRET_NAMES, REPO };
