"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveUpdates } from "@/components/LiveUpdateProvider";
import { Toast } from "@/components/Toast";
import { useCurrentUser } from "@/components/UserProvider";
import { groupBorderColors, GroupBorderColor, groupColorHexMap } from "@shared/groups";

interface GroupItem {
  id: string;
  nama: string;
  deskripsi: string | null;
  warnaGaris: GroupBorderColor;
  urutan: number;
  parentId: string | null;
  createdAt: string;
  totalDevices: number;
  onlineCount: number;
  logStoppedCount: number;
  offlineCount: number;
  unknownCount: number;
  ringkasanStatus: string;
  openIncidents: number;
  worstStatus: {
    code: "offline" | "log_stopped" | "unknown" | "online" | "empty";
    label: string;
    glyph: string;
    color: string;
  };
  uptime24h: number | null;
}

interface GroupsResponse {
  groups: GroupItem[];
  unassignedCount: number;
  totalDevices: number;
  timestamp: string;
}

interface LocationPreviewCluster {
  normalizedKey: string;
  proposedName: string;
  sampleRawLocation: string;
  existingGroup: { id: string; nama: string; warnaGaris: string } | null;
  deviceCount: number;
  devices: {
    id: string;
    name: string;
    type: string;
    ipAddress: string | null;
    location: string | null;
    currentGroupId: string | null;
  }[];
}

