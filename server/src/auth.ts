/*
  This file signs the program in to Gmail.

  Google only lets the program read and label mail after a person clicks Allow.
  The first run opens a browser. Later runs reuse the saved permission in
  token.json, so the browser does not have to open every time.
*/
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";

// Ask Google for permission to read mail and change labels.
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
// The file downloaded from Google Cloud. It identifies this program.
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
// The saved permission from the person's Gmail sign-in.
const TOKEN_PATH = path.join(process.cwd(), "token.json");

// The object the rest of the program uses when it talks to Gmail.
export type AuthClient = InstanceType<typeof google.auth.OAuth2>;

// The shape of the saved token.json file.
type AuthorizedUser = {
  type: "authorized_user";
  client_id: string;
  client_secret: string;
  refresh_token: string;
};

// The shape of the downloaded credentials.json file.
type ClientKeys = {
  installed?: { client_id: string; client_secret: string };
  web?: { client_id: string; client_secret: string };
};

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

// Read token.json. If it is missing, return nothing so the program can sign in.
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

// Save the new sign-in permission so the next run can skip the browser.
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