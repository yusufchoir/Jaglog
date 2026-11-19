"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useCurrentUser } from "@/components/UserProvider";
import { useLiveUpdates } from "@/components/LiveUpdateProvider";
import { Toast } from "@/components/Toast";
import { ConfirmModal } from "@/components/ConfirmModal";
import { BottomSheet } from "@/components/BottomSheet";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import { formatRelativeTime, formatWIBDateTime, useIsMounted } from "@/lib/datetime";
import Link from "next/link";

interface DeviceItem {
  id: string;
  name: string;
  type: "mikrotik" | "windows" | "linux" | "switch" | "firewall" | "other";
  ipAddress: string | null;
  location: string | null;
  notes: string | null;
  isActive: boolean;
  status: "online" | "log_stopped" | "offline" | "rto" | "unknown";
  statusChangedAt: string | null;
  offlineAfterMinutes: number;
  pingEnabled: boolean;
  pingFailureThreshold: number;
  notifyOnRto: boolean;
  lastPingAt: string | null;
  lastPingOk: boolean | null;
  lastPingRtt: number | null;
  lastSeenAt: string | null;
  createdAt: string;
  groupId: string | null;
  groupName?: string | null;
  groupWarnaGaris?: string | null;
  isOnline: boolean;
  logCount24h: number;
  openIncidentCount: number;
}

