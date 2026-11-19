#!/usr/bin/env bash
# ==============================================================================
# JagaLog - Skrip Instalasi Otomatis untuk Ubuntu 24.04 LTS (dan Debian-based)
# ==============================================================================
# Penggunaan:
#   sudo bash install.sh
# Opsi tambahan:
#   sudo bash install.sh --port 3000 --syslog-port 5514
#   sudo bash install.sh --admin-password "KataSandiKuat!"
# ==============================================================================

set -euo pipefail

# --- Warna untuk output terminal ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# --- Nilai default ---
WEB_PORT="3000"
SYSLOG_PORT="5514"
INSTALL_DIR=""
ADMIN_PASS_CUSTOM=""

# --- Fungsi helper ---
log_info()    { echo -e "  ${GREEN}->  ${NC}$*"; }
log_warn()    { echo -e "  ${YELLOW}[!] ${NC}$*"; }
log_error()   { echo -e "  ${RED}[X] ${NC}$*"; }
log_section() { echo -e "\n${BLUE}$*${NC}"; }

# --- Header ---
clear 2>/dev/null || true
echo -e "${CYAN}${BOLD}"
echo "=================================================================="
echo "         JagaLog - Otomasi Instalasi Server (Ubuntu 24.04)        "
echo "  Penerima & Analisa Log Perangkat Jaringan (MikroTik/Linux/Win) "
echo "=================================================================="
echo -e "${NC}"

# --- 0. Pastikan dijalankan sebagai root / sudo ---
if [ "$EUID" -ne 0 ]; then
  log_error "Skrip ini harus dijalankan dengan hak akses root / sudo."
  echo -e "       Silakan jalankan: ${BOLD}sudo bash $0${NC}"
  exit 1
fi

# --- Parsing opsi argumen ---
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
      echo "  --dir <path>              Direktori instalasi aplikasi (default: /opt/jagalog)"
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

# =============================================================================
# LANGKAH 1: Verifikasi Sistem Operasi
# =============================================================================
log_section "[1/6] Memeriksa kompatibilitas sistem operasi..."
if [ -f /etc/os-release ]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  OS_NAME="${NAME:-Linux}"
  OS_VER="${VERSION_ID:-unknown}"
  log_info "Sistem terdeteksi: ${GREEN}${OS_NAME} ${OS_VER}${NC}"
else
  log_warn "Berkas /etc/os-release tidak ditemukan. Melanjutkan dengan asumsi Linux umum."
  OS_NAME="Linux"
  OS_VER="unknown"
fi

# =============================================================================
# LANGKAH 2: Menentukan & Menyiapkan Direktori Aplikasi
# =============================================================================
log_section "[2/6] Menyiapkan direktori aplikasi JagaLog..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Jika install.sh dijalankan dari dalam repo (ada docker-compose.yml & package.json)
if [ -f "$SCRIPT_DIR/docker-compose.yml" ] && [ -f "$SCRIPT_DIR/package.json" ]; then
  APP_DIR="$SCRIPT_DIR"
  log_info "Menggunakan direktori saat ini: ${GREEN}${APP_DIR}${NC}"
else
  # Jika dijalankan via curl atau dari lokasi lain, clone/salin ke direktori target
  APP_DIR="${INSTALL_DIR:-/opt/jagalog}"
  log_info "Direktori target: ${GREEN}${APP_DIR}${NC}"
  mkdir -p "$APP_DIR"

  if [ ! -f "$APP_DIR/docker-compose.yml" ]; then
    if command -v git >/dev/null 2>&1; then
      log_info "Mengunduh kode JagaLog dari GitHub..."
      git clone --depth=1 https://github.com/yusufchoir/Jaglog.git "$APP_DIR" 2>&1 \
        || { log_error "Gagal mengunduh dari GitHub. Periksa koneksi internet."; exit 1; }
    else
      log_info "Memasang git terlebih dahulu..."
      apt-get install -y git >/dev/null 2>&1
      git clone --depth=1 https://github.com/yusufchoir/Jaglog.git "$APP_DIR" 2>&1 \
        || { log_error "Gagal mengunduh dari GitHub. Periksa koneksi internet."; exit 1; }
    fi
  else
    log_info "Direktori sudah berisi instalasi JagaLog, melewati clone."
  fi
fi

cd "$APP_DIR"

# =============================================================================
# LANGKAH 3: Memeriksa dan Memasang Docker & Docker Compose
# =============================================================================
log_section "[3/6] Memeriksa Docker dan Docker Compose..."

DOCKER_OK=false
if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    DOCKER_OK=true
  fi
fi

if [ "$DOCKER_OK" = true ]; then
  log_info "Docker dan Docker Compose sudah terpasang: ${GREEN}$(docker --version)${NC}"
