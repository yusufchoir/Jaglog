"use client";

import React, {
  useCallback,
  useMemo,
  useState,
  useRef,
  useEffect,
} from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  useReactFlow,
  ReactFlowProvider,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";

import { CustomDeviceNode, CustomDeviceNodeData } from "./CustomDeviceNode";
import { CustomGroupNode, CustomGroupNodeData } from "./CustomGroupNode";
import { CustomLinkEdge } from "./CustomLinkEdge";
import { computeGroupBounds } from "@/lib/group-bounds";
export { computeGroupBounds } from "@/lib/group-bounds";

const nodeTypes: any = {
  customDeviceNode: CustomDeviceNode,
  customGroupNode: CustomGroupNode,
};

const edgeTypes: any = {
  customLinkEdge: CustomLinkEdge,
};

export interface RawNode {
  id: string;
  mapId: string;
  deviceId: string | null;
  isVirtual: boolean;
  tipeVirtual?: string | null;
  nama: string;
  tipe: string;
  ip: string | null;
  lokasi: string | null;
  status: "online" | "log_stopped" | "offline" | "unknown";
  pingStatus: "up" | "rto" | "disabled" | "unknown";
  rttMs: number | null;
  insidenTerbuka: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  x: number;
  y: number;
  groupId: string | null;
  terkunci: boolean;
}

export interface RawGroup {
  id: string;
  mapId: string;
  nama: string;
  warnaGaris: "biru" | "merah" | "abu";
  x: number;
  y: number;
  lebar: number;
  tinggi: number;
  totalNodes: number;
  onlineNodes: number;
  deviceGroupId?: string | null;
}

export interface RawLink {
  id: string;
  mapId: string;
  sourceNodeId: string;
  targetNodeId: string;
  label: string | null;
  tipe: "kabel" | "wireless" | "vpn" | "lainnya";
}

