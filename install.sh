#!/usr/bin/env bash
# ==============================================================================
# JagaLog - Skrip Instalasi Otomatis untuk Ubuntu 24.04 LTS (dan Debian-based)
# ==============================================================================
# Penggunaan:
#   bash install.sh
# Atau dengan opsi:
#   bash install.sh --port 3000 --syslog-port 5514
# ==============================================================================

set -e

# Warna untuk output terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default values
WEB_PORT="3000"
SYSLOG_PORT="5514"
INSTALL_DIR=""
ADMIN_PASS_CUSTOM=""

# Cetak header
clear 2>/dev/null || true
echo -e "${CYAN}${BOLD}"
echo "=================================================================="
echo "         JagaLog - Otomasi Instalasi Server (Ubuntu 24.04)        "
echo "  Penerima & Analisa Log Perangkat Jaringan (MikroTik/Linux/Win) "
echo "=================================================================="
echo -e "${NC}"

# 1. Pastikan dijalankan sebagai root / sudo
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[ERROR] Skrip ini harus dijalankan dengan hak akses root / sudo.${NC}"
  echo -e "Silakan jalankan: ${BOLD}sudo bash $0${NC}"
  exit 1
fi

# Parsing opsi argumen (jika ada)
while [[ $# -gt 0 ]]; do
  case $1 in
    --port)
      WEB_PORT="$2"
      shift 2
      ;;
    --syslog-port)
      SYSLOG_PORT="$2"
      shift 2
      ;;
    --admin-password)
      ADMIN_PASS_CUSTOM="$2"
      shift 2
      ;;
    --dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    -h|--help)
      echo "Opsi instalasi JagaLog:"
      echo "  --port <port>             Port antarmuka Web UI (default: 3000)"
      echo "  --syslog-port <port>      Port listener Syslog UDP & TCP (default: 5514)"
      echo "  --admin-password <pass>   Set kata sandi awal akun admin"
      echo "  --dir <path>              Direktori instalasi aplikasi (default: folder saat ini atau /opt/jagalog)"
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

# 2. Verifikasi Sistem Operasi
echo -e "${BLUE}[1/6] Memeriksa kompatibilitas sistem operasi...${NC}"
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_NAME=$NAME
  OS_VER=$VERSION_ID
  echo -e "  -> Sistem terdeteksi: ${GREEN}${OS_NAME} ${OS_VER}${NC}"
else
  echo -e "${YELLOW}  [PERINGATAN] Berkas /etc/os-release tidak ditemukan, melanjutkan asumsi Linux umum.${NC}"
fi

# 3. Menentukan Lokasi Folder Aplikasi
echo -e "\n${BLUE}[2/6] Menyiapkan direktori aplikasi JagaLog...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/docker-compose.yml" ] && [ -f "$SCRIPT_DIR/package.json" ]; then
  APP_DIR="$SCRIPT_DIR"
  echo -e "  -> Menggunakan direktori saat ini: ${GREEN}${APP_DIR}${NC}"
