// server_fast_with_check_serial_fixed.js
const fs = require("fs");
const path = require("path");
const express = require("express");
const puppeteer = require("puppeteer");

// === CONFIG ===
const configFile = "config.json";
let config = { port: 3000 };
if (!fs.existsSync(configFile)) {
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  console.log("?? File config.json dibuat otomatis (default port 3000).");
} else {
  try {
    config = JSON.parse(fs.readFileSync(configFile));
  } catch {}
}
const PORT = config.port || 3000;

// === INIT EXPRESS ===
const app = express();

// === PROXY & RATE LIMIT CONFIG ===
let proxies = [];
if (fs.existsSync("proxies.txt")) {
  try {
    proxies = fs.readFileSync("proxies.txt", "utf-8")
      .split("\n")
      .map(p => p.trim())
      .filter(p => p && !p.startsWith("#")); // Abaikan baris kosong dan komentar (#)
    console.log(`? Ditemukan ${proxies.length} proxy di proxies.txt`);
  } catch (e) { console.log("?? Gagal baca proxies.txt:", e.message); }
}

let rateLimitUntil = 0;
let sessionTimestamp = Date.now(); // Untuk rotasi folder session jika kena limit
let currentProxyAuth = null; // Menyimpan kredensial proxy aktif

// Fungsi untuk generate opsi launch agar dinamis (Randomize Fingerprint)
function getLaunchOptions() {
  const randomWidth = 400 + Math.floor(Math.random() * 60); // 400-460
  const randomHeight = 900 + Math.floor(Math.random() * 100); // 900-1000
  
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--exclude-switches=enable-automation",
    "--use-fake-ui-for-media-stream",
    `--window-size=${randomWidth},${randomHeight}`, // Ukuran window acak setiap restart
  ];

  if (proxies.length > 0) {
    const rawProxy = proxies[Math.floor(Math.random() * proxies.length)];
    // Cek apakah proxy pakai format user:pass@ip:port
    if (rawProxy.includes('@')) {
      const [auth, host] = rawProxy.split('@');
      const [username, password] = auth.split(':');
      currentProxyAuth = { username, password };
      args.push(`--proxy-server=${host}`);
      console.log(`?? Menggunakan Proxy: ${host} (Auth)`);
    } else {
      currentProxyAuth = null;
      args.push(`--proxy-server=${rawProxy}`);
      console.log(`?? Menggunakan Proxy: ${rawProxy}`);
    }
  } else {
    currentProxyAuth = null;
  }

  // === DETEKSI CHROME PORTABLE (UNTUK MODE EXE) ===
  let executablePath = config.executablePath || undefined;
  if (!executablePath) {
    // Jika jalan via EXE (pkg), root adalah lokasi file exe. Jika via node, root adalah folder script.
    const rootDir = process.pkg ? path.dirname(process.execPath) : __dirname;
    // Cek folder 'chrome-win' di sebelah file
    const localChrome = path.join(rootDir, "chrome-win", "chrome.exe");
    if (fs.existsSync(localChrome)) {
      executablePath = localChrome;
      console.log(`?? Menggunakan Portable Chrome: ${localChrome}`);
    }
  }

  return {
    headless: false,
    userDataDir: `./session_chrome_direct_${sessionTimestamp}`, // Folder dinamis, ganti jika kena limit
    defaultViewport: null,
    executablePath: executablePath, // Gunakan path custom jika ada
    ignoreDefaultArgs: ["--enable-automation"],
    args: args,
  };
}

// === SINGLETON BROWSER ===
let sharedBrowser = null;
let requestCount = 0; // Counter untuk auto-restart
let browserStartTime = 0; // Penanda waktu browser mulai nyala
let consecutiveSystemErrors = 0; // Counter error sistem berturut-turut

async function getBrowser() {
  const now = Date.now();
  // Restart jika request >= 15 ATAU browser sudah jalan > 10 menit (600000 ms)
  if (requestCount >= 15 || (sharedBrowser && now - browserStartTime > 600000)) {
    console.log("?? Merestart browser (Limit Request/Waktu tercapai)...");
    if (sharedBrowser) try { await sharedBrowser.close(); } catch {}
    sharedBrowser = null;
    requestCount = 0;
  }

  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    console.log("?? Meluncurkan browser instance baru (Singleton)...");
    sharedBrowser = await puppeteer.launch(getLaunchOptions());
    browserStartTime = Date.now(); // Catat waktu mulai
    // Buka satu tab kosong 'dummy' agar browser tidak tertutup otomatis jika semua tab kerja ditutup
    const p = await sharedBrowser.newPage();
    await p.goto("about:blank");
  }
  return sharedBrowser;
}

