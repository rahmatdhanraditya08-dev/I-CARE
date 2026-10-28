# I-Care

Dasbor web prototipe penelitian inkubator pintar ESP32-S3. Frontend statis React + TypeScript; data masuk melalui MQTT over WebSocket dan tersimpan lokal di browser untuk log/sesi.

## Menjalankan lokal

Prasyarat: Node.js 20+ dan npm. Di PowerShell Windows, gunakan `npm.cmd` jika kebijakan eksekusi memblokir `npm.ps1`.

```sh
npm install
npm run dev
```

Buka URL lokal yang dicetak Vite. Mode Demo aktif sebagai sumber awal dan menghasilkan telemetry simulasi, termasuk sensor, baterai, pemadaman PLN, PZEM, prediksi energi, berat, dan fototerapi. Tombol sumber data di kanan atas beralih antara Demo dan MQTT nyata.

## MQTT

Pengaturan awal memakai `wss://broker.hivemq.com:8884/mqtt` dan ID `icare-radit-7391`. Pilih MQTT nyata dari kontrol sumber data; isi URL, username, password, dan ID perangkat melalui Pengaturan. Nilai disimpan di localStorage browser dan tidak ditanam sebagai kredensial dalam source. Gunakan broker publik hanya untuk uji coba. Untuk produksi gunakan broker pribadi dan akun terpisah untuk monitoring dan kontrol.

Dasbor berlangganan `icare/<id>/telemetry` dan `icare/<id>/status`. Perintah publish ke `icare/<id>/cmd/setpoint`, `cmd/mode`, atau `cmd/estop` dengan QoS 1 dan `retain=false`. MQTT over WebSocket harus diaktifkan di broker. Firmware wajib mengaktifkan `CFG_REMOTE_CONTROL` untuk menerima perintah.

## Deploy terlindungi (tanpa domain)

```sh
npm.cmd install
npx.cmd wrangler login
npx.cmd wrangler secret put IC_USERNAME
npx.cmd wrangler secret put IC_PASSWORD
npm.cmd run deploy:worker
```

Saat diminta, masukkan username dan password langsung di terminal Cloudflare; keduanya disimpan sebagai secret Worker dan tidak masuk repo. Deploy memberikan URL `https://icare-dashboard.<akun>.workers.dev` yang bisa dibagikan dan akan meminta login browser.

**Penting:** jangan aktifkan GitHub Pages untuk repo ini. URL GitHub Pages langsung akan melewati login Worker. Source code boleh berada di repo publik; asset dashboard hanya disajikan dari Worker setelah autentikasi. Jika GitHub Pages pernah diaktifkan, matikan di **Settings → Pages** sebelum membagikan URL Worker.

## GitHub Pages publik

Workflow `.github/workflows/pages.yml` membangun dan menerbitkan `dist/` setiap ada push ke `main`. Untuk menggunakannya, buka **Settings → Pages → Build and deployment**, lalu pilih **GitHub Actions** sebagai source. Situs di `https://rahmatdhanraditya08-dev.github.io/I-CARE/` bersifat publik dan melewati login Worker; gunakan Worker untuk URL yang meminta username/password.

Pada PowerShell Windows, gunakan `npm.cmd` dan `npx.cmd` seperti contoh. Untuk mengubah kredensial nanti, jalankan lagi `npx.cmd wrangler secret put IC_USERNAME` atau `npx.cmd wrangler secret put IC_PASSWORD`, lalu deploy ulang.

Untuk mencoba Worker lokal, salin `.dev.vars.example` menjadi `.dev.vars`, isi nilai uji lokal, lalu jalankan `npm.cmd run worker:dev`. File `.dev.vars` dikecualikan dari Git.

## Deploy statis tanpa login

Jika login tidak diperlukan, hasil `npm.cmd run build` membuat folder `dist/` yang bisa diterbitkan sebagai situs statis di Netlify atau GitHub Pages. Situs statis tersebut bersifat publik.

## Pengujian

```sh
npm test
```

Di PowerShell Windows, padanannya adalah `npm.cmd install`, `npm.cmd run dev`, `npm.cmd run build`, dan `npm.cmd test`.

Tes unit mencakup decoder alarm (termasuk bit tidak dikenal), parse JSON, MAE/RMSE, overshoot, settling time, dan konfirmasi perintah.

## Field kontrak baru

`MQTT_CONTRACT.md` adalah acuan topik, payload, dan alarm. Field opsional yang sudah didokumentasikan otomatis membuka kartu saat hadir. Field yang belum dikenal tetap diterima oleh parser, terlihat di Data mentah, dan ikut sesi/ekspor JSON/CSV tanpa menyebabkan error. Untuk field baru yang memerlukan visualisasi khusus, tambahkan tipe opsional di `src/domain.ts` dan kartu/seri grafik di `src/App.tsx`; pertahankan payload mentah agar versi web lama tetap bisa memantau perangkat.

## Catatan

Kontrol terkunci secara default dan hanya aktif saat telemetry segar dan perangkat online. Kartu klinis hanya pendukung penelitian: prototipe ini bukan alat diagnosis medis dan belum tersertifikasi.
