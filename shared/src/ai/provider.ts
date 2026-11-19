import { AIProvider } from "./types";

/**
 * 1. Anthropic Provider (Claude 3.5 Sonnet / Claude 3 Haiku)
 */
export class AnthropicProvider implements AIProvider {
  name = "anthropic";
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "claude-3-5-sonnet-20241022") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateText(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API Error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    const textBlock = data.content?.find((c: any) => c.type === "text");
    return textBlock?.text || "";
  }
}

/**
 * 2. OpenAI Provider (GPT-4o, GPT-4o-mini)
 */
export class OpenAIProvider implements AIProvider {
  name = "openai";
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "gpt-4o-mini") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateText(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API Error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    return data.choices?.[0]?.message?.content || "";
  }
}

/**
 * 3. Ollama Provider (Lokal: llama3, mistral, qwen)
 */
export class OllamaProvider implements AIProvider {
  name = "ollama";
  private baseUrl: string;
  private model: string;

  constructor(baseUrl = "http://localhost:11434", model = "llama3") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
  }

  async generateText(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        format: "json",
        stream: false,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama API Error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    return data.message?.content || "";
  }
}

/**
 * 4. Mock Provider (Fallback / Pengujian Otomatis Saat API Key Tidak Tersedia)
 * Menghasilkan analisa keamanan siber profesional berbahasa Indonesia sesuai data insiden
 */
export class MockProvider implements AIProvider {
  name = "mock";

