/**
 * Centralized Safe Serialization Helper
 * Menangani serialisasi BigInt, Decimal/Numeric, Date, null/undefined, dan nilai non-finite (NaN, Infinity).
 * Mencegah TypeError: "Do not know how to serialize a BigInt" dan kegagalan JSON.stringify.
 */

/**
 * Custom JSON replacer yang secara aman mengonversi BigInt dan non-finite numbers.
 */
export function safeJsonReplacer(_key: string, value: any): any {
  if (typeof value === "bigint") {
    // Jika masih dalam batas representasi angka aman JS (53-bit), jadikan number.
    // Jika melebihi batas, jadikan string teks agar presisi tidak hilang.
    if (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
      return Number(value);
    }
    return value.toString();
  }

  if (typeof value === "number") {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return null;
    }
    return value;
  }

  return value;
}

/**
 * Deep convert object values secara rekursif agar aman dari BigInt sebelum dikirim via NextResponse.json
 */
export function sanitizeForJson<T = any>(obj: any): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "bigint") {
    if (obj <= BigInt(Number.MAX_SAFE_INTEGER) && obj >= BigInt(Number.MIN_SAFE_INTEGER)) {
      return Number(obj) as unknown as T;
    }
    return obj.toString() as unknown as T;
  }

  if (typeof obj === "number") {
    if (Number.isNaN(obj) || !Number.isFinite(obj)) {
      return 0 as unknown as T;
    }
    return obj as unknown as T;
  }

  if (obj instanceof Date) {
    return obj.toISOString() as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeForJson(item)) as unknown as T;
  }

  if (typeof obj === "object") {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = sanitizeForJson(val);
    }
    return result as T;
  }

  return obj;
}

/**
 * Serialisasi objek ke JSON string secara aman dari BigInt dan non-finite numbers
 */
export function safeJsonStringify(data: any): string {
  return JSON.stringify(data, safeJsonReplacer);
}
