import { createHash, randomBytes } from "node:crypto";

const password = process.argv[2] || randomBytes(24).toString("base64url");
const hash = createHash("sha256").update(password).digest("hex");

console.log(JSON.stringify({
  password,
  hash
}));