export default function GrupPage() {
  const router = useRouter();
  const { subscribe } = useLiveUpdates();

  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [totalDevices, setTotalDevices] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Search & Sorting
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"urutan" | "nama" | "perangkat" | "insiden">("urutan");

  // User session dari UserProvider tunggal (sumber kebenaran tunggal)
  const { currentUser, isAdmin } = useCurrentUser();
  const currentUserRole = currentUser?.role || "viewer";

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Create / Edit Modal
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GroupItem | null>(null);
  const [formData, setFormData] = useState<{
    nama: string;
    deskripsi: string;
    warnaGaris: GroupBorderColor;
    urutan: number;
  }>({
    nama: "",
    deskripsi: "",
    warnaGaris: "biru",
    urutan: 0,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);

  // Delete Modal
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<GroupItem | null>(null);
  const [deleteAction, setDeleteAction] = useState<"detach" | "move">("detach");
  const [targetMoveGroupId, setTargetMoveGroupId] = useState<string>("");
  const [isSubmittingDelete, setIsSubmittingDelete] = useState(false);

  // "Buat grup dari Lokasi" Modal
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [locationPreview, setLocationPreview] = useState<{
    preview: LocationPreviewCluster[];
    totalDevices: number;
    groupClustersCount: number;
    newGroupsCount: number;
    existingGroupsMatchedCount: number;
  } | null>(null);
  const [isLoadingLocationPreview, setIsLoadingLocationPreview] = useState(false);
  const [isApplyingLocation, setIsApplyingLocation] = useState(false);

  // Fetch groups
  const fetchGroups = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/groups");
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("Gagal mengambil daftar grup.");
      }
      const data: GroupsResponse = await res.json();
      setGroups(data.groups || []);
      setUnassignedCount(data.unassignedCount || 0);
      setTotalDevices(data.totalDevices || 0);
    } catch (err: any) {
      console.error("fetchGroups error:", err);
      if (!silent) setErrorMsg(err.message || "Terjadi kesalahan saat memuat data grup.");
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [router]);

  // Initial load
  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  // SSE Subscriptions
  useEffect(() => {
    const unsubGroup = subscribe("grup.berubah", () => {
      fetchGroups(true);
    });
    const unsubDevStatus = subscribe("perangkat.status", () => {
      fetchGroups(true);
    });
    const unsubDevPing = subscribe("perangkat.ping", () => {
      fetchGroups(true);
    });
    return () => {
      unsubGroup();
      unsubDevStatus();
      unsubDevPing();
    };
  }, [subscribe, fetchGroups]);

  // Filter & Sort
  const filteredGroups = useMemo(() => {
    let result = [...groups];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (g) =>
          g.nama.toLowerCase().includes(q) ||
          (g.deskripsi && g.deskripsi.toLowerCase().includes(q))
      );
    }

    result.sort((a, b) => {
      if (sortBy === "nama") return a.nama.localeCompare(b.nama);
      if (sortBy === "perangkat") return b.totalDevices - a.totalDevices;
      if (sortBy === "insiden") return b.openIncidents - a.openIncidents;
      return a.urutan - b.urutan || a.nama.localeCompare(b.nama);
    });

    return result;
  }, [groups, searchQuery, sortBy]);

  // Form handlers
  const handleOpenCreateModal = () => {
    setEditingGroup(null);
    setFormData({
      nama: "",
      deskripsi: "",
      warnaGaris: "biru",
      urutan: groups.length,
    });
    setFormError(null);
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (group: GroupItem) => {
    setEditingGroup(group);
    setFormData({
      nama: group.nama,
      deskripsi: group.deskripsi || "",
      warnaGaris: group.warnaGaris,
      urutan: group.urutan,
    });
    setFormError(null);
    setIsFormModalOpen(true);
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nama.trim()) {
      setFormError("Nama grup wajib diisi.");
      return;
    }
    setIsSubmittingForm(true);
    setFormError(null);

    try {
      const url = editingGroup ? `/api/groups/${editingGroup.id}` : "/api/groups";
      const method = editingGroup ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nama: formData.nama.trim(),
          deskripsi: formData.deskripsi.trim() || null,
          warnaGaris: formData.warnaGaris,
          urutan: Number(formData.urutan),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gagal menyimpan grup.");
      }

      setToast({
        message: editingGroup
          ? `Grup '${formData.nama}' berhasil diperbarui.`
          : `Grup '${formData.nama}' berhasil ditambahkan.`,
        type: "success",
      });
      setIsFormModalOpen(false);
      fetchGroups(true);
    } catch (err: any) {
      setFormError(err.message || "Terjadi kesalahan saat menyimpan grup.");
    } finally {
      setIsSubmittingForm(false);
    }
  };

  // Delete handlers
  const handleOpenDeleteModal = (group: GroupItem) => {
    setGroupToDelete(group);
    setDeleteAction("detach");
    setTargetMoveGroupId("");
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!groupToDelete) return;
    if (deleteAction === "move" && !targetMoveGroupId) {
      setToast({ message: "Pilih grup tujuan untuk memindahkan perangkat.", type: "error" });
      return;
    }

    setIsSubmittingDelete(true);
    try {
      const res = await fetch(`/api/groups/${groupToDelete.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: deleteAction,
          targetGroupId: deleteAction === "move" ? targetMoveGroupId : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gagal menghapus grup.");
      }

      setToast({ message: data.message || "Grup berhasil dihapus.", type: "success" });
      setIsDeleteModalOpen(false);
      fetchGroups(true);
    } catch (err: any) {
      setToast({ message: err.message || "Terjadi kesalahan saat menghapus grup.", type: "error" });
    } finally {
      setIsSubmittingDelete(false);
    }
  };

  // Location preview / apply handlers
  const handleOpenLocationModal = async () => {
    setIsLocationModalOpen(true);
    setIsLoadingLocationPreview(true);
    setLocationPreview(null);
    try {
      const res = await fetch("/api/groups/preview-from-location", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal membuat pratinjau lokasi.");
      setLocationPreview(data);
    } catch (err: any) {
      setToast({ message: err.message || "Gagal memuat pratinjau grup dari lokasi.", type: "error" });
      setIsLocationModalOpen(false);
    } finally {
      setIsLoadingLocationPreview(false);
    }
  };

  const handleApplyLocation = async () => {
    setIsApplyingLocation(true);
    try {
      const res = await fetch("/api/groups/apply-from-location", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menerapkan grup dari lokasi.");
      setToast({ message: data.message || "Berhasil menerapkan pengelompokan dari lokasi.", type: "success" });
      setIsLocationModalOpen(false);
      fetchGroups(true);
    } catch (err: any) {
      setToast({ message: err.message || "Gagal menerapkan pengelompokan.", type: "error" });
    } finally {
      setIsApplyingLocation(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-app, #FAFAF8)", paddingBottom: "70px" }}>
      <div style={{ padding: "20px 24px", maxWidth: "1300px", margin: "0 auto" }}>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Header Halaman */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "16px",
          marginBottom: "24px",
          paddingBottom: "16px",
          borderBottom: "1px solid var(--border-color, #E6E4DF)",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "20px",
              fontWeight: 700,
              color: "var(--text-main, #1F2430)",
              margin: 0,
              letterSpacing: "-0.2px",
            }}
          >
            Grup & Area Perangkat
          </h1>
          <p
            style={{
              fontSize: "13px",
              color: "var(--text-secondary, #5B6270)",
              margin: "4px 0 0 0",
            }}
          >
            Kelompokkan perangkat berdasarkan area, lokasi fisik, atau fungsi jaringan untuk pemantauan terstruktur.
          </p>
        </div>

        {currentUserRole === "admin" && (
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleOpenLocationModal}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                minHeight: "44px",
                padding: "8px 14px",
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-main, #1F2430)",
                backgroundColor: "#FFFFFF",
                border: "1px solid var(--border-color, #E6E4DF)",
                borderRadius: "4px",
                cursor: "pointer",
                transition: "background-color 0.15s ease",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
              Buat grup dari Lokasi
            </button>

            <button
              type="button"
              onClick={handleOpenCreateModal}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                minHeight: "44px",
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#FFFFFF",
                backgroundColor: "var(--accent-blue, #1F5FBF)",
                border: "1px solid var(--accent-blue, #1F5FBF)",
                borderRadius: "4px",
                cursor: "pointer",
                transition: "opacity 0.15s ease",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Tambah Grup Baru
            </button>
          </div>
        )}
      </div>

      {/* Ringkasan Metrik Kartu Atas */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "12px",
          marginBottom: "20px",
        }}
      >
        <div
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px solid var(--border-color, #E6E4DF)",
            borderRadius: "6px",
            padding: "12px 16px",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary, #5B6270)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Total Grup Terdaftar
          </div>
          <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--text-main, #1F2430)", marginTop: "4px" }}>
            {groups.length}
          </div>
        </div>

        <div
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px solid var(--border-color, #E6E4DF)",
            borderRadius: "6px",
            padding: "12px 16px",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary, #5B6270)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Perangkat Terkelola
          </div>
          <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--accent-blue, #1F5FBF)", marginTop: "4px" }}>
            {totalDevices - unassignedCount} <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-secondary, #5B6270)" }}>dari {totalDevices}</span>
          </div>
        </div>

        <div
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px solid var(--border-color, #E6E4DF)",
            borderRadius: "6px",
            padding: "12px 16px",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary, #5B6270)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Belum Bergrup
          </div>
          <div style={{ fontSize: "22px", fontWeight: 700, color: unassignedCount > 0 ? "var(--text-secondary, #5B6270)" : "var(--accent-blue, #1F5FBF)", marginTop: "4px" }}>
            {unassignedCount}
          </div>
        </div>
      </div>

      {/* Kontrol Pencarian & Pengurutan */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          marginBottom: "16px",
          backgroundColor: "#FFFFFF",
          padding: "12px 16px",
          borderRadius: "6px",
          border: "1px solid var(--border-color, #E6E4DF)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1 1 240px", maxWidth: "400px" }}>
          <input
            type="text"
            placeholder="Cari grup berdasarkan nama atau deskripsi..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              height: "38px",
              padding: "6px 12px",
              fontSize: "13px",
              backgroundColor: "#FAFAF8",
              border: "1px solid var(--border-color, #E6E4DF)",
              borderRadius: "4px",
              color: "var(--text-main, #1F2430)",
              outline: "none",
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{
                height: "38px",
                padding: "0 10px",
                fontSize: "12px",
                color: "var(--text-secondary, #5B6270)",
                backgroundColor: "transparent",
                border: "1px solid var(--border-color, #E6E4DF)",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Reset
            </button>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "var(--text-secondary, #5B6270)", fontWeight: 500 }}>
            Urutkan:
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            style={{
              height: "38px",
              padding: "4px 10px",
              fontSize: "13px",
              backgroundColor: "#FFFFFF",
              border: "1px solid var(--border-color, #E6E4DF)",
              borderRadius: "4px",
              color: "var(--text-main, #1F2430)",
              cursor: "pointer",
            }}
          >
            <option value="urutan">Posisi / Urutan</option>
            <option value="nama">Nama Grup (A-Z)</option>
            <option value="perangkat">Jumlah Perangkat Terbanyak</option>
            <option value="insiden">Insiden Terbanyak</option>
          </select>
        </div>
      </div>

      {/* Loading & Error State */}
      {isLoading && (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-secondary, #5B6270)", fontSize: "14px" }}>
          Memuat daftar grup perangkat...
        </div>
      )}

      {errorMsg && (
        <div
          style={{
            padding: "16px",
            backgroundColor: "rgba(200, 55, 45, 0.05)",
            border: "1px solid rgba(200, 55, 45, 0.2)",
            borderRadius: "6px",
            color: "#C8372D",
            fontSize: "13px",
            marginBottom: "20px",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !errorMsg && groups.length === 0 && (
        <div
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px dashed var(--border-color, #E6E4DF)",
            borderRadius: "8px",
            padding: "48px 24px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "32px", color: "var(--accent-blue, #1F5FBF)", marginBottom: "12px" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto" }}>
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
          </div>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-main, #1F2430)", margin: "0 0 6px 0" }}>
            Belum ada grup perangkat
          </h2>
          <p style={{ fontSize: "13px", color: "var(--text-secondary, #5B6270)", maxWidth: "520px", margin: "0 auto 20px auto", lineHeight: "1.5" }}>
            Kelompokkan perangkat yang berada di area yang sama untuk visualisasi kotak area di peta jaringan dan pemantauan per area, atau buat otomatis dari kolom Lokasi perangkat.
          </p>
          {currentUserRole === "admin" && (
            <div style={{ display: "inline-flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
              <button
                type="button"
                onClick={handleOpenLocationModal}
                style={{
                  minHeight: "44px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--text-main, #1F2430)",
                  backgroundColor: "#FFFFFF",
                  border: "1px solid var(--border-color, #E6E4DF)",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Buat grup dari Lokasi
              </button>
              <button
                type="button"
                onClick={handleOpenCreateModal}
                style={{
                  minHeight: "44px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#FFFFFF",
                  backgroundColor: "var(--accent-blue, #1F5FBF)",
                  border: "1px solid var(--accent-blue, #1F5FBF)",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                + Tambah Grup Baru
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tabel Grup (Desktop >= 768px) & Card List (Mobile) */}
      {!isLoading && !errorMsg && groups.length > 0 && (
        <div
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px solid var(--border-color, #E6E4DF)",
            borderRadius: "6px",
            overflow: "hidden",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
              <thead>
                <tr style={{ backgroundColor: "#FAFAF8", borderBottom: "1px solid var(--border-color, #E6E4DF)" }}>
                  <th style={{ padding: "12px 16px", fontWeight: 600, color: "var(--text-secondary, #5B6270)" }}>Grup & Area</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600, color: "var(--text-secondary, #5B6270)" }}>Anggota Perangkat</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600, color: "var(--text-secondary, #5B6270)" }}>Status Terburuk</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600, color: "var(--text-secondary, #5B6270)" }}>Uptime 24 Jam</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600, color: "var(--text-secondary, #5B6270)" }}>Insiden</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600, color: "var(--text-secondary, #5B6270)", textAlign: "right" }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredGroups.map((group) => {
                  const colorConfig = groupColorHexMap[group.warnaGaris] || groupColorHexMap.biru;
                  return (
                    <tr
                      key={group.id}
                      style={{
                        borderBottom: "1px solid var(--border-color, #E6E4DF)",
                        transition: "background-color 0.1s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#FAFAF8")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      {/* Nama & Deskripsi */}
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span
                            style={{
                              display: "inline-block",
                              width: "10px",
                              height: "10px",
                              borderRadius: "2px",
                              border: `2px solid ${colorConfig.border}`,
                              backgroundColor: colorConfig.bg,
                            }}
                            title={`Warna garis: ${group.warnaGaris}`}
                          />
                          <Link
                            href={`/grup/${group.id}`}
                            style={{
                              fontWeight: 600,
                              color: "var(--accent-blue, #1F5FBF)",
                              textDecoration: "none",
                              fontSize: "14px",
                            }}
                          >
                            {group.nama}
                          </Link>
                        </div>
                        {group.deskripsi && (
                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--text-secondary, #5B6270)",
                              marginTop: "3px",
                              maxWidth: "340px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {group.deskripsi}
                          </div>
                        )}
                      </td>

                      {/* Jumlah Perangkat & Ringkasan */}
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ fontWeight: 600, color: "var(--text-main, #1F2430)" }}>
                          {group.totalDevices} Perangkat
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--text-secondary, #5B6270)", marginTop: "2px" }}>
                          {group.ringkasanStatus}
                        </div>
                      </td>

                      {/* Status Terburuk */}
                      <td style={{ padding: "14px 16px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "3px 8px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: group.worstStatus.color,
                            backgroundColor: "rgba(0,0,0,0.03)",
                            border: `1px solid ${group.worstStatus.color}33`,
                          }}
                        >
                          <span style={{ fontSize: "11px" }}>{group.worstStatus.glyph}</span>
                          <span>{group.worstStatus.label}</span>
                        </span>
                      </td>

                      {/* Uptime 24 Jam */}
                      <td style={{ padding: "14px 16px" }}>
                        {group.uptime24h !== null ? (
                          <span style={{ fontWeight: 600, color: group.uptime24h >= 99 ? "var(--accent-blue, #1F5FBF)" : "#C8372D" }}>
                            {group.uptime24h}%
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-secondary, #5B6270)" }}>-</span>
                        )}
                      </td>

                      {/* Insiden Terbuka */}
                      <td style={{ padding: "14px 16px" }}>
                        {group.openIncidents > 0 ? (
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: "10px",
                              backgroundColor: "rgba(200, 55, 45, 0.1)",
                              color: "#C8372D",
                              fontWeight: 700,
                              fontSize: "12px",
                            }}
                          >
                            {group.openIncidents} Terbuka
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-secondary, #5B6270)", fontSize: "12px" }}>0</span>
                        )}
                      </td>

                      {/* Aksi */}
                      <td style={{ padding: "14px 16px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                          <Link
                            href={`/grup/${group.id}`}
                            style={{
                              padding: "6px 10px",
                              fontSize: "12px",
                              fontWeight: 600,
                              color: "var(--text-main, #1F2430)",
                              backgroundColor: "#FAFAF8",
                              border: "1px solid var(--border-color, #E6E4DF)",
                              borderRadius: "4px",
                              textDecoration: "none",
                            }}
                          >
                            Detail
                          </Link>

                          {currentUserRole === "admin" && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(group)}
                                style={{
                                  padding: "6px 10px",
                                  fontSize: "12px",
                                  fontWeight: 500,
                                  color: "var(--text-main, #1F2430)",
                                  backgroundColor: "#FFFFFF",
                                  border: "1px solid var(--border-color, #E6E4DF)",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                }}
                              >
                                Ubah
                              </button>

                              <button
                                type="button"
                                onClick={() => handleOpenDeleteModal(group)}
                                style={{
                                  padding: "6px 10px",
                                  fontSize: "12px",
                                  fontWeight: 500,
                                  color: "#C8372D",
                                  backgroundColor: "#FFFFFF",
                                  border: "1px solid rgba(200, 55, 45, 0.2)",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                }}
                              >
                                Hapus
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal 1: Tambah / Ubah Grup */}
      {isFormModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "16px",
          }}
        >
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "8px",
              width: "100%",
              maxWidth: "480px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
              border: "1px solid var(--border-color, #E6E4DF)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--border-color, #E6E4DF)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--text-main, #1F2430)" }}>
                {editingGroup ? "Ubah Grup Perangkat" : "Tambah Grup Perangkat Baru"}
              </h3>
              <button
                type="button"
                onClick={() => setIsFormModalOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "18px",
                  cursor: "pointer",
                  color: "var(--text-secondary, #5B6270)",
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveGroup} style={{ padding: "20px" }}>
              {formError && (
                <div
                  style={{
                    padding: "10px 14px",
                    backgroundColor: "rgba(200, 55, 45, 0.08)",
                    border: "1px solid rgba(200, 55, 45, 0.25)",
                    borderRadius: "4px",
                    color: "#C8372D",
                    fontSize: "13px",
                    marginBottom: "16px",
                  }}
                >
                  {formError}
                </div>
              )}

              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-main, #1F2430)", marginBottom: "6px" }}>
                  Nama Grup <span style={{ color: "#C8372D" }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Lantai 2 Server, Data Center Utama, IT Office"
                  value={formData.nama}
                  onChange={(e) => setFormData({ ...formData, nama: e.target.value })}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "6px 12px",
                    fontSize: "13px",
                    border: "1px solid var(--border-color, #E6E4DF)",
                    borderRadius: "4px",
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-main, #1F2430)", marginBottom: "6px" }}>
                  Deskripsi / Keterangan Area (Opsional)
                </label>
                <textarea
                  rows={3}
                  placeholder="Deskripsi mengenai lokasi fisik, penanggung jawab, atau fungsi jaringan area ini..."
                  value={formData.deskripsi}
                  onChange={(e) => setFormData({ ...formData, deskripsi: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    fontSize: "13px",
                    border: "1px solid var(--border-color, #E6E4DF)",
                    borderRadius: "4px",
                    outline: "none",
                    resize: "vertical",
                  }}
                />
              </div>

              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-main, #1F2430)", marginBottom: "6px" }}>
                  Warna Garis Area di Peta
                </label>
                <div style={{ display: "flex", gap: "10px" }}>
                  {groupBorderColors.map((colorKey) => {
                    const isSelected = formData.warnaGaris === colorKey;
                    const hexConfig = groupColorHexMap[colorKey];
                    return (
                      <button
                        key={colorKey}
                        type="button"
                        onClick={() => setFormData({ ...formData, warnaGaris: colorKey })}
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          borderRadius: "4px",
                          border: isSelected ? `2px solid ${hexConfig.border}` : "1px solid var(--border-color, #E6E4DF)",
                          backgroundColor: isSelected ? hexConfig.bg : "#FFFFFF",
                          color: hexConfig.text,
                          fontWeight: isSelected ? 700 : 500,
                          fontSize: "13px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                        }}
                      >
                        <span
                          style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: hexConfig.border,
                          }}
                        />
                        {colorKey.charAt(0).toUpperCase() + colorKey.slice(1)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-main, #1F2430)", marginBottom: "6px" }}>
                  Urutan Tampilan
                </label>
                <input
                  type="number"
                  value={formData.urutan}
                  onChange={(e) => setFormData({ ...formData, urutan: parseInt(e.target.value) || 0 })}
                  style={{
                    width: "120px",
                    height: "38px",
                    padding: "6px 12px",
                    fontSize: "13px",
                    border: "1px solid var(--border-color, #E6E4DF)",
                    borderRadius: "4px",
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setIsFormModalOpen(false)}
                  style={{
                    minHeight: "44px",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "var(--text-main, #1F2430)",
                    backgroundColor: "#FFFFFF",
                    border: "1px solid var(--border-color, #E6E4DF)",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingForm}
                  style={{
                    minHeight: "44px",
                    padding: "8px 20px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#FFFFFF",
                    backgroundColor: "var(--accent-blue, #1F5FBF)",
                    border: "1px solid var(--accent-blue, #1F5FBF)",
                    borderRadius: "4px",
                    cursor: isSubmittingForm ? "not-allowed" : "pointer",
                    opacity: isSubmittingForm ? 0.7 : 1,
                  }}
                >
                  {isSubmittingForm ? "Menyimpan..." : editingGroup ? "Perbarui Grup" : "Simpan Grup"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Hapus Grup (Safe Dialog: Lepaskan / Pindahkan) */}
      {isDeleteModalOpen && groupToDelete && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "16px",
          }}
        >
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "8px",
              width: "100%",
              maxWidth: "480px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
              border: "1px solid var(--border-color, #E6E4DF)",
              padding: "20px",
            }}
          >
            <h3 style={{ margin: "0 0 10px 0", fontSize: "16px", fontWeight: 700, color: "#C8372D" }}>
              Hapus Grup '{groupToDelete.nama}'?
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-secondary, #5B6270)", lineHeight: "1.5", margin: "0 0 16px 0" }}>
              Grup ini memiliki <strong>{groupToDelete.totalDevices} perangkat</strong>. Perangkat Anda tidak akan dihapus dari sistem. Silakan tentukan ke mana perangkat anggota grup ini akan dialihkan:
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  padding: "10px 12px",
                  border: deleteAction === "detach" ? "1px solid var(--accent-blue, #1F5FBF)" : "1px solid var(--border-color, #E6E4DF)",
                  borderRadius: "4px",
                  backgroundColor: deleteAction === "detach" ? "rgba(31, 95, 191, 0.04)" : "#FFFFFF",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="deleteAction"
                  checked={deleteAction === "detach"}
                  onChange={() => setDeleteAction("detach")}
                  style={{ marginTop: "2px" }}
                />
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main, #1F2430)" }}>
                    Lepaskan seluruh perangkat
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary, #5B6270)" }}>
                    Perangkat menjadi 'Tanpa Grup' (dapat dikelompokkan kembali nanti).
                  </div>
                </div>
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  padding: "10px 12px",
                  border: deleteAction === "move" ? "1px solid var(--accent-blue, #1F5FBF)" : "1px solid var(--border-color, #E6E4DF)",
                  borderRadius: "4px",
                  backgroundColor: deleteAction === "move" ? "rgba(31, 95, 191, 0.04)" : "#FFFFFF",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="deleteAction"
                  checked={deleteAction === "move"}
                  onChange={() => setDeleteAction("move")}
                  style={{ marginTop: "2px" }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main, #1F2430)" }}>
                    Pindahkan seluruh perangkat ke grup lain
                  </div>
                  {deleteAction === "move" && (
                    <select
                      value={targetMoveGroupId}
                      onChange={(e) => setTargetMoveGroupId(e.target.value)}
                      style={{
                        width: "100%",
                        height: "36px",
                        marginTop: "8px",
                        fontSize: "13px",
                        borderRadius: "4px",
                        border: "1px solid var(--border-color, #E6E4DF)",
                        padding: "4px 8px",
                      }}
                    >
                      <option value="">-- Pilih Grup Tujuan --</option>
                      {groups
                        .filter((g) => g.id !== groupToDelete.id)
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.nama} ({g.totalDevices} perangkat)
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                style={{
                  minHeight: "44px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "var(--text-main, #1F2430)",
                  backgroundColor: "#FFFFFF",
                  border: "1px solid var(--border-color, #E6E4DF)",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isSubmittingDelete}
                style={{
                  minHeight: "44px",
                  padding: "8px 18px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#FFFFFF",
                  backgroundColor: "#C8372D",
                  border: "1px solid #C8372D",
                  borderRadius: "4px",
                  cursor: isSubmittingDelete ? "not-allowed" : "pointer",
                  opacity: isSubmittingDelete ? 0.7 : 1,
                }}
              >
                {isSubmittingDelete ? "Menghapus..." : "Hapus Grup"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: "Buat grup dari Lokasi" (Preview & Apply) */}
      {isLocationModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "16px",
          }}
        >
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "8px",
              width: "100%",
              maxWidth: "680px",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
              border: "1px solid var(--border-color, #E6E4DF)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--border-color, #E6E4DF)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--text-main, #1F2430)" }}>
                  Pratinjau Pembuatan Grup dari Lokasi
                </h3>
                <p style={{ margin: "3px 0 0 0", fontSize: "12px", color: "var(--text-secondary, #5B6270)" }}>
                  Normalisasi nilai kolom Lokasi (spasi, huruf besar/kecil, garis bawah) tanpa mengubah nilai lokasi asli.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsLocationModalOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "18px",
                  cursor: "pointer",
                  color: "var(--text-secondary, #5B6270)",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "20px", overflowY: "auto", flex: 1 }}>
              {isLoadingLocationPreview && (
                <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-secondary, #5B6270)", fontSize: "13px" }}>
                  Menganalisis lokasi perangkat...
                </div>
              )}

              {locationPreview && (
                <div>
                  <div
                    style={{
                      display: "flex",
                      gap: "12px",
                      marginBottom: "16px",
                      padding: "12px",
                      backgroundColor: "#FAFAF8",
                      borderRadius: "6px",
                      border: "1px solid var(--border-color, #E6E4DF)",
                      fontSize: "12px",
                    }}
                  >
                    <div>
                      <strong>{locationPreview.totalDevices}</strong> Perangkat Berlokasi
                    </div>
                    <div>•</div>
                    <div>
                      <strong>{locationPreview.newGroupsCount}</strong> Grup Baru yang akan dibuat
                    </div>
                    <div>•</div>
                    <div>
                      <strong>{locationPreview.existingGroupsMatchedCount}</strong> Cocok dengan Grup yang sudah ada
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {locationPreview.preview.map((item) => (
                      <div
                        key={item.normalizedKey}
                        style={{
                          border: "1px solid var(--border-color, #E6E4DF)",
                          borderRadius: "6px",
                          padding: "12px 14px",
                          backgroundColor: "#FFFFFF",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main, #1F2430)" }}>
                              {item.proposedName}
                            </span>
                            <span
                              style={{
                                marginLeft: "8px",
                                fontSize: "11px",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                backgroundColor: item.existingGroup ? "rgba(31, 95, 191, 0.08)" : "rgba(34, 197, 94, 0.1)",
                                color: item.existingGroup ? "var(--accent-blue, #1F5FBF)" : "#15803d",
                                fontWeight: 600,
                              }}
                            >
                              {item.existingGroup ? "Grup Sudah Ada" : "Grup Baru"}
                            </span>
                          </div>
                          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary, #5B6270)" }}>
                            {item.deviceCount} perangkat
                          </span>
                        </div>

                        <div style={{ fontSize: "12px", color: "var(--text-secondary, #5B6270)", marginTop: "6px" }}>
                          Contoh teks lokasi asal: <code>"{item.sampleRawLocation}"</code>
                        </div>

                        <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {item.devices.map((d) => (
                            <span
                              key={d.id}
                              style={{
                                fontSize: "11px",
                                padding: "2px 8px",
                                backgroundColor: "#FAFAF8",
                                border: "1px solid var(--border-color, #E6E4DF)",
                                borderRadius: "3px",
                                color: "var(--text-main, #1F2430)",
                              }}
                            >
                              {d.name} {d.ipAddress ? `(${d.ipAddress})` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div
              style={{
                padding: "16px 20px",
                borderTop: "1px solid var(--border-color, #E6E4DF)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                backgroundColor: "#FAFAF8",
              }}
            >
              <span style={{ fontSize: "12px", color: "var(--text-secondary, #5B6270)" }}>
                Kolom lokasi pada perangkat tidak akan diubah atau dihapus.
              </span>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setIsLocationModalOpen(false)}
                  style={{
                    minHeight: "44px",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "var(--text-main, #1F2430)",
                    backgroundColor: "#FFFFFF",
                    border: "1px solid var(--border-color, #E6E4DF)",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleApplyLocation}
                  disabled={isApplyingLocation || !locationPreview || locationPreview.preview.length === 0}
                  style={{
                    minHeight: "44px",
                    padding: "8px 20px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#FFFFFF",
                    backgroundColor: "var(--accent-blue, #1F5FBF)",
                    border: "1px solid var(--accent-blue, #1F5FBF)",
                    borderRadius: "4px",
                    cursor: isApplyingLocation ? "not-allowed" : "pointer",
                    opacity: isApplyingLocation ? 0.7 : 1,
                  }}
                >
                  {isApplyingLocation ? "Menerapkan..." : "Terapkan Sekarang"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
