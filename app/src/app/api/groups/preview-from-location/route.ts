import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { devices, deviceGroups } from "@shared/schema";
import { normalizeLocationKey, generateProposedGroupName } from "@shared/groups";
import { eq, isNotNull, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

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
        { error: "Akses ditolak: Hanya peran Admin yang dapat melakukan pratinjau grup dari lokasi." },
        { status: 403 }
      );
    }

    // Ambil perangkat yang memiliki lokasi
    const devicesWithLocation = await db
      .select({
        id: devices.id,
        name: devices.name,
        type: devices.type,
        ipAddress: devices.ipAddress,
        location: devices.location,
        groupId: devices.groupId,
      })
      .from(devices)
      .where(isNotNull(devices.location));

    // Filter yang lokasinya tidak kosong string
    const validDevices = devicesWithLocation.filter(
      (d) => d.location && d.location.trim().length > 0
    );

    // Ambil seluruh master grup yang sudah ada
    const existingGroups = await db
      .select({
        id: deviceGroups.id,
        nama: deviceGroups.nama,
        warnaGaris: deviceGroups.warnaGaris,
      })
      .from(deviceGroups);

    const existingGroupMap = new Map<string, typeof existingGroups[0]>();
    for (const eg of existingGroups) {
      existingGroupMap.set(eg.nama.trim().toLowerCase(), eg);
    }

    // Kelompokkan perangkat berdasarkan normalisasi lokasi
    const clusters = new Map<
      string,
      {
        normalizedKey: string;
        proposedName: string;
        sampleRawLocation: string;
        devices: typeof validDevices;
      }
    >();

    for (const dev of validDevices) {
      const raw = dev.location!;
      const key = normalizeLocationKey(raw);
      if (!key) continue;

      if (!clusters.has(key)) {
        clusters.set(key, {
          normalizedKey: key,
          proposedName: generateProposedGroupName(raw),
          sampleRawLocation: raw,
          devices: [],
        });
      }
      clusters.get(key)!.devices.push(dev);
    }

    let newGroupsCount = 0;
    let existingGroupsMatchedCount = 0;

    const previewList = Array.from(clusters.values()).map((cluster) => {
      // Cek apakah sudah ada grup yang namanya sama
      const matched =
        existingGroupMap.get(cluster.normalizedKey) ||
        existingGroupMap.get(cluster.proposedName.toLowerCase());

      if (matched) {
        existingGroupsMatchedCount++;
      } else {
        newGroupsCount++;
      }

      return {
        normalizedKey: cluster.normalizedKey,
        proposedName: cluster.proposedName,
        sampleRawLocation: cluster.sampleRawLocation,
        existingGroup: matched ? { id: matched.id, nama: matched.nama, warnaGaris: matched.warnaGaris } : null,
        deviceCount: cluster.devices.length,
        devices: cluster.devices.map((d) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          ipAddress: d.ipAddress,
          location: d.location,
          currentGroupId: d.groupId,
        })),
      };
    });

    // Urutkan dari jumlah perangkat terbanyak
    previewList.sort((a, b) => b.deviceCount - a.deviceCount);

    return NextResponse.json({
      preview: previewList,
      totalDevices: validDevices.length,
      groupClustersCount: previewList.length,
      newGroupsCount,
      existingGroupsMatchedCount,
    });
  } catch (error) {
    console.error("POST /api/groups/preview-from-location error:", error);
    return NextResponse.json(
      { error: "Gagal memproses pratinjau grup dari lokasi." },
      { status: 500 }
    );
  }
}
