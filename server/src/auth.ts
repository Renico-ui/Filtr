import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const TOKEN_PATH = path.join(process.cwd(), "token.json");

export type AuthClient = InstanceType<typeof google.auth.OAuth2>;

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

export async function authorize(): Promise<AuthClient> {
  const saved = await loadSavedAuth();
  if (saved) {
    return saved;
  }
  console.log("Opening a browser so you can allow Gmail to modify labels.");
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