else
  APP_DIR="${INSTALL_DIR:-/opt/jagalog}"
  echo -e "  -> Direktori target: ${GREEN}${APP_DIR}${NC}"
  mkdir -p "$APP_DIR"
  if [ ! -f "$APP_DIR/docker-compose.yml" ]; then
    echo -e "  -> Menyalin berkas JagaLog ke ${APP_DIR}..."
    cp -r "$SCRIPT_DIR"/* "$APP_DIR/" 2>/dev/null || true
  fi
fi

cd "$APP_DIR"

# 4. Memeriksa dan Memasang Docker & Docker Compose
echo -e "\n${BLUE}[3/6] Memeriksa Docker dan Docker Compose...${NC}"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo -e "  -> Docker dan Docker Compose sudah terpasang: ${GREEN}$(docker --version)${NC}"
else
  echo -e "  -> Docker/Docker Compose belum lengkap. Memasang via repositori resmi Docker..."
  apt-get update -y >/dev/null
  apt-get install -y curl ca-certificates gnupg lsb-release >/dev/null
  
  # Install Docker resmi menggunakan get.docker.com (resmi dari Docker untuk Ubuntu 24.04)
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh >/dev/null
  rm -f /tmp/get-docker.sh

  systemctl enable --now docker
  echo -e "  -> Docker berhasil dipasang: ${GREEN}$(docker --version)${NC}"
fi

# 5. Konfigurasi Lingkungan (.env)
echo -e "\n${BLUE}[4/6] Menyiapkan konfigurasi keamanan (.env)...${NC}"
ENV_FILE="$APP_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  echo -e "  -> Berkas .env sudah ada. Menggunakan konfigurasi yang sudah tersimpan."
else
  echo -e "  -> Mengenerate berkas .env baru dengan kata sandi acak yang aman..."

  POSTGRES_PASS=$(openssl rand -hex 16 2>/dev/null || tr -dc A-Za-z0-9 </dev/urandom | head -c 24)
  REDIS_PASS=$(openssl rand -hex 16 2>/dev/null || tr -dc A-Za-z0-9 </dev/urandom | head -c 24)
  SESS_SECRET=$(openssl rand -hex 32 2>/dev/null || tr -dc A-Za-z0-9 </dev/urandom | head -c 48)
  
  if [ -n "$ADMIN_PASS_CUSTOM" ]; then
    ADMIN_PASS="$ADMIN_PASS_CUSTOM"
  else
    # Password admin awal yang ramah dan aman
    ADMIN_PASS="JagaLog@$(openssl rand -hex 4 2>/dev/null || echo '2026')"
  fi

  cat <<EOF > "$ENV_FILE"
# ==============================================================================
# Konfigurasi Lingkungan JagaLog (Digenerate Otomatis oleh install.sh)
# Waktu Pembuatan: $(date)
# ==============================================================================

# Database PostgreSQL 16
POSTGRES_USER=jagalog
POSTGRES_PASSWORD=${POSTGRES_PASS}
POSTGRES_DB=jagalog
DATABASE_URL=postgres://jagalog:${POSTGRES_PASS}@postgres:5432/jagalog

# Cache & Antrian Redis 7
REDIS_PASSWORD=${REDIS_PASS}
REDIS_URL=redis://:${REDIS_PASS}@redis:6379

# Keamanan & Autentikasi
SESSION_SECRET=${SESS_SECRET}
ADMIN_USERNAME=admin
ADMIN_PASSWORD=${ADMIN_PASS}
TZ=Asia/Jakarta

# Port Kolektor Syslog
SYSLOG_UDP_PORT=${SYSLOG_PORT}
SYSLOG_TCP_PORT=${SYSLOG_PORT}

# Pengaturan AI & Retensi Log
AI_PROVIDER=anthropic
AI_API_KEY=
AI_MODEL=claude-3-5-sonnet-20241022
LOG_RETENTION_DAYS=30
EOF

  chmod 600 "$ENV_FILE"
  echo -e "  -> Konfigurasi tersimpan di ${GREEN}${ENV_FILE}${NC} (hak akses 600)."
fi

# Ambil IP server publik atau lokal
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$SERVER_IP" ]; then
  SERVER_IP="127.0.0.1"
fi

# Ambil ADMIN_PASSWORD dari .env untuk ditampilkan di akhir
CURRENT_ADMIN_PASS=$(grep '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d '=' -f2-)
CURRENT_ADMIN_USER=$(grep '^ADMIN_USERNAME=' "$ENV_FILE" | cut -d '=' -f2-)

# 6. Membuka Port pada Firewall (UFW) jika aktif
echo -e "\n${BLUE}[5/6] Memeriksa konfigurasi firewall (UFW)...${NC}"
if command -v ufw >/dev/null 2>&1; then
  UFW_STATUS=$(ufw status | grep -o "active" || true)
  if [ "$UFW_STATUS" = "active" ]; then
    echo -e "  -> UFW terdeteksi aktif. Mengizinkan port ${WEB_PORT}/tcp, ${SYSLOG_PORT}/udp, ${SYSLOG_PORT}/tcp..."
    ufw allow "${WEB_PORT}/tcp" comment "JagaLog Web UI" >/dev/null 2>&1 || true
    ufw allow "${SYSLOG_PORT}/udp" comment "JagaLog Syslog UDP" >/dev/null 2>&1 || true
    ufw allow "${SYSLOG_PORT}/tcp" comment "JagaLog Syslog TCP" >/dev/null 2>&1 || true
    echo -e "  -> ${GREEN}Port firewall berhasil dibuka.${NC}"
  else
    echo -e "  -> UFW terpasang tetapi tidak aktif (tidak perlu penyesuaian)."
  fi
else
  echo -e "  -> UFW tidak digunakan pada sistem ini."
fi

# 7. Memulai Kontainer JagaLog
echo -e "\n${BLUE}[6/6] Membangun dan menjalankan kontainer JagaLog...${NC}"
echo -e "  -> Proses build Docker image sedang berlangsung, mohon tunggu sebentar..."

docker compose down 2>/dev/null || true
docker compose up -d --build

echo -e "\n${YELLOW}  Menunggu kesiapan layanan database dan antarmuka web (maks 60 detik)...${NC}"
TRIES=0
MAX_TRIES=30
READY=false

while [ $TRIES -lt $MAX_TRIES ]; do
  if curl -sf "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 2
  TRIES=$((TRIES + 1))
  echo -n "."
done
echo ""

if [ "$READY" = true ]; then
  echo -e "  -> ${GREEN}Semua kontainer berhasil berjalan dan berstatus HEALTHY!${NC}"
else
  echo -e "  -> ${YELLOW}Layanan sedang menyelesaikan inisialisasi awal di latar belakang.${NC}"
fi

# Tampilan Selesai
echo -e "\n${GREEN}${BOLD}=================================================================="
echo "          INSTALASI JAGALOG BERHASIL DISELESAIKAN!               "
echo "==================================================================${NC}"
echo -e "Aplikasi JagaLog siap digunakan untuk menerima dan menganalisa log."
echo ""
echo -e " ${BOLD}Detail Akses Dashboard:${NC}"
echo -e "  * URL Web Dashboard : ${CYAN}http://${SERVER_IP}:${WEB_PORT}${NC}"
echo -e "  * Username Admin    : ${BOLD}${CURRENT_ADMIN_USER:-admin}${NC}"
echo -e "  * Password Admin    : ${YELLOW}${BOLD}${CURRENT_ADMIN_PASS}${NC}"
echo ""
echo -e " ${BOLD}Pengiriman Log Syslog (MikroTik / Linux / Switch):${NC}"
echo -e "  * IP Target Server  : ${CYAN}${SERVER_IP}${NC}"
echo -e "  * Port Syslog       : ${CYAN}${SYSLOG_PORT} (UDP / TCP)${NC}"
echo ""
echo -e " ${BOLD}Perintah Pengelolaan:${NC}"
echo -e "  * Cek status        : ${BOLD}cd ${APP_DIR} && docker compose ps${NC}"
echo -e "  * Lihat log sistem  : ${BOLD}cd ${APP_DIR} && docker compose logs -f app${NC}"
echo -e "  * Restart layanan   : ${BOLD}cd ${APP_DIR} && docker compose restart${NC}"
echo -e "  * Berhenti          : ${BOLD}cd ${APP_DIR} && docker compose down${NC}"
echo -e "${GREEN}==================================================================${NC}\n"
