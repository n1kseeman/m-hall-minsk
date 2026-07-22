const ALLOWED_ORIGINS = new Set([
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

function jsonResponse(body, status = 200, origin = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin)
    }
  });
}

function clean(value, maxLength = 500) {
  return String(value || "")
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

async function readPayload(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  const formData = await request.formData();
  return Object.fromEntries(formData.entries());
}

function buildTelegramMessage(payload) {
  const data = {
    venue: clean(payload.venue || "M HALL Минск", 80),
    name: clean(payload.name, 120),
    phone: clean(payload.phone, 80),
    event: clean(payload.event, 120),
    guests: clean(payload.guests, 20),
    date: clean(payload.date, 40),
    message: clean(payload.message, 900)
  };

  const required = ["name", "phone", "event", "guests", "date"];
  const missing = required.filter((field) => !data[field]);
  if (missing.length) {
    return {
      error: `Missing required fields: ${missing.join(", ")}`
    };
  }

  const lines = [
    "<b>Новая заявка с сайта</b>",
    "",
    ...Object.entries(data)
      .filter(([, value]) => value)
      .map(([key, value]) => `<b>${FIELD_LABELS[key] || key}:</b> ${escapeHtml(value)}`)
  ];

  return {
    text: lines.join("\n")
  };
}

async function sendTelegram(env, text) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return {
      ok: false,
      status: 500,
      error: "Telegram secrets are not configured"
    };
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: await response.text()
    };
  }

  return {
    ok: true
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin)
      });
    }

    const url = new URL(request.url);

    if (url.pathname.startsWith("/admin/")) {
      return handleAdmin(request, env, origin, url);
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405, origin);
    }

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse({ ok: false, error: "Origin is not allowed" }, 403, origin);
    }

    try {
      const payload = await readPayload(request);
      const message = buildTelegramMessage(payload);

      if (message.error) {
        return jsonResponse({ ok: false, error: message.error }, 400, origin);
      }

      const telegram = await sendTelegram(env, message.text);
      if (!telegram.ok) {
        console.error("Telegram send failed", telegram);
        return jsonResponse({ ok: false, error: "Telegram send failed" }, 502, origin);
      }

      return jsonResponse({ ok: true }, 200, origin);
    } catch (error) {
      console.error(error);
      return jsonResponse({ ok: false, error: "Unexpected error" }, 500, origin);
    }
  }
};
