// Same session flow as grokSentence() in add-on/Code.js:
// POST /v1/session, then poll /v1/session/:id/events?format=json.

export type AlertBotRequest = {
  keyword: string;
  from: string;
  subject: string;
  snippet: string;
};

const TIMEOUT_MS = 20_000;
const POLL_MS = 500;

type SessionBody = {
  sessionId?: unknown;
};

type BotEvent = {
  type?: unknown;
  data?: { text?: unknown };
};

type EventsBody = {
  events?: BotEvent[];
};

export function alertBotFallback(input: AlertBotRequest): string {
  return `Normal: New ${input.keyword} email from ${input.from}: ${input.subject}.`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function botBaseUrl(): string | undefined {
  const base = process.env.ALERT_BOT_URL?.trim().replace(/\/+$/, "");
  return base ? base : undefined;
}

function messageFor(input: AlertBotRequest): string {
  return `Keyword: ${input.keyword}. From: ${input.from}. Subject: ${input.subject}. Snippet: ${input.snippet}.`;
}

type PollResult =
  | { kind: "text"; text: string }
  | { kind: "failed" }
  | { kind: "pending" };

function classifyEvents(events: BotEvent[]): PollResult {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "message.completed" && typeof event.data?.text === "string") {
      const text = event.data.text.trim();
      if (text) {
        return { kind: "text", text };
      }
    }
  }
  const failed = events.some((event) => {
    const type = typeof event.type === "string" ? event.type : "";
    return type === "turn.failed" || type.endsWith(".failed");
  });
  return failed ? { kind: "failed" } : { kind: "pending" };
}

async function readEvents(
  base: string,
  sessionId: string,
  deadline: number
): Promise<PollResult> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    return { kind: "pending" };
  }
  const response = await fetch(
    `${base}/v1/session/${sessionId}/events?format=json`,
    { signal: AbortSignal.timeout(remaining) }
  );
  if (response.status !== 200) {
    return { kind: "pending" };
  }
  const body = (await response.json()) as EventsBody;
  return classifyEvents(body.events ?? []);
}

async function askAlertBotInner(input: AlertBotRequest): Promise<string> {
  const fallback = alertBotFallback(input);
  const base = botBaseUrl();
  if (!base) {
    return fallback;
  }

  const deadline = Date.now() + TIMEOUT_MS;
  const remaining = deadline - Date.now();
  const started = await fetch(`${base}/v1/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ message: messageFor(input) }),
    signal: AbortSignal.timeout(remaining),
  });
  if (started.status !== 200) {
    return fallback;
  }

  const session = (await started.json()) as SessionBody;
  const sessionId = session.sessionId;
  if (typeof sessionId !== "string" || !/^[\w-]+$/.test(sessionId)) {
    return fallback;
  }

  while (Date.now() < deadline) {
    const wait = Math.min(POLL_MS, deadline - Date.now());
    if (wait > 0) {
      await sleep(wait);
    }
    if (Date.now() >= deadline) {
      break;
    }
    try {
      const result = await readEvents(base, sessionId, deadline);
      if (result.kind === "text") {
        return result.text;
      }
      if (result.kind === "failed") {
        return fallback;
      }
    } catch {
      // A failed poll keeps waiting until the 20 second deadline.
    }
  }
  return fallback;
}

export async function askAlertBot(input: AlertBotRequest): Promise<string> {
  try {
    return await askAlertBotInner(input);
  } catch {
    return alertBotFallback(input);
  }
}
