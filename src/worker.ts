interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, status);
}

// Simple path matcher: returns params or null
function matchRoute(
  method: string,
  pattern: string,
  req: { method: string; pathname: string }
): Record<string, string> | null {
  if (req.method !== method) return null;

  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = req.pathname.split("/").filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

// ── Auth helpers ──

async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function getTokenFromRequest(request: Request): string | null {
  // Check Authorization header first
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  // Check cookie
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? match[1] : null;
}

async function getSessionUser(token: string | null, env: Env): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  const session = await env.DB.prepare(
    "SELECT s.*, u.email, u.id as user_id FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime('now')"
  ).bind(token).first();
  return session;
}

// ── Auth handlers ──

async function register(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ email?: string; password?: string }>();
  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !password) {
    return errorResponse("email and password are required");
  }
  if (password.length < 6) {
    return errorResponse("password must be at least 6 characters");
  }

  // Check if email already exists
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) {
    return errorResponse("email already registered");
  }

  const id = crypto.randomUUID();
  const salt = crypto.randomUUID();
  const hash = await hashPassword(password, salt);

  await env.DB.prepare("INSERT INTO users (id, email, password_hash, salt) VALUES (?, ?, ?, ?)")
    .bind(id, email, hash, salt)
    .run();

  // Auto-login: create session
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, id, expiresAt)
    .run();

  return json(
    { user: { id, email } },
    201,
    { "Set-Cookie": `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}` }
  );
}

async function login(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ email?: string; password?: string }>();
  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !password) {
    return errorResponse("email and password are required");
  }

  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user) {
    return errorResponse("invalid email or password", 401);
  }

  const hash = await hashPassword(password, user.salt as string);
  if (hash !== user.password_hash) {
    return errorResponse("invalid email or password", 401);
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, user.id as string, expiresAt)
    .run();

  return json(
    { user: { id: user.id, email: user.email } },
    200,
    { "Set-Cookie": `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}` }
  );
}

async function logout(request: Request, env: Env): Promise<Response> {
  const token = getTokenFromRequest(request);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  }
  return json(
    { success: true },
    200,
    { "Set-Cookie": "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" }
  );
}

async function getMe(request: Request, env: Env): Promise<Response> {
  const token = getTokenFromRequest(request);
  const session = await getSessionUser(token, env);
  if (!session) {
    return errorResponse("not authenticated", 401);
  }
  return json({ user: { id: session.user_id, email: session.email } });
}

// ── People handlers ──

async function listPeople(env: Env): Promise<Response> {
  const result = await env.DB.prepare("SELECT * FROM people ORDER BY created_at DESC").all();
  return json(result.results);
}

async function createPerson(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ name?: string }>();
  if (!body.name || typeof body.name !== "string" || body.name.trim() === "") {
    return errorResponse("name is required");
  }

  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO people (id, name) VALUES (?, ?)")
    .bind(id, body.name.trim())
    .run();

  const person = await env.DB.prepare("SELECT * FROM people WHERE id = ?").bind(id).first();
  return json(person, 201);
}

async function deletePerson(id: string, env: Env): Promise<Response> {
  const files = await env.DB.prepare("SELECT * FROM files WHERE person_id = ?").bind(id).all();

  for (const file of files.results) {
    await env.BUCKET.delete(file.r2_key as string);
  }

  await env.DB.prepare("DELETE FROM files WHERE person_id = ?").bind(id).run();

  const result = await env.DB.prepare("DELETE FROM people WHERE id = ?").bind(id).run();

  if (result.meta.changes === 0) {
    return errorResponse("Person not found", 404);
  }

  return json({ success: true });
}

// ── File handlers ──

async function listFiles(personId: string, env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    "SELECT * FROM files WHERE person_id = ? ORDER BY created_at DESC"
  )
    .bind(personId)
    .all();
  return json(result.results);
}

async function uploadFile(personId: string, request: Request, env: Env): Promise<Response> {
  const person = await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(personId).first();
  if (!person) {
    return errorResponse("Person not found", 404);
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return errorResponse("file field is required (multipart/form-data)");
  }

  const fileId = crypto.randomUUID();
  const filename = file.name;
  const contentType = file.type || "application/octet-stream";
  const size = file.size;
  const r2Key = `${personId}/${fileId}/${filename}`;

  await env.BUCKET.put(r2Key, file.stream(), {
    httpMetadata: { contentType },
  });

  await env.DB.prepare(
    "INSERT INTO files (id, person_id, filename, content_type, size, r2_key) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(fileId, personId, filename, contentType, size, r2Key)
    .run();

  const fileMeta = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(fileId).first();
  return json(fileMeta, 201);
}

async function downloadFile(fileId: string, request: Request, env: Env): Promise<Response> {
  const fileMeta = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(fileId).first();
  if (!fileMeta) {
    return errorResponse("File not found", 404);
  }

  const object = await env.BUCKET.get(fileMeta.r2_key as string);
  if (!object) {
    return errorResponse("File not found in storage", 404);
  }

  // Use ?download=1 for force-download, otherwise inline for preview
  const url = new URL(request.url);
  const forceDownload = url.searchParams.get("download") === "1";
  const disposition = forceDownload
    ? `attachment; filename="${fileMeta.filename}"`
    : `inline; filename="${fileMeta.filename}"`;

  return new Response(object.body, {
    headers: {
      "Content-Type": fileMeta.content_type as string,
      "Content-Disposition": disposition,
      ...corsHeaders(),
    },
  });
}

async function deleteFile(fileId: string, env: Env): Promise<Response> {
  const fileMeta = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(fileId).first();
  if (!fileMeta) {
    return errorResponse("File not found", 404);
  }

  await env.BUCKET.delete(fileMeta.r2_key as string);
  await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(fileId).run();

  return json({ success: true });
}

// ── Main fetch handler ──

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Only handle /api routes
    if (!pathname.startsWith("/api/")) {
      return errorResponse("Not found", 404);
    }

    const req = { method: request.method, pathname };
    let params: Record<string, string> | null;

    try {
      // ── Auth routes (public) ──
      params = matchRoute("POST", "/api/auth/register", req);
      if (params) return await register(request, env);

      params = matchRoute("POST", "/api/auth/login", req);
      if (params) return await login(request, env);

      params = matchRoute("POST", "/api/auth/logout", req);
      if (params) return await logout(request, env);

      params = matchRoute("GET", "/api/auth/me", req);
      if (params) return await getMe(request, env);

      // ── Protected routes — require auth ──
      const token = getTokenFromRequest(request);
      const session = await getSessionUser(token, env);
      if (!session) {
        return errorResponse("not authenticated", 401);
      }

      // People routes
      params = matchRoute("GET", "/api/people", req);
      if (params) return await listPeople(env);

      params = matchRoute("POST", "/api/people", req);
      if (params) return await createPerson(request, env);

      params = matchRoute("DELETE", "/api/people/:id", req);
      if (params) return await deletePerson(params.id, env);

      // File routes
      params = matchRoute("GET", "/api/people/:personId/files", req);
      if (params) return await listFiles(params.personId, env);

      params = matchRoute("POST", "/api/people/:personId/files", req);
      if (params) return await uploadFile(params.personId, request, env);

      params = matchRoute("GET", "/api/files/:fileId/download", req);
      if (params) return await downloadFile(params.fileId, request, env);

      params = matchRoute("DELETE", "/api/files/:fileId", req);
      if (params) return await deleteFile(params.fileId, env);

      return errorResponse("Not found", 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      return errorResponse(message, 500);
    }
  },
} satisfies ExportedHandler<Env>;
