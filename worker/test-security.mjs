import assert from "node:assert/strict";
import { __test__ } from "./telegram-booking-worker.js";

const webp = Buffer.from("RIFF\0\0\0\0WEBPVP8 ").toString("base64");
const validHall = {
  id: "main-hall",
  title: "Светлый зал",
  description: "Описание зала",
  images: ["assets/photos/main-hall.webp"]
};

assert.equal(__test__.isWebpBase64(webp), true);
assert.throws(() => __test__.validatePublishPayload({ halls: [{ ...validHall, images: ["https://example.com/hall.webp"] }] }), /фотографии зала/);
assert.throws(() => __test__.validatePublishPayload({ halls: [validHall], uploads: [{ path: "assets/photos/main-hall.webp", content: Buffer.from("not-webp").toString("base64") }] }), /Некорректная фотография/);
assert.equal(__test__.validatePublishPayload({ halls: [validHall], uploads: [{ path: "assets/photos/main-hall.webp", content: webp }] }).uploads.length, 1);
console.log("Security validation tests passed.");
