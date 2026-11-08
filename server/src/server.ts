import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";
import { authorize } from "./auth.ts";

const KEYWORDS_PATH = path.join(process.cwd(), "keywords.json");
const PORT = 4317;
const LABEL_TEXT = "#ffffff";
const LABEL_COLORS = ["#fb4c2f", "#a479e2", "#ffad47", "#16a766", "#4a86e8"] as const;
const IMPORTANT_LABEL = "IMPORTANT";
const CALL_DELAY_MS = 250;

type GmailClient = ReturnType<typeof google.gmail>;

type KeywordRule = {
  word: string;
  from: string[];
};

type StoredKeyword = string | { word: string; from: string | string[] };

type Hit = {
  keyword: string;
  subject: string;
  from: string;
  label: string;
  isNew: boolean;
};

type ScanReport = {
  hits: Hit[];
  skippedCount: number;
  perKeywordCounts: Record<string, number>;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function header(
  headers: { name?: string | null; value?: string | null }[] | undefined,
  name: string
): string {
  const found = headers?.find(
    (item) => item.name?.toLowerCase() === name.toLowerCase()
  );
  return found?.value ?? "(none)";
}

function cleanKeyword(value: string): string | undefined {
  const word = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9 -]{0,40}$/.test(word)) {
    return undefined;
  }
  return word;
}

function cleanSender(value: string): string | undefined {
  const sender = value.trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(sender)) {
    return undefined;
  }
  return sender;
}

function parseRule(entry: unknown): KeywordRule | undefined {
  if (typeof entry === "string") {
    const word = cleanKeyword(entry);
    return word ? { word, from: [] } : undefined;
  }
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  const record = entry as { word?: unknown; from?: unknown };
  const word = cleanKeyword(typeof record.word === "string" ? record.word : "");
  if (!word) {
    return undefined;
  }
  const from: string[] = [];
  if (typeof record.from === "string") {
    const sender = cleanSender(record.from);
    if (sender) {
      from.push(sender);
    }
  } else if (Array.isArray(record.from)) {
    for (const item of record.from) {
      if (typeof item !== "string") {
        continue;
      }
      const sender = cleanSender(item);
      if (sender) {
        from.push(sender);
      }
    }
  }
  return { word, from };
}

function storeRule(rule: KeywordRule): StoredKeyword {
  if (rule.from.length === 0) {
    return rule.word;
  }
  if (rule.from.length === 1) {
    return { word: rule.word, from: rule.from[0] ?? "" };
  }
  return { word: rule.word, from: rule.from };
}

async function loadRules(): Promise<KeywordRule[]> {
  try {
    const parsed = JSON.parse(await readFile(KEYWORDS_PATH, "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      return [{ word: "invoice", from: [] }];
    }
    return parsed.flatMap((entry) => {
      const rule = parseRule(entry);
      return rule ? [rule] : [];
    });
  } catch {
    return [{ word: "invoice", from: [] }];
  }
}

async function saveRules(rules: KeywordRule[]): Promise<void> {
  const stored = rules.map((rule) => storeRule(rule));
  await writeFile(KEYWORDS_PATH, JSON.stringify(stored, null, 2));
}

function colorForKeyword(word: string): string {
  let sum = 0;
  for (let index = 0; index < word.length; index += 1) {
    sum = (sum + word.charCodeAt(index)) % LABEL_COLORS.length;
  }
  return LABEL_COLORS[sum] ?? LABEL_COLORS[0];
}

function scanDays(): number {
  const parsed = Number(process.env.SCAN_DAYS ?? "1");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
    return 1;
  }
  return parsed;
}

function pollMinutes(): number {
  const parsed = Number(process.env.POLL_MINUTES ?? "0");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
}

function keywordQuery(rule: KeywordRule, days: number): string {
  const quoted = `"${rule.word.replaceAll('"', "")}"`;
  let query = `in:inbox ${quoted} newer_than:${days}d`;
  if (rule.from.length === 1) {
    query += ` from:${rule.from[0]}`;
  } else if (rule.from.length > 1) {
    query += ` from:(${rule.from.join(" OR ")})`;
  }
  return query;
}

async function listMessageIds(gmail: GmailClient, query: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const listed = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 100,
      pageToken,
    });
    for (const message of listed.data.messages ?? []) {
      if (message.id) {
        ids.push(message.id);
      }
    }
    pageToken = listed.data.nextPageToken ?? undefined;
    if (pageToken) {
      await delay(CALL_DELAY_MS);
    }
  } while (pageToken);
  return ids;
}

