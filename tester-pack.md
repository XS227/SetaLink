# SetaLink Iran Tester Pack — v0.9.18
**برای آزمایشگران ایران / For Iran Testers**

---

## APK Download

**Latest APK:** https://setalink.no/releases/latest/setalink-latest.apk  
**Version:** 0.9.18 (build 28) — May 2026

---

## Protocol Priority Order (Best → Last Resort)

| Priority | Protocol | Port | Server | Notes |
|---|---|---|---|---|
| 1 | **Reality (Cloudflare SNI)** | 443 | 178.104.77.231 | Mimics cloudflare.com HTTPS |
| 2 | **Reality (Oracle SNI)** | 8443 | 178.104.77.231 | Mimics oracle.com HTTPS |
| 3 | **Reality (Amazon SNI)** | 2052 | 178.104.77.231 | CDN port, mimics amazon.com |
| 4 | **XHTTP (SplitHTTP)** | 443 | edge.setalink.no | Chunked body, reads as file download |
| 5 | **WebSocket (Chrome)** | 443 | edge.setalink.no | Chrome TLS fingerprint |
| 6 | **HTTPUpgrade** | 443 | edge.setalink.no | Last resort |

The app automatically tries protocols in this order. No manual switching needed.

---

## Manual V2Ray/v2rayNG Configuration

If you prefer to use v2rayNG directly:

### Recommended v2rayNG Version
- **v2rayNG ≥ 1.8.16** (download from: https://github.com/2dust/v2rayNG/releases)
- Minimum Xray core: **1.8.21**

### Profile 1: Reality — Cloudflare :443 (Primary — Best for Iran)
```
vless://fd709d48-a983-484a-99e3-afc97e2c3692@178.104.77.231:443?type=tcp&encryption=none&security=reality&pbk=IJXsDOA55gNiMZprjOdfaS6pN9ifm4MSqlsiZDGzki8&fp=chrome&sni=www.cloudflare.com&sid=d93af82f2ecb7f6a#SetaLink-Cloudflare
```

### Profile 2: Reality — Oracle :8443
```
vless://c8af7366-b531-4f35-bea2-6fb70d1e4850@178.104.77.231:8443?type=tcp&encryption=none&security=reality&pbk=5eItT4D3ZmR8Nit_JWjpm9XfX4CzZGzvhovxF4n_6CY&fp=chrome&sni=www.oracle.com&sid=70df7a#SetaLink-Oracle
```

### Profile 3: Reality — Amazon :2052
```
vless://1580e282-be00-4ddc-932b-9bbcd69f0dad@178.104.77.231:2052?type=tcp&encryption=none&security=reality&pbk=Wo4-Iz8anzOfnQye9L1ARwDElePwwLPq1b82A_ZEsjo&fp=chrome&sni=www.amazon.com&sid=a4#SetaLink-Amazon
```

### Profile 4: XHTTP/SplitHTTP
```
vless://fd709d48-a983-484a-99e3-afc97e2c3692@edge.setalink.no:443?security=tls&type=xhttp&path=%2Fxhttp%2F&host=edge.setalink.no&sni=edge.setalink.no&fp=chrome#SetaLink-XHTTP
```

### Profile 5: WebSocket (Chrome fingerprint)
```
vless://fd709d48-a983-484a-99e3-afc97e2c3692@edge.setalink.no:443?security=tls&type=ws&path=%2Fws&host=edge.setalink.no&sni=edge.setalink.no&fp=chrome&alpn=http%2F1.1#SetaLink-WS
```

### Profile 6: HTTPUpgrade
```
vless://fd709d48-a983-484a-99e3-afc97e2c3692@edge.setalink.no:443?security=tls&type=httpupgrade&path=%2Fhttpup&host=edge.setalink.no&sni=edge.setalink.no&fp=chrome#SetaLink-HTTPup
```

---

## راهنمای نصب (Persian Installation Guide)

### مرحله ۱ — دانلود APK
۱. لینک زیر را در مرورگر Chrome باز کنید:
   https://setalink.no/releases/latest/setalink-latest.apk
۲. فایل APK را دانلود کنید
۳. در صورت نیاز، نصب از منابع ناشناس را در تنظیمات فعال کنید

### مرحله ۲ — نصب
۱. فایل APK را باز کنید و نصب را تأیید کنید
۲. برنامه را اجرا کنید — ثبت‌نام خودکار انجام می‌شود

### مرحله ۳ — اتصال
۱. دکمه سبز Connect را بزنید
۲. برنامه به‌طور خودکار بهترین پروتکل را انتخاب می‌کند
۳. در صورت نمایش پیام "Optimizing route..." صبر کنید — در حال تغییر پروتکل است

### مرحله ۴ — دعوت دوستان (۱ گیگابایت رایگان)
۱. وارد بخش Profile شوید
۲. کد دعوت خود را کپی و برای دوستان ارسال کنید
۳. با هر دعوت موفق، ۱ گیگابایت اضافه دریافت می‌کنید

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Connected but no internet | Force-stop app, reconnect. App will try next protocol |
| Stuck on Connecting... | Wait 30–60s — app is testing all 6 protocols automatically |
| Very slow speed | Reality (Cloudflare :443) gives best speed |
| App crashes | Update to latest APK |

### Hidden Diagnostics
In Profile screen, long-press the version number (v0.9.18) for 1.5 seconds to open the diagnostics screen.

---

## ISP Notes

| ISP | Best Protocol | Notes |
|---|---|---|
| Irancell (MCI) | Reality :443 | Works well |
| Rightel | Reality :443 | Works well |
| Hamrahe Aval | Reality :8443 or XHTTP | Try alternate ports if :443 throttled |
| MobinNet | WebSocket | |
| ADSL (TCI/Shatel) | Reality :443 | Best performance |

---

## Server Details

| Parameter | Value |
|---|---|
| Server | 178.104.77.231 (Hetzner Nuremberg, Germany) |
| Edge proxy | edge.setalink.no (WS/XHTTP/HTTPUpgrade) |
| Reality Inbound 1 | :443 · UUID fd709d48 · SNI cloudflare.com |
| Reality Inbound 2 | :8443 · UUID c8af7366 · SNI oracle.com |
| Reality Inbound 3 | :2052 · UUID 1580e282 · SNI amazon.com |

---

## Contact / Support

- Telegram: https://t.me/SetaLink3
- Website: https://setalink.no

---

*Generated: 2026-05-21 — SetaLink v0.9.18*
