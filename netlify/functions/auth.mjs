/**
 * Netlify Function: /api/auth
 * 密码验证 — 比对 ACCESS_PASSWORD 环境变量，返回时效 token
 */

// 简单的 HMAC-SHA256 签名 token：timestamp:signature
async function createToken(password) {
  const timestamp = Date.now();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}:${password}`)
  );
  const sigHex = [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${timestamp}:${sigHex}`;
}

async function verifyToken(token, password) {
  const parts = token.split(":");
  if (parts.length !== 2) return false;
  const timestamp = Number(parts[0]);
  if (!timestamp || Date.now() - timestamp > 24 * 60 * 60 * 1000) return false;
  const expected = await createTokenWithTimestamp(timestamp, password);
  // 常量时间比较
  return timingSafeEqual(token, expected);
}

async function createTokenWithTimestamp(timestamp, password) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}:${password}`)
  );
  const sigHex = [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${timestamp}:${sigHex}`;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export default async function handler(request) {
  // ---------- CORS ----------
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const password = process.env.ACCESS_PASSWORD?.trim();

  // ---------- GET: 检查是否需要密码 ----------
  if (request.method === "GET") {
    return new Response(JSON.stringify({ required: Boolean(password) }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // ---------- POST: 验证密码 ----------
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "仅支持 POST / GET" }), {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // 验证 token（用于页面刷新时检查已有 token 是否有效）
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ valid: false, error: "无效请求" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  // 验证已有 token
  if (body.token && password) {
    const valid = await verifyToken(body.token, password);
    return new Response(JSON.stringify({ valid }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  // 密码验证
  if (!password) {
    return new Response(JSON.stringify({ valid: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  if (!body.password) {
    return new Response(JSON.stringify({ valid: false, error: "请输入密码" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  if (body.password !== password) {
    return new Response(JSON.stringify({ valid: false, error: "密码错误" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const token = await createToken(password);
  return new Response(JSON.stringify({ valid: true, token }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
