import { z } from "zod";

export const groupBorderColors = ["biru", "merah", "abu"] as const;
export type GroupBorderColor = (typeof groupBorderColors)[number];

export const groupColorHexMap: Record<GroupBorderColor, { border: string; bg: string; text: string }> = {
  biru: { border: "#1F5FBF", bg: "rgba(31, 95, 191, 0.04)", text: "#1F5FBF" },
  merah: { border: "#C8372D", bg: "rgba(200, 55, 45, 0.04)", text: "#C8372D" },
  abu: { border: "#5B6270", bg: "rgba(91, 98, 112, 0.04)", text: "#5B6270" },
};

export const createDeviceGroupSchema = z.object({
  nama: z
    .string({ required_error: "Nama grup wajib diisi." })
    .trim()
    .min(2, "Nama grup minimal 2 karakter.")
    .max(100, "Nama grup maksimal 100 karakter."),
  deskripsi: z.string().trim().max(1000, "Deskripsi maksimal 1000 karakter.").optional().nullable(),
  warnaGaris: z.enum(groupBorderColors, {
    errorMap: () => ({ message: "Pilihan warna garis tidak valid ('biru', 'merah', atau 'abu')." }),
  }).default("biru"),
  urutan: z.coerce.number().int().default(0),
  parentId: z.string().uuid("Parent ID tidak valid.").optional().nullable(),
});

export const updateDeviceGroupSchema = createDeviceGroupSchema.partial();

export const deleteDeviceGroupSchema = z.object({
  action: z.enum(["detach", "move"], {
    errorMap: () => ({ message: "Aksi penghapusan harus 'detach' (lepas perangkat) atau 'move' (pindahkan)." }),
  }).default("detach"),
  targetGroupId: z.string().uuid("Target grup tujuan tidak valid.").optional().nullable(),
}).refine(
  (data) => {
    if (data.action === "move" && !data.targetGroupId) {
      return false;
    }
    return true;
  },
  { message: "Target grup tujuan wajib dipilih jika memilih opsi pindahkan.", path: ["targetGroupId"] }
);

export const bulkDeviceGroupSchema = z.object({
  deviceIds: z
    .array(z.string().uuid("ID perangkat tidak valid."))
    .min(1, "Pilih minimal 1 perangkat.")
    .max(200, "Maksimal 200 perangkat per aksi massal."),
  groupId: z.string().uuid("ID grup tidak valid.").nullable(), // null = lepas dari grup
});

export type CreateDeviceGroupInput = z.infer<typeof createDeviceGroupSchema>;
export type UpdateDeviceGroupInput = z.infer<typeof updateDeviceGroupSchema>;
export type DeleteDeviceGroupInput = z.infer<typeof deleteDeviceGroupSchema>;
export type BulkDeviceGroupInput = z.infer<typeof bulkDeviceGroupSchema>;

/**
 * Normalisasi string lokasi untuk pengelompokan otomatis:
 * - trim
 * - ubah underscore (_) dan tanda minus (-) menjadi spasi
 * - ubah beberapa spasi berurutan menjadi satu spasi
 * - lower case untuk pencocokan kunci konsisten
 * Contoh: "MAIN_BPI", "main bpi", "Main-BPI" => "main bpi"
 */
export function normalizeLocationKey(location: string): string {
  if (!location || typeof location !== "string") return "";
  return location
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Hasilkan nama grup yang rapi dalam Title Case dari kunci lokasi yang dinormalisasi.
 * Contoh: "main bpi" => "Main BPI" atau "Main Bpi"
 */
export function generateProposedGroupName(rawLocation: string): string {
  const normalized = normalizeLocationKey(rawLocation);
  if (!normalized) return "Area Umum";

  return normalized
    .split(" ")
    .map((word) => {
      // Pertahankan singkatan umum jika <= 3 huruf atau huruf kapital
      if (word.length <= 3) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export type DeviceNetworkStatus = "online" | "log_stopped" | "offline" | "unknown";

/**
 * Hitung status terburuk gabungan untuk grup perangkat.
 * Aturan prioritas terburuk:
 * 1. offline
 * 2. log_stopped
 * 3. online
 * 4. unknown
 */
export function calculateGroupWorstStatus(statuses: (DeviceNetworkStatus | string)[]): DeviceNetworkStatus {
  if (statuses.some((s) => s === "offline")) return "offline";
  if (statuses.some((s) => s === "log_stopped")) return "log_stopped";
  if (statuses.some((s) => s === "online")) return "online";
  return "unknown";
}


