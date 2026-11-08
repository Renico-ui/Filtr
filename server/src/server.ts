import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";
import { authorize } from "./auth.ts";

const KEYWORDS_PATH = path.join(process.cwd(), "keywords.json");
const PORT = 4317;

type Hit = { keyword: string; subject: string; from: string; label: string };

function header(
  headers: { name?: string | null; value?: string | null }[] | undefined,
  name: string
): string {
  const found = headers?.find(
    (item) => item.name?.toLowerCase() === name.toLowerCase()
  );
  return found?.value ?? "(none)";
}

async function loadKeywords(): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(KEYWORDS_PATH, "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      return ["invoice"];
    }
    return parsed.map((word) => String(word).toLowerCase());
  } catch {
    return ["invoice"];
  }
}

async function saveKeywords(keywords: string[]): Promise<void> {
  await writeFile(KEYWORDS_PATH, JSON.stringify(keywords, null, 2));
}

function cleanKeyword(value: string): string | undefined {
  const word = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9 -]{0,40}$/.test(word)) {
    return undefined;
  }
  return word;
}

async function ensureLabel(
  gmail: ReturnType<typeof google.gmail>,
  name: string
): Promise<string> {
  const listed = await gmail.users.labels.list({ userId: "me" });
  const existing = listed.data.labels?.find((label) => label.name === name);
  if (existing?.id) {
    return existing.id;
  }
  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
  if (!created.data.id) {
    throw new Error(`Could not create label ${name}`);
  }
  return created.data.id;
}

async function scan(): Promise<Hit[]> {
  const auth = await authorize();
  const gmail = google.gmail({ version: "v1", auth });
  const keywords = await loadKeywords();
  const list = await gmail.users.messages.list({
    userId: "me",
    maxResults: 15,
    q: "in:inbox",
  });
  const hits: Hit[] = [];
  for (const item of list.data.messages ?? []) {
    if (!item.id) {
      continue;
    }
    const message = await gmail.users.messages.get({
      userId: "me",
      id: item.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject"],
    });
    const headers = message.data.payload?.headers;
    const subject = header(headers, "Subject");
    const preview = message.data.snippet ?? "";
    const haystack = `${subject}\n${preview}`.toLowerCase();
    for (const keyword of keywords) {
      if (!haystack.includes(keyword)) {
        continue;
      }
      const label = `Keyword/${keyword}`;
      const labelId = await ensureLabel(gmail, label);
      await gmail.users.messages.modify({
        userId: "me",
        id: item.id,
        requestBody: { addLabelIds: [labelId] },
      });
      hits.push({
        keyword,
        subject,
        from: header(headers, "From"),
        label,
      });
    }
  }
  return hits;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Keyword alerts</title>
  <style>
    body { font-family: Georgia, serif; margin: 2rem auto; max-width: 36rem; color: #1c1917; }
    button, input { font: inherit; }
    input { width: 100%; padding: 0.5rem; margin: 0.5rem 0 1rem; }
    button { background: #1c1917; color: white; border: 0; padding: 0.5rem 0.8rem; margin-right: 0.5rem; }
    li { margin: 0.8rem 0; }
    #status { min-height: 1.5rem; }
  </style>
</head>
<body>
  <h1>Keyword alerts</h1>
  <p>Saved words are checked against the inbox. A hit gets a Gmail label.</p>
  <label for="keyword">Add a keyword</label>
  <input id="keyword" value="invoice" />
  <button id="save" type="button">Save keyword</button>
  <button id="scan" type="button">Check inbox</button>
  <p id="status"></p>
  <ul id="hits"></ul>
  <script>
    const status = document.querySelector("#status");
    const hits = document.querySelector("#hits");
    document.querySelector("#save").onclick = async () => {
      status.textContent = "Saving…";
      const response = await fetch("/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: document.querySelector("#keyword").value })
      });
      const body = await response.json();
      status.textContent = response.ok
        ? "Saved: " + body.keywords.join(", ")
        : body.error;
    };
    document.querySelector("#scan").onclick = async () => {
      status.textContent = "Checking the inbox…";
      hits.innerHTML = "";
      const response = await fetch("/scan", { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        status.textContent = body.error;
        return;
      }
      status.textContent = body.hits.length
        ? body.hits.length + " hit(s). Open Gmail and look for the label."
        : "No hits in the latest 15 inbox messages.";
      for (const hit of body.hits) {
        const item = document.createElement("li");
        item.textContent = hit.label + " — " + hit.subject + " — " + hit.from;
        hits.appendChild(item);
      }
    };
  </script>
</body>
</html>`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(page);
      return;
    }
    if (request.method === "GET" && url.pathname === "/keywords") {
      sendJson(response, 200, { keywords: await loadKeywords() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/keywords") {
      const payload = JSON.parse(await readBody(request)) as { keyword?: string };
      const word = cleanKeyword(payload.keyword ?? "");
      if (!word) {
        sendJson(response, 400, { error: "Use a short word or phrase, with no slash." });
        return;
      }
      const keywords = await loadKeywords();
      if (!keywords.includes(word)) {
        keywords.push(word);
        await saveKeywords(keywords);
      }
      sendJson(response, 200, { keywords });
      return;
    }
    if (request.method === "POST" && url.pathname === "/scan") {
      sendJson(response, 200, { hits: await scan() });
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan failed";
    sendJson(response, 500, { error: message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Keyword alerts at http://127.0.0.1:" + PORT);
});