async function ensureLabel(gmail: GmailClient, word: string): Promise<string> {
  const name = `Keyword/${word}`;
  const background = colorForKeyword(word);
  const listed = await gmail.users.labels.list({ userId: "me" });
  await delay(CALL_DELAY_MS);
  const existing = listed.data.labels?.find((label) => label.name === name);
  if (existing?.id) {
    if (!existing.color?.backgroundColor) {
      await gmail.users.labels.patch({
        userId: "me",
        id: existing.id,
        requestBody: {
          color: { backgroundColor: background, textColor: LABEL_TEXT },
        },
      });
      await delay(CALL_DELAY_MS);
    }
    return existing.id;
  }
  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
      color: { backgroundColor: background, textColor: LABEL_TEXT },
    },
  });
  await delay(CALL_DELAY_MS);
  if (!created.data.id) {
    throw new Error(`Could not create label ${name}`);
  }
  return created.data.id;
}

async function applyLabels(
  gmail: GmailClient,
  messageIds: string[],
  labelIds: string[]
): Promise<void> {
  for (let index = 0; index < messageIds.length; index += 1000) {
    const ids = messageIds.slice(index, index + 1000);
    if (ids.length === 0) {
      continue;
    }
    await gmail.users.messages.batchModify({
      userId: "me",
      requestBody: { ids, addLabelIds: labelIds },
    });
    await delay(CALL_DELAY_MS);
  }
}

async function scan(): Promise<ScanReport> {
  const auth = await authorize();
  const gmail = google.gmail({ version: "v1", auth });
  const rules = await loadRules();
  const days = scanDays();
  const inboxIds = await listMessageIds(gmail, `in:inbox newer_than:${days}d`);
  const matched = new Set<string>();
  const hits: Hit[] = [];
  const perKeywordCounts: Record<string, number> = {};

  for (const rule of rules) {
    perKeywordCounts[rule.word] = 0;
    const labelName = `Keyword/${rule.word}`;
    const labelId = await ensureLabel(gmail, rule.word);
    const ids = await listMessageIds(gmail, keywordQuery(rule, days));
    for (const id of ids) {
      matched.add(id);
      perKeywordCounts[rule.word] += 1;
      const message = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From", "Subject"],
      });
      await delay(CALL_DELAY_MS);
      const headers = message.data.payload?.headers;
      hits.push({
        keyword: rule.word,
        subject: header(headers, "Subject"),
        from: header(headers, "From"),
        label: labelName,
        isNew: !message.data.labelIds?.includes(labelId),
      });
    }
    await applyLabels(gmail, ids, [labelId, IMPORTANT_LABEL]);
  }

  const skippedCount = inboxIds.filter((id) => !matched.has(id)).length;
  return { hits, skippedCount, perKeywordCounts };
}

let scanInProgress = false;

async function runScan(): Promise<ScanReport> {
  if (scanInProgress) {
    throw new Error("A scan is already running.");
  }
  scanInProgress = true;
  try {
    return await scan();
  } finally {
    scanInProgress = false;
  }
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
  <p>Saved words are checked against the inbox. A hit gets a colored label and Gmail's Important marker.</p>
  <label for="keyword">Add a keyword</label>
  <input id="keyword" value="invoice" />
  <button id="save" type="button">Save keyword</button>
  <button id="scan" type="button">Check inbox</button>
  <p id="status"></p>
  <p id="counts"></p>
  <ul id="hits"></ul>
  <script>
    const status = document.querySelector("#status");
    const counts = document.querySelector("#counts");
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
      counts.textContent = "";
      hits.innerHTML = "";
      const response = await fetch("/scan", { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        status.textContent = body.error;
        return;
      }
      const summary = Object.entries(body.perKeywordCounts)
        .map(([word, count]) => word + " " + count)
        .join(" · ");
      status.textContent = body.hits.length + " hit(s), " + body.skippedCount + " skipped.";
      counts.textContent = summary;
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
      const rules = await loadRules();
      sendJson(response, 200, { keywords: rules.map((rule) => rule.word) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/keywords") {
      const payload = JSON.parse(await readBody(request)) as { keyword?: string };
      const word = cleanKeyword(payload.keyword ?? "");
      if (!word) {
        sendJson(response, 400, { error: "Use a short word or phrase, with no slash." });
        return;
      }
      const rules = await loadRules();
      if (!rules.some((rule) => rule.word === word)) {
        rules.push({ word, from: [] });
        await saveRules(rules);
      }
      sendJson(response, 200, { keywords: rules.map((rule) => rule.word) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/scan") {
      sendJson(response, 200, await runScan());
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
  const minutes = pollMinutes();
  if (minutes === 0) {
    console.log("Automatic scan is off. Set POLL_MINUTES to turn it on.");
    return;
  }
  console.log("Automatic scan every " + minutes + " minute(s).");
  setInterval(() => {
    void runScan()
      .then((report) => {
        for (const hit of report.hits) {
          if (hit.isNew) {
            console.log("New hit: " + hit.label + " — " + hit.subject);
          }
        }
      })
      .catch((error: unknown) => {
        console.error(error);
      });
  }, minutes * 60 * 1000);
});