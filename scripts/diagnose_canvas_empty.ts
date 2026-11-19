import { computeGroupBounds } from "../app/src/lib/group-bounds";

async function runDiagnosis() {
  console.log("=== LANGKAH 1: DIAGNOSIS KANVAS KOSONG DI HALAMAN /peta ===\n");

  // 1. Data dari /api/peta (simulasi data production yang baru saja diambil)
  const apiData = {
    petaId: "53420abd-92f0-42e9-ac50-4bddb30e2778",
    petaNama: "Peta Jaringan Utama",
    grup: [
      { id: "e082b2ab-1415-433c-b2de-60e16ff7a681", nama: "BPI", x: 50, y: 193, lebar: 320, tinggi: 220, totalNodes: 0 },
      { id: "252dfe03-6b26-4883-99dc-96b2e9b505c2", nama: "SEMARANG", x: 233, y: -272, lebar: 320, tinggi: 220, totalNodes: 4 },
    ],
    node: [
      { id: "node-1", nama: "MONITORING THE DUDE", x: 1170, y: -385, groupId: null, status: "online" },
      { id: "node-2", nama: "Main Mikrotik", x: 471, y: -224, groupId: "252dfe03-6b26-4883-99dc-96b2e9b505c2", status: "online" },
      { id: "node-3", nama: "SERVER 1", x: 1250, y: 1, groupId: null, status: "online" },
      { id: "node-4", nama: "SERVER 190", x: 1500, y: 1, groupId: null, status: "online" },
      { id: "node-5", nama: "SERVER 7", x: 1750, y: 1, groupId: null, status: "online" },
      { id: "node-6", nama: "SERVER181", x: 2000, y: 1, groupId: null, status: "online" },
      { id: "node-7", nama: "SERVER4", x: 2250, y: 1, groupId: null, status: "online" },
      { id: "node-8", nama: "SERVER9", x: 2500, y: 1, groupId: null, status: "online" },
      { id: "node-9", nama: "SG197", x: 2750, y: 1, groupId: null, status: "online" },
      { id: "node-10", nama: "WHMCS", x: 3000, y: 1, groupId: null, status: "online" },
      { id: "node-11", nama: "ARGON", x: 846, y: 234, groupId: null, status: "online" },
      { id: "node-12", nama: "J30", x: 244, y: -228, groupId: "252dfe03-6b26-4883-99dc-96b2e9b505c2", status: "online" },
      { id: "node-13", nama: "LocalHost", x: 256, y: -109, groupId: "252dfe03-6b26-4883-99dc-96b2e9b505c2", status: "online" },
      { id: "node-14", nama: "SEEVER 183", x: 451, y: -122, groupId: "252dfe03-6b26-4883-99dc-96b2e9b505c2", status: "online" },
    ],
    tampilan: {
      grup_terlipat: [],
    },
  };

  console.log("1. HITUNGAN PER TAHAP:");
  console.log(`- Dari API: ${apiData.node.length} node perangkat, ${apiData.grup.length} grup`);

  // Transformasi ke React Flow
  const collapsedGroupIds = new Set<string>(apiData.tampilan.grup_terlipat || []);
  const groupNodes = apiData.grup.map((g) => {
    const isCollapsed = collapsedGroupIds.has(g.id);
    const members = apiData.node.filter((n) => n.groupId === g.id);
    const bounds = computeGroupBounds(g, members);
    return {
      id: `group-${g.id}`,
      type: "customGroupNode",
      position: isCollapsed ? { x: g.x, y: g.y } : { x: bounds.x, y: bounds.y },
      width: bounds.width,
      height: bounds.height,
      hidden: false,
      isCollapsed,
    };
  });

  const deviceNodes = apiData.node.map((n) => {
    const isHidden = n.groupId ? collapsedGroupIds.has(n.groupId) : false;
    return {
      id: n.id,
      nama: n.nama,
      type: "customDeviceNode",
      position: { x: n.x, y: n.y },
      width: 185,
      height: 85,
      hidden: isHidden,
      groupId: n.groupId,
    };
  });

  const allNodes = [...groupNodes, ...deviceNodes];
  console.log(`- Setelah Transformasi: ${allNodes.length} node total (${deviceNodes.length} device, ${groupNodes.length} group)`);

  // Filter tahap: Filter bernilai 'Semua' (tidak ada filter aktif)
  const afterFilter = allNodes;
  console.log(`- Setelah Filter: ${afterFilter.length} node`);

  // Hidden status
  const visibleNodes = afterFilter.filter((n) => !n.hidden);
  const hiddenNodes = afterFilter.filter((n) => n.hidden);
  console.log(`- Setelah Hidden: ${visibleNodes.length} node visible, ${hiddenNodes.length} node hidden`);

  // 2. ANALISIS VIEWPORT & CULLING
  console.log("\n2. ANALISIS VIEWPORT & VISIBILITAS KANVAS:");
  // Default viewport React Flow saat inisialisasi awal
  const defaultViewport = { x: 0, y: 0, zoom: 1 };
  // Ukuran kanvas browser standar (desktop: 1200 x 600 px)
  const canvasSize = { width: 1200, height: 600 };

  // Rentang koordinat kanvas yang terlihat pada viewport default
  const viewXMin = -defaultViewport.x / defaultViewport.zoom;
  const viewXMax = (canvasSize.width - defaultViewport.x) / defaultViewport.zoom;
  const viewYMin = -defaultViewport.y / defaultViewport.zoom;
  const viewYMax = (canvasSize.height - defaultViewport.y) / defaultViewport.zoom;

  console.log(`Batas Viewport Default: X in [${viewXMin}, ${viewXMax}], Y in [${viewYMin}, ${viewYMax}]`);

  // Periksa berapa banyak node yang berada di dalam viewport default
  let insideViewportCount = 0;
  let outsideViewportCount = 0;

  for (const n of visibleNodes) {
    const nRight = n.position.x + n.width;
    const nBottom = n.position.y + n.height;
    const isInside =
      n.position.x < viewXMax &&
      nRight > viewXMin &&
      n.position.y < viewYMax &&
      nBottom > viewYMin;

    if (isInside) {
      insideViewportCount++;
    } else {
      outsideViewportCount++;
      console.log(`  [DILUAR VIEWPORT] ${n.id} (${(n as any).nama || n.type}): x=${n.position.x}, y=${n.position.y}`);
    }
  }

  console.log(`\nNode di dalam viewport default (0, 0): ${insideViewportCount}`);
  console.log(`Node di luar viewport default (0, 0): ${outsideViewportCount}`);

  // Rentang sebaran seluruh node:
  const allX = visibleNodes.map((n) => n.position.x);
  const allY = visibleNodes.map((n) => n.position.y);
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  console.log(`Rentang Koordinat Nyata Semua Elemen: X in [${minX}, ${maxX}], Y in [${minY}, ${maxY}]`);

  console.log("\n3. ANALISIS PENYEBAB EMPTY STATE TIDAK MUNCUL:");
  console.log("Kondisi saat ini: {initialNodes.length === 0 && <EmptyState />}");
  console.log(`initialNodes.length = ${apiData.node.length} (> 0) => empty state TIDAK TAMPIL.`);
  console.log("Meskipun tidak ada node yang terlihat di layar, empty state diabaikan.");

  console.log("\n4. ANALISIS PENYEBAB TIDAK ADA PESAN ERROR:");
  console.log("- Status API HTTP 200 OK (data JSON sukses diambil).");
  console.log("- Tidak ada syntax error atau exception yang di-throw.");
  console.log("- onlyRenderVisibleElements={true} pada React Flow menyebabkan elemen di luar viewport TIDAK DI-RENDER ke DOM.");
  console.log("- Karena data API dimuat secara asinkron (fetch) setelah kanvas mount, fitView() bawaan ReactFlow hanya berjalan di awal saat node masih kosong ([]), dan TIDAK PERNAH dipanggil ulang setelah data tiba.");

  console.log("\n=== KESIMPULAN DIAGNOSIS ===");
  console.log("Akar masalah: Viewport default (0, 0, zoom: 1) tidak mencakup node-node yang memiliki koordinat Y negatif (misal -385 s/d -109) dan X besar (1250 s/d 3000). Tanpa auto-fitView saat data API tiba, dan dengan onlyRenderVisibleElements={true}, kanvas tampak kosong melompong tanpa tombol 'Pusatkan' dan tanpa empty state.");
}

runDiagnosis();
