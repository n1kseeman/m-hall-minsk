const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024;
const SESSION_TTL_SECONDS = 30 * 60;
const DEFAULT_ADMIN_USERNAME = "admin";
const ADMIN_SESSION_SUBJECT = "m-hall-admin";
const DEFAULT_GITHUB_OWNER = "n1kseeman";
const DEFAULT_GITHUB_REPO = "m-hall-minsk";
const DEFAULT_GITHUB_BRANCH = "main";
const TELEGRAM_MAX_ATTEMPTS = 5;
const TELEGRAM_MAX_RETRY_DELAY_MS = 10_000;
let cachedTelegramChatId = "";
const DEFAULT_ALLOWED_ORIGINS = [
  "https://n1kseeman.github.io",
  "https://mhall.by",
  "https://www.mhall.by",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
];

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return handleOptions(request, env);
    }

    const url = new URL(request.url);

    try {
      if ((url.pathname === "/api/login" || url.pathname === "/admin/login") && request.method === "POST") {
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

      if (url.pathname === "/admin/halls" && request.method === "GET") {
        await requireSession(request, env);
        return await handleReadHalls(request, env);
      }

      if (url.pathname === "/admin/halls" && request.method === "PUT") {
        assertAllowedOrigin(request, env);
        await requireSession(request, env);
        const payload = await readJson(request);
        return await handlePublish(request, env, {
          halls: Array.isArray(payload.halls) ? payload.halls : [],
          uploads: [],
          deletedImages: []
        });
      }

      if ((url.pathname === "/api/booking" || url.pathname === "/") && request.method === "POST") {
        return await handleBooking(request, env);
      }

      return jsonResponse(request, env, { error: "Not found." }, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse(request, env, { error: error.message }, error.status);
      }

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

function handleOptions(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !getAllowedOrigins(env).has(origin)) {
    return jsonResponse(request, env, { error: "Origin is not allowed." }, 403);
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, env)
  });
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
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin"
  });

  const origin = request.headers.get("Origin");
  if (origin && getAllowedOrigins(env).has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}

function jsonResponse(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(request, env)
  });
}

async function readJson(request, maxLength = MAX_JSON_BODY_BYTES) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > maxLength) {
    throw new HttpError(413, "Слишком большой объём фотографий.");
  }

  if (!request.headers.get("Content-Type")?.includes("application/json")) {
    throw new HttpError(415, "Некорректный формат запроса.");
  }

  try {
    const text = await request.text();
    if (encoder.encode(text).byteLength > maxLength) {
      throw new HttpError(413, "Слишком большой объём фотографий.");
    }
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Некорректный запрос.");
  }
}

async function readFormOrJson(request, maxLength = 64 * 1024) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > maxLength) {
    throw new HttpError(413, "Слишком большой запрос.");
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return await readJson(request, maxLength);
  }

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    let bodySize;
    try {
      bodySize = (await request.clone().arrayBuffer()).byteLength;
    } catch {
      throw new HttpError(400, "Некорректный запрос.");
    }

    if (bodySize > maxLength) {
      throw new HttpError(413, "Слишком большой запрос.");
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      throw new HttpError(400, "Некорректный запрос.");
    }

    return Object.fromEntries(
      [...formData.entries()].map(([key, value]) => [
        key,
        typeof value === "string" ? value : ""
      ])
    );
  }

  throw new HttpError(415, "Некорректный формат заявки.");
}

function assertAllowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !getAllowedOrigins(env).has(origin)) {
    throw new HttpError(403, "Origin is not allowed.");
  }
}

async function handleBooking(request, env) {
  assertAllowedOrigin(request, env);
  await enforceRateLimit(env.BOOKING_RATE_LIMITER, request, "booking");

  const payload = await readFormOrJson(request);
  if (cleanText(payload.website, 120)) {
    return jsonResponse(request, env, { ok: true });
  }

  const booking = validateBookingPayload(payload);
  await sendBookingToTelegram(env, formatBookingMessage(booking, request));

  return jsonResponse(request, env, { ok: true });
}

