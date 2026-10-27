# I-Care – Kontrak MQTT v2

Acuan bersama firmware (ESP32-S3) dan dasbor web. Web dibuat LENGKAP sekarang; firmware menyusul
menambah field. Semua field di bagian "Opsional" boleh belum ada: web harus otomatis mengaktifkan
kartu terkait begitu field muncul, tanpa mengubah kode web. Ubah file ini dulu sebelum mengubah kode.

## Broker

- Firmware: TCP 1883 (tanpa TLS) / 8883 (TLS)
- Web: MQTT over WebSocket, awal: `wss://broker.hivemq.com:8884/mqtt` (broker PUBLIK, hanya uji coba)
- Username/password diisi di pengaturan masing-masing, tidak ditanam di kode.

## Topik (`<id>` = ID perangkat, huruf/angka/-/_)

| Topik | Arah | Retained | QoS | Isi |
| --- | --- | --- | --- | --- |
| `icare/<id>/telemetry` | ESP32 -> web | tidak | 0 | JSON, tiap 2 detik |
| `icare/<id>/status` | ESP32 -> web | ya | 1 | `online` / `offline` (Last Will) |
| `icare/<id>/cmd/setpoint` | web -> ESP32 | **tidak** | 1 | angka, mis. `36.5` (30.0–37.5) |
| `icare/<id>/cmd/mode` | web -> ESP32 | **tidak** | 1 | `fuzzy` / `pid` |
| `icare/<id>/cmd/estop` | web -> ESP32 | **tidak** | 1 | `1` = emergency off, `0` = lanjut |

Perintah TIDAK BOLEH retained (agar tidak terulang saat perangkat reconnect).
Firmware menerapkan `cmd/*` hanya bila `CFG_REMOTE_CONTROL = true`. Konfirmasi perintah = nilai
`sp`, `mode`, dan bit alarm E-STOP pada telemetry berikutnya.

## Telemetry – field WAJIB (sudah dikirim firmware v4)

```json
{"id":"icare-01","up":1234,"t":32.03,"sp":32.0,"ds":[32.0,31.9,32.1],
 "sht":31.9,"hum":68.0,"p":28,"mode":"fuzzy","e":-0.03,"de":0.02,
 "zc":100,"alarm":16,"rssi":-61}
```

| Kolom | Arti | Satuan |
| --- | --- | --- |
| `up` | uptime | detik |
| `t` | suhu terkendali (rata-rata sensor valid) | °C |
| `sp` | set point | °C |
| `ds` | array DS18B20; panjang bisa 3 atau 4 – web menyesuaikan | °C |
| `sht`, `hum` | SHT31 suhu, kelembapan | °C, % |
| `p` | daya pemanas | % |
| `mode` | `fuzzy` / `pid` | – |
| `e`, `de` | galat SP−T, laju perubahan galat | °C, °C/menit |
| `zc` | tepi zero-cross/detik (~100 = 50 Hz) | – |
| `alarm` | bitmask (lihat bawah) | – |
| `rssi` | sinyal WiFi | dBm |

`null` = tidak tersedia -> tampilkan "—", bukan 0.

## Telemetry – field OPSIONAL (Tahap 2, firmware menyusul)

```json
{"bat":{"v":13.1,"i":1.8,"soc":82,"runtime_min":310,"cap_ah":11},
 "grid":{"pln":true,"src":"PLN","ats_ok":true},
 "pzem":{"v":221.4,"i":0.36,"p":72.5,"pf":0.98,"hz":50.0,"kwh":0.412},
 "energy":{"pred_wh":38.2,"actual_wh":36.9},
 "wt":{"g":2480},
 "photo":{"on":true,"sec":1260,"lux":4300},
 "cam":"http://192.168.1.50:81/stream"}
```

| Objek | Kolom | Arti |
| --- | --- | --- |
| `bat` | `v` V, `i` A (+ = discharge, − = charge), `soc` %, `runtime_min` menit, `cap_ah` Ah | baterai LiFePO4. Kapasitas dari firmware, jangan di-hardcode di web |
| `grid` | `pln` bool, `src` `PLN`/`BAT`/`NONE`, `ats_ok` bool | ketersediaan PLN, sumber aktif, verifikasi ATS (tidak paralel) |
| `pzem` | `v`,`i`,`p` W,`pf`,`hz`,`kwh` | listrik AC (PZEM-004T) |
| `energy` | `pred_wh`, `actual_wh` | prediksi ML vs aktual per jendela (web hitung MAE/RMSE dari riwayat pasangan ini) |
| `wt` | `g` gram | berat (sudah terfilter di firmware); web membuat tren |
| `photo` | `on` bool, `sec` detik, `lux` | sesi fototerapi. Lux BH1750 BUKAN irradiansi terapeutik |
| `cam` | URL string | alamat stream ESP32-CAM (boleh juga diisi di pengaturan web) |

## Bitmask `alarm`

| Bit | Nilai | Arti | Tingkat |
| --- | --- | --- | --- |
| 0 | 1 | Emergency off aktif | kritis |
| 1 | 2 | Overheat (>38 °C) | kritis |
| 2 | 4 | Zero-cross hilang | kritis |
| 3 | 8 | Semua sensor hilang | kritis |
| 4 | 16 | Ada sensor tidak dipakai (rusak/outlier) | peringatan |
| 5 | 32 | Selisih antar sensor > 2 °C | peringatan |
| 6 | 64 | Baterai rendah | peringatan |
| 7 | 128 | PLN padam (berjalan di baterai) | peringatan |
| 8 | 256 | Kesalahan ATS / sumber tidak valid | kritis |

Bit lain yang tidak dikenal: tampilkan "Alarm #n" tingkat peringatan, jangan error.

## Aturan web

- OFFLINE jika `status`=offline ATAU tidak ada telemetry > 10 detik; tandai data basi.
- Pengendalian suhu berjalan di ESP32 tanpa bergantung pada MQTT; web hanya cermin + pengirim perintah.
- Broker publik: jangan aktifkan kontrol di luar uji coba. Produksi: broker pribadi + akun terpisah
  (web monitoring = read-only; kontrol = akun khusus).
