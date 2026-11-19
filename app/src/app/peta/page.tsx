"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { useLiveUpdates } from "@/components/LiveUpdateProvider";
import { useCurrentUser } from "@/components/UserProvider";
import { NodeDetailDrawer } from "@/components/peta/NodeDetailDrawer";
import { GroupDetailDrawer } from "@/components/peta/GroupDetailDrawer";
import { UnplacedDevicesPanel } from "@/components/peta/UnplacedDevicesPanel";
import { TopologyListView } from "@/components/peta/TopologyListView";
import { NocSummaryWidgets, NocRingkasanData } from "@/components/peta/NocSummaryWidgets";
import { RawNode, RawGroup, RawLink } from "@/components/peta/NetworkTopologyCanvas";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import {
  getSafeCollapsedGroups,
  setSafeCollapsedGroups,
  clearSafeCollapsedGroups,
} from "@/lib/safe-storage";

// Dynamic import untuk kanvas React Flow agar bundle halaman lain tetap ramping
const NetworkTopologyCanvas = dynamic(
  () => import("@/components/peta/NetworkTopologyCanvas"),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--bg-app, #FAFAF8)",
          color: "var(--text-secondary, #5B6270)",
          fontSize: "13px",
        }}
      >
        Memuat kanvas topologi jaringan...
      </div>
    ),
  }
);

interface PetaApiResponse {
  peta: {
    id: string;
    nama: string;
    isDefault: boolean;
    isDemo: boolean;
    createdAt: string;
  };
  daftarPeta: Array<{
    id: string;
    nama: string;
    isDefault: boolean;
  }>;
  grup: RawGroup[];
  node: RawNode[];
  link: RawLink[];
  belumDitempatkan: Array<{
    id: string;
    name: string;
    type: string;
    ipAddress: string | null;
    location: string | null;
    status: string;
  }>;
  ringkasan: NocRingkasanData;
  versi: number;
  tampilan?: {
    grup_terlipat: string[];
  };
  currentUser?: {
    username: string;
    role: "admin" | "viewer";
  };
}