// === HELPER ===
function generateTrxId() {
  const ts = Date.now();
  const rnd = Math.floor(Math.random() * 9000 + 1000);
  return `TRX${ts}${rnd}`;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function randomSleep(min, max) {
  return new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
}

async function humanClick(page, selector) {
  try {
    const element = await page.$(selector);
    if (!element) return false;
    
    // Scroll dulu biar elemen terlihat (mengatasi isu terpotong/di bawah layar)
    await page.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' }), element);
    await randomSleep(50, 150);
    
    const box = await element.boundingBox();
    if (!box) return false;

    // Gerakkan mouse ke posisi acak di dalam elemen (tidak persis tengah)
    const x = box.x + (box.width * 0.2) + (Math.random() * (box.width * 0.6));
    const y = box.y + (box.height * 0.2) + (Math.random() * (box.height * 0.6));

    // Gerakan mouse lebih natural & acak (Generate path baru tiap kali)
    const startX = x - (Math.random() * 50 + 20); // Mulai dari posisi acak 20-70px menjauh
    const startY = y - (Math.random() * 50 + 20);
    await page.mouse.move(startX, startY, { steps: 5 + Math.floor(Math.random() * 10) });
    await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 15) }); 
    
    await randomSleep(50, 100); // Jeda mikir manusia
    await page.mouse.down();
    await randomSleep(30, 80); // Tahan klik sedikit lebih lama
    await page.mouse.up();
    return true;
  } catch (e) {
    return false;
  }
}

// Gunakan 1 User Agent Tetap agar sesi login (cookies) valid dan tidak dicurigai karena gonta-ganti device
const FIXED_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