function validateBookingPayload(payload) {
  const name = cleanText(payload.name, 80);
  const phone = normalizePhone(cleanText(payload.phone, 40));
  const eventType = cleanText(payload.eventType || payload.event, 80);
  const guestsValue = cleanText(payload.guests, 8);
  const guests = Number.parseInt(guestsValue, 10);
  const date = cleanText(payload.date, 20);
  const comment = cleanText(payload.comment || payload.message, 1000);
  const venue = cleanText(payload.venue || "M HALL Минск", 80);

  if (!name) {
    throw new HttpError(400, "Укажите имя.");
  }

  if (!/^\+?[0-9]{7,15}$/.test(phone)) {
    throw new HttpError(400, "Укажите корректный телефон.");
  }

  if (!eventType) {
    throw new HttpError(400, "Укажите формат мероприятия.");
  }

  if (!/^\d{1,3}$/.test(guestsValue) || !Number.isInteger(guests) || guests < 1 || guests > 300) {
    throw new HttpError(400, "Укажите корректное количество гостей.");
  }

  if (!isValidBookingDate(date)) {
    throw new HttpError(400, "Укажите дату мероприятия.");
  }

  return { venue, name, phone, eventType, guests, date, comment };
}

function isValidBookingDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;

  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return date.getTime() >= todayUtc;
}

function normalizePhone(value) {
  const text = String(value || "").trim();
  const digits = text.replace(/\D/g, "").slice(0, 15);
  return `${text.startsWith("+") ? "+" : ""}${digits}`;
}

function formatBookingMessage(booking, request) {
  const source = cleanText(request.headers.get("Referer") || "Сайт M HALL", 500);
  const createdAt = new Date().toLocaleString("ru-RU", {
    timeZone: "Europe/Minsk",
    dateStyle: "short",
    timeStyle: "short"
  });
  const rows = [
    ["Площадка", booking.venue],
    ["Имя", booking.name],
    ["Телефон", booking.phone],
    ["Формат", booking.eventType],
    ["Гостей", booking.guests],
    ["Дата", booking.date],
    ["Комментарий", booking.comment],
    ["Источник", source],
    ["Время", createdAt]
  ];

  return [
    "<b>Новая заявка M HALL</b>",
    "",
    ...rows
      .filter(([, value]) => value || value === 0)
      .map(([label, value]) => `<b>${label}:</b> ${escapeHtml(value)}`)
  ].join("\n");
}

async function sendBookingToTelegram(env, text) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const configuredChatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  let chatId = cachedTelegramChatId || configuredChatId;

  if (!token || !chatId) {
    throw new HttpError(503, "Приём заявок не настроен.");
  }

  let messageText = text;
  let parseMode = "HTML";
  let lastFailure = null;

  for (let attempt = 1; attempt <= TELEGRAM_MAX_ATTEMPTS; attempt += 1) {
    let response;

    try {
      const body = {
        chat_id: chatId,
        text: messageText,
        disable_web_page_preview: true
      };
      if (parseMode) body.parse_mode = parseMode;

      response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (error) {
      lastFailure = {
        kind: "network",
        description: cleanTelegramError(error?.message || "Telegram request failed"),
        attempt
      };

      if (attempt < TELEGRAM_MAX_ATTEMPTS) {
        logTelegramRecovery("network retry", lastFailure);
        await sleep(telegramRetryDelay(attempt));
        continue;
      }
      break;
    }

    const result = await readTelegramResult(response);
    if (response.ok && result.ok !== false) return;

    const errorCode = Number(result.error_code || response.status || 0);
    const description = cleanTelegramError(result.description || response.statusText || "Unknown Telegram error");
    const migrateToChatId = result.parameters?.migrate_to_chat_id;
    const retryAfter = Number(result.parameters?.retry_after);
    lastFailure = {
      kind: "api",
      status: response.status,
      errorCode,
      description,
      attempt,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
      migrateToChatId: migrateToChatId ? String(migrateToChatId) : undefined
    };

    if (migrateToChatId && String(migrateToChatId) !== chatId) {
      chatId = String(migrateToChatId);
      cachedTelegramChatId = chatId;
      logTelegramRecovery("chat migrated", {
        status: response.status,
        errorCode,
        attempt
      });
      continue;
    }

    if (parseMode && isTelegramParseError(errorCode, description)) {
      parseMode = "";
      messageText = htmlToPlainText(text);
      logTelegramRecovery("plain text fallback", {
        status: response.status,
        errorCode,
        attempt
      });
      continue;
    }

    if (isRetryableTelegramError(response.status, errorCode) && attempt < TELEGRAM_MAX_ATTEMPTS) {
      logTelegramRecovery("API retry", lastFailure);
      const delay = Number.isFinite(retryAfter)
        ? Math.min(Math.max(retryAfter, 0) * 1000, TELEGRAM_MAX_RETRY_DELAY_MS)
        : telegramRetryDelay(attempt);
      await sleep(delay);
      continue;
    }

    break;
  }

  logTelegramFailure(lastFailure || { kind: "unknown" });
  throw new HttpError(502, "Не удалось отправить заявку. Пожалуйста, попробуйте ещё раз.");
}

