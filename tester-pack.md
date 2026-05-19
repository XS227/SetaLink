# SetaLink Iran Tester Pack — v0.9.6
**برای آزمایشگران ایران / For Iran Testers**

---

## APK Download

**Latest APK:** https://setalink.no/assets/setalink-v0.9.6.apk  
**Version:** 0.9.6 (build 11) — May 2026

---

## Protocol Priority Order (Best → Last Resort)

| Priority | Protocol | Port | Notes |
|---|---|---|---|
| 1 | **Reality (XTLS)** | 8443 | Best for Iran — mimics HTTPS traffic |
| 2 | **XHTTP (SplitHTTP)** | 10002 | Good for restricted ISPs |
| 3 | **WebSocket (Chrome)** | 10001 | Fallback via Cloudflare edge |
| 4 | **HTTPUpgrade** | 10000 | Last resort |

The app automatically tries protocols in this order. No manual switching needed.

---

## Manual V2Ray/v2rayNG Configuration

If you prefer to use v2rayNG directly:

### Recommended v2rayNG Version
- **v2rayNG ≥ 1.8.16** (download from: https://github.com/2dust/v2rayNG/releases)
- Minimum Xray core: **1.8.21**

### Profile 1: Reality (Primary — Best for Iran)
```
vless://b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3@5.249.252.221:8443?security=reality&type=tcp&flow=xtls-rprx-vision&sni=www.microsoft.com&fp=chrome&pbk=Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU&sid=7f81892e#SetaLink-Reality
```

### Profile 2: XHTTP/SplitHTTP
```
vless://b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3@edge.setalink.no:443?security=tls&type=splithttp&path=%2Fxhttp&sni=edge.setalink.no&fp=chrome#SetaLink-XHTTP
```

### Profile 3: WebSocket (Chrome fingerprint)
```
vless://b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3@edge.setalink.no:443?security=tls&type=ws&path=%2Fws&sni=edge.setalink.no&fp=chrome#SetaLink-WS-Chrome
```

### Profile 4: HTTPUpgrade
```
vless://b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3@edge.setalink.no:443?security=tls&type=httpupgrade&path=%2Fhttpup&sni=edge.setalink.no&fp=chrome#SetaLink-HTTPup
```

---

## راهنمای نصب (Persian Installation Guide)

### مرحله ۱ — دانلود APK
۱. لینک زیر را در مرورگر Chrome باز کنید:
   https://setalink.no/assets/setalink-v0.9.6.apk
۲. فایل APK را دانلود کنید
۳. در صورت نیاز، نصب از منابع ناشناس را در تنظیمات فعال کنید

### مرحله ۲ — نصب
۱. فایل APK را باز کنید و نصب را تأیید کنید
۲. برنامه را اجرا کنید — ثبت‌نام خودکار انجام می‌شود

### مرحله ۳ — اتصال
۱. دکمه سبز Connect را بزنید
۲. برنامه به‌طور خودکار بهترین پروتکل را انتخاب می‌کند
۳. در صورت نمایش پیام "Optimizing route..." صبر کنید — در حال تغییر پروتکل است

### مرحله ۴ — دعوت دوستان (۵۱۲ مگابایت رایگان)
۱. وارد بخش Profile شوید
۲. کد دعوت خود را کپی و برای دوستان ارسال کنید
۳. با هر دعوت، ۵۱۲ مگابایت اضافه دریافت می‌کنید

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Connected but no internet | Force-stop app, reconnect. App will try next protocol |
| Stuck on Connecting... | Wait 30s — app is testing all protocols |
| Very slow speed | Reality protocol gives best speed |
| App crashes | Update to latest APK |

### Hidden Diagnostics
In Profile screen, long-press the version number (v0.9.6) for 1.5 seconds to open the diagnostics screen.

---

## ISP Notes

| ISP | Best Protocol | Notes |
|---|---|---|
| Irancell (MCI) | Reality | Works well |
| Rightel | Reality | Works well |
| Hamrahe Aval | XHTTP | Reality may be throttled |
| MobinNet | WebSocket | |
| ADSL (TCI/Shatel) | Reality | Best performance |

---

## Server Details

| Parameter | Value |
|---|---|
| Server | 5.249.252.221 (Netherlands, SetaLink Edge) |
| Edge | edge.setalink.no (Cloudflare-proxied) |
| UUID | b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3 |
| Reality Public Key | Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU |
| Short ID | 7f81892e |
| SNI | www.microsoft.com |

---

## Contact / Support

- Website: https://setalink.no

---

*Generated: May 2026 — SetaLink v0.9.6*
