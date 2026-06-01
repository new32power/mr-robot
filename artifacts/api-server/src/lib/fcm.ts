import { webcrypto } from "node:crypto";

const { subtle } = webcrypto;

type FirebaseCredentials = {
  project_id: string;
  private_key: string;
  client_email: string;
};

function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, "\n");
  if (!key.endsWith("\n")) key += "\n";
  return key;
}

export function getFirebaseCredentials(): FirebaseCredentials {
  const jsonStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (jsonStr) {
    const parsed = JSON.parse(jsonStr) as FirebaseCredentials;
    parsed.private_key = normalizePrivateKey(parsed.private_key);
    return parsed;
  }
  const project_id = process.env.FIREBASE_PROJECT_ID?.trim() || "main-fcm";
  const client_email = process.env.FIREBASE_CLIENT_EMAIL?.trim()
    || "firebase-adminsdk-fbsvc@main-fcm.iam.gserviceaccount.com";
  const rawKey = process.env.FIREBASE_PRIVATE_KEY
    || "-----BEGIN PRIVATE KEY-----\nMIIEugIBADANBgkqhkiG9w0BAQEFAASCBKQwggSgAgEAAoIBAQDZMJpUVmIkZjuC\nhvHNzJg3Mu9OL/Dw2mXZif8EIn4vE9R1kwQyd68hqBHOwV9Dy0K8zwrIU09GfKND\nh5Aij5TrCobAFzJgiOMDdm8+4a8NXQcx7J/C2Itj5gStYQHxwqmT++ZzNzvmdZkf\nOrY5MhY2zajq+fgpERyHE8KCD0UirFYsWwEqn6lxv9oyGCBkbq9fKfnE5lQxwCDh\nMUDMTMFRIdYkGsbErqTLJfDJ0LS8gf3PCRh2jWsWDYWVsrBtQMOleqIAchciQZ4N\n1CbcYT/HaX+ZkmdcrFSxue0Cb6ihWed7PDlb0bRbqH3+WJ1Z8EHou+pnN6sSdY3u\nA3VRcd9pAgMBAAECgf8CLLZbo3GVsWNliFjTQ6j3+zS0vDeR1xKip/FL0GQYUiXZ\nyfTuKzenhLFrYizKubFUNeIk8fsiItyJWkhpz125sjjHlnChx5/vsdnPwoLvnbKw\nsbxso5RND2ncK6ywzZgL+FeyuPMpgNaRYS2fR9KGLpxtT7V1T1oyey8oAQ9XClRD\nPycROqBAkCrmhcaA5vj1K9kDO/RxAmurS6CtpE9qcUi0eNhBUvPYDRi1eWytvoiF\nCAcJlGoO6qOmi+x1qIGxxwzYwHYv2YHTTcUl2H2wXknpcQ16SzRtUi7ESnArGxkE\ntIO5untib+97Z0n/Rlzc/4tj39qtek2+uML+eRkCgYEA81oXRw3ymSvyISbifRdD\nJjO4f12SuUGmQ4NqEDThd2WZEhX4vqt/D91Bm3mzGha9y0dV991QUTvLHPxJvBlw\nd4mY3enbwtNjB6WKKMoJS32nL9vTsyUZt53ITnGvStJWjbVBfLMxMMdgHWRBZAkx\nhbKZPJoKzVifYtru6LnZgw0CgYEA5Hpp5VdGUp+iiNf7nir+hhdlTsB9aSjDJAZ3\nnWjo9cmD1ZAOhzZ5BbuW13hy4zqErVjKOzsXkrTKzz9sSQspARCRtckFH6S3nPIB\n4CM5qCP650YHxwUsUUwmgPBSJJL+Q+KEZ+6Kh3ewUege6hzZ//UCK/5b4+cQSeyD\nIRQQJs0CgYBuLKCTS85E6K+DsN4jsi91kT77cvrlosJKmKmhUr+tVbMajBYFBRHO\nteZpJI0gx6D/8nkKcglV7dNEeThMz9uqUwKBncogB6IzKRBG7UmOAwJ5WXYcCjT9\ne5LfaPrqzhXfrGtMsLgZlHqAdA5i4wKnvDdCR5+SXogyslotxU6j1QKBgC+h8bfV\ndRy+mSUMWjHEZuHPuNgtOzgUPnKhQoi3mXG8fFamvNClo591V2I+gz0qMwTssOSe\nUjDMrkd8wneL8xV8vdP3P7E0Ju96aLewwFF0htd2eyKbynx8cr6I26cyWf4PGGmO\niqTpaAH7cY5/S1eYXcaMNd4SiwvOWhwoUaG1AoGAGfpFDp5cp210vV360Pf86DFa\nqc5+y+TLRrwLkpE6DlVscDBVDt1NhzaJGgTeo5kniv1c2rdvq0UVR3GdjORQggSf\nptX03BRuoSKtuHZNxWQnqQpMorQmDZgSklJlLTIWv5aq/iyCv78u815rxtvDKNH9\n+hW5Y1czi5JdGikljiw=\n-----END PRIVATE KEY-----\n";
  const private_key = normalizePrivateKey(rawKey);
  return { project_id, client_email, private_key };
}

function b64urlFromBytes(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return Buffer.from(s, "binary").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlFromString(s: string): string {
  return Buffer.from(s).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64FromPem(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  return Buffer.from(body, "base64");
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getFcmAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const creds = getFirebaseCredentials();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(JSON.stringify(claim))}`;
  const keyData = b64FromPem(creds.private_key);
  const key = await subtle.importKey(
    "pkcs8",
    keyData.buffer.slice(keyData.byteOffset, keyData.byteOffset + keyData.byteLength) as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    Buffer.from(unsigned),
  );
  const jwt = `${unsigned}.${b64urlFromBytes(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google OAuth token error ${res.status}: ${body}`);
  }
  const json = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in * 1000),
  };
  return cachedToken.token;
}

export async function sendFcmToToken(
  fcmToken: string,
  data: Record<string, string>,
): Promise<{ messageId: string }> {
  const accessToken = await getFcmAccessToken();
  const creds = getFirebaseCredentials();
  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${creds.project_id}/messages:send`;
  const res = await fetch(fcmUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        android: { priority: "high", ttl: "3600s" },
        data: Object.assign({}, data, {
          payload: JSON.stringify(
            Object.fromEntries(Object.entries(data).filter(([k]) => k !== "type")),
          ),
        }),
      },
    }),
  });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    throw Object.assign(new Error("FCM rejected"), { fcmStatus: res.status, fcmBody: body });
  }
  return { messageId: String(body["name"] ?? "sent") };
}