  async generateText(_systemPrompt: string, userPrompt: string): Promise<string> {
    const isBruteForce = /brute_force|login failure|sshd|password/i.test(userPrompt);
    const isPortScan = /port_scan|firewall|drop|port/i.test(userPrompt);
    const isPrivilege = /admin|4720|4732|user_create/i.test(userPrompt);
    const isLogCleared = /1102|log_cleared|audit log/i.test(userPrompt);

    // Ekstrak IP atau entitas dari prompt jika ada
    const ipMatch = userPrompt.match(/\b([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\b/);
    const targetIp = ipMatch ? ipMatch[1] : "203.0.113.195";

    const isMikrotik = /mikrotik/i.test(userPrompt);
    const isLinux = /linux/i.test(userPrompt);

    let specificCmd = `/ip firewall filter add chain=input src-address=${targetIp} action=drop comment="JagaLog Block"`;
    if (isLinux) {
      specificCmd = `sudo ufw deny from ${targetIp} to any comment "JagaLog Block"`;
    } else if (!isMikrotik) {
      specificCmd = `New-NetFirewallRule -DisplayName "JagaLog Block IP" -Direction Inbound -Action Block -RemoteAddress ${targetIp}`;
    }

    if (isLogCleared) {
      return JSON.stringify({
        risk_level: "critical",
        summary:
          "Terdeteksi penghapusan log audit keamanan pada sistem oleh akun yang memiliki hak akses administratif. Aktivitas ini merupakan indikator kuat upaya anti-forensik pasca kompromi sistem. Diperlukan isolasi segera terhadap host terdampak dan investigasi riwayat sesi.",
        suspected_attack: "Log Erasure (Anti-Forensics)",
        confidence: "tinggi",
        findings: [
          {
            title: "Pembersihan Security Event Log (EventID 1102)",
            explanation:
              "Log audit keamanan sengaja dikosongkan untuk menghilangkan jejak aktivitas mencurigakan.",
            evidence_event_ids: ["ev-log-cleared"],
          },
        ],
        recommendations: [
          {
            priority: 1,
            action: "Karantina / Isolasi Host",
            reason: "Mencegah penyebaran lateral jika penyerang masih menguasai host.",
            device_specific_command: specificCmd,
          },
          {
            priority: 2,
            action: "Audit Kredensial Administrator",
            reason: "Akun dengan hak istimewa kemungkinan telah disusupi.",
          },
        ],
      });
    }

    if (isPrivilege) {
      return JSON.stringify({
        risk_level: "high",
        summary:
          "Ditemukan pembuatan akun lokal baru dan eskalasi ke dalam grup administrator sistem. Pola aktivitas ini konsisten dengan pembentukan persistence oleh entitas tidak terotorisasi. Disarankan untuk menonaktifkan akun tersebut dan meninjau otorisasi pergantian hak akses.",
        suspected_attack: "Unauthorized Privilege Escalation",
        confidence: "tinggi",
        findings: [
          {
            title: "Penambahan Anggota Grup Administrators",
            explanation: "Akun baru dimasukkan ke grup hak istimewa tinggi tanpa tiket perubahan resmi.",
            evidence_event_ids: ["ev-priv-escalate"],
          },
        ],
        recommendations: [
          {
            priority: 1,
            action: "Nonaktifkan Akun Baru yang Dicurigai",
            reason: "Menutup akses pintu belakang (backdoor) sebelum disalahgunakan.",
            device_specific_command: isLinux ? "sudo usermod -L <username>" : "Disable-LocalUser -Name <username>",
          },
        ],
      });
    }

    if (isPortScan) {
      return JSON.stringify({
        risk_level: "medium",
        summary:
          `Terdeteksi aktivitas pemindaian port masif dari alamat IP ${targetIp} yang menyentuh puluhan port layanan dalam durasi singkat. Paket-paket tersebut telah diblokir oleh firewall, namun mengindikasikan fase pengintaian (reconnaissance). Disarankan memasukkan alamat IP tersebut ke daftar blokir permanen.`,
        suspected_attack: "Network Port Reconnaissance",
        confidence: "tinggi",
        findings: [
          {
            title: "Reconnaissance Port Scan dari IP Eksternal",
            explanation: "Penyerang mengirim paket SYN ke berbagai port umum untuk mencari celah terbuka.",
            evidence_event_ids: ["ev-port-scan"],
          },
        ],
        recommendations: [
          {
            priority: 1,
            action: "Blokir Alamat IP Penyerang di Firewall",
            reason: "Mencegah fase serangan lanjutan setelah pemindaian.",
            device_specific_command: specificCmd,
          },
        ],
      });
    }

    // Default: Brute force
    return JSON.stringify({
      risk_level: "high",
      summary:
        `Terdeteksi percobaan serangan brute force login yang intensif dari alamat IP ${targetIp}. Pola serangan mencoba membobol kredensial akses administratif melalui layanan jarak jauh. Langkah mitigasi cepat diperlukan untuk memutus upaya autentikasi tersebut.`,
      suspected_attack: "Brute Force Authentication",
      confidence: "tinggi",
      findings: [
        {
          title: `Percobaan Login Gagal Beruntun dari IP ${targetIp}`,
          explanation: "Kegagalan autentikasi berulang dalam frekuensi tinggi mengindikasikan serangan kamus otomatis.",
          evidence_event_ids: ["ev-bruteforce-1", "ev-bruteforce-2"],
        },
      ],
      recommendations: [
        {
          priority: 1,
          action: "Blokir Akses IP Penyerang di Perangkat Jaringan",
          reason: "Menghentikan beban autentikasi dan mencegah kebocoran kredensial.",
          device_specific_command: specificCmd,
        },
        {
          priority: 2,
          action: "Evaluasi Pembatasan Akses Manajemen",
          reason: "Port manajemen (SSH/Winbox) sebaiknya hanya dapat diakses melalui VPN atau IP manajemen khusus.",
        },
      ],
    });
  }
}

/**
 * Factory untuk membuat AI Provider aktif berdasarkan konfigurasi lingkungan (ENV)
 */
export function getActiveAIProvider(): AIProvider {
  const providerType = (process.env.AI_PROVIDER || "").toLowerCase().trim();
  const apiKey = process.env.AI_API_KEY || "";
  const model = process.env.AI_MODEL;

  if (providerType === "anthropic" && apiKey) {
    return new AnthropicProvider(apiKey, model || "claude-3-5-sonnet-20241022");
  }

  if (providerType === "openai" && apiKey) {
    return new OpenAIProvider(apiKey, model || "gpt-4o-mini");
  }

  if (providerType === "ollama") {
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    return new OllamaProvider(baseUrl, model || "llama3");
  }

  // Fallback aman: Gunakan Mock Provider profesional jika key tidak diatur
  return new MockProvider();
}
