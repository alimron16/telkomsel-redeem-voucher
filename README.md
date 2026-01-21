# Telkomsel Redeem Automation (Portable)

Aplikasi otomatisasi berbasis Node.js dan Puppeteer untuk melakukan redeem voucher Telkomsel dan pengecekan serial voucher (By.U) melalui browser automation. Aplikasi ini dirancang agar dapat dikompilasi menjadi file `.exe` portable yang dapat berjalan di Windows tanpa perlu instalasi Node.js.

## Fitur

*   **Redeem Voucher Telkomsel**: Otomatisasi input nomor dan kode voucher di web Telkomsel.
*   **Cek Serial Voucher**: Pengecekan status voucher By.U berdasarkan serial number.
*   **Portable Mode**: Dapat berjalan sebagai `.exe` mandiri.
*   **Auto-Download Chrome**: Otomatis mengunduh Chromium jika folder `chrome-win` tidak ditemukan.
*   **Anti-Detect**: Menggunakan teknik manipulasi User-Agent dan fingerprint agar tidak terdeteksi sebagai bot.
*   **Proxy Support**: Mendukung penggunaan proxy untuk menghindari rate limit IP.

## Struktur Folder (Portable)

Untuk penggunaan di PC client (tanpa install Node.js), struktur folder yang dibutuhkan adalah:

```text
FolderAplikasi/
??? redeem-app.exe      (File utama hasil compile)
??? run.bat             (Launcher opsional)
??? config.json         (Konfigurasi port)
??? proxies.txt         (Opsional: Daftar proxy)
??? chrome-win/         (Otomatis terunduh jika belum ada)
```

## Cara Penggunaan (Development)

1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Jalankan script:
    ```bash
    node redeem.js
    ```

## Cara Compile ke EXE

Gunakan `pkg` untuk mengubah script menjadi executable:

1.  Install pkg secara global:
    ```bash
    npm install -g pkg
    ```
2.  Compile script:
    ```bash
    pkg redeem.js --targets node18-win-x64 --output redeem-app.exe
    ```

## API Endpoints

Aplikasi berjalan default di port `3000`.

### 1. Redeem Voucher Telkomsel

*   **URL**: `/redeem`
*   **Method**: `GET`
*   **Query Params**:
    *   `nomor`: Nomor HP Telkomsel (misal: `08123456789`)
    *   `vc`: Kode Voucher (HRN...)
*   **Contoh**:
    ```
    http://localhost:3000/redeem?nomor=08123456789&vc=123456789012345
    ```

### 2. Cek Serial Voucher (By.U)

*   **URL**: `/check-serial`
*   **Method**: `GET`
*   **Query Params**:
    *   `serialNumber`: Nomor seri voucher
*   **Contoh**:
    ```
    http://localhost:3000/check-serial?serialNumber=9000123456
    ```

## Konfigurasi

### `config.json`
```json
{
  "port": 3000
}
```

### `proxies.txt` (Opsional)
Masukkan daftar proxy satu per baris (format `ip:port` atau `user:pass@ip:port`).