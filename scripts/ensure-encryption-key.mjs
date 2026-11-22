import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  if (!content.includes("GOOGLE_TOKEN_ENCRYPTION_KEY")) {
    const key = crypto.randomBytes(32).toString("hex");
    fs.appendFileSync(
      envPath,
      `\n# AES-256-GCM Token Encryption Key for Google OAuth\nGOOGLE_TOKEN_ENCRYPTION_KEY="${key}"\n`,
    );
    console.log("Successfully added GOOGLE_TOKEN_ENCRYPTION_KEY to .env");
  } else {
    console.log("GOOGLE_TOKEN_ENCRYPTION_KEY already present in .env");
  }
} else {
  console.log(".env not found");
}
