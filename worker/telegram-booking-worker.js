const encoder = new TextEncoder();
const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024;
const SESSION_TTL_SECONDS = 30 * 60;
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD_HASH = "3e67f0b9df3270aaf08671c35f14f6929bc3fc362b1f90fb511ddd8a1a7654f7";
const DEFAULT_SESSION_SECRET = "m-hall-admin-session-2026";

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://n1kseeman.github.io",
  "https://mhall.by",
  "https://www.mhall.by",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
]);

const FIELD_LABELS = {
  name: "Имя",
  phone: "Телефон",
  event: "Формат",
  guests: "Гостей",
  date: "Дата",
  message: "Комментарий",
  venue: "Площадка"
};


const ADMIN_TOKEN_TTL_SECONDS = 60 * 60 * 8;

function base64Url(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new TextEncoder().encode(String(buffer));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(env, value) {
  const secret = env.ADMIN_PASSWORD || env.GITHUB_TOKEN || "mhall-admin";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function issueAdminToken(env) {
  const payload = base64Url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ADMIN_TOKEN_TTL_SECONDS }));
  return `${payload}.${await hmac(env, payload)}`;
}

async function verifyAdmin(request, env) {
  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  const [payload, signature] = token.split(".");
  if (!payload || !signature || signature !== await hmac(env, payload)) return false;
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return Number(data.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function githubConfig(env) {
  return {
    owner: env.GITHUB_OWNER || "n1kseeman",
    repo: env.GITHUB_REPO || "m-hall-minsk",
    branch: env.GITHUB_BRANCH || "main",
    token: env.GITHUB_TOKEN
  };
}

function toBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToUtf8(value) {
  const binary = atob(String(value).replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function dataUrlToBase64(dataUrl) {
  return String(dataUrl).split(",").pop() || "";
}

async function githubRequest(env, path, options = {}) {
  const { owner, repo, token } = githubConfig(env);
  if (!token) throw new Error("GITHUB_TOKEN is not configured");
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "m-hall-admin-worker",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `GitHub request failed: ${response.status}`);
  return data;
}

async function getGithubFile(env, path) {
  const { branch } = githubConfig(env);
  return githubRequest(env, `${path}?ref=${encodeURIComponent(branch)}`);
}

async function putGithubFile(env, path, content, message, sha) {
  const { branch } = githubConfig(env);
  return githubRequest(env, path, {
    method: "PUT",
    body: JSON.stringify({ message, content, sha, branch })
  });
}

function imageExtension(name = "", type = "") {
  const fromName = String(name).match(/\.([a-z0-9]+)$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("jpeg")) return "jpg";
  if (type.includes("webp")) return "webp";
  return "jpg";
}

async function saveUploadedImages(env, halls) {
  for (const hall of halls) {
    const images = [];
    for (let index = 0; index < (hall.images || []).length; index += 1) {
      const image = hall.images[index];
      if (typeof image === "string") {
        images.push(image);
        continue;
      }
      if (image?.dataUrl) {
        const ext = imageExtension(image.name, image.type);
        const safeHall = clean(hall.id || hall.title || "hall", 80).toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "hall";
        const path = `assets/photos/${safeHall}-${Date.now()}-${index}.${ext}`;
        await putGithubFile(env, path, dataUrlToBase64(image.dataUrl), `Add M HALL photo ${safeHall}`, undefined);
        images.push(path);
      }
    }
    hall.images = images;
    hall.image = images[0] || "";
  }
}

async function handleAdmin(request, env, origin, url) {
  if (url.pathname === "/admin/login" && request.method === "POST") {
    const payload = await request.json().catch(() => ({}));
    if (!env.ADMIN_PASSWORD || payload.password !== env.ADMIN_PASSWORD) {
      return jsonResponse({ ok: false, error: "Invalid password" }, 401, origin);
    }
    return jsonResponse({ ok: true, token: await issueAdminToken(env) }, 200, origin);
  }

  if (!(await verifyAdmin(request, env))) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401, origin);
  }

  if (url.pathname === "/admin/halls" && request.method === "GET") {
    const file = await getGithubFile(env, "content/halls.json");
    const content = JSON.parse(base64ToUtf8(file.content));
    return jsonResponse({ ok: true, ...content }, 200, origin);
  }

  if (url.pathname === "/admin/halls" && request.method === "PUT") {
    const payload = await request.json();
    const halls = Array.isArray(payload.halls) ? payload.halls : [];
    await saveUploadedImages(env, halls);
    const file = await getGithubFile(env, "content/halls.json");
    const content = `${JSON.stringify({ halls }, null, 2)}\n`;
    await putGithubFile(env, "content/halls.json", toBase64Utf8(content), "Update M HALL halls content", file.sha);
    return jsonResponse({ ok: true, halls }, 200, origin);
  }

  return jsonResponse({ ok: false, error: "Not found" }, 404, origin);
}

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://n1kseeman.github.io";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
    "Vary": "Origin"
  };
}

    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/login" && request.method === "POST") {
        return await handleLogin(request, env);
      }
      if (url.pathname === "/api/session" && request.method === "GET") {
        await requireSession(request, env);
        return jsonResponse(request, env, { authenticated: true });
      }
      if (url.pathname === "/api/publish" && request.method === "POST") {
        assertAllowedOrigin(request, env);
        await requireSession(request, env);
        return await handlePublish(request, env);
      }
      if (url.pathname === "/admin/login" && request.method === "POST") {
        return await handleLogin(request, env);
      }
      if (url.pathname === "/admin/halls" && request.method === "GET") {
        await requireSession(request, env);
        const file = await getGitHubContentFile(env, "content/halls.json");
        return jsonResponse(request, env, { ok: true, ...JSON.parse(base64ToUtf8(file.content)) });
      }
      if (url.pathname === "/admin/halls" && request.method === "PUT") {
        assertAllowedOrigin(request, env);
        await requireSession(request, env);
        const payload = await readJson(request);
        return await handlePublish(request, env, { halls: payload.halls || [], uploads: [], deletedImages: [] });
      }
      if ((url.pathname === "/api/booking" || url.pathname === "/") && request.method === "POST") {
        return await handleBooking(request, env);
      }
      return jsonResponse(request, env, { error: "Not found." }, 404);
    } catch (error) {
      if (error instanceof HttpError) return jsonResponse(request, env, { error: error.message }, error.status);
      console.error(error);
      return jsonResponse(request, env, { error: "Не удалось выполнить запрос. Попробуйте ещё раз." }, 500);
    }
  }
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getAllowedOrigins(env) {
  const fromEnv = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...fromEnv]);
}