async function preparePage(page) {
  // Gunakan User Agent Tetap
  const ua = FIXED_UA;
  const platform = "Linux armv8l"; // Arsitektur CPU HP Android
  const uaVersion = ua.match(/Chrome\/(\d+)/)?.[1] || "122";
  const uaPlatform = "Android";

  // Set Viewport Mobile (Layar HP)
  await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });

  // Set Timezone ke Asia/Jakarta (Sesuai saran by.U point 1: Pengaturan Tanggal & Waktu)
  await page.emulateTimezone("Asia/Jakarta");

  await page.setUserAgent(ua);
  await page.setCacheEnabled(false);
  
  // Login Proxy jika diperlukan
  if (currentProxyAuth) {
    await page.authenticate(currentProxyAuth);
  }

  // Set Header Lengkap (Bahasa + Client Hints) agar terlihat valid
  const brands = [
    { brand: "Chromium", version: uaVersion },
    { brand: "Google Chrome", version: uaVersion },
    { brand: "Not(A:Brand", version: "24" }
  ];
  const secChUa = brands.map(b => `"${b.brand}";v="${b.version}"`).join(", ");

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Sec-CH-UA': secChUa,
    'Sec-CH-UA-Mobile': '?1', // ?1 artinya Mobile
    'Sec-CH-UA-Platform': `"${uaPlatform}"`,
    'Referer': 'https://www.byu.id/', // Referer diaktifkan kembali sesuai log sukses
  });
  
  // Script Anti-Detect Lanjutan
  await page.evaluateOnNewDocument((platform, uaVersion, uaPlatform) => {
    // 1. Hapus properti navigator.webdriver
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    } catch (e) {}
    try { delete Object.getPrototypeOf(navigator).webdriver; } catch (e) {}
    
    // 2. Samakan Platform dengan User Agent
    Object.defineProperty(navigator, 'platform', { get: () => platform });

    // 3. Mock window.chrome (agar terlihat seperti Chrome asli)
    window.chrome = {
      runtime: {},
      loadTimes: function() {},
      csi: function() {},
      app: {},
    };
    
    // Mock UserAgentData (Penting untuk Chrome modern agar tidak terdeteksi bot)
    const brands = [
      { brand: "Chromium", version: uaVersion },
      { brand: "Google Chrome", version: uaVersion },
      { brand: "Not(A:Brand", version: "24" }
    ];
    Object.defineProperty(navigator, 'userAgentData', {
      get: () => ({
        brands: brands,
        mobile: true, // Mobile true
        platform: uaPlatform,
        getHighEntropyValues: async () => ({
          architecture: "x86",
          bitness: "64",
          model: "",
          platformVersion: "10.0.0",
          fullVersionList: brands,
        })
      })
    });

    // 4. Mock plugins (agar tidak kosong)
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
        { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
        { name: "Native Client", filename: "internal-nacl-plugin", description: "" }
      ],
    });

    // Tambahan: Mock mimeTypes agar sinkron dengan plugins (Penting untuk jangka panjang)
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => [
        { type: 'application/pdf', suffixes: 'pdf', description: '', enabledPlugin: { name: 'Chrome PDF Plugin' } },
        { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: { name: 'Chrome PDF Plugin' } },
        { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable', enabledPlugin: { name: 'Native Client' } }
      ],
    });

    Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });

    // 5. Mock languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['id-ID', 'id', 'en-US', 'en'],
    });

    // 6. Mock Permissions (Penting untuk bypass deteksi bot)
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: 'denied' }) :
        originalQuery(parameters)
    );

    // 7. Mock WebGL (Sembunyikan identitas Headless/SwiftShader)
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      // 37445: UNMASKED_VENDOR_WEBGL, 37446: UNMASKED_RENDERER_WEBGL
      if (parameter === 37445) return 'Intel Inc.';
      // Generate variasi renderer agar tidak statis
      if (parameter === 37446) return 'Intel(R) Iris(R) Xe Graphics' + (Math.random() > 0.5 ? ' (TM)' : '');
      return getParameter(parameter);
    };

    // 8. Mock Hardware Info (CPU & RAM) - Randomize agar terlihat beda device
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => [4, 8, 12, 16][Math.floor(Math.random() * 4)] });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => [4, 8, 16, 32][Math.floor(Math.random() * 4)] });
    
    // 9. Mock Connection (Variasi RTT/Downlink agar terlihat dinamis seperti saran 'On-Off jaringan')
    Object.defineProperty(navigator, 'connection', {
      get: () => ({ 
        effectiveType: '4g', 
        rtt: Math.floor(Math.random() * 100) + 50, // RTT sedikit lebih tinggi khas seluler
        downlink: Math.floor(Math.random() * 5) + 2, // Speed variatif
        saveData: false 
      }),
    });

    // 11. Mock Touch Points (HP punya layar sentuh)
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });

    // 10. Canvas & Font Fingerprint Noise (Generate Unique Fingerprint per Session)
    // Ini akan membuat hash canvas berubah setiap kali script dijalankan
    const shift = { r: Math.floor(Math.random() * 4) - 2, g: Math.floor(Math.random() * 4) - 2, b: Math.floor(Math.random() * 4) - 2 };
    
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
      const image = originalGetImageData.apply(this, arguments);
      // Inject noise halus ke pixel data
      for (let i = 0; i < image.data.length; i += 4) {
        if (image.data[i+3] > 0) { // Hanya ubah jika tidak transparan
           image.data[i] = Math.max(0, Math.min(255, image.data[i] + shift.r));
           image.data[i+1] = Math.max(0, Math.min(255, image.data[i+1] + shift.g));
           image.data[i+2] = Math.max(0, Math.min(255, image.data[i+2] + shift.b));
        }
      }
      return image;
    };

    // 12. Mock window dimensions (Penting untuk deteksi headless, agar tidak 0)
    Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth });
    Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight });
  }, platform, uaVersion, uaPlatform);
}

