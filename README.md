# Sistem Manajemen Peserta Sidang & Verifikasi QR Code (MUSPIMNAS)

Aplikasi web internal tertutup (*Closed System*) untuk manajemen peserta sidang, alokasi ruangan sidang secara massal (*bulk assignment*), pembuatan kartu tanda pengenal ber-QR Code siap cetak, serta mesin verifikasi gerbang pintu sidang *hybrid* (mendukung kamera smartphone dan *laser barcode/QR scanner hardware* USB/Bluetooth).

---

## Fitur Utama

### 1. Closed Access & Autentikasi Admin
- **Sistem Tertutup**: Tidak ada registrasi publik untuk peserta. Seluruh dashboard, pendaftaran peserta, manajemen ruangan, dan pencetakan kartu dilindungi oleh otentikasi Admin berbasis sesi.
- **Akun Default Seeding**:
  - **Username**: `admin`
  - **Password**: `admin123`

### 2. Manajemen Peserta & Relasional Database
- Skema database SQLite otomatis dibuat saat inisialisasi:
  - `admins`: kredensial admin ber-hash bcrypt.
  - `court_rooms`: master ruangan sidang, judul sesi/agenda, kapasitas kursi, status aktif.
  - `participants`: nama peserta, NIM/NIK (unik), instansi/jurusan, `qr_token` (UUID v4 permanen).
  - `room_allocations`: relasi peserta dan ruangan, status absensi (`is_attended`), waktu absensi (`attended_at`).
- Form penambahan dan pengeditan peserta sidang dengan auto-generation token UUID v4.

### 3. Aksi Massal (Bulk Assignment & Bulk Print)
- Checkbox di setiap baris tabel peserta dan checkbox **"Select All"** di header tabel.
- **Floating Bulk Action Toolbar** otomatis muncul saat peserta dicentang:
  - **Tugaskan ke Ruangan**: Memilih beberapa peserta -> pilih ruangan sidang tujuan -> klik simpan (*upsert* ke `room_allocations`).
  - **Cetak ID Card Terpilih**: Membuka halaman cetak khusus untuk peserta yang dicentang dalam satu lembar cetak sekaligus.

### 4. Generator Kartu ID Peserta (Print Ready)
- Template ID Card standar kartu panitia/sidang (format kartu tanda pengenal ID-1 / rasio A6):
  - Nama Lengkap & Gelar Peserta.
  - NIM / NIK Identitas.
  - Instansi / Asal Delegasi.
  - Gambar QR Code tajam beresolusi tinggi yang di-generate otomatis dari `qr_token`.
  - Ruangan Sidang & Sesi Sidang yang dialokasikan panitia.
  - Tata letak ramah cetak (`@media print` CSS): Otomatis menyembunyikan navigasi, header, dan tombol saat dialog `window.print()` atau `Ctrl + P` dibuka.

### 5. Arsitektur Dua Layar (Dual-Device / Multi-Screen Gate Architecture)
Sistem memisahkan alur pemindaian menjadi dua halaman berbeda yang tersinkronisasi secara realtime melalui **Server-Sent Events (SSE)**:
1. **Layar 1: Kamera Pemindai HP Petugas Pintu (`/scanner/camera`)**:
   - Khusus dibuka di smartphone / tablet petugas yang berdiri di pintu masuk.
   - Layar penuh kamera 100% untuk fokus menembak QR code secara cepat.
   - Memberi getaran (*haptic feedback*) dan notifikasi ringkas 2 detik, lalu langsung siap menembak peserta berikutnya tanpa tertutup riwayat.
2. **Layar 2: Layar Monitor Display & Riwayat Database (`/scanner`)**:
   - Khusus dibuka di Laptop Panitia Meja Operator / TV Display Pintu Sidang.
   - **Center Stage (Panggung Utama)**: Menampilkan kartu identitas peserta yang baru saja di-scan secara besar dan jelas dengan nada audio chime.
   - **Bagian Bawah**: Menampilkan **Tabel Database Biasa** yang rapi dan otomatis bertambah (*live insert*) tiap kali ada peserta yang berhasil di-scan dari HP petugas di depan pintu.
   - Dilengkapi pula input tembakan scanner eksternal USB bagi panitia meja.