export default function DevicesPage() {
  const isMounted = useIsMounted();
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [availableGroups, setAvailableGroups] = useState<{ id: string; nama: string; warnaGaris: string }[]>([]);
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isGroupedView, setIsGroupedView] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [bulkTargetGroupId, setBulkTargetGroupId] = useState<string>("");
  const [isSubmittingBulk, setIsSubmittingBulk] = useState(false);

  const { currentUser: contextUser } = useCurrentUser();
  const currentUser = contextUser || { username: "Admin", role: "admin" as const };
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [processingDeviceId, setProcessingDeviceId] = useState<string | null>(null);
  const [tokenConfirmDevice, setTokenConfirmDevice] = useState<DeviceItem | null>(null);
  const [isRegeneratingToken, setIsRegeneratingToken] = useState(false);
  const [pingingDeviceId, setPingingDeviceId] = useState<string | null>(null);
  const [isPingingAll, setIsPingingAll] = useState(false);
  const [actionSheetDevice, setActionSheetDevice] = useState<DeviceItem | null>(null);

  // Modal Tambah Perangkat
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<DeviceItem["type"]>("mikrotik");
  const [formIp, setFormIp] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formGroupId, setFormGroupId] = useState<string>("");
  const [isInlineCreateGroup, setIsInlineCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState<"biru" | "merah" | "abu">("biru");
  const [isCreatingInlineGroup, setIsCreatingInlineGroup] = useState(false);
  const [formNotes, setFormNotes] = useState("");
  const [formOfflineAfterMinutes, setFormOfflineAfterMinutes] = useState(10);
  const [formPingEnabled, setFormPingEnabled] = useState(true);
  const [formPingFailureThreshold, setFormPingFailureThreshold] = useState(3);
  const [formNotifyOnRto, setFormNotifyOnRto] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal Edit Perangkat
  const [editingDevice, setEditingDevice] = useState<DeviceItem | null>(null);

  // Modal Tampil Token Sekali
  const [oneTimeToken, setOneTimeToken] = useState<{ deviceName: string; token: string } | null>(null);
  const [hasCopiedToken, setHasCopiedToken] = useState(false);

  const fetchGroups = async () => {
    try {
      const res = await fetch("/api/groups");
      const data = await res.json();
      if (res.ok && data.groups) {
        setAvailableGroups(data.groups);
      }
    } catch (err) {
      console.warn("Gagal memuat daftar grup:", err);
    }
  };

  const fetchDevices = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/devices");
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = "/login?from=/perangkat";
          return;
        }
        setErrorMessage(data.error || "Gagal memuat daftar perangkat.");
        setIsLoading(false);
        return;
      }

      setDevices(data.devices || []);
    } catch (err) {
      console.error(err);
      setErrorMessage("Tidak dapat terhubung ke server.");
    } finally {
      setIsLoading(false);
    }
  };

  const { subscribe } = useLiveUpdates();

  useEffect(() => {
    fetchDevices();
    fetchGroups();

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const grp = params.get("group");
      if (grp) setSelectedGroupFilter(grp);
    }

    // Perbarui status & ping perangkat langsung tanpa refetch penuh
    const unsubStatus = subscribe("perangkat.status", (evt) => {
      if (!evt.perangkat_id) return;
      setDevices((prev) =>
        prev.map((d) =>
          d.id === evt.perangkat_id
            ? {
                ...d,
                status: (evt.data_ringkas?.status_perangkat as any) ?? d.status,
                lastPingOk: evt.data_ringkas?.ping_ok ?? d.lastPingOk,
                lastPingRtt:
                  evt.data_ringkas?.ping_rtt !== undefined
                    ? evt.data_ringkas.ping_rtt
                    : d.lastPingRtt,
                statusChangedAt: evt.waktu || d.statusChangedAt,
              }
            : d
        )
      );
    });

    const unsubPing = subscribe("perangkat.ping", (evt) => {
      if (!evt.perangkat_id) return;
      setDevices((prev) =>
        prev.map((d) =>
          d.id === evt.perangkat_id
            ? {
                ...d,
                lastPingOk: evt.data_ringkas?.ping_ok ?? d.lastPingOk,
                lastPingRtt:
                  evt.data_ringkas?.ping_rtt !== undefined
                    ? evt.data_ringkas.ping_rtt
                    : d.lastPingRtt,
                lastPingAt: evt.waktu || d.lastPingAt,
              }
            : d
        )
      );
    });

    const unsubDevice = subscribe("perangkat.diubah", (evt) => {
      if (evt.data_ringkas?.deleted && evt.perangkat_id) {
        setDevices((prev) => prev.filter((d) => d.id !== evt.perangkat_id));
      } else {
        fetchDevices();
      }
    });

    const unsubGrup = subscribe("grup.berubah", () => {
      fetchGroups();
      fetchDevices();
    });

    const unsubResync = subscribe("resync", () => {
      fetchDevices();
      fetchGroups();
    });

    return () => {
      unsubStatus();
      unsubPing();
      unsubDevice();
      unsubGrup();
      unsubResync();
    };
  }, [subscribe]);

  const handleBulkMove = async () => {
    if (selectedDeviceIds.length === 0) return;
    setIsSubmittingBulk(true);
    try {
      const res = await fetch("/api/devices/bulk-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceIds: selectedDeviceIds,
          groupId: bulkTargetGroupId === "none" ? null : bulkTargetGroupId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal memindahkan perangkat.");
      setToast({ message: data.message || `${selectedDeviceIds.length} perangkat berhasil dipindahkan.`, type: "success" });
      setSelectedDeviceIds([]);
      fetchDevices();
      fetchGroups();
    } catch (err: any) {
      setToast({ message: err.message || "Gagal memindahkan perangkat.", type: "error" });
    } finally {
      setIsSubmittingBulk(false);
    }
  };

  const handleInlineCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    setIsCreatingInlineGroup(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nama: newGroupName.trim(),
          warnaGaris: newGroupColor,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal membuat grup.");
      setAvailableGroups((prev) => [...prev, data.group]);
      setFormGroupId(data.group.id);
      setIsInlineCreateGroup(false);
      setNewGroupName("");
      setToast({ message: `Grup '${data.group.nama}' berhasil dibuat dan dipilih.`, type: "success" });
    } catch (err: any) {
      setToast({ message: err.message || "Gagal membuat grup baru.", type: "error" });
    } finally {
      setIsCreatingInlineGroup(false);
    }
  };

  const handleCreateDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          type: formType,
          ipAddress: formIp || null,
          location: formLocation || null,
          groupId: formGroupId || null,
          notes: formNotes || null,
          offlineAfterMinutes: Number(formOfflineAfterMinutes) || 10,
          pingEnabled: formPingEnabled,
          pingFailureThreshold: Number(formPingFailureThreshold) || 3,
          notifyOnRto: formNotifyOnRto,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          setErrorMessage("Sesi login Anda telah berakhir atau belum aktif. Mengalihkan ke halaman login...");
          setTimeout(() => {
            window.location.href = "/login?from=/perangkat";
          }, 1200);
          setIsSubmitting(false);
          return;
        }
        setErrorMessage(data.error || "Gagal menambahkan perangkat.");
        setIsSubmitting(false);
        return;
      }

      // Sukses: Buka modal token sekali tampil jika ada token
      if (data.ingestToken) {
        setOneTimeToken({
          deviceName: data.device.name,
          token: data.ingestToken,
        });
      }

      setSuccessMessage(data.message || `Perangkat '${formName}' berhasil ditambahkan.`);
      setIsAddModalOpen(false);
      setFormName("");
      setFormIp("");
      setFormLocation("");
      setFormGroupId("");
      setIsInlineCreateGroup(false);
      setFormNotes("");
      setFormOfflineAfterMinutes(10);
      setFormPingEnabled(false);
      setFormPingFailureThreshold(3);
      setFormNotifyOnRto(true);
      setFormType("mikrotik");
      fetchDevices();
      fetchGroups();
    } catch (err) {
      console.error(err);
      setErrorMessage("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDevice) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/devices/${editingDevice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          type: formType,
          ipAddress: formIp || null,
          location: formLocation || null,
          groupId: formGroupId || null,
          notes: formNotes || null,
          offlineAfterMinutes: Number(formOfflineAfterMinutes) || 10,
          pingEnabled: formPingEnabled,
          pingFailureThreshold: Number(formPingFailureThreshold) || 3,
          notifyOnRto: formNotifyOnRto,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          setErrorMessage("Sesi login Anda telah berakhir. Mengalihkan ke halaman login...");
          setTimeout(() => {
            window.location.href = "/login?from=/perangkat";
          }, 1200);
          setIsSubmitting(false);
          return;
        }
        setErrorMessage(data.error || "Gagal memperbarui perangkat.");
        setIsSubmitting(false);
        return;
      }

      setSuccessMessage(`Perangkat '${formName}' berhasil diperbarui.`);
      setEditingDevice(null);
      fetchDevices();
      fetchGroups();
    } catch (err) {
      console.error(err);
      setErrorMessage("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (device: DeviceItem) => {
    if (processingDeviceId === device.id) return;
    const nextActive = !device.isActive;
    const actionVerb = nextActive ? "diaktifkan" : "dinonaktifkan";

    // 1. Optimistic update di UI seketika (<10ms)
    setDevices((prev) =>
      prev.map((d) => (d.id === device.id ? { ...d, isActive: nextActive } : d))
    );
    setProcessingDeviceId(device.id);

    try {
      const res = await fetch(`/api/devices/${device.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });

      const data = await res.json();
      if (!res.ok) {
        // Rollback otomatis jika gagal
        setDevices((prev) =>
          prev.map((d) => (d.id === device.id ? { ...d, isActive: !nextActive } : d))
        );
        setToast({
          message: data.error || `Gagal ${actionVerb} perangkat '${device.name}'.`,
          type: "error",
        });
        return;
      }

      setToast({
        message: `Perangkat '${device.name}' berhasil ${actionVerb}.`,
        type: "success",
      });
    } catch (err) {
      console.error("handleToggleActive error:", err);
      // Rollback otomatis
      setDevices((prev) =>
        prev.map((d) => (d.id === device.id ? { ...d, isActive: !nextActive } : d))
      );
      setToast({
        message: "Terjadi kesalahan jaringan saat memperbarui status.",
        type: "error",
      });
    } finally {
      setProcessingDeviceId(null);
    }
  };

  const handleExecuteRegenerateToken = async () => {
    if (!tokenConfirmDevice) return;
    const deviceId = tokenConfirmDevice.id;
    const deviceName = tokenConfirmDevice.name;

    setIsRegeneratingToken(true);
    try {
      const res = await fetch(`/api/devices/${deviceId}/token`, {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) {
        setToast({
          message: data.error || "Gagal membuat ulang token perangkat.",
          type: "error",
        });
        setTokenConfirmDevice(null);
        return;
      }

      setTokenConfirmDevice(null);
      setOneTimeToken({
        deviceName,
        token: data.ingestToken,
      });
      setHasCopiedToken(false);
      setToast({
        message: `Token ingest baru untuk '${deviceName}' berhasil dibuat.`,
        type: "success",
      });
    } catch (err) {
      console.error("handleRegenerateToken error:", err);
      setToast({
        message: "Terjadi kesalahan jaringan saat membuat token.",
        type: "error",
      });
      setTokenConfirmDevice(null);
    } finally {
      setIsRegeneratingToken(false);
    }
  };

  const handlePingDevice = async (id: string, name?: string) => {
    setPingingDeviceId(id);
    try {
      const res = await fetch(`/api/devices/${id}/ping`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setToast({
          message: data.error || `Gagal melakukan tes ping ke ${name || "perangkat"}.`,
          type: "error",
        });
        return;
      }
      setToast({
        message: data.message || (data.isAlive ? `Ping OK: ${name || "Perangkat"} UP` : `Ping Gagal: ${name || "Perangkat"} DOWN`),
        type: data.isAlive ? "success" : "error",
      });
      fetchDevices();
    } catch (err) {
      console.error("handlePingDevice error:", err);
      setToast({
        message: "Gagal menghubungi server untuk melakukan tes ping.",
        type: "error",
      });
    } finally {
      setPingingDeviceId(null);
    }
  };

  const handlePingAll = async () => {
    setIsPingingAll(true);
    try {
      const res = await fetch("/api/devices/ping-all", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setToast({
          message: data.error || "Gagal memeriksa ping semua perangkat.",
          type: "error",
        });
        return;
      }
      setToast({
        message: data.message || "Pemeriksaan ping selesai.",
        type: "success",
      });
      fetchDevices();
    } catch (err) {
      console.error("handlePingAll error:", err);
      setToast({
        message: "Terjadi kesalahan saat memeriksa ping semua perangkat.",
        type: "error",
      });
    } finally {
      setIsPingingAll(false);
    }
  };

  const openEditModal = (device: DeviceItem) => {
    setEditingDevice(device);
    setFormName(device.name);
    setFormType(device.type);
    setFormIp(device.ipAddress || "");
    setFormLocation(device.location || "");
    setFormGroupId(device.groupId || "");
    setIsInlineCreateGroup(false);
    setNewGroupName("");
    setFormNotes(device.notes || "");
    setFormOfflineAfterMinutes(device.offlineAfterMinutes ?? 10);
    setFormPingEnabled(Boolean(device.pingEnabled));
    setFormPingFailureThreshold(device.pingFailureThreshold ?? 3);
    setFormNotifyOnRto(device.notifyOnRto ?? true);
  };

  const filteredDevices = useMemo(() => {
    return devices.filter((d) => {
      if (selectedGroupFilter === "none") {
        if (d.groupId) return false;
      } else if (selectedGroupFilter !== "all") {
        if (d.groupId !== selectedGroupFilter) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = d.name.toLowerCase().includes(q);
        const matchesIp = (d.ipAddress || "").toLowerCase().includes(q);
        const matchesLocation = (d.location || "").toLowerCase().includes(q);
        const matchesGroup = (d.groupName || "").toLowerCase().includes(q);
        return matchesName || matchesIp || matchesLocation || matchesGroup;
      }

      return true;
    });
  }, [devices, selectedGroupFilter, searchQuery]);

  const groupedMap = useMemo(() => {
    const map = new Map<string, { groupName: string; color: string; devices: DeviceItem[] }>();
    for (const dev of filteredDevices) {
      const key = dev.groupId || "unassigned";
      const name = dev.groupName || "Tanpa Grup";
      const color = dev.groupWarnaGaris || "abu";
      if (!map.has(key)) {
        map.set(key, { groupName: name, color, devices: [] });
      }
      map.get(key)!.devices.push(dev);
    }
    return map;
  }, [filteredDevices]);

  const formatStatusDuration = (
    status: DeviceItem["status"],
    statusChangedAt: string | null,
    lastSeenAt: string | null
  ) => {
    if (!isMounted) return null;
    const ts = statusChangedAt || lastSeenAt;
    if (!ts) return null;
    const diffMs = Date.now() - new Date(ts).getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    let timeStr = "baru saja";
    if (diffMinutes >= 1 && diffMinutes < 60) timeStr = `${diffMinutes}m lalu`;
    else if (diffHours >= 1 && diffHours < 24) timeStr = `${diffHours}j lalu`;
    else if (diffDays >= 1) timeStr = `${diffDays}h lalu`;

    if (status === "rto") return `RTO sejak ${diffMinutes < 60 ? `${diffMinutes} menit lalu` : timeStr}`;
    if (status === "offline") return `offline sejak ${timeStr}`;
    if (status === "log_stopped") return `log terhenti sejak ${timeStr}`;
    if (status === "online") return `aktif sejak ${timeStr}`;
    return null;
  };

  const toggleSelectOne = (id: string) => {
    setSelectedDeviceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const renderDeviceRow = (dev: DeviceItem) => {
    const isChecked = selectedDeviceIds.includes(dev.id);
    const st = !dev.isActive ? "nonaktif" : dev.status || (dev.isOnline ? "online" : "unknown");
    const diffMs = isMounted && dev.statusChangedAt ? Date.now() - new Date(dev.statusChangedAt).getTime() : 0;
    const diffMins = Math.floor(diffMs / 60000);
    const rtoTimeStr = dev.statusChangedAt && isMounted
      ? (diffMins < 1 ? "sejak baru saja" : diffMins < 60 ? `sejak ${diffMins} mnt lalu` : `sejak ${Math.floor(diffMins / 60)} jam lalu`)
      : "Ping Request Time Out";

    const config = {
      nonaktif: {
        label: "Nonaktif",
        sub: "Log & Ping Dimatikan",
        color: "#991B1B",
        bg: "#FEF2F2",
        border: "#FECACA",
        dot: "#EF4444",
      },
      online: {
        label: "UP • Online",
        sub: dev.lastSeenAt ? "Syslog Aktif" : "Ping UP",
        color: "#15803D",
        bg: "#F0FDF4",
        border: "#BBF7D0",
        dot: "#22C55E",
      },
      log_stopped: {
        label: "UP • Log Berhenti",
        sub: "Ping UP, Syslog Berhenti",
        color: "#B45309",
        bg: "#FEFCE8",
        border: "#FEF08A",
        dot: "#EAB308",
      },
      rto: {
        label: "RTO",
        sub: rtoTimeStr,
        color: "#B91C1C",
        bg: "#FEF2F2",
        border: "#FECACA",
        dot: "#EF4444",
      },
      offline: {
        label: "DOWN • Offline",
        sub: "Host Tidak Terjangkau",
        color: "#B91C1C",
        bg: "#FEF2F2",
        border: "#FECACA",
        dot: "#EF4444",
      },
      unknown: {
        label: "Menunggu Data",
        sub: "Kirim Log / Tes Ping",
        color: "#64748B",
        bg: "#F1F5F9",
        border: "#E2E8F0",
        dot: "#94A3B8",
      },
    }[st] || {
      label: st,
      sub: "",
      color: "#64748B",
      bg: "#F1F5F9",
      border: "#E2E8F0",
      dot: "#94A3B8",
    };

    const durationStr = st === "nonaktif" ? null : formatStatusDuration(st, dev.statusChangedAt, dev.lastSeenAt);

    return (
      <tr
        key={dev.id}
        style={{
          height: "56px",
          borderBottom: "1px solid var(--border-color)",
          opacity: dev.isActive ? 1 : 0.65,
          backgroundColor: isChecked ? "rgba(31, 95, 191, 0.04)" : "transparent",
        }}
      >
        {currentUser.role === "admin" && (
          <td style={{ width: "40px", padding: "8px 8px 8px 16px", textAlign: "center" }}>
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => toggleSelectOne(dev.id)}
              aria-label={`Pilih ${dev.name}`}
              style={{ cursor: "pointer" }}
            />
          </td>
        )}
        <td style={{ padding: "8px 16px" }}>
          <Link
            href={`/perangkat/${dev.id}`}
            style={{
              fontWeight: 600,
              color: "var(--accent-blue)",
              textDecoration: "none",
            }}
          >
            {dev.name}
          </Link>
          {!dev.isActive && (
            <span
              style={{
                marginLeft: "6px",
                fontSize: "11px",
                color: "var(--accent-red)",
                fontWeight: 600,
              }}
            >
              (Nonaktif)
            </span>
          )}
        </td>
        <td style={{ padding: "8px 16px" }}>
          <span
            style={{
              fontSize: "11px",
              padding: "2px 6px",
              borderRadius: "4px",
              backgroundColor: "#F1F5F9",
              color: "#334155",
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            {dev.type}
          </span>
        </td>
        <td style={{ padding: "8px 16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                className="font-mono"
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: dev.ipAddress ? "var(--text-main)" : "var(--text-secondary)",
                }}
              >
                {dev.ipAddress || "Token Agent"}
              </span>
              {dev.ipAddress && dev.isActive && currentUser.role === "admin" && (
                <button
                  type="button"
                  onClick={() => handlePingDevice(dev.id, dev.name)}
                  disabled={pingingDeviceId === dev.id}
                  title="Tes Ping ICMP/TCP Sekarang"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "2px 7px",
                    fontSize: "11px",
                    fontWeight: 600,
                    border: "1px solid var(--border-color)",
                    borderRadius: "4px",
                    backgroundColor: pingingDeviceId === dev.id ? "#F1F5F9" : "#FFFFFF",
                    color: "var(--accent-blue)",
                    cursor: pingingDeviceId === dev.id ? "wait" : "pointer",
                    lineHeight: "1.2",
                  }}
                >
                  {pingingDeviceId === dev.id ? "Pinging..." : "Tes Ping"}
                </button>
              )}
            </div>

            {/* Status Ping Terdaftar */}
            {dev.ipAddress && dev.isActive ? (
              dev.pingEnabled ? (
                dev.lastPingAt ? (
                  dev.lastPingOk ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "#166534",
                      }}
                      title={`Ping Terakhir: ${formatWIBDateTime(dev.lastPingAt)}`}
                    >
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#22C55E", display: "inline-block" }} />
                      Ping UP ({formatRelativeTime(dev.lastPingAt)})
                    </span>
                  ) : (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "#991B1B",
                      }}
                      title={`Ping Terakhir Gagal: ${formatWIBDateTime(dev.lastPingAt)}`}
                    >
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#EF4444", display: "inline-block" }} />
                      Ping DOWN / RTO ({formatRelativeTime(dev.lastPingAt)})
                    </span>
                  )
                ) : (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "11px",
                      color: "#B45309",
                    }}
                  >
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#F59E0B", display: "inline-block" }} />
                    Ping Aktif (Belum di-ping)
                  </span>
                )
              ) : (
                <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                  Ping nonaktif
                </span>
              )
            ) : null}
          </div>
        </td>
        <td style={{ padding: "8px 16px", color: "var(--text-secondary)" }}>
          {dev.location || "-"}
        </td>
        <td style={{ padding: "8px 16px" }}>
          {dev.groupName ? (
            <span
              style={{
                display: "inline-block",
                fontSize: "11px",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: "4px",
                backgroundColor:
                  dev.groupWarnaGaris === "merah"
                    ? "rgba(200, 55, 45, 0.08)"
                    : dev.groupWarnaGaris === "biru"
                    ? "rgba(31, 95, 191, 0.08)"
                    : "#F1F5F9",
                border: `1px solid ${
                  dev.groupWarnaGaris === "merah"
                    ? "#C8372D"
                    : dev.groupWarnaGaris === "biru"
                    ? "#1F5FBF"
                    : "var(--border-color)"
                }`,
                color:
                  dev.groupWarnaGaris === "merah"
                    ? "#C8372D"
                    : dev.groupWarnaGaris === "biru"
                    ? "#1F5FBF"
                    : "var(--text-secondary)",
              }}
            >
              {dev.groupName}
            </span>
          ) : (
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>-</span>
          )}
        </td>
        <td style={{ padding: "8px 16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                width: "fit-content",
                fontSize: "11px",
                fontWeight: 700,
                color: config.color,
                backgroundColor: config.bg,
                border: `1px solid ${config.border}`,
                borderRadius: "4px",
                padding: "3px 8px",
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: config.dot,
                }}
              />
              {config.label}
            </span>
            <span style={{ fontSize: "11px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
              {durationStr || config.sub}
            </span>
          </div>
        </td>
        <td
          style={{ padding: "0 16px", color: "var(--text-secondary)", fontSize: "12px" }}
          title={
            dev.lastSeenAt
              ? formatWIBDateTime(dev.lastSeenAt)
              : ""
          }
        >
          {formatRelativeTime(dev.lastSeenAt)}
        </td>
        <td style={{ padding: "0 16px", textAlign: "right", fontWeight: 600, color: "var(--text-main)" }}>
          {dev.logCount24h.toLocaleString("id-ID")}
        </td>
        <td style={{ padding: "0 16px", textAlign: "right" }}>
          {dev.openIncidentCount > 0 ? (
            <span
              style={{
                padding: "2px 6px",
                backgroundColor: "#FEE2E2",
                color: "var(--accent-red)",
                borderRadius: "4px",
                fontWeight: 700,
                fontSize: "11px",
              }}
            >
              {dev.openIncidentCount}
            </span>
          ) : (
            <span style={{ color: "var(--text-secondary)", fontSize: "12px" }}>0</span>
          )}
        </td>
        <td style={{ padding: "0 16px", textAlign: "right" }}>
          <div style={{ display: "inline-flex", gap: "6px" }}>
            <Link
              href={`/perangkat/${dev.id}`}
              style={{
                padding: "4px 8px",
                fontSize: "12px",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "#FFFFFF",
                color: "var(--text-main)",
              }}
            >
              Detail
            </Link>
            {currentUser.role === "admin" && (
              <>
                <button
                  type="button"
                  onClick={() => openEditModal(dev)}
                  style={{
                    padding: "4px 8px",
                    fontSize: "12px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "#FFFFFF",
                    cursor: "pointer",
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={processingDeviceId === dev.id}
                  onClick={() => handleToggleActive(dev)}
                  style={{
                    padding: "4px 8px",
                    fontSize: "12px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "transparent",
                    color: dev.isActive ? "var(--accent-red)" : "var(--accent-blue)",
                    cursor: processingDeviceId === dev.id ? "not-allowed" : "pointer",
                    opacity: processingDeviceId === dev.id ? 0.6 : 1,
                  }}
                >
                  {processingDeviceId === dev.id
                    ? "Memproses..."
                    : dev.isActive
                    ? "Nonaktifkan"
                    : "Aktifkan"}
                </button>
                <button
                  type="button"
                  disabled={processingDeviceId === dev.id || isRegeneratingToken}
                  onClick={() => setTokenConfirmDevice(dev)}
                  title="Buat ulang token ingest untuk perangkat ini"
                  style={{
                    padding: "4px 8px",
                    fontSize: "12px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "#FFFFFF",
                    color: "var(--text-main)",
                    cursor: processingDeviceId === dev.id ? "not-allowed" : "pointer",
                  }}
                >
                  Buat Ulang Token
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-app)" }}>
      <main className="page-bottom-padding" style={{ maxWidth: "1200px", margin: "0 auto", padding: "28px 24px" }}>
        {/* Header Halaman */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            marginBottom: "20px",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "18px",
                fontWeight: 700,
                color: "var(--text-main)",
                letterSpacing: "-0.3px",
              }}
            >
              Daftar Perangkat Jaringan
            </h1>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "2px" }}>
              Kelola sumber log: MikroTik, Windows, Linux, Switch, dan Firewall.
            </p>
          </div>

          {currentUser.role === "admin" && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handlePingAll}
                disabled={isPingingAll}
                title="Kirim tes ping ke seluruh perangkat dengan alamat IP terdaftar"
                className="touch-target"
                style={{
                  padding: "8px 14px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--text-main)",
                  backgroundColor: "#FFFFFF",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  cursor: isPingingAll ? "wait" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: isPingingAll ? "#EAB308" : "#22C55E",
                    display: "inline-block",
                  }}
                />
                {isPingingAll ? "Memeriksa Ping..." : "Ping Semua Perangkat"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setFormName("");
                  setFormType("mikrotik");
                  setFormIp("");
                  setFormLocation("");
                  setFormGroupId("");
                  setIsInlineCreateGroup(false);
                  setNewGroupName("");
                  setFormNotes("");
                  setFormOfflineAfterMinutes(10);
                  setFormPingEnabled(true);
                  setIsAddModalOpen(true);
                }}
                className="touch-target"
                style={{
                  padding: "8px 14px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#FFFFFF",
                  backgroundColor: "var(--accent-blue)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
              >
                + Tambah Perangkat
              </button>
            </div>
          )}
        </div>

        {/* Notifikasi */}
        {errorMessage && (
          <div
            style={{
              padding: "10px 14px",
              marginBottom: "16px",
              backgroundColor: "#FEF2F2",
              border: "1px solid #FCA5A5",
              borderLeft: "3px solid var(--accent-red)",
              borderRadius: "var(--radius-sm)",
              fontSize: "13px",
              color: "#991B1B",
            }}
          >
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div
            style={{
              padding: "10px 14px",
              marginBottom: "16px",
              backgroundColor: "#F0FDF4",
              border: "1px solid #86EFAC",
              borderLeft: "3px solid #16A34A",
              borderRadius: "var(--radius-sm)",
              fontSize: "13px",
              color: "#166534",
            }}
          >
            {successMessage}
          </div>
        )}

        {/* Kontrol Pencarian, Filter Grup, & Kelompokkan */}
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
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-color)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1 1 260px", maxWidth: "420px" }}>
            <input
              type="text"
              placeholder="Cari nama, IP, lokasi, atau grup..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                height: "36px",
                padding: "6px 12px",
                fontSize: "13px",
                backgroundColor: "#FAFAF8",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                outline: "none",
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            {/* Filter Grup Dropdown */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 500 }}>Grup:</span>
              <select
                value={selectedGroupFilter}
                onChange={(e) => setSelectedGroupFilter(e.target.value)}
                style={{
                  height: "36px",
                  padding: "4px 8px",
                  fontSize: "13px",
                  backgroundColor: "#FFFFFF",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
              >
                <option value="all">Semua Grup ({devices.length})</option>
                <option value="none">Tanpa Grup ({devices.filter((d) => !d.groupId).length})</option>
                {availableGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nama} ({devices.filter((d) => d.groupId === g.id).length})
                  </option>
                ))}
              </select>
            </div>

            {/* Toggle Kelompokkan berdasarkan grup */}
            <button
              type="button"
              onClick={() => setIsGroupedView(!isGroupedView)}
              style={{
                height: "36px",
                padding: "0 12px",
                fontSize: "12px",
                fontWeight: 600,
                color: isGroupedView ? "#FFFFFF" : "var(--text-main)",
                backgroundColor: isGroupedView ? "var(--accent-blue)" : "#FFFFFF",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              {isGroupedView ? "Tampilan Rata" : "Kelompokkan Grup"}
            </button>
          </div>
        </div>

        {/* Toolbar Aksi Massal */}
        {selectedDeviceIds.length > 0 && currentUser.role === "admin" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "12px",
              padding: "10px 16px",
              marginBottom: "16px",
              backgroundColor: "rgba(31, 95, 191, 0.06)",
              border: "1px solid rgba(31, 95, 191, 0.25)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--accent-blue)" }}>
              {selectedDeviceIds.length} perangkat dipilih
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <select
                value={bulkTargetGroupId}
                onChange={(e) => setBulkTargetGroupId(e.target.value)}
                style={{
                  height: "34px",
                  padding: "4px 8px",
                  fontSize: "12px",
                  backgroundColor: "#FFFFFF",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <option value="">-- Pilih Grup Tujuan --</option>
                <option value="none">Lepas dari Grup (Tanpa Grup)</option>
                {availableGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    Pindahkan ke '{g.nama}'
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleBulkMove}
                disabled={!bulkTargetGroupId || isSubmittingBulk}
                style={{
                  height: "34px",
                  padding: "0 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#FFFFFF",
                  backgroundColor: "var(--accent-blue)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: !bulkTargetGroupId || isSubmittingBulk ? "not-allowed" : "pointer",
                  opacity: !bulkTargetGroupId || isSubmittingBulk ? 0.6 : 1,
                }}
              >
                {isSubmittingBulk ? "Memindahkan..." : "Terapkan"}
              </button>

              <button
                type="button"
                onClick={() => setSelectedDeviceIds([])}
                style={{
                  height: "34px",
                  padding: "0 10px",
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  backgroundColor: "#FFFFFF",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
              >
                Batal
              </button>
            </div>
          </div>
        )}

        <SectionErrorBoundary sectionName="Daftar Perangkat">
        {/* Desktop Table View */}
        <div className="desktop-only">
          <div
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}
          >
            <div style={{ height: "2px", backgroundColor: "var(--accent-blue)", width: "100%" }} />

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  textAlign: "left",
                  fontSize: "13px",
                }}
              >
              <thead>
                <tr
                  style={{
                    backgroundColor: "#F8F8F6",
                    borderBottom: "1px solid var(--border-color)",
                    color: "var(--text-secondary)",
                    height: "38px",
                  }}
                >
                  {currentUser.role === "admin" && (
                    <th style={{ width: "40px", padding: "0 8px 0 16px", textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={
                          filteredDevices.length > 0 &&
                          filteredDevices.every((d) => selectedDeviceIds.includes(d.id))
                        }
                        onChange={() => {
                          const allSelected =
                            filteredDevices.length > 0 &&
                            filteredDevices.every((d) => selectedDeviceIds.includes(d.id));
                          if (allSelected) {
                            setSelectedDeviceIds([]);
                          } else {
                            setSelectedDeviceIds(filteredDevices.map((d) => d.id));
                          }
                        }}
                        aria-label="Pilih semua perangkat"
                        style={{ cursor: "pointer" }}
                      />
                    </th>
                  )}
                  <th style={{ padding: "0 16px", fontWeight: 600 }}>Nama Perangkat</th>
                  <th style={{ padding: "0 16px", fontWeight: 600 }}>Tipe</th>
                  <th style={{ padding: "0 16px", fontWeight: 600 }}>Alamat IP & Ping</th>
                  <th style={{ padding: "0 16px", fontWeight: 600 }}>Lokasi</th>
                  <th style={{ padding: "0 16px", fontWeight: 600 }}>Grup</th>
                  <th style={{ padding: "0 16px", fontWeight: 600 }}>Status Perangkat</th>
                  <th style={{ padding: "0 16px", fontWeight: 600 }}>Terakhir Terlihat</th>
                  <th style={{ padding: "0 16px", fontWeight: 600, textAlign: "right" }}>Log 24 Jam</th>
                  <th style={{ padding: "0 16px", fontWeight: 600, textAlign: "right" }}>Insiden Buka</th>
                  <th style={{ padding: "0 16px", fontWeight: 600, textAlign: "right" }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={currentUser.role === "admin" ? 11 : 10} style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-secondary)" }}>
                      Memuat daftar perangkat...
                    </td>
                  </tr>
                ) : filteredDevices.length === 0 ? (
                  <tr>
                    <td colSpan={currentUser.role === "admin" ? 11 : 10} style={{ padding: "36px 16px", textAlign: "center", color: "var(--text-secondary)" }}>
                      Tidak ada perangkat yang cocok dengan pencarian atau filter yang dipilih.
                    </td>
                  </tr>
                ) : isGroupedView ? (
                  Array.from(groupedMap.entries()).map(([gKey, groupData]) => {
                    const onlineCount = groupData.devices.filter(
                      (d) => d.status === "online" || d.isOnline
                    ).length;
                    const totalCount = groupData.devices.length;
                    const hasDown = groupData.devices.some(
                      (d) => d.status === "offline" || d.status === "rto"
                    );
                    const hasWarning = groupData.devices.some(
                      (d) => d.status === "log_stopped"
                    );
                    const worstStatus = hasDown
                      ? "down"
                      : hasWarning
                      ? "warning"
                      : onlineCount > 0
                      ? "up"
                      : "unknown";
                    const isCollapsed = !!collapsedGroups[gKey];

                    return (
                      <React.Fragment key={`group-sec-${gKey}`}>
                        <tr
                          style={{
                            backgroundColor: "#F8F8F6",
                            borderBottom: "1px solid var(--border-color)",
                            borderTop: "2px solid var(--border-color)",
                          }}
                        >
                          <td
                            colSpan={currentUser.role === "admin" ? 11 : 10}
                            style={{ padding: "8px 16px" }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setCollapsedGroups((prev) => ({
                                    ...prev,
                                    [gKey]: !prev[gKey],
                                  }))
                                }
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  font: "inherit",
                                  textAlign: "left",
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: "11px",
                                    color: "var(--text-secondary)",
                                    display: "inline-block",
                                    transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                                    transition: "transform 0.15s ease",
                                  }}
                                >
                                  ▼
                                </span>
                                <span
                                  style={{
                                    padding: "2px 8px",
                                    fontSize: "12px",
                                    fontWeight: 700,
                                    borderRadius: "4px",
                                    backgroundColor:
                                      groupData.color === "merah"
                                        ? "rgba(200,55,45,0.08)"
                                        : groupData.color === "biru"
                                        ? "rgba(31,95,191,0.08)"
                                        : "#FFFFFF",
                                    border: `1px solid ${
                                      groupData.color === "merah"
                                        ? "#C8372D"
                                        : groupData.color === "biru"
                                        ? "#1F5FBF"
                                        : "var(--border-color)"
                                    }`,
                                    color:
                                      groupData.color === "merah"
                                        ? "#C8372D"
                                        : groupData.color === "biru"
                                        ? "#1F5FBF"
                                        : "var(--text-main)",
                                  }}
                                >
                                  {groupData.groupName}
                                </span>
                                <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                  ({totalCount} perangkat • {onlineCount} online)
                                </span>
                              </button>

                              <span
                                style={{
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  padding: "2px 8px",
                                  borderRadius: "4px",
                                  backgroundColor:
                                    worstStatus === "down"
                                      ? "#FEF2F2"
                                      : worstStatus === "warning"
                                      ? "#FEFCE8"
                                      : worstStatus === "up"
                                      ? "#F0FDF4"
                                      : "#F1F5F9",
                                  color:
                                    worstStatus === "down"
                                      ? "#991B1B"
                                      : worstStatus === "warning"
                                      ? "#B45309"
                                      : worstStatus === "up"
                                      ? "#166534"
                                      : "#64748B",
                                  border: `1px solid ${
                                    worstStatus === "down"
                                      ? "#FCA5A5"
                                      : worstStatus === "warning"
                                      ? "#FEF08A"
                                      : worstStatus === "up"
                                      ? "#86EFAC"
                                      : "#CBD5E1"
                                  }`,
                                }}
                              >
                                {worstStatus === "down"
                                  ? "Terdapat Gangguan"
                                  : worstStatus === "warning"
                                  ? "Peringatan Log"
                                  : worstStatus === "up"
                                  ? "Semua Normal"
                                  : "Menunggu Data"}
                              </span>
                            </div>
                          </td>
                        </tr>
                        {!isCollapsed && groupData.devices.map(renderDeviceRow)}
                      </React.Fragment>
                    );
                  })
                ) : (
                  filteredDevices.map(renderDeviceRow)
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Mobile Cards View */}
      <div className="mobile-only" style={{ display: "none" }}>
        {isLoading ? (
          <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-secondary)" }}>
            Memuat daftar perangkat...
          </div>
        ) : filteredDevices.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "36px 16px",
              color: "var(--text-secondary)",
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            Tidak ada perangkat yang cocok dengan pencarian atau filter yang dipilih.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {filteredDevices.map((dev) => {
              const st = !dev.isActive ? "nonaktif" : dev.status || (dev.isOnline ? "online" : "unknown");
              const statusConfig = {
                nonaktif: { label: "Nonaktif", color: "#991B1B", bg: "#FEF2F2", dot: "#EF4444", border: "#FECACA" },
                online: { label: "Online", color: "#15803D", bg: "#F0FDF4", dot: "#22C55E", border: "#22C55E" },
                log_stopped: { label: "Log Berhenti", color: "#B45309", bg: "#FEFCE8", dot: "#EAB308", border: "#EAB308" },
                offline: { label: "Offline", color: "#B91C1C", bg: "#FEF2F2", dot: "#EF4444", border: "#EF4444" },
                rto: { label: "RTO / Down", color: "#991B1B", bg: "#FEF2F2", dot: "#DC2626", border: "#DC2626" },
                unknown: { label: "Menunggu Data", color: "#64748B", bg: "#F1F5F9", dot: "#94A3B8", border: "#CBD5E1" },
              }[st] || { label: st, color: "#64748B", bg: "#F1F5F9", dot: "#94A3B8", border: "#CBD5E1" };

              const durationStr = st === "nonaktif" ? null : formatStatusDuration(st, dev.statusChangedAt, dev.lastSeenAt);

              return (
                <div
                  key={dev.id}
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-color)",
                    borderLeft: `4px solid ${statusConfig.border}`,
                    borderRadius: "var(--radius-sm)",
                    padding: "14px 16px",
                    opacity: dev.isActive ? 1 : 0.65,
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  {/* Baris 1: Nama & Tipe */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                    <Link
                      href={`/perangkat/${dev.id}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        textDecoration: "none",
                        color: "var(--text-main)",
                        fontWeight: 700,
                        fontSize: "15px",
                      }}
                    >
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          backgroundColor: statusConfig.dot,
                          flexShrink: 0,
                        }}
                      />
                      <span>{dev.name}</span>
                    </Link>

                    <span
                      style={{
                        fontSize: "11px",
                        textTransform: "uppercase",
                        fontWeight: 600,
                        padding: "2px 6px",
                        borderRadius: "3px",
                        backgroundColor: "var(--bg-app)",
                        color: "var(--text-secondary)",
                        border: "1px solid var(--border-color)",
                        flexShrink: 0,
                      }}
                    >
                      {dev.type}
                    </span>
                  </div>

                  {/* Baris 2: IP, Ping RTT & Lokasi & Grup */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", fontSize: "12px" }}>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {dev.ipAddress || "Token-based (HTTP)"}
                    </span>

                    {dev.isActive && dev.pingEnabled && dev.ipAddress && (
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          padding: "1px 6px",
                          borderRadius: "3px",
                          backgroundColor:
                            dev.lastPingOk === true
                              ? "#F0FDF4"
                              : dev.lastPingOk === false
                              ? "#FEF2F2"
                              : "#F1F5F9",
                          color:
                            dev.lastPingOk === true
                              ? "#15803D"
                              : dev.lastPingOk === false
                              ? "#B91C1C"
                              : "#64748B",
                        }}
                      >
                        {dev.lastPingOk === true
                          ? `Ping: ${dev.lastPingRtt !== null ? `${dev.lastPingRtt} ms` : "OK"}`
                          : dev.lastPingOk === false
                          ? "Ping: RTO"
                          : "Ping: Belum dicek"}
                      </span>
                    )}

                    {dev.location && (
                      <span style={{ color: "var(--text-muted)" }}>• {dev.location}</span>
                    )}

                    {dev.groupName && (
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          padding: "1px 6px",
                          borderRadius: "3px",
                          backgroundColor:
                            dev.groupWarnaGaris === "merah"
                              ? "rgba(200, 55, 45, 0.08)"
                              : dev.groupWarnaGaris === "biru"
                              ? "rgba(31, 95, 191, 0.08)"
                              : "#F1F5F9",
                          border: `1px solid ${
                            dev.groupWarnaGaris === "merah"
                              ? "#C8372D"
                              : dev.groupWarnaGaris === "biru"
                              ? "#1F5FBF"
                              : "var(--border-color)"
                          }`,
                          color:
                            dev.groupWarnaGaris === "merah"
                              ? "#C8372D"
                              : dev.groupWarnaGaris === "biru"
                              ? "#1F5FBF"
                              : "var(--text-secondary)",
                        }}
                      >
                        {dev.groupName}
                      </span>
                    )}
                  </div>

                  {/* Baris 3: Status Badge + Waktu */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        color: statusConfig.color,
                        backgroundColor: statusConfig.bg,
                        padding: "2px 8px",
                        borderRadius: "4px",
                        border: `1px solid ${statusConfig.border}`,
                      }}
                    >
                      {statusConfig.label} {durationStr ? `(${durationStr})` : ""}
                    </span>

                    <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                      {formatRelativeTime(dev.lastSeenAt)}
                    </span>
                  </div>

                  {/* Baris 4: Log 24h & Insiden Buka */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: "12px",
                      paddingTop: "8px",
                      borderTop: "1px solid var(--border-color)",
                    }}
                  >
                    <span style={{ color: "var(--text-secondary)" }}>
                      Log 24j: <strong style={{ color: "var(--text-main)" }}>{dev.logCount24h.toLocaleString("id-ID")}</strong>
                    </span>

                    {dev.openIncidentCount > 0 ? (
                      <span style={{ color: "var(--accent-red)", fontWeight: 700 }}>
                        {dev.openIncidentCount} Insiden Terbuka
                      </span>
                    ) : (
                      <span style={{ color: "#15803D", fontWeight: 500 }}>0 Insiden</span>
                    )}
                  </div>

                  {/* Baris 5: Tombol Aksi Mobile */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px", marginTop: "4px" }}>
                    <Link
                      href={`/perangkat/${dev.id}`}
                      className="touch-target"
                      style={{
                        padding: "8px",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "var(--text-main)",
                        backgroundColor: "#FFFFFF",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        textDecoration: "none",
                        textAlign: "center",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      Detail
                    </Link>

                    {dev.ipAddress ? (
                      <button
                        type="button"
                        onClick={() => handlePingDevice(dev.id, dev.name)}
                        disabled={pingingDeviceId === dev.id}
                        className="touch-target"
                        style={{
                          padding: "8px",
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "var(--text-main)",
                          backgroundColor: "#FFFFFF",
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                        }}
                      >
                        {pingingDeviceId === dev.id ? "Ping..." : "Tes Ping"}
                      </button>
                    ) : (
                      <div />
                    )}

                    <button
                      type="button"
                      onClick={() => setActionSheetDevice(dev)}
                      className="touch-target"
                      aria-label={`Menu aksi untuk ${dev.name}`}
                      style={{
                        padding: "8px 12px",
                        fontSize: "13px",
                        fontWeight: 700,
                        color: "var(--text-main)",
                        backgroundColor: "#FFFFFF",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                      }}
                    >
                      Aksi ▾
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </SectionErrorBoundary>

      {/* Action Sheet Perangkat di Mobile */}
      <BottomSheet
        isOpen={Boolean(actionSheetDevice)}
        onClose={() => setActionSheetDevice(null)}
        title={actionSheetDevice?.name || "Aksi Perangkat"}
      >
        {actionSheetDevice && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "8px 0" }}>
            <div
              style={{
                padding: "10px 14px",
                backgroundColor: "var(--bg-app)",
                borderRadius: "var(--radius-sm)",
                fontSize: "12px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                {actionSheetDevice.ipAddress || "Token HTTP"}
              </span>
              <span style={{ textTransform: "uppercase", fontWeight: 600, color: "var(--text-muted)" }}>
                {actionSheetDevice.type}
              </span>
            </div>

            <Link
              href={`/perangkat/${actionSheetDevice.id}`}
              onClick={() => setActionSheetDevice(null)}
              className="touch-target"
              style={{
                padding: "12px 14px",
                backgroundColor: "var(--bg-panel)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-main)",
                fontWeight: 600,
                fontSize: "14px",
                textDecoration: "none",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>Buka Halaman Detail</span>
              <span>→</span>
            </Link>

            {actionSheetDevice.ipAddress && (
              <button
                type="button"
                onClick={() => {
                  const dev = actionSheetDevice;
                  setActionSheetDevice(null);
                  handlePingDevice(dev.id, dev.name);
                }}
                className="touch-target"
                style={{
                  padding: "12px 14px",
                  backgroundColor: "var(--bg-panel)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text-main)",
                  fontWeight: 600,
                  fontSize: "14px",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  textAlign: "left",
                }}
              >
                <span>Tes Ping Sekarang</span>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  {actionSheetDevice.lastPingRtt !== null ? `${actionSheetDevice.lastPingRtt} ms` : ""}
                </span>
              </button>
            )}

            {currentUser.role === "admin" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const dev = actionSheetDevice;
                    setActionSheetDevice(null);
                    openEditModal(dev);
                  }}
                  className="touch-target"
                  style={{
                    padding: "12px 14px",
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text-main)",
                    fontWeight: 600,
                    fontSize: "14px",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    textAlign: "left",
                  }}
                >
                  <span>Ubah Data Perangkat</span>
                  <span>✏️</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const dev = actionSheetDevice;
                    setActionSheetDevice(null);
                    setTokenConfirmDevice(dev);
                  }}
                  className="touch-target"
                  style={{
                    padding: "12px 14px",
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text-main)",
                    fontWeight: 600,
                    fontSize: "14px",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    textAlign: "left",
                  }}
                >
                  <span>Buat Ulang Token Ingest</span>
                  <span>🔄</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const dev = actionSheetDevice;
                    setActionSheetDevice(null);
                    handleToggleActive(dev);
                  }}
                  className="touch-target"
                  style={{
                    padding: "12px 14px",
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                    color: actionSheetDevice.isActive ? "var(--accent-red)" : "#15803D",
                    fontWeight: 600,
                    fontSize: "14px",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    textAlign: "left",
                  }}
                >
                  <span>{actionSheetDevice.isActive ? "Nonaktifkan Perangkat" : "Aktifkan Perangkat"}</span>
                  <span>{actionSheetDevice.isActive ? "🚫" : "✓"}</span>
                </button>
              </>
            )}
          </div>
        )}
      </BottomSheet>
    </main>

      {/* Modal Tambah / Edit Perangkat */}
      {(isAddModalOpen || editingDevice) && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 36, 48, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "480px",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              overflow: "hidden",
            }}
          >
            <div style={{ height: "3px", backgroundColor: "var(--accent-blue)", width: "100%", flexShrink: 0 }} />
            <div style={{ padding: "24px", overflowY: "auto" }}>
              <h2
                style={{
                  fontSize: "16px",
                  fontWeight: 700,
                  color: "var(--text-main)",
                  marginBottom: "4px",
                }}
              >
                {editingDevice ? `Ubah Perangkat: ${editingDevice.name}` : "Tambah Perangkat Baru"}
              </h2>
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
                Pastikan IP atau token perangkat sesuai dengan pengirim log.
              </p>

              <form
                onSubmit={editingDevice ? handleUpdateDevice : handleCreateDevice}
                style={{ display: "flex", flexDirection: "column", gap: "14px" }}
              >
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                    Nama Perangkat *
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="misal: Router-Utama-Kantor"
                    required
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: "13px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                    Tipe Perangkat *
                  </label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as DeviceItem["type"])}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: "13px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "#FFFFFF",
                    }}
                  >
                    <option value="mikrotik">MikroTik RouterOS</option>
                    <option value="linux">Linux Server</option>
                    <option value="windows">Windows Server / Client</option>
                    <option value="switch">Switch Jaringan</option>
                    <option value="firewall">Firewall Hardware / Appliance</option>
                    <option value="other">Perangkat Lainnya</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                    Alamat IP (Opsional untuk agent HTTP)
                  </label>
                  <input
                    type="text"
                    value={formIp}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFormIp(val);
                      if (val.trim()) {
                        setFormPingEnabled(true);
                      }
                    }}
                    placeholder="misal: 192.168.1.1 atau 203.0.113.10"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: "13px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                    Lokasi Fisik / Cabang
                  </label>
                  <input
                    type="text"
                    value={formLocation}
                    onChange={(e) => setFormLocation(e.target.value)}
                    placeholder="misal: Ruang Server Lt. 2, Kantor Pusat"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: "13px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  />
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <label style={{ fontSize: "13px", fontWeight: 600 }}>
                      Grup / Area Perangkat
                    </label>
                    {currentUser.role === "admin" && !isInlineCreateGroup && (
                      <button
                        type="button"
                        onClick={() => setIsInlineCreateGroup(true)}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "var(--accent-blue)",
                          cursor: "pointer",
                        }}
                      >
                        + Buat Grup Baru
                      </button>
                    )}
                  </div>

                  {!isInlineCreateGroup ? (
                    <select
                      value={formGroupId}
                      onChange={(e) => setFormGroupId(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        fontSize: "13px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "#FFFFFF",
                      }}
                    >
                      <option value="">-- Tanpa Grup --</option>
                      {availableGroups.map((grp) => (
                        <option key={grp.id} value={grp.id}>
                          {grp.nama}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div
                      style={{
                        padding: "10px",
                        backgroundColor: "#FAFAF8",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      <input
                        type="text"
                        placeholder="Nama grup baru..."
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "6px 10px",
                          fontSize: "13px",
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius-sm)",
                        }}
                      />
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <select
                          value={newGroupColor}
                          onChange={(e) => setNewGroupColor(e.target.value as any)}
                          style={{
                            padding: "4px 8px",
                            fontSize: "12px",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius-sm)",
                          }}
                        >
                          <option value="biru">Garis Biru</option>
                          <option value="merah">Garis Merah</option>
                          <option value="abu">Garis Abu</option>
                        </select>
                        <button
                          type="button"
                          onClick={handleInlineCreateGroup}
                          disabled={isCreatingInlineGroup || !newGroupName.trim()}
                          style={{
                            padding: "4px 10px",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "#FFFFFF",
                            backgroundColor: "var(--accent-blue)",
                            border: "none",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                          }}
                        >
                          {isCreatingInlineGroup ? "..." : "Simpan & Pilih"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsInlineCreateGroup(false)}
                          style={{
                            background: "none",
                            border: "none",
                            fontSize: "12px",
                            color: "var(--text-secondary)",
                            cursor: "pointer",
                          }}
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                    Catatan Tambahan
                  </label>
                  <textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="misal: Router gateway utama, gateway VPN WireGuard"
                    rows={2}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: "13px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      fontFamily: "inherit",
                    }}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px", padding: "12px", backgroundColor: "#F8F8F6", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-color)" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-main)", marginBottom: "4px" }}>
                      Batas Waktu Log Terhenti (Menit)
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        value={formOfflineAfterMinutes}
                        onChange={(e) => setFormOfflineAfterMinutes(Math.max(1, parseInt(e.target.value) || 10))}
                        style={{
                          width: "90px",
                          padding: "6px 10px",
                          fontSize: "13px",
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "#FFFFFF",
                        }}
                      />
                      <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                        menit tanpa log baru sebelum ditandai status berhenti/offline.
                      </span>
                    </div>
                  </div>

                  <div style={{ paddingTop: "6px", borderTop: "1px solid #E6E4DF" }}>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={formPingEnabled}
                        onChange={(e) => setFormPingEnabled(e.target.checked)}
                        style={{ marginTop: "2px" }}
                      />
                      <div>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main)" }}>
                          Cek ping dari server
                        </span>
                        <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px", lineHeight: "1.4" }}>
                          Server JagaLog harus dapat menjangkau IP perangkat melalui jaringan lokal atau VPN. Membedakan antara log terhenti dan mati total.
                        </p>
                      </div>
                    </label>

                    {formPingEnabled && (
                      <div style={{ marginTop: "10px", paddingLeft: "24px", display: "flex", flexDirection: "column", gap: "10px" }}>
                        <div>
                          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-main)", marginBottom: "4px" }}>
                            Ambang Gagal Berturut-turut (RTO)
                          </label>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <input
                              type="number"
                              min={1}
                              max={10}
                              value={formPingFailureThreshold}
                              onChange={(e) => setFormPingFailureThreshold(Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
                              style={{
                                width: "70px",
                                padding: "4px 8px",
                                fontSize: "12px",
                                border: "1px solid var(--border-color)",
                                borderRadius: "var(--radius-sm)",
                                backgroundColor: "#FFFFFF",
                              }}
                            />
                            <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                              kali gagal berturut-turut sebelum dinyatakan RTO (default 3 kali).
                            </span>
                          </div>
                        </div>

                        <div>
                          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "12px", color: "var(--text-main)" }}>
                            <input
                              type="checkbox"
                              checked={formNotifyOnRto}
                              onChange={(e) => setFormNotifyOnRto(e.target.checked)}
                            />
                            Kirim notifikasi RTO untuk perangkat ini
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddModalOpen(false);
                      setEditingDevice(null);
                    }}
                    disabled={isSubmitting}
                    style={{
                      padding: "8px 14px",
                      fontSize: "13px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "transparent",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                    }}
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    style={{
                      padding: "8px 16px",
                      fontSize: "13px",
                      fontWeight: 600,
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--accent-blue)",
                      color: "#FFFFFF",
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {isSubmitting ? "Menyimpan..." : editingDevice ? "Simpan Perubahan" : "Tambah Perangkat"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal Token Ingest Satu Kali Tampil */}
      {oneTimeToken && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 36, 48, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 110,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "500px",
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
              overflow: "hidden",
            }}
          >
            <div style={{ height: "3px", backgroundColor: "var(--accent-red)", width: "100%" }} />
            <div style={{ padding: "24px" }}>
              <div style={{ marginBottom: "16px" }}>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "var(--accent-red)",
                    textTransform: "uppercase",
                    letterSpacing: "0.8px",
                  }}
                >
                  PENTING • SIMPAN TOKEN INI
                </span>
                <h2
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    color: "var(--text-main)",
                    marginTop: "4px",
                  }}
                >
                  Token Ingest: {oneTimeToken.deviceName}
                </h2>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.5 }}>
                  Demi alasan keamanan, token ini <strong>hanya ditampilkan SEKALI</strong> saat ini. Sistem hanya menyimpan hash SHA-256 dari token ini.
                </p>
              </div>

              <div
                style={{
                  padding: "12px",
                  backgroundColor: "#F9F9F8",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  marginBottom: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <code
                  className="font-mono"
                  style={{
                    fontSize: "12px",
                    wordBreak: "break-all",
                    color: "var(--text-main)",
                    userSelect: "all",
                    flex: "1 1 200px",
                  }}
                >
                  {oneTimeToken.token}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(oneTimeToken.token);
                    setHasCopiedToken(true);
                  }}
                  className="touch-target"
                  style={{
                    padding: "8px 14px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: hasCopiedToken ? "var(--accent-blue)" : "#FFFFFF",
                    backgroundColor: hasCopiedToken ? "rgba(31, 95, 191, 0.1)" : "var(--accent-blue)",
                    border: hasCopiedToken ? "1px solid var(--accent-blue)" : "none",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {hasCopiedToken ? "✓ Tersalin" : "Salin Token"}
                </button>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setOneTimeToken(null)}
                  className="touch-target"
                  style={{
                    padding: "10px 18px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#FFFFFF",
                    backgroundColor: "var(--text-main)",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    width: "100%",
                  }}
                >
                  Saya Sudah Menyalin Token
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Modal Konfirmasi Buat Ulang Token */}
      <ConfirmModal
        isOpen={tokenConfirmDevice !== null}
        title="Konfirmasi Buat Ulang Token Ingest"
        message={
          <div>
            Token lama untuk perangkat <strong>{tokenConfirmDevice?.name}</strong> akan berhenti berfungsi.
            Agen atau perangkat yang memakai token lama harus segera diperbarui dengan token baru.
          </div>
        }
        confirmLabel="Buat Ulang Token"
        cancelLabel="Batal"
        isDanger={true}
        isLoading={isRegeneratingToken}
        onConfirm={handleExecuteRegenerateToken}
        onCancel={() => setTokenConfirmDevice(null)}
      />

      {/* Toast Notifikasi Ringan */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
