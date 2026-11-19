import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { devices, deviceGroups } from "@shared/schema";
import { normalizeLocationKey, generateProposedGroupName } from "@shared/groups";
import { publishChangeImmediately } from "@shared/events/publisher";
import { redis } from "@shared/redis";
import { eq, isNotNull, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

const GROUPS_SUMMARY_CACHE_KEY = "jagalog:groups_summary";

export async function POST() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Akses ditolak: Hanya peran Admin yang dapat menerapkan pembuatan grup dari lokasi." },
        { status: 403 }
      );
    }

    const devicesWithLocation = await db
      .select({
        id: devices.id,
        name: devices.name,
        location: devices.location,
        groupId: devices.groupId,
      })
      .from(devices)
      .where(isNotNull(devices.location));

    const validDevices = devicesWithLocation.filter(
      (d) => d.location && d.location.trim().length > 0
    );

    if (validDevices.length === 0) {
      return NextResponse.json(
        { error: "Tidak ada perangkat yang memiliki informasi lokasi untuk dikelompokkan." },
        { status: 400 }
      );
    }

    // Ambil master grup yang ada
    const existingGroups = await db.select().from(deviceGroups);
    const existingGroupMap = new Map<string, typeof existingGroups[0]>();
    for (const eg of existingGroups) {
      existingGroupMap.set(eg.nama.trim().toLowerCase(), eg);
    }

    // Kelompokkan
    const clusters = new Map<
      string,
      {
        proposedName: string;
        deviceIds: string[];
      }
    >();

    for (const dev of validDevices) {
      const key = normalizeLocationKey(dev.location!);
      if (!key) continue;

      if (!clusters.has(key)) {
        clusters.set(key, {
          proposedName: generateProposedGroupName(dev.location!),
          deviceIds: [],
        });
      }
      clusters.get(key)!.deviceIds.push(dev.id);
    }

    let groupsCreatedCount = 0;
    let devicesAssignedCount = 0;

    await db.transaction(async (tx) => {
      for (const [key, cluster] of clusters.entries()) {
        let targetGroupId: string;

        // Cek apakah sudah ada grup yang cocok
        const matched =
          existingGroupMap.get(key) ||
          existingGroupMap.get(cluster.proposedName.toLowerCase());

        if (matched) {
          targetGroupId = matched.id;
        } else {
          // Buat grup baru
          const [newGroup] = await tx
            .insert(deviceGroups)
            .values({
              nama: cluster.proposedName,
              deskripsi: `Dibuat otomatis dari lokasi perangkat (${cluster.proposedName})`,
              warnaGaris: "biru",
            })
            .returning();

          targetGroupId = newGroup.id;
          existingGroupMap.set(key, newGroup);
          existingGroupMap.set(cluster.proposedName.toLowerCase(), newGroup);
          groupsCreatedCount++;
        }

        // Terapkan penugasan perangkat ke targetGroupId tanpa mengubah kolom location
        if (cluster.deviceIds.length > 0) {
          await tx
            .update(devices)
            .set({ groupId: targetGroupId })
            .where(inArray(devices.id, cluster.deviceIds));

          devicesAssignedCount += cluster.deviceIds.length;
        }
      }
    });

    // Invalidate Redis cache
    try {
      await redis.del(GROUPS_SUMMARY_CACHE_KEY);
    } catch (err) {
      console.warn("Gagal menghapus cache Redis groups_summary:", err);
    }

    // Broadcast SSE
    await publishChangeImmediately({
      tipe: "grup.berubah",
      perangkat_id: null,
      data_ringkas: {
        aksi: "diterapkan_dari_lokasi",
        groupsCreated: groupsCreatedCount,
        devicesAssigned: devicesAssignedCount,
      },
    });

    return NextResponse.json({
      success: true,
      groupsCreated: groupsCreatedCount,
      devicesAssigned: devicesAssignedCount,
      message: `Berhasil menerapkan pengelompokan lokasi: ${groupsCreatedCount} grup baru dibuat, ${devicesAssignedCount} penugasan perangkat berhasil diperbarui. Kolom lokasi asli tetap utuh.`,
    });
  } catch (error) {
    console.error("POST /api/groups/apply-from-location error:", error);
    return NextResponse.json(
      { error: "Gagal menerapkan pengelompokan grup dari lokasi." },
      { status: 500 }
    );
  }
}