---

## Panduan Instalasi & Menjalankan Aplikasi

### Persyaratan Sistem
- **Node.js**: Versi 20+ atau versi 22/24 (menggunakan modul database bawaan `node:sqlite`).
- **NPM**: Versi 9+

### Langkah-langkah:

1. **Buka Terminal / PowerShell di Direktori Proyek**:
   ```bash
   cd d:\Codingan\muspimnas
   ```

2. **Instalasi Dependensi**:
   ```bash
   npm install
   ```

3. **Inisialisasi Database & Seeder Data Awal**:
   Menghasilkan tabel, 1 akun admin default, 3 master ruang sidang, dan 10 data peserta sampel:
   ```bash
   npm run seed
   ```

4. **Menjalankan Server**:
   ```bash
   npm start
   ```
   *Atau jalankan dalam mode pengembangan (auto-reload):*
   ```bash
   npm run dev
   ```

5. **Akses Aplikasi di Browser**:
   - URL Utama: `http://localhost:3000`
   - Halaman Login: `http://localhost:3000/login`
   - Dashboard Peserta: `http://localhost:3000/dashboard`
   - Kelola Ruangan: `http://localhost:3000/rooms`
   - Terminal Scanner Pintu: `http://localhost:3000/scanner`

---

## Menjalankan Automated Test Suite

Untuk memvalidasi seluruh fungsionalitas logika sistem dan endpoint HTTP secara otomatis:

```bash
# 1. Menjalankan pengujian aturan verifikasi & layanan database
node test/verification_test.js

# 2. Menjalankan pengujian integrasi End-to-End HTTP
node test/e2e_http_test.js
```

---

## Struktur Direktori

```
muspimnas/
├── package.json
├── server.js                      # Entry point aplikasi Express
├── README.md                      # Panduan lengkap sistem
├── data/
│   └── muspimnas.db               # Basis data SQLite lokal
├── public/
│   ├── css/
│   │   └── custom.css             # Glassmorphism, animasi laser scanner, & print CSS
│   └── js/
│       ├── audio.js               # Web Audio API synthesizer (beep & buzzer)
│       ├── dashboard.js           # Logika checkbox bulk, toolbar melayang, & modal
│       └── scanner.js             # Logika hybrid scanner (html5-qrcode & hardware wedge)
├── src/
│   ├── config/
│   │   └── database.js            # Inisialisasi SQLite database schema
│   ├── middleware/
│   │   └── auth.js                # Proteksi rute session admin
│   ├── routes/
│   │   ├── auth.js                # Login & logout admin
│   │   ├── dashboard.js           # CRUD peserta & API bulk-assign
│   │   ├── rooms.js               # CRUD ruangan sidang & statistik kapasitas
│   │   ├── print.js               # Generator kartu tanda pengenal ber-QR
│   │   └── verify.js              # Endpoint verifikasi & terminal scanner
│   ├── seed/
│   │   └── seeder.js              # Script pembuat data awal (seed)
│   └── services/
│       ├── participantService.js  # Layanan CRUD peserta & token UUID
│       ├── roomService.js         # Layanan ruangan & kapasitas
│       └── verificationService.js # Mesin validasi QR pintu sidang
├── test/
│   ├── verification_test.js       # Test suite aturan validasi & relasi DB
│   └── e2e_http_test.js           # Test suite integrasi HTTP E2E
└── views/
    ├── partials/
    │   ├── header.ejs             # Header navbar layout
    │   └── footer.ejs             # Footer layout & container notifikasi
    ├── login.ejs                  # Halaman login admin modern glassmorphism
    ├── dashboard.ejs              # Dashboard peserta & floating bulk action toolbar
    ├── rooms.ejs                  # Manajemen ruangan sidang & progress bar
    ├── print-cards.ejs            # Template kartu tanda pengenal peserta siap cetak
    └── scanner.ejs                # Terminal verifikasi hybrid petugas pintu
```