interface NetworkTopologyCanvasProps {
  mapId: string;
  initialNodes: RawNode[];
  initialGroups: RawGroup[];
  initialLinks: RawLink[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onSelectGroup?: (groupId: string | null) => void;
  focusedGroupId?: string | null;
  isEditMode: boolean;
  collapsedGroupIds?: Set<string>;
  onToggleCollapse?: (groupId: string) => void;
  onResetGroupView?: () => void;
  onSaveLayout: (
    nodes: Array<{ id: string; x: number; y: number; terkunci?: boolean; groupId?: string | null }>,
    groups: Array<{ id: string; x: number; y: number; lebar?: number; tinggi?: number }>
  ) => Promise<boolean>;
  onCreateLink: (sourceNodeId: string, targetNodeId: string) => Promise<void>;
  onDeleteLink: (linkId: string) => Promise<void>;
  onDropDevice: (deviceId: string, x: number, y: number) => Promise<void>;
  saveStatusText: string;
  onNotify?: (
    msg: string,
    type: "info" | "warning" | "error" | "success",
    opts?: { actionText?: string; onAction?: () => void }
  ) => void;
}

/**
 * Recompute bounding box untuk seluruh customGroupNode yang tidak dilipat
 */
function recomputeAllGroupBounds(allNodes: Node[]): Node[] {
  return allNodes.map((node) => {
    if (node.type !== "customGroupNode") return node;
    const isCollapsed = Boolean((node.data as any).isCollapsed);
    if (isCollapsed) return node;

    const rawGroupId = (node.data as any).id;
    const members = allNodes.filter(
      (n) => n.type !== "customGroupNode" && (n.data as any).groupId === rawGroupId
    );
    const bounds = computeGroupBounds((node.data as any), members);

    return {
      ...node,
      position: { x: bounds.x, y: bounds.y },
      style: {
        ...node.style,
        width: bounds.width,
        height: bounds.height,
      },
      data: {
        ...(node.data as any),
        lebar: bounds.width,
        tinggi: bounds.height,
        totalNodes: members.length,
      },
    };
  });
}

function InnerCanvas({
  mapId,
  initialNodes,
  initialGroups,
  initialLinks,
  selectedNodeId,
  onSelectNode,
  onSelectGroup,
  focusedGroupId,
  isEditMode,
  collapsedGroupIds: propCollapsedGroupIds,
  onToggleCollapse: propOnToggleCollapse,
  onResetGroupView: propOnResetGroupView,
  onSaveLayout,
  onCreateLink,
  onDeleteLink,
  onDropDevice,
  saveStatusText,
  onNotify,
}: NetworkTopologyCanvasProps) {
  const reactFlowInstance = useReactFlow();

  // State cadangan lokal jika tidak diteruskan dari prop (fallback)
  const [internalCollapsedGroupIds, setInternalCollapsedGroupIds] = useState<Set<string>>(new Set());

  const activeCollapsedGroupIds = useMemo(() => {
    return propCollapsedGroupIds ?? internalCollapsedGroupIds;
  }, [propCollapsedGroupIds, internalCollapsedGroupIds]);

  const handleFitView = useCallback(() => {
    reactFlowInstance.fitView({ padding: 0.25, duration: 400 });
  }, [reactFlowInstance]);

  const handleResetGroupView = useCallback(() => {
    if (propOnResetGroupView) {
      propOnResetGroupView();
    } else {
      activeCollapsedGroupIds.forEach((id) => {
        if (propOnToggleCollapse) propOnToggleCollapse(id);
      });
      setInternalCollapsedGroupIds(new Set());
    }
    setTimeout(() => {
      reactFlowInstance.fitView({ padding: 0.25, duration: 400 });
    }, 150);
  }, [activeCollapsedGroupIds, propOnResetGroupView, propOnToggleCollapse, reactFlowInstance]);

  const handleToggleCollapse = useCallback(
    (groupId: string) => {
      if (propOnToggleCollapse) {
        propOnToggleCollapse(groupId);
      } else {
        setInternalCollapsedGroupIds((prev) => {
          const next = new Set(prev);
          if (next.has(groupId)) {
            next.delete(groupId);
          } else {
            next.add(groupId);
          }
          return next;
        });
      }
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.25, duration: 300 });
      }, 150);
    },
    [propOnToggleCollapse, reactFlowInstance]
  );

  // Auto-fitView saat data peta pertama kali dimuat atau berpindah peta
  const hasAutoFittedMapIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialNodes.length > 0 && hasAutoFittedMapIdRef.current !== mapId) {
      hasAutoFittedMapIdRef.current = mapId;
      const timer = setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.25, duration: 400 });
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [initialNodes.length, mapId, reactFlowInstance]);

  // Helper hitung status terburuk untuk grup
  const getGroupWorstStatus = useCallback((groupId: string, allNodes: RawNode[]) => {
    const members = allNodes.filter((n) => n.groupId === groupId);
    if (members.some((n) => n.status === "offline")) return "offline" as const;
    if (members.some((n) => n.status === "log_stopped")) return "log_stopped" as const;
    if (members.some((n) => n.status === "online")) return "online" as const;
    return "unknown" as const;
  }, []);

  // Helper konversi data raw ke format Node & Edge React Flow
  const buildNodes = useCallback(
    (rawNodes: RawNode[], rawGroups: RawGroup[]): Node[] => {
      // 1. Group nodes (layer belakang saat expanded zIndex 1, layer depan saat collapsed zIndex 20)
      // Hanya render kotak grup yang memiliki anggota di peta (grup kosong tidak digambar sebagai kotak)
      const groupNodes: Node[] = rawGroups
        .filter((g) => rawNodes.some((n) => n.groupId === g.id))
        .map((g) => {
        const isCollapsed = activeCollapsedGroupIds.has(g.id);
        const worstStatus = getGroupWorstStatus(g.id, rawNodes);
        const members = rawNodes.filter((n) => n.groupId === g.id);
        const bounds = computeGroupBounds(g, members);
        const openIncidents = members.reduce(
          (sum, m) => sum + (m.insidenTerbuka?.total || 0),
          0
        );

        const safeGroupX = typeof g.x === "number" && !isNaN(g.x) ? g.x : bounds.x;
        const safeGroupY = typeof g.y === "number" && !isNaN(g.y) ? g.y : bounds.y;

        return {
          id: `group-${g.id}`,
          type: "customGroupNode",
          position: isCollapsed ? { x: safeGroupX, y: safeGroupY } : { x: bounds.x, y: bounds.y },
          data: {
            id: g.id,
            nama: g.nama,
            warnaGaris: g.warnaGaris,
            lebar: bounds.width,
            tinggi: bounds.height,
            totalNodes: members.length,
            onlineNodes: members.filter((m) => m.status === "online").length,
            openIncidentsCount: openIncidents,
            isEditMode,
            isCollapsed,
            worstStatus,
            onToggleCollapse: handleToggleCollapse,
            onOpenGroupDetail: onSelectGroup,
          } as CustomGroupNodeData,
          draggable: isEditMode,
          selectable: isEditMode,
          zIndex: isCollapsed ? 20 : 1,
          style: isCollapsed
            ? { width: 240, height: 72 }
            : { width: bounds.width, height: bounds.height },
        };
      });

      // 2. Device nodes (layer depan) — sembunyikan jika grupnya dilipat
      const deviceNodes: Node[] = rawNodes.map((n) => {
        const safeNodeX = typeof n.x === "number" && !isNaN(n.x) ? n.x : 0;
        const safeNodeY = typeof n.y === "number" && !isNaN(n.y) ? n.y : 0;
        const isHidden = n.groupId ? activeCollapsedGroupIds.has(n.groupId) : false;

        return {
          id: n.id,
          type: "customDeviceNode",
          position: { x: safeNodeX, y: safeNodeY },
          data: {
            ...n,
            isEditMode,
            onSelectNode: (id: string) => onSelectNode(id),
          } as CustomDeviceNodeData,
          draggable: isEditMode && !n.terkunci,
          selectable: true,
          zIndex: 10,
          hidden: isHidden,
        };
      });

      const allResultingNodes = [...groupNodes, ...deviceNodes];
      const visibleCount = allResultingNodes.filter((n) => !n.hidden).length;

      // Sesuai Aturan: Jangan pernah menyembunyikan seluruh node karena status lipat.
      // Bila status lipat membuat tidak ada yang tampil, abaikan status itu, kembali ke semua terbuka, dan tulis ulang status yang bersih.
      if (visibleCount === 0 && rawNodes.length > 0) {
        if (propOnResetGroupView) {
          setTimeout(() => propOnResetGroupView(), 0);
        }
        return allResultingNodes.map((n) => ({ ...n, hidden: false }));
      }

      return allResultingNodes;
    },
    [isEditMode, onSelectNode, activeCollapsedGroupIds, handleToggleCollapse, onSelectGroup, getGroupWorstStatus, propOnResetGroupView]
  );

  const buildEdges = useCallback(
    (rawLinks: RawLink[], rawNodes: RawNode[]): Edge[] => {
      const nodeStatusMap = new Map<string, string>();
      const nodeGroupMap = new Map<string, string | null>();

      for (const n of rawNodes) {
        nodeStatusMap.set(n.id, n.status);
        nodeGroupMap.set(n.id, n.groupId);
      }

      const dedupeMap = new Map<string, Edge>();
      const validNodeIds = new Set(rawNodes.map((n) => n.id));

      for (const l of rawLinks) {
        // Abaikan link yatim jika source atau target node tidak ada di peta aktif
        if (!validNodeIds.has(l.sourceNodeId) || !validNodeIds.has(l.targetNodeId)) {
          continue;
        }

        let sourceId = l.sourceNodeId;
        let targetId = l.targetNodeId;

        const sourceGrp = nodeGroupMap.get(sourceId);
        const targetGrp = nodeGroupMap.get(targetId);

        // Jika salah satu ujung link berada di dalam grup yang dilipat, arahkan visual ke node grup
        if (sourceGrp && activeCollapsedGroupIds.has(sourceGrp)) {
          sourceId = `group-${sourceGrp}`;
        }
        if (targetGrp && activeCollapsedGroupIds.has(targetGrp)) {
          targetId = `group-${targetGrp}`;
        }

        // Jangan gambar link internal antar anggota grup yang sama saat dilipat
        if (sourceId === targetId) {
          continue;
        }

        const edgeKey = `${sourceId}___${targetId}`;
        const reverseKey = `${targetId}___${sourceId}`;
        const existingKey = dedupeMap.has(edgeKey)
          ? edgeKey
          : dedupeMap.has(reverseKey)
            ? reverseKey
            : null;

        if (!existingKey) {
          dedupeMap.set(edgeKey, {
            id: l.id,
            source: sourceId,
            target: targetId,
            type: "customLinkEdge",
            data: {
              id: l.id,
              label: l.label,
              tipe: l.tipe,
              sourceStatus: nodeStatusMap.get(l.sourceNodeId) || "online",
              targetStatus: nodeStatusMap.get(l.targetNodeId) || "online",
              onDeleteLink: (linkId: string) => onDeleteLink(linkId),
              isEditMode,
              count: 1,
            },
            zIndex: 5,
          });
        } else {
          // Gabung link ganda ke grup terlipat dengan lencana jumlah
          const existing = dedupeMap.get(existingKey)!;
          if (existing.data) {
            const currentCount = ((existing.data as any).count || 1) + 1;
            (existing.data as any).count = currentCount;
            (existing.data as any).label = `${currentCount} tautan`;
          }
        }
      }

      return Array.from(dedupeMap.values());
    },
    [isEditMode, onDeleteLink, activeCollapsedGroupIds]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(
    buildNodes(initialNodes, initialGroups)
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    buildEdges(initialLinks, initialNodes)
  );

  const currentMapIdRef = useRef<string>(mapId);

  // Sync saat initialNodes/Groups/Links berubah dari server/SSE
  useEffect(() => {
    const isNewMap = currentMapIdRef.current !== mapId;
    currentMapIdRef.current = mapId;

    setNodes((prevNodes) => {
      const newNodes = buildNodes(initialNodes, initialGroups);
      // Jika baru pertama kali dimuat atau berpindah peta, pakai koordinat fresh dari database
      if (isNewMap || prevNodes.length === 0) {
        return newNodes.map((n) => ({
          ...n,
          selected: n.id === selectedNodeId,
        }));
      }

      // Jika update status/ping dari SSE saat peta yang sama sedang dibuka:
      // PERTAHANKAN posisi koordinat kanvas saat ini agar node tidak loncat/revert!
      const prevPosMap = new Map(prevNodes.map((n) => [n.id, n.position]));
      const prevSelectedMap = new Map(prevNodes.map((n) => [n.id, n.selected]));

      const merged = newNodes.map((n) => {
        // Untuk grup yang expanded, koordinat selalu derived dari posisi anggotanya
        if (n.type === "customGroupNode" && !(n.data as any).isCollapsed) {
          return {
            ...n,
            selected: prevSelectedMap.get(n.id) ?? (n.id === selectedNodeId),
          };
        }
        const existingPos = prevPosMap.get(n.id);
        const existingSelected = prevSelectedMap.get(n.id);
        return {
          ...n,
          position: existingPos || n.position,
          selected: existingSelected !== undefined ? existingSelected : n.id === selectedNodeId,
        };
      });

      return recomputeAllGroupBounds(merged);
    });

    setEdges(buildEdges(initialLinks, initialNodes));
  }, [mapId, initialNodes, initialGroups, initialLinks, buildNodes, buildEdges, setNodes, setEdges, selectedNodeId]);

  // Pantau perubahan dimensi terukur (measured) dari React Flow untuk menyesuaikan batas kotak
  const handleNodesChange = useCallback(
    (changes: any[]) => {
      onNodesChange(changes);
      const hasDimensionChanges = changes.some((c) => c.type === "dimensions");
      if (hasDimensionChanges) {
        setNodes((prev) => recomputeAllGroupBounds(prev));
      }
    },
    [onNodesChange, setNodes]
  );

  // Sinkronisasi status seleksi node secara terpisah tanpa mereset posisi kanvas
  useEffect(() => {
    setNodes((prevNodes) =>
      prevNodes.map((n) => {
        const shouldBeSelected = n.id === selectedNodeId;
        if (n.selected === shouldBeSelected) return n;
        return { ...n, selected: shouldBeSelected };
      })
    );
  }, [selectedNodeId, setNodes]);

  // Fokus pada grup tertentu jika focusedGroupId berubah
  useEffect(() => {
    if (!focusedGroupId) return;
    const targetGroup = initialGroups.find(
      (g) => g.id === focusedGroupId || g.deviceGroupId === focusedGroupId
    );
    if (targetGroup) {
      const timer = setTimeout(() => {
        reactFlowInstance.setCenter(
          targetGroup.x + targetGroup.lebar / 2,
          targetGroup.y + targetGroup.tinggi / 2,
          { zoom: 1.1, duration: 800 }
        );
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [focusedGroupId, initialGroups, reactFlowInstance]);

  // Data pelacak saat drag dimulai
  const dragStartDataRef = useRef<{
    isGroup: boolean;
    groupId?: string;
    groupStartPos?: { x: number; y: number };
    memberStartPositions?: Map<string, { x: number; y: number }>;
    nodeId?: string;
    startPos?: { x: number; y: number };
  } | null>(null);

  const onNodeDragStart = useCallback(
    (_event: any, node: Node) => {
      if (node.type === "customGroupNode") {
        const rawGroupId = (node.data as any).id;
        const memberPositions = new Map<string, { x: number; y: number }>();
        nodes.forEach((n) => {
          if (n.type !== "customGroupNode" && (n.data as any).groupId === rawGroupId) {
            memberPositions.set(n.id, { x: n.position.x, y: n.position.y });
          }
        });

        dragStartDataRef.current = {
          isGroup: true,
          groupId: rawGroupId,
          groupStartPos: { x: node.position.x, y: node.position.y },
          memberStartPositions: memberPositions,
        };
      } else {
        dragStartDataRef.current = {
          isGroup: false,
          nodeId: node.id,
          startPos: { x: node.position.x, y: node.position.y },
        };
      }
    },
    [nodes]
  );

  // Menggeser secara interaktif (live update during drag)
  const onNodeDrag = useCallback(
    (_event: any, node: Node) => {
      if (!isEditMode) return;

      // 1. Jika menggeser kotak grup: geser seluruh anggota secara bersamaan seketika
      if (node.type === "customGroupNode") {
        const dragData = dragStartDataRef.current;
        if (
          dragData &&
          dragData.isGroup &&
          dragData.groupId === (node.data as any).id &&
          dragData.groupStartPos &&
          dragData.memberStartPositions
        ) {
          const dx = node.position.x - dragData.groupStartPos.x;
          const dy = node.position.y - dragData.groupStartPos.y;

          setNodes((prevNodes) =>
            prevNodes.map((n) => {
              if (n.type !== "customGroupNode" && (n.data as any).groupId === dragData.groupId) {
                const startPos = dragData.memberStartPositions!.get(n.id);
                if (startPos) {
                  return {
                    ...n,
                    position: {
                      x: Math.round(startPos.x + dx),
                      y: Math.round(startPos.y + dy),
                    },
                  };
                }
              }
              return n;
            })
          );
        }
        return;
      }

      // 2. Jika menggeser anggota grup: kotak langsung menyesuaikan ukuran (membesar/mengecil) saat drag
      const rawGroupId = (node.data as any).groupId;
      if (rawGroupId) {
        setNodes((prevNodes) => {
          const updatedNodes = prevNodes.map((n) => (n.id === node.id ? node : n));
          return recomputeAllGroupBounds(updatedNodes);
        });
      }
    },
    [isEditMode, setNodes]
  );

  // Rapikan Otomatis (Dagre Layout)
  const handleDagreLayout = useCallback(() => {
    if (!isEditMode) return;
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 100 });
    g.setDefaultEdgeLabel(() => ({}));

    // Masukkan hanya device nodes ke dagre
    nodes.forEach((n) => {
      if (n.type !== "customGroupNode") {
        g.setNode(n.id, { width: 190, height: 85 });
      }
    });

    edges.forEach((e) => {
      g.setEdge(e.source, e.target);
    });

    dagre.layout(g);

    let updatedNodes = nodes.map((n) => {
      if (n.type !== "customGroupNode") {
        const nodeWithPosition = g.node(n.id);
        if (nodeWithPosition) {
          return {
            ...n,
            position: {
              x: Math.round(nodeWithPosition.x - 95),
              y: Math.round(nodeWithPosition.y - 42),
            },
          };
        }
      }
      return n;
    });

    // Hitung ulang semua batas grup setelah dagre layout
    updatedNodes = recomputeAllGroupBounds(updatedNodes);

    // Pastikan tidak ada 2 kotak grup yang saling menimpa (jarak minimal 32px antar kotak)
    const expandedGroupNodes = updatedNodes.filter(
      (n) => n.type === "customGroupNode" && !(n.data as any).isCollapsed
    );

    for (let i = 0; i < expandedGroupNodes.length; i++) {
      for (let j = i + 1; j < expandedGroupNodes.length; j++) {
        const g1 = expandedGroupNodes[i];
        const g2 = expandedGroupNodes[j];
        const w1 = Number(g1.style?.width || 220);
        const h1 = Number(g1.style?.height || 120);
        const w2 = Number(g2.style?.width || 220);
        const h2 = Number(g2.style?.height || 120);

        // Jika saling menimpa (overlap)
        if (
          g1.position.x < g2.position.x + w2 &&
          g1.position.x + w1 > g2.position.x &&
          g1.position.y < g2.position.y + h2 &&
          g1.position.y + h1 > g2.position.y
        ) {
          // Geser g2 dan semua anggotanya ke kanan dengan jarak 32px
          const shiftX = Math.round(g1.position.x + w1 + 32 - g2.position.x);
          const g2Id = (g2.data as any).id;

          updatedNodes = updatedNodes.map((n) => {
            if (n.id === g2.id) {
              return { ...n, position: { ...n.position, x: n.position.x + shiftX } };
            }
            if (n.type !== "customGroupNode" && (n.data as any).groupId === g2Id) {
              return { ...n, position: { ...n.position, x: n.position.x + shiftX } };
            }
            return n;
          });
        }
      }
    }

    setNodes(updatedNodes);

    // Simpan semua node dan grup yang baru dirapikan
    const changedNodes = updatedNodes
      .filter((n) => n.type !== "customGroupNode")
      .map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        terkunci: (n.data as any).terkunci,
        groupId: (n.data as any).groupId,
      }));

    const changedGroups = updatedNodes
      .filter((n) => n.type === "customGroupNode")
      .map((n) => ({
        id: (n.data as any).id,
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
        lebar: Number(n.style?.width || 220),
        tinggi: Number(n.style?.height || 120),
      }));

    onSaveLayout(changedNodes, changedGroups);
    setTimeout(() => {
      reactFlowInstance.fitView({ padding: 0.2, duration: 400 });
    }, 100);
  }, [isEditMode, nodes, edges, setNodes, onSaveLayout, reactFlowInstance]);

  const onNodeDragStop = useCallback(
    (_event: any, node: Node) => {
      if (!isEditMode) return;

      const savedDragStart = dragStartDataRef.current;
      dragStartDataRef.current = null;

      // 1. Pastikan node yang baru saja digeser memakai koordinat posisi terbarunya
      let currentNodes = nodes.map((n) =>
        n.id === node.id ? { ...n, position: { ...node.position } } : n
      );

      // Jika grup digeser: selesaikan posisi seluruh anggota
      if (node.type === "customGroupNode") {
        const dragData = savedDragStart;
        if (
          dragData &&
          dragData.isGroup &&
          dragData.groupId === (node.data as any).id &&
          dragData.groupStartPos &&
          dragData.memberStartPositions
        ) {
          const dx = Math.round(node.position.x - dragData.groupStartPos.x);
          const dy = Math.round(node.position.y - dragData.groupStartPos.y);

          if (dx !== 0 || dy !== 0) {
            currentNodes = currentNodes.map((n) => {
              if (n.type !== "customGroupNode" && (n.data as any).groupId === dragData.groupId) {
                const startPos = dragData.memberStartPositions!.get(n.id);
                if (startPos) {
                  return {
                    ...n,
                    position: {
                      x: Math.round(startPos.x + dx),
                      y: Math.round(startPos.y + dy),
                    },
                  };
                }
              }
              return n;
            });
          }
        }
      }

      // Hitung ulang seluruh bounding box grup
      currentNodes = recomputeAllGroupBounds(currentNodes);
      setNodes(currentNodes);

      // 2. Periksa apakah dua kotak grup saling menimpa
      const expandedGroups = currentNodes.filter(
        (n) => n.type === "customGroupNode" && !(n.data as any).isCollapsed
      );
      let groupsOverlap = false;
      for (let i = 0; i < expandedGroups.length; i++) {
        for (let j = i + 1; j < expandedGroups.length; j++) {
          const g1 = expandedGroups[i];
          const g2 = expandedGroups[j];
          const w1 = Number(g1.style?.width || 220);
          const h1 = Number(g1.style?.height || 120);
          const w2 = Number(g2.style?.width || 220);
          const h2 = Number(g2.style?.height || 120);

          if (
            g1.position.x < g2.position.x + w2 &&
            g1.position.x + w1 > g2.position.x &&
            g1.position.y < g2.position.y + h2 &&
            g1.position.y + h1 > g2.position.y
          ) {
            groupsOverlap = true;
            break;
          }
        }
        if (groupsOverlap) break;
      }

      if (groupsOverlap) {
        onNotify?.(
          "Dua kotak grup saling menimpa. Klik Rapikan untuk merapikan posisi.",
          "warning",
          {
            actionText: "Rapikan",
            onAction: handleDagreLayout,
          }
        );
      }

      // 3. Jika node perangkat digeser ke atas kotak grup lain: tawarkan konfirmasi inline
      if (node.type !== "customGroupNode") {
        const centerX = node.position.x + 95;
        const centerY = node.position.y + 42;
        const currentGroupId = (node.data as any).groupId;
        const nodeName = (node.data as any).nama || "Perangkat";

        // Cari grup tujuan yang bukan grup saat ini
        const targetGroupNode = expandedGroups.find((gNode) => {
          const gId = (gNode.data as any).id;
          if (gId === currentGroupId) return false;
          const gw = Number(gNode.style?.width || 220);
          const gh = Number(gNode.style?.height || 120);
          return (
            centerX >= gNode.position.x &&
            centerX <= gNode.position.x + gw &&
            centerY >= gNode.position.y &&
            centerY <= gNode.position.y + gh
          );
        });

        if (targetGroupNode) {
          const targetGroupId = (targetGroupNode.data as any).id;
          const targetGroupName = (targetGroupNode.data as any).nama;
          const originalPos = savedDragStart?.startPos || { x: node.position.x, y: node.position.y };
          const droppedPos = { x: Math.round(node.position.x), y: Math.round(node.position.y) };

          // Kembalikan node ke posisi semula jika tanpa konfirmasi (Aturan: tanpa konfirmasi, node kembali)
          setNodes((prev) => {
            const reverted = prev.map((n) =>
              n.id === node.id ? { ...n, position: { ...originalPos } } : n
            );
            return recomputeAllGroupBounds(reverted);
          });

          onNotify?.(
            `Pindahkan "${nodeName}" ke grup "${targetGroupName}"?`,
            "info",
            {
              actionText: "Pindahkan",
              onAction: () => {
                setNodes((prev) => {
                  const updated = prev.map((n) =>
                    n.id === node.id
                      ? {
                          ...n,
                          position: droppedPos,
                          data: { ...n.data, groupId: targetGroupId },
                        }
                      : n
                  );
                  return recomputeAllGroupBounds(updated);
                });
                onSaveLayout(
                  [{ id: node.id, x: droppedPos.x, y: droppedPos.y, groupId: targetGroupId }],
                  []
                );
              },
            }
          );
          return;
        }
      }

      // 4. Kumpulkan HANYA elemen yang posisinya BERUBAH (delta payload)
      const changedNodes: Array<{ id: string; x: number; y: number; terkunci?: boolean; groupId?: string | null }> = [];
      const changedGroups: Array<{ id: string; x: number; y: number; lebar?: number; tinggi?: number }> = [];

      if (node.type === "customGroupNode") {
        const rawGroupId = (node.data as any).id;
        currentNodes.forEach((n) => {
          if (n.type !== "customGroupNode" && (n.data as any).groupId === rawGroupId) {
            changedNodes.push({
              id: n.id,
              x: Math.round(n.position.x),
              y: Math.round(n.position.y),
              terkunci: (n.data as any).terkunci,
              groupId: (n.data as any).groupId,
            });
          }
        });
      } else {
        const startPos = savedDragStart?.startPos;
        const hasMoved =
          !startPos ||
          Math.abs(node.position.x - startPos.x) > 0.5 ||
          Math.abs(node.position.y - startPos.y) > 0.5;

        if (hasMoved) {
          changedNodes.push({
            id: node.id,
            x: Math.round(node.position.x),
            y: Math.round(node.position.y),
            terkunci: (node.data as any).terkunci,
            groupId: (node.data as any).groupId,
          });
        }
      }

      if (changedNodes.length > 0) {
        onSaveLayout(changedNodes, changedGroups);
      }
    },
    [isEditMode, nodes, onNotify, handleDagreLayout, onSaveLayout, setNodes]
  );

  // Buat link baru antar node (hanya pada mode edit)
  const onConnect = useCallback(
    (params: Connection) => {
      if (!isEditMode) return;
      if (!params.source || !params.target) return;
      if (params.source === params.target) return;

      // Jangan izinkan koneksi langsung ke node grup
      if (params.source.startsWith("group-") || params.target.startsWith("group-")) {
        return;
      }

      onCreateLink(params.source, params.target);
    },
    [isEditMode, onCreateLink]
  );

  // Penanganan Drag & Drop dari panel Unplaced Devices
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!isEditMode) return;

      const deviceId = event.dataTransfer.getData("application/jagalog-device-id");
      if (!deviceId) return;

      const reactFlowBounds = event.currentTarget.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      // Validasi penempatan agar node tidak saling menimpa total
      let finalX = Math.round(position.x);
      let finalY = Math.round(position.y);

      let hasOverlap = true;
      let attempts = 0;
      while (hasOverlap && attempts < 10) {
        attempts++;
        const overlap = nodes.some(
          (n) =>
            n.type !== "customGroupNode" &&
            Math.abs(n.position.x - finalX) < 40 &&
            Math.abs(n.position.y - finalY) < 35
        );
        if (overlap) {
          finalX += 45;
          finalY += 35;
        } else {
          hasOverlap = false;
        }
      }

      onDropDevice(deviceId, finalX, finalY);
    },
    [isEditMode, reactFlowInstance, onDropDevice, nodes]
  );

  // Deteksi apakah ada node yang terlihat di dalam viewport layar
  const [hasNodesInViewport, setHasNodesInViewport] = useState(true);

  const checkViewportVisibility = useCallback(() => {
    if (nodes.length === 0) return;
    try {
      const { x, y, zoom } = reactFlowInstance.getViewport();
      const viewportWidth = window.innerWidth || 1200;
      const viewportHeight = window.innerHeight || 800;

      const viewXMin = -x / zoom;
      const viewXMax = (viewportWidth - x) / zoom;
      const viewYMin = -y / zoom;
      const viewYMax = (viewportHeight - y) / zoom;

      const visible = nodes.some((n) => {
        if (n.hidden) return false;
        const w = Number((n.style?.width as number) || n.width || 185);
        const h = Number((n.style?.height as number) || n.height || 85);
        return (
          n.position.x < viewXMax &&
          n.position.x + w > viewXMin &&
          n.position.y < viewYMax &&
          n.position.y + h > viewYMin
        );
      });

      setHasNodesInViewport(visible);
    } catch {}
  }, [nodes, reactFlowInstance]);

  useEffect(() => {
    const timer = setTimeout(checkViewportVisibility, 600);
    return () => clearTimeout(timer);
  }, [nodes, checkViewportVisibility]);

  return (
    <div
      style={{ width: "100%", height: "100%", position: "relative" }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onlyRenderVisibleElements={false}
        nodesDraggable={isEditMode}
        nodesConnectable={isEditMode}
        elementsSelectable={true}
        fitView
        minZoom={0.1}
        maxZoom={2.5}
        defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
        onPaneClick={() => {
          onSelectNode(null);
          onSelectGroup?.(null);
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#E6E4DF" />
        <Controls
          position="bottom-left"
          showZoom={true}
          showFitView={true}
          onFitView={handleFitView}
          fitViewOptions={{ padding: 0.25, duration: 400 }}
          showInteractive={false}
          style={{
            marginBottom: "36px",
            borderRadius: "4px",
            border: "1px solid var(--border-color, #E6E4DF)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            backgroundColor: "var(--bg-panel, #FFFFFF)",
          }}
        />
        <MiniMap
          nodeStrokeWidth={2}
          nodeColor={(n: any) => {
            if (n.type === "customGroupNode") return "#CBD5E1";
            const st = n.data?.status;
            if (st === "online") return "#22C55E";
            if (st === "log_stopped") return "#EAB308";
            if (st === "offline") return "#EF4444";
            return "#94A3B8";
          }}
          maskColor="rgba(250, 250, 248, 0.7)"
          style={{
            border: "1px solid var(--border-color, #E6E4DF)",
            borderRadius: "4px",
            backgroundColor: "var(--bg-panel, #FFFFFF)",
            width: 140,
            height: 95,
          }}
        />
      </ReactFlow>

      {/* Floating Status Bar & Tombol Navigasi Cepat (saat Mode Ubah Tata Letak) */}
      {isEditMode && (
        <div
          style={{
            position: "absolute",
            top: "16px",
            left: "16px",
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: "var(--bg-panel, #FFFFFF)",
            border: "1px solid var(--border-color, #E6E4DF)",
            borderRadius: "4px",
            padding: "6px 12px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            fontSize: "12px",
          }}
        >
          <span style={{ fontWeight: 600, color: "var(--text-main, #1F2430)" }}>
            Mode Ubah Tata Letak
          </span>

          <span style={{ color: "var(--text-muted, #8C93A0)" }}>|</span>

          <span
            style={{
              color: saveStatusText === "Tersimpan" ? "#15803D" : "var(--accent-blue, #1F5FBF)",
              fontWeight: 500,
            }}
          >
            {saveStatusText}
          </span>

          <button
            type="button"
            onClick={handleDagreLayout}
            title="Atur tata letak node otomatis secara hierarki"
            style={{
              marginLeft: "6px",
              padding: "4px 8px",
              fontSize: "11px",
              fontWeight: 600,
              backgroundColor: "var(--bg-app, #FAFAF8)",
              border: "1px solid var(--border-color, #E6E4DF)",
              borderRadius: "3px",
              cursor: "pointer",
              color: "var(--accent-blue, #1F5FBF)",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            📐 Rapikan
          </button>

          <button
            type="button"
            onClick={handleFitView}
            title="Pusatkan seluruh perangkat ke tengah layar (Fit View)"
            style={{
              marginLeft: "2px",
              padding: "4px 8px",
              fontSize: "11px",
              fontWeight: 600,
              backgroundColor: "var(--bg-app, #FAFAF8)",
              border: "1px solid var(--border-color, #E6E4DF)",
              borderRadius: "3px",
              cursor: "pointer",
              color: "var(--accent-blue, #1F5FBF)",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span>⛶</span>
            <span>Pusatkan</span>
          </button>
        </div>
      )}

      {/* Banner Peringatan jika data ada tapi tidak ada yang tampil di viewport */}
      {initialNodes.length > 0 && !hasNodesInViewport && (
        <div
          role="alert"
          style={{
            position: "absolute",
            top: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            backgroundColor: "var(--bg-panel, #FFFFFF)",
            border: "1px solid #FDE047",
            borderLeft: "4px solid #EAB308",
            borderRadius: "6px",
            padding: "8px 16px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            fontSize: "12px",
            maxWidth: "90%",
          }}
        >
          <span style={{ color: "var(--text-main, #1F2430)", fontWeight: 500 }}>
            Peta berisi {initialNodes.length} perangkat tetapi tidak ada yang tampil. Pusatkan peta, atau atur ulang tampilan grup.
          </span>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              onClick={handleFitView}
              style={{
                padding: "4px 10px",
                fontSize: "11px",
                fontWeight: 600,
                backgroundColor: "var(--accent-blue, #1F5FBF)",
                color: "#FFFFFF",
                borderRadius: "4px",
                border: "none",
                cursor: "pointer",
              }}
            >
              Pusatkan
            </button>
            <button
              type="button"
              onClick={handleResetGroupView}
              style={{
                padding: "4px 10px",
                fontSize: "11px",
                fontWeight: 600,
                backgroundColor: "transparent",
                color: "var(--text-secondary, #5B6270)",
                borderRadius: "4px",
                border: "1px solid var(--border-color, #E6E4DF)",
                cursor: "pointer",
              }}
            >
              Reset tampilan grup
            </button>
          </div>
        </div>
      )}

      {/* Empty State jika belum ada node */}
      {initialNodes.length === 0 && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: "var(--bg-panel, #FFFFFF)",
            border: "1px solid var(--border-color, #E6E4DF)",
            borderRadius: "8px",
            padding: "24px 28px",
            textAlign: "center",
            maxWidth: "400px",
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.06)",
            zIndex: 5,
          }}
        >
          <h4 style={{ margin: "0 0 8px 0", fontSize: "15px", fontWeight: 700, color: "var(--text-main, #1F2430)" }}>
            Peta Topologi Masih Kosong
          </h4>
          <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary, #5B6270)", lineHeight: 1.5 }}>
            Belum ada perangkat di peta. Tambahkan perangkat di menu Perangkat, lalu seret ke kanvas ini atau klik{" "}
            <strong>Tempatkan Otomatis</strong> di panel penyunting.
          </p>
        </div>
      )}

      {/* Legenda Ringkas di Pojok Kiri Bawah */}
      <div
        className="desktop-only"
        style={{
          position: "absolute",
          bottom: "16px",
          left: "16px",
          zIndex: 10,
          backgroundColor: "rgba(255, 255, 255, 0.92)",
          border: "1px solid var(--border-color, #E6E4DF)",
          borderRadius: "4px",
          padding: "6px 10px",
          fontSize: "10.5px",
          display: "flex",
          gap: "12px",
          alignItems: "center",
          backdropFilter: "blur(4px)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <span style={{ color: "#15803D", fontWeight: 600 }}>● Online</span>
        <span style={{ color: "#B45309", fontWeight: 600 }}>◐ Log berhenti</span>
        <span style={{ color: "#B91C1C", fontWeight: 600 }}>○ Offline</span>
        <span style={{ color: "#64748B", fontWeight: 600 }}>◌ Belum ada data</span>
        <span style={{ color: "var(--accent-red, #C8372D)", fontWeight: 700 }}>! Garis merah: Insiden</span>
      </div>
    </div>
  );
}

export default function NetworkTopologyCanvas(props: NetworkTopologyCanvasProps) {
  return (
    <ReactFlowProvider>
      <InnerCanvas {...props} />
    </ReactFlowProvider>
  );
}