// === FUNCTION: redeemVoucher ===
async function redeemVoucher(trxid, nomor, voucher) {
  // Cek apakah sedang masa cooldown akibat limit IP
  if (Date.now() < rateLimitUntil) {
    const wait = Math.ceil((rateLimitUntil - Date.now()) / 1000);
    console.log(`[${trxid}] ? Sedang Cooldown IP (${wait}s)`);
    return { trxid, status: "failed", reason: "rate_limit_cooldown", message: `IP Limit Cooldown (${wait}s)` };
  }

  requestCount++; // Tambah counter request
  
  // Sanitasi input agar tidak merusak JSON
  nomor = String(nomor).trim();
  voucher = String(voucher).trim();

  let page;
  try {
    const browser = await getBrowser(); // Gunakan browser yang sudah terbuka
    page = await browser.newPage(); // Buka Tab Baru
    
    page.setDefaultTimeout(60000);
    await preparePage(page);

    console.log(`[${trxid}] Redeem ${voucher} untuk ${nomor} (Telkomsel)...`);
    
    // Navigasi ke halaman Redeem Telkomsel
    await page.goto("https://www.telkomsel.com/shops/voucher/redeem", { waitUntil: "domcontentloaded", timeout: 60000 });

    // Selectors sesuai request
    const msisdnSelector = 'input[formcontrolname="msisdn"]';
    const voucherSelector = 'input[placeholder="Masukkan Kode Voucher"]';
    const submitSelector = 'button.btn-primary-submit';

    // Tunggu form muncul
    try {
      await page.waitForSelector(msisdnSelector, { visible: true, timeout: 30000 });
    } catch (e) {
      return { trxid, status: "failed", reason: "page_load_error", message: "Gagal memuat halaman input Telkomsel." };
    }

    // Input MSISDN
    await humanClick(page, msisdnSelector);
    await randomSleep(100, 200);
    await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, msisdnSelector);
    await page.type(msisdnSelector, nomor, { delay: 100 });
    
    await randomSleep(500, 1000);

    // Cek apakah nomor valid (muncul span error)
    const invalidNumMsg = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll('span'));
        const found = spans.find(s => s.innerText.includes("Bukan nomor Telkomsel"));
        return found ? found.innerText : null;
    });
    if (invalidNumMsg) {
        return { trxid, status: "failed", reason: "invalid_number", message: invalidNumMsg };
    }

    // Input Voucher
    await humanClick(page, voucherSelector);
    await randomSleep(100, 200);
    await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, voucherSelector);
    await page.type(voucherSelector, voucher, { delay: 100 });

    await randomSleep(500, 1000);

    // Klik Redeem
    await humanClick(page, submitSelector);
    
    console.log(`[${trxid}] Menunggu hasil redeem...`);

    // Polling status sukses/gagal
    const startTime = Date.now();
    const POLLING_TIMEOUT = 60000;
    
    while (Date.now() - startTime < POLLING_TIMEOUT) {
        // 1. Cek Header Gagal/Sukses
        const failHeader = await page.$('div.headerMessage');
        if (failHeader) {
            const headerText = await page.evaluate(el => el.innerText.trim(), failHeader);
            const msgText = await page.$eval('div.messageResponse', el => el.innerText.trim()).catch(() => "");
            
            if (headerText.toLowerCase().includes("gagal")) {
                console.log(`[${trxid}] Gagal: ${headerText} - ${msgText}`);
                // Reset session jika terjadi kesalahan sistem 3x berturut-turut
                if (msgText.includes("Terjadi kesalahan pada sistem")) {
                    consecutiveSystemErrors++;
                    console.log(`[${trxid}] ?? System Error count: ${consecutiveSystemErrors}`);
                    
                    if (consecutiveSystemErrors >= 3) {
                        console.log(`[${trxid}] ?? System Error limit reached (3x). Resetting browser session...`);
                        if (sharedBrowser) try { await sharedBrowser.close(); } catch {}
                        sharedBrowser = null;
                        consecutiveSystemErrors = 0;
                    }
                } else {
                    consecutiveSystemErrors = 0;
                }
                return { trxid, status: "failed", reason: "failed_redeem", message: `${headerText}: ${msgText}` };
            }
            
            // Jika header muncul tapi bukan gagal, kemungkinan sukses (atau teks "Berhasil")
            if (headerText.toLowerCase().includes("berhasil") || headerText.toLowerCase().includes("sukses") || msgText.toLowerCase().includes("diproses")) {
                consecutiveSystemErrors = 0;
                console.log(`[${trxid}] Sukses: ${headerText} - ${msgText}`);
                return { trxid, status: "success", message: `${headerText}: ${msgText}` };
            }
        }

        // 2. Cek Invalid Number (muncul belakangan)
        const invalidNum = await page.evaluate(() => {
            const spans = Array.from(document.querySelectorAll('span'));
            const found = spans.find(s => s.innerText.includes("Bukan nomor Telkomsel"));
            return found ? found.innerText : null;
        });
        if (invalidNum) {
             return { trxid, status: "failed", reason: "invalid_number", message: invalidNum };
        }

        await sleep(1000);
    }

    return { trxid, status: "failed", reason: "timeout", message: "Tidak ada respon dari Telkomsel setelah 60 detik." };
  } catch (e) {
    return { trxid, status: "error", message: e.message };
  } finally {
    // JANGAN tutup browser, cukup tutup tab (page) saja
    if (page && !page.isClosed()) await page.close();
  }
}

