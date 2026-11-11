#!/usr/bin/env node
// healthmanager MCP server — stdio transport
// Authenticate with email+password, then CRUD people & files.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.HEALTHMANAGER_URL || "https://health.beenex.company";
const EMAIL = process.env.HEALTHMANAGER_EMAIL;
const PASSWORD = process.env.HEALTHMANAGER_PASSWORD;

let sessionCookie = null;

// ── HTTP helpers ──

async function api(method, path, body, isFormData = false) {
  const headers = {};
  if (sessionCookie) headers["Cookie"] = `session=${sessionCookie}`;
  if (body && !isFormData) headers["Content-Type"] = "application/json";

  const opts = { method, headers };
  if (body) opts.body = isFormData ? body : JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);

  // Grab session cookie from Set-Cookie
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const match = setCookie.match(/session=([^;]+)/);
    if (match && match[1]) sessionCookie = match[1];
  }

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return data;
}

async function ensureAuth() {
  if (sessionCookie) {
    // Verify session is still valid
    try {
      await api("GET", "/api/auth/me");
      return;
    } catch {
      sessionCookie = null;
    }
  }

  if (!EMAIL || !PASSWORD) {
    throw new Error(
      "Set HEALTHMANAGER_EMAIL and HEALTHMANAGER_PASSWORD environment variables."
    );
  }

  await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
}

// ── MCP server ──

const server = new McpServer({
  name: "healthmanager",
  version: "1.0.0",
});

// -- list_people --
server.tool("list_people", "List all people in healthmanager.", {}, async () => {
  await ensureAuth();
  const people = await api("GET", "/api/people");
  return {
    content: [{ type: "text", text: JSON.stringify(people, null, 2) }],
  };
});

// -- create_person --
server.tool(
  "create_person",
  "Add a new person to track medical files for.",
  { name: z.string().describe("The person's name") },
  async ({ name }) => {
    await ensureAuth();
    const person = await api("POST", "/api/people", { name });
    return {
      content: [{ type: "text", text: JSON.stringify(person, null, 2) }],
    };
  }
);

// -- delete_person --
server.tool(
  "delete_person",
  "Delete a person and all their files.",
  { person_id: z.string().describe("The person's ID") },
  async ({ person_id }) => {
    await ensureAuth();
    const result = await api("DELETE", `/api/people/${person_id}`);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// -- list_files --
server.tool(
  "list_files",
  "List all files for a person.",
  { person_id: z.string().describe("The person's ID") },
  async ({ person_id }) => {
    await ensureAuth();
    const files = await api("GET", `/api/people/${person_id}/files`);
    return {
      content: [{ type: "text", text: JSON.stringify(files, null, 2) }],
    };
  }
);

// -- upload_file --
server.tool(
  "upload_file",
  "Upload a medical file (from local disk) for a person.",
  {
    person_id: z.string().describe("The person's ID"),
    file_path: z.string().describe("Absolute path to the file on disk"),
  },
  async ({ person_id, file_path }) => {
    await ensureAuth();

    const absPath = resolve(file_path);
    const buf = readFileSync(absPath);
    const filename = absPath.split("/").pop() || "file";

    // Determine content type from extension
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeMap = {
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      txt: "text/plain",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    const contentType = mimeMap[ext] || "application/octet-stream";

    const blob = new Blob([buf], { type: contentType });
    const form = new FormData();
    form.append("file", blob, filename);

    const result = await api("POST", `/api/people/${person_id}/files`, form, true);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// -- download_file --
server.tool(
  "download_file",
  "Get the download URL for a file (opens in browser).",
  { file_id: z.string().describe("The file's ID") },
  async ({ file_id }) => {
    await ensureAuth();
    const url = `${BASE}/api/files/${file_id}/download`;
    return {
      content: [{ type: "text", text: `Download URL: ${url}` }],
    };
  }
);

// -- delete_file --
server.tool(
  "delete_file",
  "Delete a medical file.",
  { file_id: z.string().describe("The file's ID") },
  async ({ file_id }) => {
    await ensureAuth();
    const result = await api("DELETE", `/api/files/${file_id}`);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Start ──

const transport = new StdioServerTransport();
await server.connect(transport);