function corsHeaders(request, env) {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Max-Age": "600",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin"
  });
  const origin = request.headers.get("Origin");
  if (origin && getAllowedOrigins(env).has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  else headers.set("Access-Control-Allow-Origin", "https://n1kseeman.github.io");
  return headers;
}

function jsonResponse(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request, env) });
}

async function readJson(request, maxLength = MAX_JSON_BODY_BYTES) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > maxLength) throw new HttpError(413, "Слишком большой объём фотографий.");
  if (!request.headers.get("Content-Type")?.includes("application/json")) throw new HttpError(415, "Некорректный формат запроса.");
  try {
    const text = await request.text();
    if (encoder.encode(text).byteLength > maxLength) throw new HttpError(413, "Слишком большой объём фотографий.");
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Некорректный запрос.");
  }
}

async function readFormOrJson(request, maxLength = 64 * 1024) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > maxLength) throw new HttpError(413, "Слишком большой запрос.");
  const contentType = request.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) return await readJson(request, maxLength);
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const bodySize = (await request.clone().arrayBuffer()).byteLength;
    if (bodySize > maxLength) throw new HttpError(413, "Слишком большой запрос.");
    const formData = await request.formData();
    return Object.fromEntries([...formData.entries()].map(([key, value]) => [key, typeof value === "string" ? value : ""]));
  }
  throw new HttpError(415, "Некорректный формат заявки.");
}

function assertAllowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !getAllowedOrigins(env).has(origin)) throw new HttpError(403, "Origin is not allowed.");
}

async function handleBooking(request, env) {
  assertAllowedOrigin(request, env);
  await enforceRateLimit(env.BOOKING_RATE_LIMITER, request, "booking");
  const payload = await readFormOrJson(request);
  if (cleanText(payload.website, 120)) return jsonResponse(request, env, { ok: true });
  const message = buildTelegramMessage(payload);
  if (message.error) throw new HttpError(400, message.error);
  await sendTelegram(env, message.text);
  return jsonResponse(request, env, { ok: true });
}

function buildTelegramMessage(payload) {
  const data = {
    venue: cleanText(payload.venue || "M HALL Минск", 80),
    name: cleanText(payload.name, 120),
    phone: cleanText(payload.phone, 80),
    event: cleanText(payload.event || payload.eventType, 120),
    guests: cleanText(payload.guests, 20),
    date: cleanText(payload.date, 40),
    message: cleanText(payload.message || payload.comment, 900)
  };
  const missing = ["name", "phone", "event", "guests", "date"].filter((field) => !data[field]);
  if (missing.length) return { error: `Missing required fields: ${missing.join(", ")}` };
  const lines = ["<b>Новая заявка с сайта</b>", "", ...Object.entries(data).filter(([, value]) => value).map(([key, value]) => `<b>${FIELD_LABELS[key] || key}:</b> ${escapeHtml(value)}`)];
  return { text: lines.join("\n") };
}