// === FUNCTION: checkSerialStatus ===
async function checkSerialStatus(trxid, serialNumber) {
  requestCount++;
  let page;
  try {
    const browser = await getBrowser(); // Gunakan browser yang sudah terbuka
    page = await browser.newPage(); // Buka Tab Baru
    page.setDefaultTimeout(10000);
    await preparePage(page);

    console.log(` [${trxid}] Cek serial: ${serialNumber}`);
    // Gunakan navigasi via JS
    await page.evaluate(() => {
      window.location.assign("https://www.byu.id/v2/tkr-voucher");
    });
    await page.waitForSelector('input[name="serialNumber"], input[placeholder*="Nomor seri"]', { timeout: 30000 });

    const inputSel = 'input[name="serialNumber"]';
    const submitBtnSel =
      'button[form="check-voucher-form"], button[form="check-voucher-form"][type="submit"], button[data-test-id][form="check-voucher-form"]';

    if (!(await page.$(inputSel))) {
      const fallback = await page.$('input[placeholder*="Nomor seri"]');
      if (fallback) {
        await fallback.focus();
        await fallback.type(serialNumber, { delay: Math.floor(Math.random() * 100) + 50 });
      } else {
        return { trxid, status: "error", message: "Selector input serialNumber tidak ditemukan di halaman." };
      }
    } else {
      await page.type(inputSel, serialNumber, { delay: Math.floor(Math.random() * 100) + 50 });
    }

    const btn = await page.$(submitBtnSel);
    if (!btn) {
      const buttons = await page.$$("button");
      let clicked = false;
      for (const b of buttons) {
        const text = (await page.evaluate((el) => el.innerText || "", b)).trim();
        if (/cek status/i.test(text)) {
          await b.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        return { trxid, status: "error", message: "Tombol Cek Status tidak ditemukan." };
      }
    } else {
      await randomSleep(300, 600);
      await btn.click();
    }

    const popupSel = ".styles_pop-up__content__acjst, .styles_popup__content__LM0Bo";
    try {
      await page.waitForSelector(popupSel, { timeout: 7000 });
    } catch {
      const errSel = "p.styles_m-input-group__message__4Tff1";
      if (await page.$(errSel)) {
        const errText = await page.$eval(errSel, (el) => el.innerText.trim());
        return { trxid, status: "failed", reason: "invalid_serial", message: errText };
      }
      return { trxid, status: "failed", reason: "no_popup", message: "Popup status voucher tidak muncul." };
    }

    const badgeSel =
      ".styles_popup__badge__5GT7E, .styles_popup__badge--available__XLldG, .styles_popup__badge__5GT7E";
    let badgeText = null;
    if (await page.$(badgeSel)) {
      badgeText = (await page.$eval(badgeSel, (el) => el.innerText.trim())).replace(/\s+/g, " ");
    }

    const rowSel = ".styles_popup__row__6Y6fm";
    const data = {};
    if (await page.$(rowSel)) {
      const rows = await page.$$(rowSel);
      for (const r of rows) {
        const label =
          (await r.$eval(".styles_popup__row__label__HLWI3", (el) => el.innerText.trim()).catch(() => null)) ||
          (await r.$eval("p:first-child", (el) => el.innerText.trim()).catch(() => null));
        const value =
          (await r.$eval(".styles_popup__row__value__gcxFn", (el) => el.innerText.trim()).catch(() => null)) ||
          (await r.$eval("p:last-child", (el) => el.innerText.trim()).catch(() => null));
        if (label) data[label] = value ?? "";
      }
    }

    const result = {
      trxid,
      status: "success",
      voucher_status_badge: badgeText || null,
      data,
    };

    return result;
  } catch (err) {
    return { trxid, status: "error", message: err.message };
  } finally {
    // JANGAN tutup browser, cukup tutup tab (page) saja
    if (page && !page.isClosed()) await page.close();
  }
}

// === ROUTES ===
app.get("/redeem", async (req, res) => {
  let { trxid, nomor, vc } = req.query;
  if (!nomor || !vc)
    return res
      .status(400)
      .json({ trxid: trxid || generateTrxId(), status: "error", message: "Parameter nomor & vc wajib." });

  trxid = trxid || generateTrxId();
  const result = await redeemVoucher(trxid, nomor, vc);
  res.json({
    nomor,
    result,
  });
});

// === API CEK SERIAL (versi stabil tanpa waitForTimeout) ===
app.get("/check-serial", async (req, res) => {
  requestCount++;
  const { serialNumber } = req.query;
  const trxid = generateTrxId();

  if (!serialNumber)
    return res.status(400).json({
      trxid,
      status: "error",
      message: "Parameter serialNumber wajib diisi.",
    });

  let page;
  try {
    const browser = await getBrowser(); // Gunakan browser yang sudah terbuka
    page = await browser.newPage(); // Buka Tab Baru
    page.setDefaultTimeout(30000);
    await preparePage(page);

    console.log(`?? [${trxid}] Mengecek voucher serial: ${serialNumber}`);
    // Gunakan navigasi via JS
    await page.evaluate(() => {
      window.location.assign("https://www.byu.id/v2/cek-voucher");
    });
    await page.waitForSelector('input[name="serialNumber"]', { timeout: 40000 });

    // Tunggu form serial siap
    await page.waitForSelector('button[type="submit"]', { timeout: 20000 });

    // Isi nomor voucher
    await page.focus('input[name="serialNumber"]');
    await page.keyboard.type(serialNumber, { delay: Math.floor(Math.random() * 50) + 20 });

    // Klik tombol cek status
    await page.evaluate(() => {
      const btn = document.querySelector('button[type="submit"]');
      if (btn) btn.click();
    });

    // Tunggu popup atau pesan error muncul (5x percobaan)
    let popupAppeared = false;
    for (let i = 0; i < 5; i++) {
      await randomSleep(1000, 1500);
      if (await page.$("div.styles_pop-up__content__acjst")) {
        popupAppeared = true;
        break;
      }
      if (await page.$("p.styles_m-input-group__message__4Tff1")) break;
    }

    // Cek apakah popup muncul
    if (popupAppeared) {
      const data = await page.evaluate(() => {
        const title = document.querySelector("p.styles_popup__title__trDN_")?.innerText || "";
        const status = document.querySelector("span.styles_popup__badge__5GT7E")?.innerText || "";
        const nomorSeri = document.querySelectorAll("p.styles_popup__row__value__gcxFn")[0]?.innerText || "";
        const value = document.querySelectorAll("p.styles_popup__row__value__gcxFn")[1]?.innerText || "";
        const masaBerlaku = document.querySelectorAll("p.styles_popup__row__value__gcxFn")[2]?.innerText || "";
        return { title, status, nomorSeri, value, masaBerlaku };
      });

      return res.json({
        trxid,
        serialNumber,
        status: "success",
        data,
      });
    }

    // Kalau popup tidak muncul, cek pesan error
    const errMsg = await page.$eval(
      "p.styles_m-input-group__message__4Tff1",
      (el) => el.innerText.trim()
    ).catch(() => null);

    if (errMsg) {
      if (errMsg.includes("tidak valid")) {
        return res.json({
          trxid,
          serialNumber,
          status: "failed",
          reason: "invalid_serial",
          message: errMsg,
        });
      }
      return res.json({
        trxid,
        serialNumber,
        status: "failed",
        reason: "unknown_error",
        message: errMsg,
      });
    }

    return res.json({
      trxid,
      serialNumber,
      status: "failed",
      reason: "no_popup",
      message: "Popup status voucher tidak muncul setelah beberapa percobaan.",
    });
  } catch (e) {
    res.json({
      trxid,
      serialNumber,
      status: "error",
      message: e.message,
    });
  } finally {
    // JANGAN tutup browser, cukup tutup tab (page) saja
    if (page && !page.isClosed()) await page.close();
  }
});


// === START SERVER ===
app.listen(PORT, async () => {
  console.log(`Addon jalan di http://localhost:${PORT}`);
  // Pre-launch browser saat server nyala
  await getBrowser();
});