else
  log_info "Docker belum lengkap. Memasang via repositori resmi Docker..."
  apt-get update -y >/dev/null 2>&1
  apt-get install -y curl ca-certificates gnupg lsb-release >/dev/null 2>&1

  # Install Docker resmi via get.docker.com (mendukung Ubuntu 24.04)
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh \
    || { log_error "Gagal mengunduh skrip instalasi Docker."; exit 1; }
  sh /tmp/get-docker.sh 2>&1 | tail -5
  rm -f /tmp/get-docker.sh

  systemctl enable docker >/dev/null 2>&1 || true
  systemctl start docker  >/dev/null 2>&1 || true
  sleep 2

  if ! docker compose version >/dev/null 2>&1; then
    log_error "Instalasi Docker gagal atau Docker Compose plugin tidak tersedia."
    log_error "Coba jalankan manual: apt-get install docker-compose-plugin"
    exit 1
  fi
  log_info "Docker berhasil dipasang: ${GREEN}$(docker --version)${NC}"
fi

# =============================================================================
# LANGKAH 4: Menyiapkan Konfigurasi Lingkungan (.env)
# =============================================================================
log_section "[4/6] Menyiapkan konfigurasi keamanan (.env)..."
ENV_FILE="$APP_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  log_info "Berkas .env sudah ada. Menggunakan konfigurasi yang tersimpan."
  log_warn "Hapus .env terlebih dahulu jika ingin mengenerate konfigurasi baru."
else
  log_info "Mengenerate berkas .env baru dengan kata sandi acak yang aman..."

  # Generate password acak dengan fallback yang aman
  _gen_pass() {
    openssl rand -hex "$1" 2>/dev/null \
      || tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c $(( $1 * 2 )) \
      || echo "fallback_$(date +%s)_$1"
  }

  POSTGRES_PASS="$(_gen_pass 16)"
  REDIS_PASS="$(_gen_pass 16)"
  SESS_SECRET="$(_gen_pass 32)"
  ENCRYPT_KEY="$(_gen_pass 32)"

  if [ -n "$ADMIN_PASS_CUSTOM" ]; then
    ADMIN_PASS="$ADMIN_PASS_CUSTOM"
  else
    ADMIN_PASS="JagaLog@$(_gen_pass 4)"
  fi

  CREATED_AT="$(date '+%Y-%m-%d %H:%M:%S %Z')"

  # Tulis .env — gunakan printf agar karakter khusus dalam variabel aman
  {
    printf '# ==============================================================================\n'
    printf '# Konfigurasi Lingkungan JagaLog (Digenerate Otomatis oleh install.sh)\n'
    printf '# Waktu Pembuatan: %s\n' "$CREATED_AT"
    printf '# ==============================================================================\n\n'
    printf '# Database PostgreSQL 16\n'
    printf 'POSTGRES_USER=jagalog\n'
    printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASS"
    printf 'POSTGRES_DB=jagalog\n'
    printf 'DATABASE_URL=postgres://jagalog:%s@postgres:5432/jagalog\n\n' "$POSTGRES_PASS"
    printf '# Cache & Antrian Redis 7\n'
    printf 'REDIS_PASSWORD=%s\n' "$REDIS_PASS"
    printf 'REDIS_URL=redis://:%s@redis:6379\n\n' "$REDIS_PASS"
    printf '# Keamanan & Autentikasi\n'
    printf 'SESSION_SECRET=%s\n' "$SESS_SECRET"
    printf 'ENCRYPTION_KEY=%s\n' "$ENCRYPT_KEY"
    printf 'ADMIN_USERNAME=admin\n'
    printf 'ADMIN_PASSWORD=%s\n' "$ADMIN_PASS"
    printf 'TZ=Asia/Jakarta\n\n'
    printf '# Port Kolektor Syslog\n'
    printf 'SYSLOG_UDP_PORT=%s\n' "$SYSLOG_PORT"
    printf 'SYSLOG_TCP_PORT=%s\n\n' "$SYSLOG_PORT"
    printf '# Pengaturan AI & Retensi Log\n'
    printf 'AI_PROVIDER=anthropic\n'
    printf 'AI_API_KEY=\n'
    printf 'AI_MODEL=claude-3-5-sonnet-20241022\n'
    printf 'LOG_RETENTION_DAYS=30\n'
  } > "$ENV_FILE"

  chmod 600 "$ENV_FILE"
  log_info "Konfigurasi tersimpan di ${GREEN}${ENV_FILE}${NC} (hak akses 600)."
fi

# Baca kembali dari .env untuk ditampilkan di akhir
CURRENT_ADMIN_PASS="$(grep '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2-)"
CURRENT_ADMIN_USER="$(grep '^ADMIN_USERNAME=' "$ENV_FILE" | cut -d'=' -f2-)"
CURRENT_ADMIN_USER="${CURRENT_ADMIN_USER:-admin}"

# Ambil IP server
SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
SERVER_IP="${SERVER_IP:-127.0.0.1}"

# =============================================================================
# LANGKAH 5: Membuka Port pada Firewall (UFW)
# =============================================================================
log_section "[5/6] Memeriksa konfigurasi firewall (UFW)..."