async function sendTelegram(env, text) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new HttpError(503, "Приём заявок не настроен.");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true })
  });
  if (!response.ok) throw new HttpError(502, "Не удалось отправить заявку.");
}

async function handleLogin(request, env) {
  assertAllowedOrigin(request, env);
  await enforceRateLimit(env.LOGIN_RATE_LIMITER, request, "login");
  const body = await readJson(request);
  const username = String(body.username || "");
  const password = String(body.password || "");
  const validUsername = timingSafeEqual(username, String(env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME));
  const validPassword = timingSafeEqual(await sha256Hex(password), String(env.ADMIN_PASSWORD_HASH || DEFAULT_ADMIN_PASSWORD_HASH).toLowerCase());
  if (!validUsername || !validPassword) throw new HttpError(401, "Неверный логин или пароль.");
  const token = await createSessionToken(env);
  return jsonResponse(request, env, { token });
}

async function requireSession(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token || !(await verifySessionToken(token, env))) throw new HttpError(401, "Сессия истекла. Войдите ещё раз.");
}

async function createSessionToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: "m-hall-admin", iat: now, exp: now + SESSION_TTL_SECONDS, nonce: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))) };
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await signValue(encodedPayload, env.SESSION_SECRET || DEFAULT_SESSION_SECRET);
  return `${encodedPayload}.${signature}`;
}

async function verifySessionToken(token, env) {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [encodedPayload, signature] = parts;
  const expectedSignature = await signValue(encodedPayload, env.SESSION_SECRET || DEFAULT_SESSION_SECRET);
  if (!timingSafeEqual(signature, expectedSignature)) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = Number(payload.iat);
    const expiresAt = Number(payload.exp);
    return payload.sub === "m-hall-admin" && Number.isSafeInteger(issuedAt) && Number.isSafeInteger(expiresAt) && issuedAt <= now + 60 && expiresAt > now && expiresAt - issuedAt === SESSION_TTL_SECONDS;
  } catch {
    return false;
  }
}