export default function PetaJaringanPage() {
  const [data, setData] = useState<PetaApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedPetaId, setSelectedPetaId] = useState<string | null>(null);

  // Filter & Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterLocation, setFilterLocation] = useState<string | null>(null);
  const [filterGroup, setFilterGroup] = useState<string | null>(null);

  // View Controls
  const [viewMode, setViewMode] = useState<"peta" | "daftar">("peta");
  const { isMonitorMode, setIsMonitorMode, currentUser: contextUser } = useCurrentUser();
  const [isEditMode, setIsEditMode] = useState(false);
  const [showNocDrawer, setShowNocDrawer] = useState(false);

  // Node & Group Detail State
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedGroupIdForDrawer, setSelectedGroupIdForDrawer] = useState<string | null>(null);

  // Sync parameter group dari URL query
  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const urlGroup = sp.get("group") || sp.get("groupId");
      if (urlGroup) {
        setFilterGroup(urlGroup);
      }
    }
  }, []);

  // Auto-save Status Text
  // Auto-save Status & Antrian
  const [saveStatusText, setSaveStatusText] = useState("Tersimpan");
  const [isAutoPlacing, setIsAutoPlacing] = useState(false);

  // Status Lipat/Buka Grup (Preferensi Tampilan per Pengguna & Peta)
  // Dimulai dari Set kosong pada SSR server untuk mencegah hydration mismatch
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set<string>());

  // Sinkronkan preferensi tampilan dari safeStorage saat client mount atau selectedPetaId berubah
  useEffect(() => {
    if (!selectedPetaId) return;
    const safeSaved = getSafeCollapsedGroups(selectedPetaId);
    if (safeSaved.length > 0) {
      setCollapsedGroupIds(new Set(safeSaved));
    }
  }, [selectedPetaId]);

  // Sinkronkan preferensi tampilan begitu respons server tiba (server menang jika ada perbedaan)
  useEffect(() => {
    if (data?.tampilan?.grup_terlipat && Array.isArray(data.tampilan.grup_terlipat)) {
      const validGroupIds = new Set((data.grup || []).map((g) => g?.id).filter(Boolean));
      const filtered = data.tampilan.grup_terlipat.filter((id) => typeof id === "string" && validGroupIds.has(id));
      setCollapsedGroupIds(new Set(filtered));
      setSafeCollapsedGroups(filtered, selectedPetaId || undefined);
    }
  }, [data?.tampilan?.grup_terlipat, data?.grup, selectedPetaId]);

  // Debounced simpan preferensi tampilan ke endpoint PUT /api/peta/[id]/tampilan (500 ms)
  const debouncedSaveTampilanRef = useRef<NodeJS.Timeout | null>(null);

  const handleToggleCollapse = useCallback(
    (groupId: string) => {
      setCollapsedGroupIds((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) {
          next.delete(groupId);
        } else {
          next.add(groupId);
        }
        const arr = Array.from(next);

        // 1. Simpan instan ke safeStorage terpusat
        setSafeCollapsedGroups(arr, selectedPetaId || undefined);

        // 2. Debounce simpan ke server (500ms)
        if (debouncedSaveTampilanRef.current) {
          clearTimeout(debouncedSaveTampilanRef.current);
        }
        if (selectedPetaId) {
          debouncedSaveTampilanRef.current = setTimeout(async () => {
            try {
              await fetch(`/api/peta/${selectedPetaId}/tampilan`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ grupTerlipat: arr }),
              });
            } catch (err) {
              console.error("Gagal menyimpan preferensi tampilan:", err);
            }
          }, 500);
        }

        return next;
      });
    },
    [selectedPetaId]
  );

  const handleResetGroupView = useCallback(() => {
    setCollapsedGroupIds(new Set());
    clearSafeCollapsedGroups(selectedPetaId || undefined);
    if (selectedPetaId) {
      fetch(`/api/peta/${selectedPetaId}/tampilan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grupTerlipat: [] }),
      }).catch((err) => {
        console.error("Gagal mereset preferensi tampilan:", err);
      });
    }
  }, [selectedPetaId]);

  // Toast & Banner Notifikasi Non-Blokir
  const [toasts, setToasts] = useState<Array<{
    id: string;
    type: "info" | "warning" | "error" | "success";
    message: string;
    actionText?: string;
    onAction?: () => void;
  }>>([]);
  const [externalUpdateAvailable, setExternalUpdateAvailable] = useState(false);

  const showToast = useCallback(
    (
      message: string,
      type: "info" | "warning" | "error" | "success" = "error",
      opts?: { actionText?: string; onAction?: () => void }
    ) => {
      const id = `t_${Date.now()}_${Math.random()}`;
      setToasts((prev) => [...prev, { id, message, type, ...opts }]);
      if (!opts?.actionText) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 4000);
      }
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Identitas Klien per Tab
  const clientIdRef = useRef<string>("");
  useEffect(() => {
    clientIdRef.current = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }, []);

  // Versi Lokal Peta
  const localVersionRef = useRef<number>(0);
  useEffect(() => {
    if (data?.versi) {
      localVersionRef.current = Math.max(localVersionRef.current, data.versi);
    }
  }, [data?.versi]);

  // Antrian Simpan & Coalescing
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef<{
    nodes: Array<{ id: string; x: number; y: number; terkunci?: boolean; groupId?: string | null }>;
    groups: Array<{ id: string; x: number; y: number; lebar?: number; tinggi?: number }>;
  } | null>(null);
  const lastFailedSaveRef = useRef<{
    nodes: Array<{ id: string; x: number; y: number; terkunci?: boolean; groupId?: string | null }>;
    groups: Array<{ id: string; x: number; y: number; lebar?: number; tinggi?: number }>;
  } | null>(null);

  // Fetch Data Peta (satu request tunggal teragregasi)
  const fetchPetaData = useCallback(async (petaId?: string | null) => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const url = petaId ? `/api/peta?peta_id=${petaId}` : "/api/peta";
      const res = await fetch(url);
      if (!res.ok) {
        const errMsg = `Gagal memuat data peta (HTTP ${res.status}: ${res.statusText})`;
        console.error(errMsg);
        setFetchError(errMsg);
        return;
      }
      const json: PetaApiResponse = await res.json();
      // Validasi bentuk defensif agar tidak melempar TypeError saat data null/kosong
      const defaultRingkasan: NocRingkasanData = {
        totalNodes: 0,
        onlineCount: 0,
        logStoppedCount: 0,
        offlineCount: 0,
        unknownCount: 0,
        insiden: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
        perJenis: [],
        heatmap: [],
        alarmTerbaru: [],
      };
      const safeData: PetaApiResponse = {
        ...json,
        node: Array.isArray(json?.node) ? json.node : [],
        grup: Array.isArray(json?.grup) ? json.grup : [],
        link: Array.isArray(json?.link) ? json.link : [],
        ringkasan: json?.ringkasan ? { ...defaultRingkasan, ...json.ringkasan } : defaultRingkasan,
      };
      if (!Array.isArray(safeData.ringkasan.heatmap)) safeData.ringkasan.heatmap = [];

      setData(safeData);
      setSelectedPetaId((prev) => prev || json?.peta?.id);
      if (json?.versi) {
        localVersionRef.current = Math.max(localVersionRef.current, json.versi);
      }
    } catch (err: any) {
      const errMsg = `Terjadi kesalahan saat memuat peta: ${err?.message || "Koneksi bermasalah"}`;
      console.error("Gagal memuat peta jaringan:", err);
      setFetchError(errMsg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPetaData(selectedPetaId);
  }, [selectedPetaId, fetchPetaData]);

  // Live SSE: Perbarui node tertentu in-place tanpa fetch ulang seluruh peta
  const { subscribe } = useLiveUpdates();
  useEffect(() => {
    // 1. Status perangkat berubah
    const unsubStatus = subscribe("perangkat.status", (evt) => {
      if (!evt.perangkat_id) return;
      setData((prev) => {
        if (!prev) return prev;
        const currentNodes = Array.isArray(prev.node) ? prev.node : [];
        const updatedNodes = currentNodes.map((n) => {
          if (n.deviceId === evt.perangkat_id && evt.data_ringkas) {
            return {
              ...n,
              status: (evt.data_ringkas.status_perangkat as any) || n.status,
              pingStatus: evt.data_ringkas.ping_ok ? ("up" as const) : ("rto" as const),
              rttMs: evt.data_ringkas.ping_rtt ?? n.rttMs,
            };
          }
          return n;
        });

        // Update juga data heatmap di ringkasan secara aman
        const currentHeatmap = Array.isArray(prev.ringkasan?.heatmap) ? prev.ringkasan.heatmap : [];
        const updatedHeatmap = currentHeatmap.map((h) => {
          if (h.id === evt.perangkat_id && evt.data_ringkas) {
            return {
              ...h,
              status: (evt.data_ringkas.status_perangkat as any) || h.status,
              rttMs: evt.data_ringkas.ping_rtt ?? h.rttMs,
            };
          }
          return h;
        });

        return {
          ...prev,
          node: updatedNodes,
          ringkasan: {
            ...prev.ringkasan,
            heatmap: updatedHeatmap,
          },
        };
      });
    });

    // 2. Ping perangkat diperbarui
    const unsubPing = subscribe("perangkat.ping", (evt) => {
      if (!evt.perangkat_id) return;
      setData((prev) => {
        if (!prev) return prev;
        const currentNodes = Array.isArray(prev.node) ? prev.node : [];
        const updatedNodes = currentNodes.map((n) => {
          if (n.deviceId === evt.perangkat_id && evt.data_ringkas) {
            return {
              ...n,
              pingStatus: evt.data_ringkas.ping_ok ? ("up" as const) : ("rto" as const),
              rttMs: evt.data_ringkas.ping_rtt ?? n.rttMs,
            };
          }
          return n;
        });
        return { ...prev, node: updatedNodes };
      });
    });

    // 3. Tata letak peta diubah oleh admin lain
    const unsubPeta = subscribe("peta.berubah", (evt) => {
      // Abaikan event dari tab sendiri
      if (evt.clientId && evt.clientId === clientIdRef.current) return;
      if (evt.data_ringkas?.id_peta && evt.data_ringkas.id_peta !== selectedPetaId) return;

      if (isEditMode) {
        // Tampilkan chip/banner non-blokir saat sedang mengedit
        setExternalUpdateAvailable(true);
      } else {
        // Terapkan perubahan posisi secara diam-diam bila tidak di mode edit
        if (evt.data_ringkas?.node_diubah && Array.isArray(evt.data_ringkas.node_diubah)) {
          const changedMap = new Map<string, any>(
            evt.data_ringkas.node_diubah.map((n: any) => [n.id, n])
          );
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              node: prev.node.map((n) => {
                const c = changedMap.get(n.id);
                return c ? { ...n, x: c.x, y: c.y, groupId: c.groupId ?? n.groupId } : n;
              }),
            };
          });
        } else {
          fetchPetaData(selectedPetaId);
        }
      }
    });

    // 4. Grup perangkat diperbarui (nama/warna/anggota)
    const unsubGrup = subscribe("grup.berubah", (evt) => {
      // Abaikan event dari tab sendiri
      if (evt.clientId && evt.clientId === clientIdRef.current) return;
      fetchPetaData(selectedPetaId);
    });

    return () => {
      unsubStatus();
      unsubPing();
      unsubPeta();
      unsubGrup();
    };
  }, [subscribe, selectedPetaId, isEditMode, fetchPetaData]);

  // Handler simpan posisi node & grup (Antrian atomik, non-blocking, last-write-wins)
  const handleSaveLayout = useCallback(
    async (
      changedNodes: Array<{ id: string; x: number; y: number; terkunci?: boolean; groupId?: string | null }>,
      changedGroups: Array<{ id: string; x: number; y: number; lebar?: number; tinggi?: number }>
    ): Promise<boolean> => {
      if (!selectedPetaId) return false;

      // OPTIMISTIC UPDATE: Langsung update data node & grup di memory parent seketika
      // agar tidak ada race condition atau revert posisi saat ada render/SSE ping
      setData((prev) => {
        if (!prev) return prev;
        const nodeMap = new Map(changedNodes.map((cn) => [cn.id, cn]));
        const groupMap = new Map(changedGroups.map((cg) => [cg.id, cg]));
        return {
          ...prev,
          node: prev.node.map((n) => {
            const cn = nodeMap.get(n.id);
            if (cn) {
              return {
                ...n,
                x: cn.x,
                y: cn.y,
                groupId: cn.groupId !== undefined ? cn.groupId : n.groupId,
                terkunci: cn.terkunci !== undefined ? cn.terkunci : n.terkunci,
              };
            }
            return n;
          }),
          grup: prev.grup.map((g) => {
            const cg = groupMap.get(g.id);
            if (cg) {
              return {
                ...g,
                x: cg.x,
                y: cg.y,
                lebar: cg.lebar !== undefined ? cg.lebar : g.lebar,
                tinggi: cg.tinggi !== undefined ? cg.tinggi : g.tinggi,
              };
            }
            return g;
          }),
        };
      });

      // Antrian (coalesce) jika sedang ada permintaan berjalan
      if (isSavingRef.current) {
        pendingSaveRef.current = { nodes: changedNodes, groups: changedGroups };
        return true;
      }

      isSavingRef.current = true;
      setSaveStatusText("Menyimpan...");

      // Timeout 15 detik
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const res = await fetch(`/api/peta/${selectedPetaId}/layout`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            nodes: changedNodes,
            groups: changedGroups,
            clientId: clientIdRef.current,
            version: localVersionRef.current,
          }),
        });

        clearTimeout(timeoutId);

        if (res.ok) {
          const resJson = await res.json();
          if (resJson.versi) {
            localVersionRef.current = resJson.versi;
          }
          setSaveStatusText("Tersimpan");
          lastFailedSaveRef.current = null;
          return true;
        } else {
          const errJson = await res.json().catch(() => ({}));
          setSaveStatusText("Gagal menyimpan");
          lastFailedSaveRef.current = { nodes: changedNodes, groups: changedGroups };
          showToast(errJson.error || "Gagal menyimpan perubahan tata letak.", "error", {
            actionText: "Coba Lagi",
            onAction: () => {
              if (lastFailedSaveRef.current) {
                handleSaveLayout(lastFailedSaveRef.current.nodes, lastFailedSaveRef.current.groups);
              }
            },
          });
          return false;
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        setSaveStatusText("Gagal menyimpan");
        lastFailedSaveRef.current = { nodes: changedNodes, groups: changedGroups };
        const isTimeout = err?.name === "AbortError";
        showToast(
          isTimeout ? "Waktu simpan habis (timeout 15 detik)." : "Koneksi ke server terputus saat menyimpan.",
          "error",
          {
            actionText: "Coba Lagi",
            onAction: () => {
              if (lastFailedSaveRef.current) {
                handleSaveLayout(lastFailedSaveRef.current.nodes, lastFailedSaveRef.current.groups);
              }
            },
          }
        );
        return false;
      } finally {
        isSavingRef.current = false;
        // Jika ada perubahan baru yang masuk saat simpan berlangsung, proses segera
        if (pendingSaveRef.current) {
          const next = pendingSaveRef.current;
          pendingSaveRef.current = null;
          handleSaveLayout(next.nodes, next.groups);
        }
      }
    },
    [selectedPetaId, showToast]
  );

  // Handler hubungkan node (link)
  const handleCreateLink = useCallback(
    async (sourceNodeId: string, targetNodeId: string) => {
      if (!selectedPetaId) return;
      try {
        const res = await fetch(`/api/peta/${selectedPetaId}/links`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceNodeId, targetNodeId, tipe: "kabel" }),
        });
        if (res.ok) {
          fetchPetaData(selectedPetaId);
          showToast("Hubungan node berhasil dibuat.", "success");
        } else {
          const err = await res.json();
          showToast(err.error || "Gagal membuat hubungan node.", "warning");
        }
      } catch {
        showToast("Gagal menghubungi server.", "error");
      }
    },
    [selectedPetaId, fetchPetaData, showToast]
  );

  // Handler hapus link
  const handleDeleteLink = useCallback(
    async (linkId: string) => {
      if (!selectedPetaId) return;
      try {
        const res = await fetch(`/api/peta/${selectedPetaId}/links/${linkId}`, {
          method: "DELETE",
        });
        if (res.ok) {
          fetchPetaData(selectedPetaId);
          showToast("Hubungan node berhasil dihapus.", "info");
        } else {
          showToast("Gagal menghapus hubungan koneksi.", "error");
        }
      } catch {
        showToast("Gagal menghapus hubungan koneksi.", "error");
      }
    },
    [selectedPetaId, fetchPetaData, showToast]
  );

  // Handler taruh perangkat dari panel samping ke kanvas
  const handleDropDevice = useCallback(
    async (deviceId: string, x: number, y: number) => {
      if (!selectedPetaId) return;
      try {
        const res = await fetch(`/api/peta/${selectedPetaId}/nodes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId, x, y }),
        });
        if (res.ok) {
          fetchPetaData(selectedPetaId);
          showToast("Perangkat berhasil ditempatkan di peta.", "success");
        } else {
          const err = await res.json();
          showToast(err.error || "Gagal menempatkan perangkat.", "error");
        }
      } catch {
        showToast("Gagal menghubungi server saat menempatkan perangkat.", "error");
      }
    },
    [selectedPetaId, fetchPetaData, showToast]
  );

  // Handler tambah node virtual
  const handleAddVirtualNode = useCallback(
    async (tipeVirtual: string, label: string) => {
      if (!selectedPetaId) return;

      // Cegah tumpang tindih total saat menempatkan node virtual baru
      let finalX = 250;
      let finalY = 150;
      let attempts = 0;
      while (
        data?.node &&
        data.node.some((n) => Math.abs(n.x - finalX) < 40 && Math.abs(n.y - finalY) < 35) &&
        attempts < 10
      ) {
        attempts++;
        finalX += 50;
        finalY += 35;
      }

      try {
        const res = await fetch(`/api/peta/${selectedPetaId}/nodes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipeVirtual, label, x: finalX, y: finalY }),
        });
        if (res.ok) {
          fetchPetaData(selectedPetaId);
          showToast(`Node virtual "${label || tipeVirtual}" berhasil ditambahkan.`, "success");
        } else {
          const err = await res.json().catch(() => ({}));
          showToast(err.error || "Gagal menambahkan node virtual.", "error");
        }
      } catch {
        showToast("Gagal menambahkan node virtual.", "error");
      }
    },
    [selectedPetaId, fetchPetaData, showToast]
  );

  // Handler tambah grup lokasi
  const handleAddGroup = useCallback(
    async (nama: string, warna: "biru" | "merah" | "abu") => {
      if (!selectedPetaId) return;
      try {
        const res = await fetch(`/api/peta/${selectedPetaId}/groups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nama, warnaGaris: warna, x: 100, y: 100 }),
        });
        if (res.ok) {
          fetchPetaData(selectedPetaId);
          showToast(`Grup area "${nama}" berhasil dibuat.`, "success");
        } else {
          const err = await res.json().catch(() => ({}));
          showToast(err.error || "Gagal menambahkan grup area.", "error");
        }
      } catch {
        showToast("Gagal menambahkan grup area.", "error");
      }
    },
    [selectedPetaId, fetchPetaData, showToast]
  );

  // Handler tempatkan otomatis
  const handleAutoPlace = useCallback(async () => {
    if (!selectedPetaId) return;
    setIsAutoPlacing(true);
    try {
      const res = await fetch(`/api/peta/${selectedPetaId}/auto-place`, {
        method: "POST",
      });
      if (res.ok) {
        fetchPetaData(selectedPetaId);
        showToast("Perangkat berhasil ditata otomatis ke kanvas.", "success");
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || "Gagal menata perangkat otomatis.", "error");
      }
    } catch {
      showToast("Gagal menata perangkat otomatis.", "error");
    } finally {
      setIsAutoPlacing(false);
    }
  }, [selectedPetaId, fetchPetaData, showToast]);

  // Daftar unik lokasi untuk filter
  const uniqueLocations = useMemo(() => {
    if (!data?.node) return [];
    const locs = new Set<string>();
    data.node.forEach((n) => {
      if (n.lokasi) locs.add(n.lokasi.trim());
    });
    return Array.from(locs);
  }, [data?.node]);

  // Node yang difilter untuk kanvas & daftar
  const filteredNodes = useMemo(() => {
    if (!data?.node) return [];

    const matchedGroup = filterGroup
      ? data?.grup.find((g) => g.id === filterGroup || (g as any).deviceGroupId === filterGroup)
      : null;
    const targetGroupId = matchedGroup?.id || filterGroup;

    return data.node.filter((n) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchName = n.nama.toLowerCase().includes(q);
        const matchIp = n.ip ? n.ip.toLowerCase().includes(q) : false;
        if (!matchName && !matchIp) return false;
      }
      if (filterStatus && n.status !== filterStatus) return false;
      if (filterType && n.tipe.toLowerCase() !== filterType.toLowerCase()) return false;
      if (filterLocation && n.lokasi !== filterLocation) return false;
      if (targetGroupId && n.groupId !== targetGroupId) return false;
      return true;
    });
  }, [data?.node, data?.grup, searchQuery, filterStatus, filterType, filterLocation, filterGroup]);

  const isAdmin = (contextUser?.role || data?.currentUser?.role) === "admin";

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-app, #FAFAF8)", display: "flex", flexDirection: "column" }}>
      {/* BILAH ATAS KONTROL PETA */}
      <div
        style={{
          backgroundColor: "var(--bg-panel, #FFFFFF)",
          borderBottom: "1px solid var(--border-color, #E6E4DF)",
          padding: "10px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          zIndex: 30,
        }}
      >
        {/* Sisi Kiri: Judul, Pemilih Peta, Search, Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          <h1
            style={{
              fontSize: "16px",
              fontWeight: 700,
              color: "var(--text-main, #1F2430)",
              letterSpacing: "-0.2px",
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span style={{ color: "var(--accent-blue, #1F5FBF)" }}>🗺️</span>
            <span>Peta Jaringan</span>
          </h1>

          {/* Pemilih Peta */}
          {data?.daftarPeta && data.daftarPeta.length > 1 && (
            <select
              value={selectedPetaId || ""}
              onChange={(e) => setSelectedPetaId(e.target.value)}
              style={{
                padding: "4px 8px",
                fontSize: "12px",
                borderRadius: "4px",
                border: "1px solid var(--border-color, #E6E4DF)",
                backgroundColor: "#FFFFFF",
              }}
            >
              {data.daftarPeta.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nama} {p.isDefault ? "(Utama)" : ""}
                </option>
              ))}
            </select>
          )}

          {/* Kotak Pencarian Node */}
          <div style={{ position: "relative", minWidth: "160px" }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari node / IP..."
              style={{
                width: "100%",
                padding: "5px 8px 5px 24px",
                fontSize: "12px",
                borderRadius: "4px",
                border: "1px solid var(--border-color, #E6E4DF)",
                boxSizing: "border-box",
              }}
            />
            <span
              style={{
                position: "absolute",
                left: "7px",
                top: "6px",
                fontSize: "11px",
                color: "var(--text-muted, #8C93A0)",
                pointerEvents: "none",
              }}
            >
              🔍
            </span>
          </div>

          {/* Filter Status */}
          <select
            value={filterStatus || ""}
            onChange={(e) => setFilterStatus(e.target.value || null)}
            style={{
              padding: "5px 8px",
              fontSize: "11px",
              borderRadius: "4px",
              border: "1px solid var(--border-color, #E6E4DF)",
              backgroundColor: "#FFFFFF",
            }}
          >
            <option value="">Semua Status</option>
            <option value="online">Online</option>
            <option value="log_stopped">Log Berhenti</option>
            <option value="offline">Offline</option>
            <option value="unknown">Belum Ada Data</option>
          </select>

          {/* Filter Tipe */}
          <select
            value={filterType || ""}
            onChange={(e) => setFilterType(e.target.value || null)}
            style={{
              padding: "5px 8px",
              fontSize: "11px",
              borderRadius: "4px",
              border: "1px solid var(--border-color, #E6E4DF)",
              backgroundColor: "#FFFFFF",
            }}
          >
            <option value="">Semua Tipe</option>
            <option value="mikrotik">MikroTik</option>
            <option value="switch">Switch</option>
            <option value="firewall">Firewall</option>
            <option value="windows">Windows</option>
            <option value="linux">Linux</option>
            <option value="internet">Internet</option>
            <option value="cloud">Cloud</option>
          </select>

          {/* Filter Lokasi */}
          {uniqueLocations.length > 0 && (
            <select
              value={filterLocation || ""}
              onChange={(e) => setFilterLocation(e.target.value || null)}
              style={{
                padding: "5px 8px",
                fontSize: "11px",
                borderRadius: "4px",
                border: "1px solid var(--border-color, #E6E4DF)",
                backgroundColor: "#FFFFFF",
              }}
            >
              <option value="">Semua Lokasi</option>
              {uniqueLocations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          )}

          {/* Filter Grup / Area */}
          {data?.grup && data.grup.length > 0 && (
            <select
              value={filterGroup || ""}
              onChange={(e) => {
                const val = e.target.value || null;
                setFilterGroup(val);
                if (typeof window !== "undefined") {
                  const url = new URL(window.location.href);
                  if (val) {
                    url.searchParams.set("group", val);
                  } else {
                    url.searchParams.delete("group");
                  }
                  window.history.replaceState({}, "", url.toString());
                }
              }}
              style={{
                padding: "5px 8px",
                fontSize: "11px",
                borderRadius: "4px",
                border: "1px solid var(--border-color, #E6E4DF)",
                backgroundColor: "#FFFFFF",
              }}
            >
              <option value="">Semua Area</option>
              {data.grup.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nama}
                </option>
              ))}
            </select>
          )}

          {/* Reset Filter jika aktif */}
          {(filterStatus || filterType || filterLocation || filterGroup || searchQuery) && (
            <button
              type="button"
              onClick={() => {
                setFilterStatus(null);
                setFilterType(null);
                setFilterLocation(null);
                setFilterGroup(null);
                setSearchQuery("");
                if (typeof window !== "undefined") {
                  const url = new URL(window.location.href);
                  url.searchParams.delete("group");
                  window.history.replaceState({}, "", url.toString());
                }
              }}
              style={{
                padding: "4px 8px",
                fontSize: "10px",
                border: "none",
                background: "transparent",
                color: "var(--accent-red, #C8372D)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reset Filter ✕
            </button>
          )}
        </div>

        {/* Sisi Kanan: Toggle View, Mode Pantau, Mode Edit (Admin) */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {/* Toggle Peta | Daftar */}
          <div
            style={{
              display: "flex",
              backgroundColor: "var(--bg-app, #FAFAF8)",
              border: "1px solid var(--border-color, #E6E4DF)",
              borderRadius: "4px",
              padding: "2px",
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode("peta")}
              style={{
                padding: "4px 8px",
                fontSize: "11px",
                fontWeight: viewMode === "peta" ? 700 : 500,
                backgroundColor: viewMode === "peta" ? "var(--bg-panel, #FFFFFF)" : "transparent",
                border: "none",
                borderRadius: "3px",
                boxShadow: viewMode === "peta" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                cursor: "pointer",
                color: viewMode === "peta" ? "var(--text-main, #1F2430)" : "var(--text-secondary, #5B6270)",
              }}
            >
              Peta
            </button>
            <button
              type="button"
              onClick={() => setViewMode("daftar")}
              style={{
                padding: "4px 8px",
                fontSize: "11px",
                fontWeight: viewMode === "daftar" ? 700 : 500,
                backgroundColor: viewMode === "daftar" ? "var(--bg-panel, #FFFFFF)" : "transparent",
                border: "none",
                borderRadius: "3px",
                boxShadow: viewMode === "daftar" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                cursor: "pointer",
                color: viewMode === "daftar" ? "var(--text-main, #1F2430)" : "var(--text-secondary, #5B6270)",
              }}
            >
              Daftar
            </button>
          </div>

          {/* Tombol Analitik Ringkasan NOC (Dockable Bar) */}
          <button
            type="button"
            onClick={() => setShowNocDrawer(!showNocDrawer)}
            title="Tampilkan ringkasan metrik NOC di layar"
            style={{
              padding: "5px 10px",
              fontSize: "11px",
              fontWeight: 600,
              backgroundColor: showNocDrawer ? "rgba(31, 95, 191, 0.1)" : "var(--bg-panel, #FFFFFF)",
              border: "1px solid var(--border-color, #E6E4DF)",
              borderRadius: "4px",
              cursor: "pointer",
              color: showNocDrawer ? "var(--accent-blue, #1F5FBF)" : "var(--text-main, #1F2430)",
            }}
          >
            📊 Metrik NOC
          </button>

          {/* Tombol Mode Pantau (Bersih untuk Monitor NOC) */}
          <button
            type="button"
            onClick={() => setIsMonitorMode(!isMonitorMode)}
            title="Aktifkan tampilan bersih tanpa navbar untuk layar monitor"
            style={{
              padding: "5px 10px",
              fontSize: "11px",
              fontWeight: 600,
              backgroundColor: isMonitorMode ? "var(--text-main, #1F2430)" : "var(--bg-panel, #FFFFFF)",
              color: isMonitorMode ? "#FFFFFF" : "var(--text-main, #1F2430)",
              border: "1px solid var(--border-color, #E6E4DF)",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            🖥️ {isMonitorMode ? "Keluar Pantau" : "Mode Pantau"}
          </button>

          {/* Tombol Ubah Tata Letak (Admin Only) */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                if (window.innerWidth < 768) {
                  showToast("Penyuntingan tata letak peta lebih nyaman dilakukan pada layar tablet atau desktop (>= 768px).", "info");
                }
                setIsEditMode(!isEditMode);
              }}
              style={{
                padding: "5px 12px",
                fontSize: "11px",
                fontWeight: 600,
                backgroundColor: isEditMode ? "var(--accent-blue, #1F5FBF)" : "var(--bg-panel, #FFFFFF)",
                color: isEditMode ? "#FFFFFF" : "var(--accent-blue, #1F5FBF)",
                border: "1px solid var(--accent-blue, #1F5FBF)",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              {isEditMode ? "✓ Selesai Ubah" : "✏️ Ubah Tata Letak"}
            </button>
          )}
        </div>
      </div>

      {/* BANNER NOTIFIKASI PEMBARUAN EKSTERNAL */}
      {externalUpdateAvailable && (
        <div
          style={{
            backgroundColor: "#FFFFFF",
            borderBottom: "1px solid var(--accent-blue, #1F5FBF)",
            padding: "8px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "12px",
            color: "var(--text-main, #1F2430)",
            zIndex: 40,
          }}
        >
          <span>Peta baru saja diperbarui oleh pengguna lain.</span>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => {
                setExternalUpdateAvailable(false);
                fetchPetaData(selectedPetaId);
              }}
              style={{
                padding: "3px 10px",
                fontSize: "11px",
                fontWeight: 600,
                backgroundColor: "var(--accent-blue, #1F5FBF)",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "3px",
                cursor: "pointer",
              }}
            >
              Muat Perubahan
            </button>
            <button
              type="button"
              onClick={() => setExternalUpdateAvailable(false)}
              style={{
                border: "none",
                background: "transparent",
                color: "var(--text-secondary, #5B6270)",
                cursor: "pointer",
                padding: "0 4px",
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* FLOATING TOAST NOTIFIKASI */}
      {toasts.length > 0 && (
        <div
          style={{
            position: "fixed",
            top: "20px",
            right: "20px",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            maxWidth: "360px",
          }}
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              style={{
                backgroundColor: "#FFFFFF",
                borderLeft: `4px solid ${
                  t.type === "error"
                    ? "var(--accent-red, #C8372D)"
                    : t.type === "warning"
                    ? "#D97706"
                    : t.type === "success"
                    ? "#15803D"
                    : "var(--accent-blue, #1F5FBF)"
                }`,
                border: "1px solid var(--border-color, #E6E4DF)",
                borderRadius: "4px",
                padding: "10px 14px",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "10px",
                fontSize: "12px",
                color: "var(--text-main, #1F2430)",
              }}
            >
              <span style={{ flex: 1 }}>{t.message}</span>
              {t.actionText && t.onAction && (
                <button
                  type="button"
                  onClick={() => {
                    t.onAction?.();
                    removeToast(t.id);
                  }}
                  style={{
                    padding: "4px 8px",
                    fontSize: "11px",
                    fontWeight: 600,
                    backgroundColor: "var(--accent-blue, #1F5FBF)",
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: "3px",
                    cursor: "pointer",
                  }}
                >
                  {t.actionText}
                </button>
              )}
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--text-secondary, #5B6270)",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* KONTEN UTAMA: PETA ATAU DAFTAR */}
      <div style={{ flex: 1, position: "relative", display: "flex", overflow: "hidden" }}>
        {viewMode === "peta" ? (
          <>
            {/* Panel Samping Belum Ditempatkan (hanya tampil saat Mode Edit Admin Aktif) */}
            {isEditMode && isAdmin && (
              <UnplacedDevicesPanel
                unplacedDevices={data?.belumDitempatkan || []}
                onAddDeviceNode={(devId) => handleDropDevice(devId, 250, 250)}
                onAddVirtualNode={handleAddVirtualNode}
                onAddGroup={handleAddGroup}
                onAutoPlace={handleAutoPlace}
                isPlacingAuto={isAutoPlacing}
              />
            )}

            {/* Kanvas Utama React Flow */}
            <div style={{ flex: 1, height: "calc(100vh - 110px)", position: "relative" }}>
              {fetchError && (
                <div
                  role="alert"
                  style={{
                    position: "absolute",
                    top: "16px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 40,
                    backgroundColor: "#FEF2F2",
                    border: "1px solid #FCA5A5",
                    borderLeft: "4px solid #DC2626",
                    borderRadius: "6px",
                    padding: "8px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    fontSize: "12px",
                    color: "#991B1B",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                  }}
                >
                  <span style={{ fontWeight: 500 }}>⚠️ {fetchError}</span>
                  <button
                    type="button"
                    onClick={() => fetchPetaData(selectedPetaId)}
                    style={{
                      padding: "4px 10px",
                      fontSize: "11px",
                      fontWeight: 600,
                      backgroundColor: "#DC2626",
                      color: "#FFFFFF",
                      borderRadius: "4px",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    Coba Lagi
                  </button>
                </div>
              )}

              <SectionErrorBoundary
                sectionName="Peta Topologi"
                onReset={() => fetchPetaData(selectedPetaId)}
                fallbackAction={
                  <button
                    type="button"
                    onClick={() => setViewMode("daftar")}
                    style={{
                      padding: "8px 16px",
                      fontSize: "12px",
                      fontWeight: 500,
                      color: "var(--text-main, #1F2430)",
                      backgroundColor: "var(--bg-panel, #FFFFFF)",
                      border: "1px solid var(--border-subtle, #D1D5DB)",
                      borderRadius: "5px",
                      cursor: "pointer",
                    }}
                  >
                    Buka Tampilan Daftar
                  </button>
                }
              >
                <NetworkTopologyCanvas
                  mapId={selectedPetaId || ""}
                  initialNodes={filteredNodes}
                  initialGroups={data?.grup || []}
                  initialLinks={data?.link || []}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={(id) => {
                    setSelectedNodeId(id);
                    if (id) setSelectedGroupIdForDrawer(null);
                  }}
                  onSelectGroup={(id) => {
                    setSelectedGroupIdForDrawer(id);
                    if (id) setSelectedNodeId(null);
                  }}
                  focusedGroupId={filterGroup}
                  isEditMode={isEditMode}
                  collapsedGroupIds={collapsedGroupIds}
                  onToggleCollapse={handleToggleCollapse}
                  onResetGroupView={handleResetGroupView}
                  onSaveLayout={handleSaveLayout}
                  onCreateLink={handleCreateLink}
                  onDeleteLink={handleDeleteLink}
                  onDropDevice={handleDropDevice}
                  saveStatusText={saveStatusText}
                  onNotify={showToast}
                />
              </SectionErrorBoundary>
            </div>
          </>
        ) : (
          /* Tampilan Alternatif Daftar yang Aksesibel */
          <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto", maxWidth: "1000px", margin: "0 auto", width: "100%" }}>
            <TopologyListView
              nodes={filteredNodes}
              onSelectNode={(id) => setSelectedNodeId(id)}
              searchQuery={searchQuery}
              filterStatus={filterStatus}
              filterType={filterType}
            />
          </div>
        )}

        {/* Panel Dok / Drawer Analitik Ringkasan NOC (Opsional Ditampilkan) */}
        {showNocDrawer && data?.ringkasan && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: selectedNodeId ? "420px" : 0,
              maxHeight: "360px",
              overflowY: "auto",
              backgroundColor: "rgba(255, 255, 255, 0.98)",
              borderTop: "1px solid var(--border-color, #E6E4DF)",
              boxShadow: "0 -4px 16px rgba(0,0,0,0.06)",
              zIndex: 25,
              padding: "16px 20px",
              backdropFilter: "blur(6px)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-main, #1F2430)" }}>
                Analitik Ringkasan NOC
              </span>
              <button
                type="button"
                onClick={() => setShowNocDrawer(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: "14px",
                  cursor: "pointer",
                  color: "var(--text-secondary, #5B6270)",
                }}
              >
                ✕
              </button>
            </div>

            <SectionErrorBoundary sectionName="Widget Metrik NOC" compact>
              <NocSummaryWidgets
                ringkasan={data.ringkasan}
                showMiniMapLink={false}
                filterGroupId={filterGroup}
                onSelectNode={(nodeId) => {
                  setSelectedNodeId(nodeId);
                  setShowNocDrawer(false);
                }}
                onFilterStatus={(st) => setFilterStatus(st)}
                onFilterType={(tp) => setFilterType(tp)}
              />
            </SectionErrorBoundary>
          </div>
        )}

        {/* Drawer Detail Saat Node Diklik */}
        <SectionErrorBoundary sectionName="Drawer Detail Perangkat" compact>
          <NodeDetailDrawer
            nodeId={selectedNodeId}
            onClose={() => setSelectedNodeId(null)}
            onSelectNode={(targetId) => setSelectedNodeId(targetId)}
            currentUserRole={data?.currentUser?.role || "viewer"}
          />
        </SectionErrorBoundary>

        {/* Drawer Detail Saat Area / Grup Diklik */}
        <SectionErrorBoundary sectionName="Drawer Detail Grup" compact>
          <GroupDetailDrawer
            groupId={selectedGroupIdForDrawer}
            groups={data?.grup || []}
            nodes={data?.node || []}
            onClose={() => setSelectedGroupIdForDrawer(null)}
            onSelectNode={(nodeId) => {
              setSelectedGroupIdForDrawer(null);
              setSelectedNodeId(nodeId);
            }}
          />
        </SectionErrorBoundary>
      </div>
    </div>
  );
}
