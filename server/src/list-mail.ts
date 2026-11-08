/*
  This file is a small practice script.

  Run it with npm run list-mail from the server folder. It signs in to Gmail,
  looks at the five newest inbox messages, and prints only the ones that
  contain the word "invoice". It does not add labels. The real scanner is
  server.ts. This file keeps its own copy of the sign-in steps so it can run
  by itself.
*/
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const TOKEN_PATH = path.join(process.cwd(), "token.json");

// The only word this practice script looks for.
const KEYWORDS = ["invoice"];

// Return the keyword if the subject or preview contains it.
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

// Read one header, such as Subject or From, from a Gmail message.
function header(
    headers: { name?: string | null; value?: string | null }[] | undefined,
    name: string
): string {
    const found = headers?.find(
        (item) => item.name?.toLowerCase() === name.toLowerCase()
    );
    return found?.value ?? "(none)";
}

// Build a Gmail sign-in object from a permission that was saved earlier.
function clientFromRefreshToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string
): AuthClient {
    const client = new google.auth.OAuth2(clientId, clientSecret);
    client.setCredentials({ refresh_token: refreshToken });
    return client;
}

// Read token.json. If it is missing, return nothing so the script can sign in.
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

// Read the program's id and secret from credentials.json.
async function readClientKeys(): Promise<ClientKeys["installed"]> {
    const content = await readFile(CREDENTIALS_PATH, "utf8");
    const keys = JSON.parse(content) as ClientKeys;
    return keys.installed ?? keys.web;
}

// Save the sign-in permission so the next run can skip the browser.
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

// Return a signed-in Gmail client. Reuse token.json, or open the browser once.
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

// Sign in, read five inbox messages, and print the ones that mention invoice.
async function main(): Promise<void> {
    const auth = await authorize();
    const gmail = google.gmail({ version: "v1", auth });
    const list = await gmail.users.messages.list({
        userId: "me",
        maxResults: 5,
        q: "in:inbox",
    });
    const messages = list.data.messages ?? [];
    if (messages.length === 0) {
        console.log("Signed in. The inbox has no messages.");
        return;
    }
    let hits = 0;
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
        const keyword = matchedKeyword(subject, preview);
        if (!keyword) {
            continue;
        }
        hits += 1;
        console.log(`${hits}. keyword: ${keyword}`);
        console.log(`   ${header(headers, "Date")}`);
        console.log(`   From: ${header(headers, "From")}`);
        console.log(`   Subject: ${subject}`);
        console.log(`   ${preview}`);
        console.log();
    }
    if (hits === 0) {
        console.log(`No inbox messages matched: ${KEYWORDS.join(", ")}`);
    }
}

// Start the script, and print the error if Gmail sign-in fails.
main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});