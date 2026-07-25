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

console.log("Security validation tests passed.");
