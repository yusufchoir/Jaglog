import { db } from "../db";
import { incidents } from "../schema";
import { and, eq, inArray } from "drizzle-orm";
import { RuleMatch, IncidentEvidenceItem } from "./types";
import { publishChange } from "../events/publisher";

const MAX_EVIDENCE_ITEMS = 20;

/**
 * Mencatat atau memperbarui insiden secara cerdas (Deduplikasi):
 * Jika insiden dengan (deviceId, ruleKey, mainEntity) masih berstatus 'open' atau 'ack',
 * perbarui count, lastSeen, dan gabungkan evidence (maks 20 item).
 * Jika belum ada, buat insiden baru.
 */
export async function recordIncident(match: RuleMatch): Promise<{ id: string; isNew: boolean }> {
  // 1. Cari insiden aktif yang sudah ada
  const [existing] = await db
    .select({
      id: incidents.id,
      count: incidents.count,
      evidence: incidents.evidence,
      firstSeen: incidents.firstSeen,
      lastSeen: incidents.lastSeen,
      severity: incidents.severity,
    })
    .from(incidents)
    .where(
      and(
        eq(incidents.deviceId, match.deviceId),
        eq(incidents.ruleKey, match.ruleKey),
        eq(incidents.mainEntity, match.mainEntity),
        inArray(incidents.status, ["open", "ack"])
      )
    )
    .limit(1);

  if (existing) {
    // 2. Gabungkan bukti (evidence) tanpa duplikat ID, maks 20 item
    const existingEvidence = (Array.isArray(existing.evidence)
      ? existing.evidence
      : []) as IncidentEvidenceItem[];

    const seenEventIds = new Set(existingEvidence.map((e) => e.eventId));
    const mergedEvidence = [...existingEvidence];

    for (const ev of match.evidence) {
      if (!seenEventIds.has(ev.eventId)) {
        seenEventIds.add(ev.eventId);
        mergedEvidence.push(ev);
        if (mergedEvidence.length >= MAX_EVIDENCE_ITEMS) break;
      }
    }

    // Perbarui insiden
    await db
      .update(incidents)
      .set({
        count: existing.count + match.count,
        lastSeen: match.lastSeen > existing.lastSeen ? match.lastSeen : existing.lastSeen,
        evidence: mergedEvidence,
      })
      .where(eq(incidents.id, existing.id));

    publishChange({
      tipe: "insiden.berubah",
      perangkat_id: match.deviceId,
      data_ringkas: { id_insiden: existing.id, status: "open" },
    }).catch(() => {});

    return { id: existing.id, isNew: false };
  }

  // 3. Buat insiden baru
  const slicedEvidence = match.evidence.slice(0, MAX_EVIDENCE_ITEMS);

  const [created] = await db
    .insert(incidents)
    .values({
      deviceId: match.deviceId,
      ruleKey: match.ruleKey,
      severity: match.severity,
      title: match.title,
      firstSeen: match.firstSeen,
      lastSeen: match.lastSeen,
      count: match.count,
      status: "open",
      evidence: slicedEvidence,
      mainEntity: match.mainEntity,
    })
    .returning({ id: incidents.id });

  publishChange({
    tipe: "insiden.berubah",
    perangkat_id: match.deviceId,
    data_ringkas: { id_insiden: created.id, status: "open" },
  }).catch(() => {});

  // 4. Picu analisa AI otomatis di latar belakang untuk insiden severity >= high
  if (match.severity === "high" || match.severity === "critical") {
    // Dynamic import untuk menghindari circular dependency saat startup
    import("../ai/service.js")
      .then(({ analyzeIncident }) => analyzeIncident(created.id))
      .catch((err) => console.error("[Auto AI Trigger Error]", err));
  }

  return { id: created.id, isNew: true };
}
