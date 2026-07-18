import { Redis } from "@upstash/redis";
import dotenv from "dotenv";
import path from "path";

// Load env files
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!redisUrl || !redisToken) {
  console.log("Redis not configured. Skipping ban clear.");
  process.exit(0);
}

const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

async function clearBans() {
  try {
    const keys = [
      "ban:::1",
      "ban:127.0.0.1",
      "violations:::1",
      "violations:127.0.0.1"
    ];
    for (const key of keys) {
      await redis.del(key);
      console.log(`Deleted Redis key: ${key}`);
    }
  } catch (err) {
    console.error("Failed to clear Redis bans:", err);
  }
}

clearBans().then(() => process.exit(0));