if command -v ufw >/dev/null 2>&1; then
  # Nonaktifkan set -e sementara agar grep yang hasilnya kosong tidak abort skrip
  UFW_STATUS="$(ufw status 2>/dev/null | grep -o 'active' || true)"
  if [ "$UFW_STATUS" = "active" ]; then
    log_info "UFW aktif. Mengizinkan port ${WEB_PORT}/tcp, ${SYSLOG_PORT}/udp, ${SYSLOG_PORT}/tcp..."
    ufw allow "${WEB_PORT}/tcp"    comment "JagaLog Web UI"      >/dev/null 2>&1 || true
    ufw allow "${SYSLOG_PORT}/udp" comment "JagaLog Syslog UDP"  >/dev/null 2>&1 || true
    ufw allow "${SYSLOG_PORT}/tcp" comment "JagaLog Syslog TCP"  >/dev/null 2>&1 || true
    log_info "${GREEN}Port firewall berhasil dibuka.${NC}"
  else
    log_info "UFW terpasang tetapi tidak aktif — tidak perlu penyesuaian."
  fi
else
  log_info "UFW tidak digunakan pada sistem ini."
fi

# =============================================================================
# LANGKAH 6: Membangun dan Menjalankan Kontainer JagaLog
# =============================================================================
log_section "[6/6] Membangun dan menjalankan kontainer JagaLog..."
log_info "Proses build Docker image sedang berlangsung. Ini bisa memakan 3–10 menit pertama kali..."

# Hentikan kontainer lama dengan aman (tidak abort meskipun belum ada)
docker compose --env-file "$ENV_FILE" down --remove-orphans 2>/dev/null || true

# Build & jalankan semua service
docker compose --env-file "$ENV_FILE" up -d --build

# Healthcheck: tunggu /api/health merespons (maks 120 detik / 60 percobaan)
echo ""
echo -e "  ${YELLOW}Menunggu layanan siap (maks 120 detik)...${NC}"
TRIES=0
MAX_TRIES=60
READY=false

while [ "$TRIES" -lt "$MAX_TRIES" ]; do
  if curl -sf "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then
    READY=true
    break
  fi
  TRIES=$(( TRIES + 1 ))
  # Tampilkan titik progress tiap 5 detik (cek tiap 2 detik)
  if [ $(( TRIES % 5 )) -eq 0 ]; then
    echo -n "."
  fi
  sleep 2
done
echo "" # Newline setelah titik progress

if [ "$READY" = true ]; then
  log_info "${GREEN}Semua kontainer berjalan dan antarmuka web merespons!${NC}"
else
  log_warn "Layanan masih menginisialisasi. Jika beberapa menit kemudian belum bisa diakses, jalankan:"
  log_warn "  cd ${APP_DIR} && docker compose logs app"
fi

# =============================================================================
# RINGKASAN INSTALASI
# =============================================================================
echo ""
echo -e "${GREEN}${BOLD}=================================================================="
echo "          INSTALASI JAGALOG BERHASIL DISELESAIKAN!               "
echo -e "==================================================================${NC}"
echo -e "Aplikasi JagaLog siap menerima dan menganalisa log jaringan."
echo ""
echo -e " ${BOLD}Detail Akses Dashboard:${NC}"
echo -e "  * URL Web Dashboard : ${CYAN}http://${SERVER_IP}:${WEB_PORT}${NC}"
echo -e "  * Username Admin    : ${BOLD}${CURRENT_ADMIN_USER}${NC}"
echo -e "  * Password Admin    : ${YELLOW}${BOLD}${CURRENT_ADMIN_PASS}${NC}"
echo ""
echo -e " ${BOLD}Pengiriman Log Syslog (MikroTik / Linux / Switch):${NC}"
echo -e "  * IP Target Server  : ${CYAN}${SERVER_IP}${NC}"
echo -e "  * Port Syslog       : ${CYAN}${SYSLOG_PORT}/UDP dan ${SYSLOG_PORT}/TCP${NC}"
echo ""
echo -e " ${BOLD}Perintah Pengelolaan:${NC}"
echo -e "  * Cek status        : ${CYAN}cd ${APP_DIR} && docker compose ps${NC}"
echo -e "  * Lihat log app     : ${CYAN}cd ${APP_DIR} && docker compose logs -f app${NC}"
echo -e "  * Restart layanan   : ${CYAN}cd ${APP_DIR} && docker compose restart${NC}"
echo -e "  * Berhenti          : ${CYAN}cd ${APP_DIR} && docker compose down${NC}"
echo -e "  * Update JagaLog    : ${CYAN}cd ${APP_DIR} && git pull && sudo bash install.sh${NC}"
echo ""
echo -e " ${YELLOW}${BOLD}[!] Simpan kredensial di atas di tempat yang aman!${NC}"
echo -e " ${YELLOW}    Password tersimpan di: ${APP_DIR}/.env (hak akses 600)${NC}"
echo -e "${GREEN}${BOLD}==================================================================${NC}"
echo ""
