import assert from "node:assert/strict";
import worker, { __test__ } from "./telegram-booking-worker.js";

const validHall = (image = "assets/photos/test.webp") => ({
  id: "test-hall",
  title: "Тестовый зал",
  description: "Описание тестового зала",
  tagline: "M HALL",
  images: [image]
});
const webp = Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ").toString("base64");

assert.throws(
  () => __test__.validateBookingPayload({
    name: "Иван",
    phone: "+375291234567",
    event: "Свадьба",
    guests: "12 человек",
    date: "2030-01-01"
  }),
  /количество гостей/
);
assert.throws(
  () => __test__.validateBookingPayload({
    name: "Иван",
    phone: "+375291234567",
    event: "Свадьба",
    guests: "12",
    date: "2030-02-30"
  }),
  /дату мероприятия/
);
assert.throws(
  () => __test__.validatePublishPayload({ halls: [validHall("https://example.com/hall.webp")] }),
  /фотографии зала/
);
assert.throws(
  () => __test__.validatePublishPayload({
    halls: [validHall()],
    uploads: [{ path: "assets/photos/test.webp", content: Buffer.from("not an image").toString("base64") }]
  }),
  /Некорректная фотография/
);

const result = __test__.validatePublishPayload({
  halls: [validHall()],
  uploads: [{ path: "assets/photos/test.webp", content: webp }]
});
assert.equal(result.uploads.length, 1);
assert.equal(__test__.isWebpBase64(webp), true);

const password = "only-for-security-test";
const passwordHash = "2f1b4159afa2128c56a04a699d380ebe4cbf8b09c19b03528de13374ffd673b7";
const env = {
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD_HASH: passwordHash,
  SESSION_SECRET: "security-test-session-secret",
  ALLOWED_ORIGINS: "https://admin.example",
  LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  BOOKING_RATE_LIMITER: { limit: async () => ({ success: true }) }
};

const loginResponse = await worker.fetch(new Request("https://worker.example/api/login", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://admin.example" },
  body: JSON.stringify({ username: "admin", password })
}), env);
assert.equal(loginResponse.status, 200);
const { token } = await loginResponse.json();
assert.ok(token);

const sessionResponse = await worker.fetch(new Request("https://worker.example/api/session", {
  headers: { Authorization: `Bearer ${token}`, Origin: "https://admin.example" }
}), env);
assert.equal(sessionResponse.status, 200);

const legacyEnv = {
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: password,
  GITHUB_TOKEN: "legacy-session-signing-secret",
  ALLOWED_ORIGINS: "https://admin.example",
  LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) }
};
const legacyLoginResponse = await worker.fetch(new Request("https://worker.example/api/login", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://admin.example" },
  body: JSON.stringify({ username: "admin", password })
}), legacyEnv);
assert.equal(legacyLoginResponse.status, 200);
const { token: legacyToken } = await legacyLoginResponse.json();
const legacySessionResponse = await worker.fetch(new Request("https://worker.example/api/session", {
  headers: { Authorization: `Bearer ${legacyToken}`, Origin: "https://admin.example" }
}), legacyEnv);
assert.equal(legacySessionResponse.status, 200);

const blockedLogin = await worker.fetch(new Request("https://worker.example/api/login", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://admin.example" },
  body: JSON.stringify({ username: "admin", password })
}), { ...env, LOGIN_RATE_LIMITER: { limit: async () => ({ success: false }) } });
assert.equal(blockedLogin.status, 429);

const blockedBooking = await worker.fetch(new Request("https://worker.example/api/booking", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({})
}), env);
assert.equal(blockedBooking.status, 403);

assert.equal(
  __test__.htmlToPlainText("<b>Имя:</b> Иван &lt;VIP&gt; &amp; Анна"),
  "Имя: Иван <VIP> & Анна"
);
assert.equal(
  __test__.isTelegramParseError(400, "Bad Request: can't parse entities"),
  true
);
assert.equal(__test__.isRetryableTelegramError(429, 429), true);
assert.equal(__test__.isRetryableTelegramError(400, 400), false);

const telegramEnv = {
  ...env,
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_CHAT_ID: "-1001234567890"
};
const bookingRequest = () => new Request("https://worker.example/api/booking", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://admin.example"
  },
  body: JSON.stringify({
    name: "Иван <VIP>",
    phone: "+375291234567",
    eventType: "Свадьба",
    guests: "12",
    date: "2030-01-01",
    comment: "Тест доставки",
    venue: "M HALL Минск",
    website: ""
  })
});
const originalFetch = globalThis.fetch;

try {
  const sentBodies = [];
  globalThis.fetch = async (_url, options) => {
    sentBodies.push(JSON.parse(options.body));
    if (sentBodies.length === 1) {
      return Response.json({
        ok: false,
        error_code: 400,
        description: "Bad Request: can't parse entities"
      }, { status: 400 });
    }
    return Response.json({ ok: true, result: { message_id: 1 } });
  };

  const fallbackResponse = await worker.fetch(bookingRequest(), telegramEnv);
  assert.equal(fallbackResponse.status, 200);
  assert.equal(sentBodies.length, 2);
  assert.equal(sentBodies[0].parse_mode, "HTML");
  assert.equal("parse_mode" in sentBodies[1], false);
  assert.match(sentBodies[1].text, /Иван <VIP>/);

  let retryCalls = 0;
  globalThis.fetch = async () => {
    retryCalls += 1;
    if (retryCalls === 1) {
      return Response.json({
        ok: false,
        error_code: 429,
        description: "Too Many Requests",
        parameters: { retry_after: 0 }
      }, { status: 429 });
    }
    return Response.json({ ok: true, result: { message_id: 2 } });
  };

  const retryResponse = await worker.fetch(bookingRequest(), telegramEnv);
  assert.equal(retryResponse.status, 200);
  assert.equal(retryCalls, 2);

  const migratedBodies = [];
  globalThis.fetch = async (_url, options) => {
    migratedBodies.push(JSON.parse(options.body));
    if (migratedBodies.length === 1) {
      return Response.json({
        ok: false,
        error_code: 400,
        description: "Bad Request: group chat was upgraded",
        parameters: { migrate_to_chat_id: -1009876543210 }
      }, { status: 400 });
    }
    return Response.json({ ok: true, result: { message_id: 3 } });
  };

  const migratedResponse = await worker.fetch(bookingRequest(), telegramEnv);
  assert.equal(migratedResponse.status, 200);
  assert.equal(migratedBodies.length, 2);
  assert.equal(migratedBodies[1].chat_id, "-1009876543210");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Worker security and Telegram delivery tests passed.");
