import { Hono } from "hono";
import { todos } from "./data.json";
import { Ratelimit } from "@upstash/ratelimit";
import { BlankEnv, Env } from "hono/types";
import { Context } from "hono";
import { env } from "hono/adapter";
import { Redis } from "@upstash/redis/cloudflare";

declare module "hono" {
  interface ContextVariableMap {
    ratelimit: Ratelimit;
  }
}

const app = new Hono();

const cache = new Map();

class RedisRateLimiter {
  private static instance: Ratelimit;

  static getInstance(c: Context<Env, "/todos/:id", BlankEnv>) {
    if (!this.instance) {
      const { REDIS_URL, REDIS_TOKEN } = env<{
        REDIS_URL: string;
        REDIS_TOKEN: string;
      }>(c);

      try {
        const redisClient = new Redis({
          url: REDIS_URL,
          token: REDIS_TOKEN,
        });

        const ratelimit = new Ratelimit({
          redis: redisClient,
          limiter: Ratelimit.slidingWindow(10, "10 s"),
          ephemeralCache: cache,
        });

        this.instance = ratelimit;
      } catch (error) {
        console.error('Failed to initialize RedisRateLimiter:', error);
        throw error;
      }
    }

    return this.instance;
  }
}

app.use(async (c, next) => {
  const ratelimit = RedisRateLimiter.getInstance(c);
  c.set("ratelimit", ratelimit);

  // Uncomment the following line if you want to limit requests here
  // await ratelimit.limit(c.req.ip());

  await next();
});

app.get("/todos/:id", async (c) => {
  const ratelimit = c.get("ratelimit");
  const ip = c.req.raw.headers.get("CF-Connecting-IP") || "anonymous";
  const { success } = await ratelimit.limit(ip);

  if (success) {
    const id = c.req.param("id");
    const todoIndex = Number(id);
    const todo = todos[todoIndex] || {};
    return c.json(todo);
  } else {
    return c.text("Too many requests", 429);
  }
});

export default app;
