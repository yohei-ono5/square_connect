export async function verifySquareWebhookSignature(
  signatureHeader: string | null,
  signatureKey: string,
  notificationUrl: string,
  rawBody: string,
): Promise<boolean> {
  if (!signatureHeader || !signatureKey || !notificationUrl) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(notificationUrl + rawBody)),
  );
  const expected = btoa(String.fromCharCode(...signature));

  // 長さが違う場合も全ループを通し、署名比較の時間差を小さくする。
  const length = Math.max(expected.length, signatureHeader.length);
  let difference = expected.length ^ signatureHeader.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (expected.charCodeAt(index) || 0) ^ (signatureHeader.charCodeAt(index) || 0);
  }
  return difference === 0;
}
