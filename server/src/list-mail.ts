import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const TOKEN_PATH = path.join(process.cwd(), "token.json");

const KEYWORDS = (process.env.KEYWORDS ?? "invoice")
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
const MAX_RESULTS = Number(process.env.MAX_RESULTS ?? 20);
function matchedKeyword(subject: string, preview: string): string | undefined {
    const haystack = `${subject}\n${preview}`.toLowerCase();
    return KEYWORDS.find((word) => haystack.includes(word.toLowerCase()));
}

type AuthClient = InstanceType<typeof google.auth.OAuth2>;
type AuthorizedUser = {
    type: "authorized_user";
    client_id: string;
    client_secret: string;
    refresh_token: string;
};
type ClientKeys = {
    installed?: { client_id: string; client_secret: string };
    web?: { client_id: string; client_secret: string };
};
//Print the metadata value
function header(
    headers: { name?: string | null; value?: string | null }[] | undefined,
    name: string
): string {
    const found = headers?.find(
        (item) => item.name?.toLowerCase() === name.toLowerCase()
    );
    return found?.value ?? "(none)";
}
function clientFromRefreshToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string
): AuthClient {
    const client = new google.auth.OAuth2(clientId, clientSecret);
    client.setCredentials({ refresh_token: refreshToken });
    return client;
}
async function loadSavedAuth(): Promise<AuthClient | undefined> {
    try {
        const content = await readFile(TOKEN_PATH, "utf8");
        const credentials = JSON.parse(content) as AuthorizedUser;
        return clientFromRefreshToken(
            credentials.client_id,
            credentials.client_secret,
            credentials.refresh_token
        );
    } catch {
        return undefined;
    }
}
async function readClientKeys(): Promise<ClientKeys["installed"]> {
    const content = await readFile(CREDENTIALS_PATH, "utf8");
    const keys = JSON.parse(content) as ClientKeys;
    return keys.installed ?? keys.web;
}
async function saveAuth(client: AuthClient): Promise<void> {
    const key = await readClientKeys();
    const refreshToken = client.credentials.refresh_token;
    if (!key || !refreshToken) {
        return;
    }
    const payload: AuthorizedUser = {
        type: "authorized_user",
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: refreshToken,
    };
    await writeFile(TOKEN_PATH, JSON.stringify(payload, null, 2));
}
async function authorize(): Promise<AuthClient> {
    const saved = await loadSavedAuth();
    if (saved) {
        return saved;
    }
    console.log("Opening a browser so you can sign in to Gmail.");
    const signedIn = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    });
    const key = await readClientKeys();
    const refreshToken = signedIn.credentials.refresh_token;
    if (!key || !refreshToken) {
        throw new Error("Sign-in did not return a refresh token.");
    }
    const client = clientFromRefreshToken(
        key.client_id,
        key.client_secret,
        refreshToken
    );
    await saveAuth(client);
    return client;
}
async function main(): Promise<void> {
    const auth = await authorize();
    const gmail = google.gmail({ version: "v1", auth });
    const list = await gmail.users.messages.list({
        userId: "me",
        maxResults: MAX_RESULTS,
        q: "in:inbox",
    });
    const messages = list.data.messages ?? [];
    if (messages.length === 0) {
        console.log("Signed in. The inbox has no messages.");
        return;
    }
    type Row = { date: string; from: string; subject: string; keyword?: string };
    const matched: Row[] = [];
    const skipped: Row[] = [];
    for (const item of messages) {
        if (!item.id) {
            continue;
        }
        const message = await gmail.users.messages.get({
            userId: "me",
            id: item.id,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
        });
        const headers = message.data.payload?.headers;
        const subject = header(headers, "Subject");
        const preview = message.data.snippet ?? "";
        const row: Row = {
            date: header(headers, "Date"),
            from: header(headers, "From"),
            subject,
            keyword: matchedKeyword(subject, preview),
        };
        (row.keyword ? matched : skipped).push(row);
    }
    console.log(`Keywords: ${KEYWORDS.join(", ")}`);
    console.log(`Checked ${matched.length + skipped.length} inbox emails.\n`);
    console.log(`MATCHED (${matched.length})`);
    for (const row of matched) {
        console.log(`  [${row.keyword}] ${row.subject}  (from ${row.from}, ${row.date})`);
    }
    console.log(`\nSKIPPED (${skipped.length})`);
    for (const row of skipped) {
        console.log(`  ${row.subject}  (from ${row.from}, ${row.date})`);
    }
    if (process.env.JSON_OUT) {
        await writeFile(
            process.env.JSON_OUT,
            JSON.stringify({ keywords: KEYWORDS, matched, skipped }, null, 2)
        );
    }
}
main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});