async function readTelegramResult(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function cleanTelegramError(value) {
  return String(value)
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function logTelegramFailure(failure) {
  console.error("Telegram delivery failed", JSON.stringify(failure));
}

function logTelegramRecovery(action, details) {
  console.warn(`Telegram ${action}`, JSON.stringify(details));
}

function isTelegramParseError(errorCode, description) {
  const normalized = String(description).toLowerCase();
  return (
    errorCode === 400
    && normalized.includes("parse")
    && (normalized.includes("entit") || normalized.includes("tag"))
  );
}

function isRetryableTelegramError(status, errorCode) {
  return status === 429 || errorCode === 429 || status >= 500 || errorCode >= 500;
}

function telegramRetryDelay(attempt) {
  return Math.min(250 * (2 ** Math.max(attempt - 1, 0)), TELEGRAM_MAX_RETRY_DELAY_MS);
}

function sleep(delayMs) {
  if (!delayMs) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function htmlToPlainText(value) {
  return String(value)
    .replace(/<\/?b>/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

async function handleLogin(request, env) {
  assertAllowedOrigin(request, env);
  await enforceRateLimit(env.LOGIN_RATE_LIMITER, request, "login");

  if (!hasAdminPassword(env)) {
    throw new HttpError(503, "Пароль администратора не настроен.");
  }
  if (!getSessionSecret(env)) {
    throw new HttpError(503, "Секрет сессии администратора не настроен.");
  }

  const body = await readJson(request);
  const username = String(body.username || DEFAULT_ADMIN_USERNAME);
  const password = String(body.password || "");
  const validUsername = timingSafeEqual(username, String(env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME));
  const validPassword = await verifyAdminPassword(password, env);

  if (!validUsername || !validPassword) {
    throw new HttpError(401, "Неверный логин или пароль.");
  }

  const token = await createSessionToken(env);
  return jsonResponse(request, env, { token });
}

async function requireSession(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (!token || !(await verifySessionToken(token, env))) {
    throw new HttpError(401, "Сессия истекла. Войдите ещё раз.");
  }
}

async function createSessionToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: ADMIN_SESSION_SUBJECT,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    nonce: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))
  };
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await signValue(encodedPayload, getSessionSecret(env));
  return `${encodedPayload}.${signature}`;
}

async function verifySessionToken(token, env) {
  const sessionSecret = getSessionSecret(env);
  if (!sessionSecret) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [encodedPayload, signature] = parts;
  const expectedSignature = await signValue(encodedPayload, sessionSecret);
  if (!timingSafeEqual(signature, expectedSignature)) return false;

  try {
    const payload = JSON.parse(decoder.decode(base64UrlDecode(encodedPayload)));
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = Number(payload.iat);
    const expiresAt = Number(payload.exp);
    return (
      payload.sub === ADMIN_SESSION_SUBJECT
      && Number.isSafeInteger(issuedAt)
      && Number.isSafeInteger(expiresAt)
      && issuedAt <= now + 60
      && expiresAt > now
      && expiresAt - issuedAt === SESSION_TTL_SECONDS
    );
  } catch {
    return false;
  }
}

function hasAdminPassword(env) {
  return Boolean(String(env.ADMIN_PASSWORD_HASH || "") || String(env.ADMIN_PASSWORD || ""));
}

async function verifyAdminPassword(password, env) {
  const passwordHash = String(env.ADMIN_PASSWORD_HASH || "").trim().toLowerCase();
  if (passwordHash) {
    return timingSafeEqual(await sha256Hex(password), passwordHash);
  }

  const legacyPassword = String(env.ADMIN_PASSWORD || "");
  return Boolean(legacyPassword) && timingSafeEqual(password, legacyPassword);
}

function getSessionSecret(env) {
  return String(env.SESSION_SECRET || env.GITHUB_TOKEN || "").trim();
}

async function signValue(value, secret) {
  if (!secret) throw new Error("SESSION_SECRET is not configured.");

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function enforceRateLimit(limiter, request, scope) {
  if (!limiter || typeof limiter.limit !== "function") return;

  const clientIp = String(request.headers.get("CF-Connecting-IP") || "unknown")
    .replace(/[^0-9a-f:.]/gi, "")
    .slice(0, 64) || "unknown";
  const result = await limiter.limit({ key: `${scope}:${clientIp}` });

  if (!result?.success) {
    throw new HttpError(429, "Слишком много попыток. Попробуйте через минуту.");
  }
}

function timingSafeEqual(left, right) {
  const leftBytes = encoder.encode(String(left));
  const rightBytes = encoder.encode(String(right));
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }

  return difference === 0;
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function handleReadHalls(request, env) {
  const file = await getGitHubContentFile(env, "content/halls.json");
  return jsonResponse(request, env, {
    ok: true,
    ...JSON.parse(base64ToUtf8(file.content))
  });
}

async function handlePublish(request, env, overridePayload = null) {
  const payload = validatePublishPayload(overridePayload || await readJson(request));
  const result = await publishToGitHub(env, payload);

  return jsonResponse(request, env, {
    ok: true,
    commitSha: result.sha,
    commitUrl: result.htmlUrl
  });
}

function validatePublishPayload(payload) {
  if (!payload || !Array.isArray(payload.halls)) {
    throw new HttpError(400, "Список залов не передан.");
  }

  if (payload.halls.length > 30) {
    throw new HttpError(400, "Можно добавить не более 30 залов.");
  }

  const ids = new Set();
  const halls = payload.halls.map((hall) => {
    const id = cleanText(hall.id, 90);
    const title = cleanText(hall.title, 80);
    const description = cleanText(hall.description, 1000);
    const imageInput = Array.isArray(hall.images) ? hall.images : [hall.image];
    const images = imageInput
      .map((image) => cleanText(image, 500))
      .filter(Boolean);
    const tagline = cleanText(hall.tagline || "M HALL", 80);

    if (!/^[a-z0-9-]+$/i.test(id) || ids.has(id)) {
      throw new HttpError(400, "Некорректный идентификатор зала.");
    }

    if (
      !title
      || !description
      || !images.length
      || images.length > 10
      || images.some((image) => !isAllowedImage(image))
    ) {
      throw new HttpError(400, "Проверьте название, описание и фотографии зала.");
    }

    ids.add(id);
    return { id, title, description, image: images[0], images, tagline };
  });

  const uploadsInput = Array.isArray(payload.uploads) ? payload.uploads : [];
  if (uploadsInput.length > 30) {
    throw new HttpError(400, "За один раз можно загрузить не более 30 фотографий.");
  }

  const uploadPaths = new Set();
  let totalUploadLength = 0;
  const uploads = uploadsInput.map((upload) => {
    const path = cleanText(upload.path, 220);
    const content = String(upload.content || "");

    if (
      !/^assets\/photos\/[a-z0-9-]+\.webp$/i.test(path)
      || uploadPaths.has(path)
      || !/^[a-zA-Z0-9+/=]+$/.test(content)
      || !isWebpBase64(content)
    ) {
      throw new HttpError(400, "Некорректная фотография.");
    }

    if (content.length > 4 * 1024 * 1024) {
      throw new HttpError(413, "Одна из фотографий слишком большая.");
    }

    totalUploadLength += content.length;
    uploadPaths.add(path);
    return { path, content };
  });

  if (totalUploadLength > 14 * 1024 * 1024) {
    throw new HttpError(413, "Общий объём фотографий слишком большой.");
  }

  const referencedImages = new Set(halls.flatMap((hall) => hall.images));
  for (const path of uploadPaths) {
    if (!referencedImages.has(path)) {
      throw new HttpError(400, "Загружена фотография, которая не используется.");
    }
  }

  const deletedImages = [
    ...new Set(
      (Array.isArray(payload.deletedImages) ? payload.deletedImages : [])
        .map((path) => cleanText(path, 220))
        .filter((path) => /^assets\/photos\/[a-z0-9-]+\.webp$/i.test(path))
    )
  ].filter((path) => !referencedImages.has(path) && !uploadPaths.has(path));

  return { halls, uploads, deletedImages };
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isAllowedImage(value) {
  return /^assets\/photos\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(value);
}

function isWebpBase64(value) {
  if (!value || value.length % 4 !== 0) return false;

  try {
    const binary = atob(value);
    return (
      binary.length >= 12
      && binary.slice(0, 4) === "RIFF"
      && binary.slice(8, 12) === "WEBP"
    );
  } catch {
    return false;
  }
}

function githubConfig(env) {
  return {
    owner: env.GITHUB_OWNER || DEFAULT_GITHUB_OWNER,
    repo: env.GITHUB_REPO || DEFAULT_GITHUB_REPO,
    branch: env.GITHUB_BRANCH || DEFAULT_GITHUB_BRANCH
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
  const contentBlob = await githubRequest(env, `${repoPath}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content, encoding: "utf-8" })
  });

  const uploadEntries = await Promise.all(
    payload.uploads.map(async (upload) => {
      const blob = await githubRequest(env, `${repoPath}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: upload.content, encoding: "base64" })
      });

      return {
        path: upload.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha
      };
    })
  );

  const deleteEntries = payload.deletedImages
    .filter((path) => existingPaths.has(path))
    .map((path) => ({
      path,
      mode: "100644",
      type: "blob",
      sha: null
    }));

  const tree = await githubRequest(env, `${repoPath}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: [
        {
          path: "content/halls.json",
          mode: "100644",
          type: "blob",
          sha: contentBlob.sha
        },
        ...uploadEntries,
        ...deleteEntries
      ]
    })
  });

  const newCommit = await githubRequest(env, `${repoPath}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: "Update M HALL halls from admin",
      tree: tree.sha,
      parents: [headSha]
    })
  });

  await githubRequest(env, `${repoPath}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: JSON.stringify({
      sha: newCommit.sha,
      force: false
    })
  });

  return {
    sha: newCommit.sha,
    htmlUrl: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`
  };
}

async function getGitHubContentFile(env, path) {
  const { owner, repo, branch } = githubConfig(env);
  return githubRequest(
    env,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`
  );
}

function base64ToUtf8(value) {
  const binary = atob(String(value).replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return decoder.decode(bytes);
}

async function githubRequest(env, path, options = {}) {
  if (!env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not configured.");
  }

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
    try {
      data = JSON.parse(body);
    } catch {
      data = {};
    }
  }

  if (!response.ok) {
    console.error("GitHub API error", response.status, data.message || body);

    if (response.status === 409 || response.status === 422) {
      throw new HttpError(409, "Сайт изменился во время сохранения. Обновите страницу и повторите.");
    }

    throw new Error(`GitHub API request failed: ${response.status}`);
  }

  return data;
}

export const __test__ = Object.freeze({
  htmlToPlainText,
  isTelegramParseError,
  isRetryableTelegramError,
  isValidBookingDate,
  isWebpBase64,
  validateBookingPayload,
  validatePublishPayload
});
