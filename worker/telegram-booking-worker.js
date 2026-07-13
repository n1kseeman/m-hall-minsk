const ALLOWED_ORIGINS = new Set([
  "https://n1kseeman.github.io",
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

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://n1kseeman.github.io";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
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
