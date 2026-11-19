"use client";

import React, { useState } from "react";
import { DeviceTypeIcon } from "./DeviceTypeIcon";

interface UnplacedDevice {
  id: string;
  name: string;
  type: string;
  ipAddress: string | null;
  location: string | null;
  status: string;
}

export function UnplacedDevicesPanel({
  unplacedDevices,
  onAddDeviceNode,
  onAddVirtualNode,
  onAddGroup,
  onAutoPlace,
  isPlacingAuto = false,
}: {
  unplacedDevices: UnplacedDevice[];
  onAddDeviceNode: (deviceId: string) => void;
  onAddVirtualNode: (tipeVirtual: string, label: string) => void;
  onAddGroup: (nama: string, warna: "biru" | "merah" | "abu") => void;
  onAutoPlace: () => void;
  isPlacingAuto?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"perangkat" | "virtual" | "grup">("perangkat");
  const [virtualType, setVirtualType] = useState<string>("internet");
  const [virtualLabel, setVirtualLabel] = useState<string>("");
  const [groupName, setGroupName] = useState<string>("");
  const [groupColor, setGroupColor] = useState<"biru" | "merah" | "abu">("biru");

  const handleCreateVirtual = (e: React.FormEvent) => {
    e.preventDefault();
    onAddVirtualNode(virtualType, virtualLabel);
    setVirtualLabel("");
  };

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;
    onAddGroup(groupName.trim(), groupColor);
    setGroupName("");
  };

  return (
    <aside
      aria-label="Panel Perangkat Belum Ditempatkan dan Node Tambahan"
      style={{
        width: "280px",
        backgroundColor: "var(--bg-panel, #FFFFFF)",
        borderRight: "1px solid var(--border-color, #E6E4DF)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        zIndex: 20,
        boxShadow: "2px 0 8px rgba(0, 0, 0, 0.03)",
      }}
    >
      {/* Header Panel */}
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--border-color, #E6E4DF)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-main, #1F2430)" }}>
          Alat Penyunting Peta
        </span>
      </div>

      {/* Nav Tabs */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border-color, #E6E4DF)",
          backgroundColor: "var(--bg-app, #FAFAF8)",
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("perangkat")}
          style={{
            flex: 1,
            padding: "8px 4px",
            fontSize: "11px",
            fontWeight: activeTab === "perangkat" ? 700 : 500,
            color: activeTab === "perangkat" ? "var(--accent-blue, #1F5FBF)" : "var(--text-secondary, #5B6270)",
            border: "none",
            borderBottom: activeTab === "perangkat" ? "2px solid var(--accent-blue, #1F5FBF)" : "none",
            backgroundColor: "transparent",
            cursor: "pointer",
          }}
        >
          Perangkat ({unplacedDevices.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("virtual")}
          style={{
            flex: 1,
            padding: "8px 4px",
            fontSize: "11px",
            fontWeight: activeTab === "virtual" ? 700 : 500,
            color: activeTab === "virtual" ? "var(--accent-blue, #1F5FBF)" : "var(--text-secondary, #5B6270)",
            border: "none",
            borderBottom: activeTab === "virtual" ? "2px solid var(--accent-blue, #1F5FBF)" : "none",
            backgroundColor: "transparent",
            cursor: "pointer",
          }}
        >
          + Virtual
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("grup")}
          style={{
            flex: 1,
            padding: "8px 4px",
            fontSize: "11px",
            fontWeight: activeTab === "grup" ? 700 : 500,
            color: activeTab === "grup" ? "var(--accent-blue, #1F5FBF)" : "var(--text-secondary, #5B6270)",
            border: "none",
            borderBottom: activeTab === "grup" ? "2px solid var(--accent-blue, #1F5FBF)" : "none",
            backgroundColor: "transparent",
            cursor: "pointer",
          }}
        >
          + Grup
        </button>
      </div>

      {/* Isi Tab */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
        {/* Tab 1: Perangkat Belum Ditempatkan */}
        {activeTab === "perangkat" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {unplacedDevices.length > 0 && (
              <button
                type="button"
                onClick={onAutoPlace}
                disabled={isPlacingAuto}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  fontSize: "11px",
                  fontWeight: 600,
                  backgroundColor: "var(--bg-app, #FAFAF8)",
                  border: "1px dashed var(--accent-blue, #1F5FBF)",
                  borderRadius: "4px",
                  color: "var(--accent-blue, #1F5FBF)",
                  cursor: "pointer",
                }}
              >
                {isPlacingAuto ? "Menempatkan..." : "⚡ Tempatkan Semua Otomatis"}
              </button>
            )}

            {unplacedDevices.length === 0 ? (
              <div style={{ fontSize: "11px", color: "var(--text-muted, #8C93A0)", textAlign: "center", padding: "24px 0" }}>
                Semua perangkat aktif sudah ditempatkan di peta.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "10px", color: "var(--text-muted, #8C93A0)", textTransform: "uppercase" }}>
                  Klik / Seret ke Kanvas:
                </span>

                {unplacedDevices.map((dev) => (
                  <div
                    key={dev.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/jagalog-device-id", dev.id);
                    }}
                    onClick={() => onAddDeviceNode(dev.id)}
                    title="Klik atau seret ke kanvas untuk menempatkan"
                    style={{
                      padding: "8px 10px",
                      backgroundColor: "var(--bg-app, #FAFAF8)",
                      border: "1px solid var(--border-color, #E6E4DF)",
                      borderRadius: "4px",
                      cursor: "grab",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "6px",
                      transition: "border-color 0.15s ease",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ color: "var(--accent-blue, #1F5FBF)", flexShrink: 0 }}>
                          <DeviceTypeIcon type={dev.type} size={13} />
                        </span>
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--text-main, #1F2430)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {dev.name}
                        </span>
                      </div>
                      <span style={{ fontSize: "10px", fontFamily: "var(--font-mono, monospace)", color: "var(--text-muted, #8C93A0)", display: "block" }}>
                        {dev.ipAddress || "Token"}
                      </span>
                    </div>

                    <button
                      type="button"
                      style={{
                        padding: "2px 6px",
                        fontSize: "10px",
                        fontWeight: 600,
                        backgroundColor: "#FFFFFF",
                        border: "1px solid var(--border-color, #E6E4DF)",
                        borderRadius: "3px",
                        cursor: "pointer",
                        color: "var(--accent-blue, #1F5FBF)",
                      }}
                    >
                      + Taruh
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Tambah Node Virtual */}
        {activeTab === "virtual" && (
          <form onSubmit={handleCreateVirtual} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <span style={{ fontSize: "11px", color: "var(--text-secondary, #5B6270)" }}>
              Tambahkan gateway Internet, ISP WAN, Cloud, atau switch unmanaged.
            </span>

            <div>
              <label style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted, #8C93A0)", display: "block", marginBottom: "4px" }}>
                TIPE VIRTUAL
              </label>
              <select
                value={virtualType}
                onChange={(e) => setVirtualType(e.target.value)}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  fontSize: "12px",
                  borderRadius: "4px",
                  border: "1px solid var(--border-color, #E6E4DF)",
                  backgroundColor: "#FFFFFF",
                }}
              >
                <option value="internet">Internet Gateway</option>
                <option value="isp">ISP / Koneksi WAN</option>
                <option value="cloud">Layanan Cloud / VPS</option>
                <option value="switch_tak_terpantau">Switch Tak Terpantau</option>
                <option value="lainnya">Lainnya</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted, #8C93A0)", display: "block", marginBottom: "4px" }}>
                LABEL / NAMA NODE
              </label>
              <input
                type="text"
                value={virtualLabel}
                onChange={(e) => setVirtualLabel(e.target.value)}
                placeholder="Contoh: ISP Telkom, AWS Jakarta"
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  fontSize: "12px",
                  borderRadius: "4px",
                  border: "1px solid var(--border-color, #E6E4DF)",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <button
              type="submit"
              style={{
                marginTop: "4px",
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 600,
                backgroundColor: "var(--accent-blue, #1F5FBF)",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              + Tambahkan Node Virtual
            </button>
          </form>
        )}

        {/* Tab 3: Tambah Grup Lokasi */}
        {activeTab === "grup" && (
          <form onSubmit={handleCreateGroup} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <span style={{ fontSize: "11px", color: "var(--text-secondary, #5B6270)" }}>
              Buat kotak pembatas garis putus-putus untuk mengelompokkan perangkat per cabang/ruangan.
            </span>

            <div>
              <label style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted, #8C93A0)", display: "block", marginBottom: "4px" }}>
                NAMA LOKASI / CABANG
              </label>
              <input
                type="text"
                required
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Contoh: Gedung A Lt 2, Cabang Surabaya"
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  fontSize: "12px",
                  borderRadius: "4px",
                  border: "1px solid var(--border-color, #E6E4DF)",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted, #8C93A0)", display: "block", marginBottom: "4px" }}>
                WARNA GARIS
              </label>
              <select
                value={groupColor}
                onChange={(e) => setGroupColor(e.target.value as any)}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  fontSize: "12px",
                  borderRadius: "4px",
                  border: "1px solid var(--border-color, #E6E4DF)",
                  backgroundColor: "#FFFFFF",
                }}
              >
                <option value="biru">Biru (#1F5FBF)</option>
                <option value="merah">Merah (#C8372D)</option>
                <option value="abu">Abu-abu (#94A3B8)</option>
              </select>
            </div>

            <button
              type="submit"
              style={{
                marginTop: "4px",
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 600,
                backgroundColor: "var(--accent-blue, #1F5FBF)",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              + Buat Kotak Grup
            </button>
          </form>
        )}
      </div>
    </aside>
  );
}