async function signValue(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function enforceRateLimit(limiter, request, scope) {
  if (!limiter || typeof limiter.limit !== "function") return;
  const clientIp = String(request.headers.get("CF-Connecting-IP") || "unknown").replace(/[^0-9a-f:.]/gi, "").slice(0, 64) || "unknown";
  const result = await limiter.limit({ key: `${scope}:${clientIp}` });
  if (!result?.success) throw new HttpError(429, "Слишком много попыток. Попробуйте через минуту.");
}

    const url = new URL(request.url);

    if (url.pathname.startsWith("/admin/")) {
      return handleAdmin(request, env, origin, url);
    }

function timingSafeEqual(left, right) {
  const leftBytes = encoder.encode(String(left));
  const rightBytes = encoder.encode(String(right));
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  return difference === 0;
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function handlePublish(request, env, overridePayload = null) {
  const payload = validatePublishPayload(overridePayload || await readJson(request));
  const result = await publishToGitHub(env, payload);
  return jsonResponse(request, env, { ok: true, commitSha: result.sha, commitUrl: result.htmlUrl });
}

function validatePublishPayload(payload) {
  if (!payload || !Array.isArray(payload.halls)) throw new HttpError(400, "Список залов не передан.");
  if (payload.halls.length > 30) throw new HttpError(400, "Можно добавить не более 30 залов.");
  const ids = new Set();
  const halls = payload.halls.map((hall) => {
    const id = cleanText(hall.id, 90);
    const title = cleanText(hall.title, 80);
    const description = cleanText(hall.description, 1000);
    const imageInput = Array.isArray(hall.images) ? hall.images : [hall.image];
    const images = imageInput.map((image) => cleanText(image, 500)).filter(Boolean);
    const tagline = cleanText(hall.tagline || "M HALL", 80);
    if (!/^[a-z0-9-]+$/i.test(id) || ids.has(id)) throw new HttpError(400, "Некорректный идентификатор зала.");
    if (!title || !description || !images.length || images.length > 10 || images.some((image) => !isAllowedImage(image))) throw new HttpError(400, "Проверьте название, описание и фотографии зала.");
    ids.add(id);
    return { id, title, description, image: images[0], images, tagline };
  });
  const uploadsInput = Array.isArray(payload.uploads) ? payload.uploads : [];
  if (uploadsInput.length > 30) throw new HttpError(400, "За один раз можно загрузить не более 30 фотографий.");
  const uploadPaths = new Set();
  let totalUploadLength = 0;
  const uploads = uploadsInput.map((upload) => {
    const path = cleanText(upload.path, 220);
    const content = String(upload.content || "");
    if (!/^assets\/photos\/[a-z0-9-]+\.webp$/i.test(path) || uploadPaths.has(path) || !/^[a-zA-Z0-9+/=]+$/.test(content) || !isWebpBase64(content)) throw new HttpError(400, "Некорректная фотография.");
    if (content.length > 4 * 1024 * 1024) throw new HttpError(413, "Одна из фотографий слишком большая.");
    totalUploadLength += content.length;
    uploadPaths.add(path);
    return { path, content };
  });
  if (totalUploadLength > 14 * 1024 * 1024) throw new HttpError(413, "Общий объём фотографий слишком большой.");
  const referencedImages = new Set(halls.flatMap((hall) => hall.images));
  for (const path of uploadPaths) if (!referencedImages.has(path)) throw new HttpError(400, "Загружена фотография, которая не используется.");
  const deletedImages = [...new Set((Array.isArray(payload.deletedImages) ? payload.deletedImages : []).map((path) => cleanText(path, 220)).filter((path) => /^assets\/photos\/[a-z0-9-]+\.webp$/i.test(path)))].filter((path) => !referencedImages.has(path) && !uploadPaths.has(path));
  return { halls, uploads, deletedImages };
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isAllowedImage(value) {
  return /^assets\/photos\/[a-z0-9-]+\.(?:jpe?g|png|webp)$/i.test(value) || /^assets\/images\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(value);
}

function isWebpBase64(value) {
  if (!value || value.length % 4 !== 0) return false;
  try {
    const binary = atob(value);
    return binary.length >= 12 && binary.slice(0, 4) === "RIFF" && binary.slice(8, 12) === "WEBP";
  } catch {
    return false;
  }
}

function githubConfig(env) {
  return {
    owner: env.GITHUB_OWNER || "n1kseeman",
    repo: env.GITHUB_REPO || "m-hall-minsk",
    branch: env.GITHUB_BRANCH || "main"
  };
}

async function publishToGitHub(env, payload) {
  const { owner, repo, branch } = githubConfig(env);
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const reference = await githubRequest(env, `${repoPath}/git/ref/heads/${encodeURIComponent(branch)}`);
  const headSha = reference.object.sha;
  const commit = await githubRequest(env, `${repoPath}/git/commits/${headSha}`);
  const baseTreeSha = commit.tree.sha;
  const fullTree = await githubRequest(env, `${repoPath}/git/trees/${baseTreeSha}?recursive=1`);
  const existingPaths = new Set((fullTree.tree || []).map((entry) => entry.path));
  const content = `${JSON.stringify({ halls: payload.halls }, null, 2)}\n`;
  const contentBlob = await githubRequest(env, `${repoPath}/git/blobs`, { method: "POST", body: JSON.stringify({ content, encoding: "utf-8" }) });
  const uploadEntries = await Promise.all(payload.uploads.map(async (upload) => {
    const blob = await githubRequest(env, `${repoPath}/git/blobs`, { method: "POST", body: JSON.stringify({ content: upload.content, encoding: "base64" }) });
    return { path: upload.path, mode: "100644", type: "blob", sha: blob.sha };
  }));
  const deleteEntries = payload.deletedImages.filter((path) => existingPaths.has(path)).map((path) => ({ path, mode: "100644", type: "blob", sha: null }));
  const tree = await githubRequest(env, `${repoPath}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: baseTreeSha, tree: [{ path: "content/halls.json", mode: "100644", type: "blob", sha: contentBlob.sha }, ...uploadEntries, ...deleteEntries] }) });
  const newCommit = await githubRequest(env, `${repoPath}/git/commits`, { method: "POST", body: JSON.stringify({ message: "Update M HALL halls from admin", tree: tree.sha, parents: [headSha] }) });
  await githubRequest(env, `${repoPath}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "PATCH", body: JSON.stringify({ sha: newCommit.sha, force: false }) });
  return { sha: newCommit.sha, htmlUrl: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}` };
}

async function getGitHubContentFile(env, path) {
  const { owner, repo, branch } = githubConfig(env);
  return githubRequest(env, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`);
}

function base64ToUtf8(value) {
  const binary = atob(String(value).replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubRequest(env, path, options = {}) {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not configured.");
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "m-hall-admin-worker",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  let data = {};
  if (body) {
    try { data = JSON.parse(body); } catch { data = {}; }
  }
  if (!response.ok) {
    console.error("GitHub API error", response.status, data.message || body);
    if (response.status === 409 || response.status === 422) throw new HttpError(409, "Сайт изменился во время сохранения. Обновите страницу и повторите.");
    throw new Error(`GitHub API request failed: ${response.status}`);
  }
  return data;
}

export const __test__ = Object.freeze({ isWebpBase64, validatePublishPayload });
