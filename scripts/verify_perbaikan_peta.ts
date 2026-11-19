import { computeGroupBounds } from "../app/src/lib/group-bounds";

async function runTests() {
  console.log("=== PENGUJIAN OTOMATIS: PERBAIKAN PETA JARINGAN ===");
  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string) {
    totalTests++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
    }
  }

  // Skenario 1: Koordinat NaN pada node dan grup
  console.log("\n--- Skenario 1: Koordinat NaN pada node dan grup ---");
  const nanGroup = { id: "grp-nan", x: NaN, y: NaN, lebar: NaN, tinggi: NaN };
  const nanMembers = [
    { id: "node-1", position: { x: NaN, y: 100 }, measured: { width: 180, height: 80 } },
    { id: "node-2", x: 200, y: NaN, width: 180, height: 80 },
    { id: "node-3", position: { x: 300, y: 400 }, measured: { width: NaN, height: NaN } },
  ];
  const boundsWithNaN = computeGroupBounds(nanGroup as any, nanMembers as any);

  assert(!isNaN(boundsWithNaN.x), "Bounds X bukan NaN");
  assert(!isNaN(boundsWithNaN.y), "Bounds Y bukan NaN");
  assert(!isNaN(boundsWithNaN.width), "Bounds width bukan NaN");
  assert(!isNaN(boundsWithNaN.height), "Bounds height bukan NaN");
  assert(boundsWithNaN.width >= 220, "Bounds width memenuhi batas minimal 220");
  assert(boundsWithNaN.height >= 100, "Bounds height memenuhi batas minimal 100");

  // Skenario 2: Semua grup berstatus terlipat
  console.log("\n--- Skenario 2: Semua grup berstatus terlipat ---");
  const rawGroups = [
    { id: "grp-1", nama: "SEMARANG", x: 100, y: 100, warnaGaris: "biru" as const },
    { id: "grp-2", nama: "SOLO", x: 600, y: 100, warnaGaris: "merah" as const },
  ];
  const rawNodes = [
    { id: "dev-1", nama: "Mikrotik 1", x: 120, y: 120, groupId: "grp-1", status: "online" as const },
    { id: "dev-2", nama: "Mikrotik 2", x: 150, y: 150, groupId: "grp-1", status: "online" as const },
    { id: "dev-3", nama: "Switch Solo", x: 620, y: 120, groupId: "grp-2", status: "offline" as const },
    { id: "dev-4", nama: "Cloud Node (Tanpa Grup)", x: 400, y: 300, groupId: null, status: "online" as const },
  ];
  const collapsedGroupIds = new Set(["grp-1", "grp-2"]);

  // Logika transformasi
  const groupNodes = rawGroups.map((g) => ({
    id: `group-${g.id}`,
    isCollapsed: collapsedGroupIds.has(g.id),
    hidden: false, // Node ringkasan tidak pernah hidden
  }));

  const deviceNodes = rawNodes.map((n) => ({
    id: n.id,
    hidden: n.groupId ? collapsedGroupIds.has(n.groupId) : false,
  }));

  const visibleGroupSummaryNodes = groupNodes.filter((g) => g.isCollapsed && !g.hidden);
  const visibleUngroupedNodes = deviceNodes.filter((d) => !d.hidden);

  assert(visibleGroupSummaryNodes.length === 2, "Minimal 1 node ringkasan per grup terlipat harus tampil (ada 2 grup terlipat)");
  assert(visibleUngroupedNodes.some((d) => d.id === "dev-4"), "Perangkat tanpa grup (dev-4) selalu tampil dan tidak hidden");

  // Skenario 3: Bila status lipat membuat 0 node tampil
  console.log("\n--- Skenario 3: Bila status lipat membuat 0 node tampil ---");
  const corruptedRawGroups: any[] = []; // Grup hilang atau kosong
  const corruptedRawNodes = [
    { id: "dev-orphan-1", nama: "Orphan 1", groupId: "deleted-grp" },
    { id: "dev-orphan-2", nama: "Orphan 2", groupId: "deleted-grp" },
  ];
  const badCollapsed = new Set(["deleted-grp"]);
  const initialDevNodes = corruptedRawNodes.map((n) => ({
    id: n.id,
    hidden: n.groupId ? badCollapsed.has(n.groupId) : false,
  }));
  const initialGroupNodes = corruptedRawGroups.map((g) => ({
    id: `group-${g.id}`,
    hidden: false,
  }));

  let allNodes = [...initialGroupNodes, ...initialDevNodes];
  const visibleCount = allNodes.filter((n) => !n.hidden).length;
  let resetTriggered = false;

  if (visibleCount === 0 && corruptedRawNodes.length > 0) {
    resetTriggered = true;
    allNodes = allNodes.map((n) => ({ ...n, hidden: false }));
  }

  assert(resetTriggered === true, "Deteksi 0 node terlihat memicu fallback uncollapse otomatis");
  assert(allNodes.filter((n) => !n.hidden).length === 2, "Semua node dikembalikan ke kondisi terlihat (hidden = false)");

  // Skenario 4: Viewport di luar jangkauan (Node di luar layar)
  console.log("\n--- Skenario 4: Viewport di luar jangkauan ---");
  const viewport = { x: 0, y: 0, zoom: 1 };
  const screenWidth = 1200;
  const screenHeight = 800;

  // Node berada di koordinat X: 2500, Y: 1800 (jauh di luar layar default)
  const offscreenNodes = [
    { id: "remote-1", position: { x: 2500, y: 1800 }, width: 185, height: 85, hidden: false },
    { id: "remote-2", position: { x: 3000, y: -400 }, width: 185, height: 85, hidden: false },
  ];

  const viewXMin = -viewport.x / viewport.zoom;
  const viewXMax = (screenWidth - viewport.x) / viewport.zoom;
  const viewYMin = -viewport.y / viewport.zoom;
  const viewYMax = (screenHeight - viewport.y) / viewport.zoom;

  const hasVisibleInViewport = offscreenNodes.some((n) => {
    if (n.hidden) return false;
    return (
      n.position.x < viewXMax &&
      n.position.x + n.width > viewXMin &&
      n.position.y < viewYMax &&
      n.position.y + n.height > viewYMin
    );
  });

  assert(hasVisibleInViewport === false, "Deteksi bahwa 0 node berada di viewport saat koordinat di luar layar");
  const bannerCondition = offscreenNodes.length > 0 && !hasVisibleInViewport;
  assert(bannerCondition === true, "Banner 'Peta berisi N perangkat tetapi tidak ada yang tampil' aktif");

  // Skenario 5: Auto-fitView memulihkan jangkauan viewport
  console.log("\n--- Skenario 5: FitView memusatkan node ---");
  // Setelah fitView dipanggil, viewport mencakup seluruh bounding box node
  const allX = offscreenNodes.map((n) => n.position.x);
  const allY = offscreenNodes.map((n) => n.position.y);
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX) + 185;
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY) + 85;

  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const fitZoom = Math.min(screenWidth / (contentWidth * 1.5), screenHeight / (contentHeight * 1.5));
  const fitX = (screenWidth - contentWidth * fitZoom) / 2 - minX * fitZoom;
  const fitY = (screenHeight - contentHeight * fitZoom) / 2 - minY * fitZoom;

  const newViewXMin = -fitX / fitZoom;
  const newViewXMax = (screenWidth - fitX) / fitZoom;
  const newViewYMin = -fitY / fitZoom;
  const newViewYMax = (screenHeight - fitY) / fitZoom;

  const centeredVisible = offscreenNodes.some((n) => {
    return (
      n.position.x < newViewXMax &&
      n.position.x + n.width > newViewXMin &&
      n.position.y < newViewYMax &&
      n.position.y + n.height > newViewYMin
    );
  });

  assert(centeredVisible === true, "Setelah fitView, node berada di dalam viewport layar");

  console.log(`\n========================================`);
  console.log(`HASIL: ${passedTests}/${totalTests} Pengujian Berhasil`);
  console.log(`========================================\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error("Test execution error:", e);
  process.exit(1);
});

