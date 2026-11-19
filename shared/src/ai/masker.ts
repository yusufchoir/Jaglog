/**
 * Modul pembersih / masking data sensitif sebelum dikirim ke AI Provider.
 * Mengganti password, bearer token, API key, dan cryptographic hash dengan label [MASKED].
 */
export function maskSensitiveData(input: string): string {
  if (!input || typeof input !== "string") return "";

  let text = input;

  // 1. Masking Passwords
  // Contoh: password=secret123, passwd: "myPassword!", pwd='123'
  text = text.replace(
    /(?:password|passwd|pwd|passphrase)\s*[:=]\s*['"]?([^\s'",;]+)['"]?/gi,
    (match, captured) => match.replace(captured, "[MASKED_PASSWORD]")
  );

  // 2. Masking Bearer & Authorization Tokens
  // Contoh: Bearer eyJhbGciOi..., Authorization: Bearer abc...
  text = text.replace(
    /Bearer\s+([A-Za-z0-9._~+/-]{16,})/gi,
    "Bearer [MASKED_TOKEN]"
  );

  // 3. Masking API Keys & Secrets
  // Contoh: api_key=sk_live_..., secret=1234567890abcdef
  text = text.replace(
    /(?:api_key|apikey|app_secret|client_secret|access_token|private_key)\s*[:=]\s*['"]?([A-Za-z0-9_-]{16,})['"]?/gi,
    (match, captured) => match.replace(captured, "[MASKED_API_KEY]")
  );

  // 4. Masking Password Hashes (Argon2, Bcrypt, NTLM, SHA-256)
  // Argon2: $argon2id$v=19$m=...
  text = text.replace(/\$argon2[a-z]*\$[^\s'",;]+/gi, "[MASKED_ARGON2_HASH]");

  // Bcrypt: $2a$10$... atau $2b$...
  text = text.replace(/\$2[abxy]\$\d{2}\$[A-Za-z0-9./]{53}/gi, "[MASKED_BCRYPT_HASH]");

  // NTLM / SHA-256 / SHA-1 hashes (32, 40, atau 64 heksadesimal beruntun yang bukan UUID)
  // Perhatikan agar tidak memasker UUID (yang punya format 8-4-4-4-12)
  text = text.replace(
    /(?<![a-fA-F0-9-])\b[a-fA-F0-9]{64}\b(?![a-fA-F0-9-])/g,
    "[MASKED_SHA256_HASH]"
  );

  text = text.replace(
    /(?<![a-fA-F0-9-])\b[a-fA-F0-9]{32}\b(?![a-fA-F0-9-])/g,
    "[MASKED_HASH]"
  );

  return text;
}
