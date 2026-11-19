export interface GroupBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Menghitung bounding box kotak grup secara dinamis agar selalu memuat seluruh anggotanya.
 * Mode utama "otomatis pas": batas kotak = bounding box dari SEMUA anggota yang terlihat,
 * memakai ukuran TERUKUR dari kanvas (atau fallback standar), ditambah:
 * - padding: 24 px kiri/kanan/bawah
 * - area judul di atas (tinggi sesuai label dan tombol minimal 48 px) agar label tidak menimpa node.
 * Dilengkapi proteksi terhadap nilai koordinat NaN / undefined / null.
 */
export function computeGroupBounds(
  group: { id: string; x?: number | null; y?: number | null; lebar?: number | null; tinggi?: number | null },
  memberNodes: Array<{
    id: string;
    position?: { x?: number; y?: number };
    x?: number | null;
    y?: number | null;
    measured?: { width?: number; height?: number };
    width?: number;
    height?: number;
  }>
): GroupBounds {
  const safeGroupX = typeof group.x === "number" && !isNaN(group.x) ? group.x : 0;
  const safeGroupY = typeof group.y === "number" && !isNaN(group.y) ? group.y : 0;
  const safeGroupW = typeof group.lebar === "number" && !isNaN(group.lebar) ? group.lebar : 220;
  const safeGroupH = typeof group.tinggi === "number" && !isNaN(group.tinggi) ? group.tinggi : 100;

  if (!memberNodes || memberNodes.length === 0) {
    return {
      x: safeGroupX,
      y: safeGroupY,
      width: Math.max(safeGroupW, 220),
      height: Math.max(safeGroupH, 100),
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const PADDING_X = 24;
  const PADDING_BOTTOM = 24;
  const HEADER_HEIGHT = 48; // area judul di atas (tinggi label & tombol >= 44px)

  let validMemberCount = 0;

  for (const node of memberNodes) {
    let nx = 0;
    if (node.position && typeof node.position.x === "number" && !isNaN(node.position.x)) {
      nx = node.position.x;
    } else if (typeof node.x === "number" && !isNaN(node.x)) {
      nx = node.x;
    }

    let ny = 0;
    if (node.position && typeof node.position.y === "number" && !isNaN(node.position.y)) {
      ny = node.position.y;
    } else if (typeof node.y === "number" && !isNaN(node.y)) {
      ny = node.y;
    }

    let w = 185;
    if (node.measured && typeof node.measured.width === "number" && !isNaN(node.measured.width) && node.measured.width > 0) {
      w = node.measured.width;
    } else if (typeof node.width === "number" && !isNaN(node.width) && node.width > 0) {
      w = node.width;
    }

    let h = 85;
    if (node.measured && typeof node.measured.height === "number" && !isNaN(node.measured.height) && node.measured.height > 0) {
      h = node.measured.height;
    } else if (typeof node.height === "number" && !isNaN(node.height) && node.height > 0) {
      h = node.height;
    }

    if (nx < minX) minX = nx;
    if (ny < minY) minY = ny;
    if (nx + w > maxX) maxX = nx + w;
    if (ny + h > maxY) maxY = ny + h;
    validMemberCount++;
  }

  if (validMemberCount === 0 || !isFinite(minX) || !isFinite(minY)) {
    return {
      x: safeGroupX,
      y: safeGroupY,
      width: Math.max(safeGroupW, 220),
      height: Math.max(safeGroupH, 100),
    };
  }

  const boxX = Math.round(minX - PADDING_X);
  const boxY = Math.round(minY - HEADER_HEIGHT);
  const boxWidth = Math.round(Math.max(maxX - minX + PADDING_X * 2, 220));
  const boxHeight = Math.round(Math.max(maxY - minY + HEADER_HEIGHT + PADDING_BOTTOM, 120));

  return {
    x: boxX,
    y: boxY,
    width: boxWidth,
    height: boxHeight,
  };
}
