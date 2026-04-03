# AT&T / phone + Twilio Trust (fix SIP 603 / no ring)

Use this after Twilio logs show **SIP 603** (decline) on outbound calls to your mobile: the **callee network or handset** is rejecting the leg before a normal ring. MiraChat only triggers Twilio; it cannot change AT&T or Trust Hub for you.

---

## 1. Phone and AT&T (do this on the device)

Work through in order; then place a test call from the ops console or `POST /mirachat/phone/outbound`.

### iPhone

1. **Settings → Phone → Silence Unknown Callers** → **Off** (test at least once with it off).
2. **Settings → Focus** → ensure no Focus is blocking calls (or allow calls from everyone for the test).
3. **Phone app → Recents** → find **`+15187503210`** (your Twilio Voice caller ID) → **Unblock** if listed.
4. **Contacts** → add **`+15187503210`** with a clear name (e.g. “MiraChat Twilio”) so the OS/carrier treats it as known.
5. **Settings → Phone → Call Blocking & Identification** → disable third‑party call ID/spam apps **temporarily** for the test (Truecaller, Hiya, etc.).
6. **Settings → Cellular** (or **Mobile Data**) → try **Wi‑Fi Calling → Off** for one test (some routes behave differently).
7. If you use **Google Voice / dual SIM**: test with **only** the AT&T line active for cellular voice.

### AT&T ActiveArmor (mobile app)

1. Open **AT&T ActiveArmor** (or **Call Protect**, depending on plan).
2. Turn **off** aggressive **spam / fraud / automatic blocking** for the duration of the test (or allowlist **`+15187503210`** if the app supports it).
3. Open **blocked / quarantined** lists and **remove** **`+15187503210`** if present.

### Android (if applicable)

1. **Phone → Settings → Blocked numbers** → unblock **`+15187503210`**.
2. **Google Phone → Spam and Call Screen** → adjust so unknown numbers are not auto‑declined for the test.
3. Disable other **call screening / firewall** apps temporarily.

### After changes

Wait **1–2 minutes**, then trigger another outbound notify call. If logs still show **603**, continue with section 3 and/or open **AT&T support** with a recent **Call SID** from Twilio.

---

## 3. Twilio Trust Hub: SHAKEN/STIR, CNAM, Voice Integrity

These improve **how your Twilio number appears** to carriers (attestation, caller-name databases, spam scores). Everything below is done in the [Twilio Console](https://console.twilio.com/) (often after a Trust Hub **Customer Profile**). Twilio’s product rules change; use their docs as source of truth.

### SHAKEN/STIR Trusted Calling (Voice)

**Status (this project):** configured.

This is the main carrier-facing signal for **signed / attested** caller identity on many US networks. After it is live, re-test outbound notify; if you still see **SIP 603**, the block is likely still **handset or carrier policy** (section 1), not missing STIR.

Docs: [Trusted calling with SHAKEN/STIR](https://www.twilio.com/docs/voice/trusted-calling-with-shakenstir) · [Trust overview](https://www.twilio.com/en-us/trust/shaken-stir)

### CNAM (Caller ID Name) — not DNS “CNAME”

**CNAM** is the **name** some carriers show for a voice number (separate from DNS **CNAME**).

**Status (this project):** not configurable **per individual local number** in Twilio for this setup — Twilio and the CNAM ecosystem often restrict database dips to **toll-free**, **certain business lines**, or bulk programs, not every purchased local DID. That is **normal**; you are **not** blocked from voice just because CNAM is unavailable.

If Twilio later offers CNAM for your number type, see: [Brand your calls using CNAM](https://www.twilio.com/docs/voice/brand-your-calls-using-cnam). Otherwise rely on **SHAKEN/STIR**, **Voice Integrity**, **Branded Calling** (where supported), and **§1** (contact card + AT&T).

### Voice Integrity & Branded Calling (optional)

- [Voice Integrity](https://www.twilio.com/docs/voice/spam-monitoring-with-voiceintegrity) — spam/reputation monitoring.  
- [Branded Calling](https://www.twilio.com/docs/voice/branded-calling) — where carriers support rich caller display.

### Trust Hub entry points

1. [Trust Hub overview](https://console.twilio.com/us1/account/trust-hub/overview)  
2. [Customer Profiles](https://console.twilio.com/us1/account/trust-hub/customer-profiles) — [create a profile](https://www.twilio.com/docs/trust-hub) if you add more trust products later.

### Your Voice number in Console

Configure the **purchased** number you use as **`TWILIO_VOICE_FROM_NUMBER`**:

- [Console → Phone Numbers → Manage → Active numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming)  
- Open the number → check **Voice** configuration and any **Trust / compliance** prompts Twilio shows for that number.

### Repo helper (URLs only)

From `MiraChat/`:

```bash
npm run twilio:trust-urls
```

Prints your **Account SID**, **Voice From** E.164, **IncomingPhoneNumber SID**, and deep links to the configure page when the API returns a match.

### MiraChat: capture StirVerstat (status callbacks)

SHAKEN/STIR **signing** is configured in Twilio Trust Hub; **per-call attestation** can appear on Voice **status callbacks** as **`StirVerstat`** (see Twilio changelog: outbound STIR in status callbacks).

1. Expose your MiraChat API on a **public HTTPS** URL (e.g. ngrok) pointing at the same process that has **`DATABASE_URL`** (the webhook route requires Postgres + `mirachat` context).
2. In **`MiraChat/.env`** set:
   - **`MIRACHAT_PUBLIC_BASE_URL=https://your-host`** (no trailing path), **or** a full **`MIRACHAT_TWILIO_VOICE_STATUS_CALLBACK=...`**.
   - For local tunnels, **`MIRACHAT_SKIP_TWILIO_VOICE_WEBHOOK_SIGNATURE=1`** is allowed **only in dev** (never in production).
3. Restart **`npm run dev:api`**. Outbound notify calls will include Twilio **`StatusCallback`** automatically when a public base or explicit callback URL is set.
4. Twilio POSTs to **`POST /mirachat/webhooks/twilio/voice-call-status`**. The API appends rows with **`phone.twilio.call_status`** (metadata includes **`StirVerstat`**, **`CallStatus`**, **`SipResponseCode`**, etc.) for GQM / debugging.

**`GET /mirachat/phone/status`** returns **`voiceStatusCallbackConfigured`** and **`voiceStatusCallbackHost`** so you can confirm the running server resolved a callback URL.

---

## Document history

| Version | Date | Notes |
| --- | --- | --- |
| 0.1 | 2026-04-02 | AT&T/phone checklist + Twilio Trust links for SIP 603 troubleshooting |
| 0.2 | 2026-04-02 | SHAKEN/STIR noted configured; CNAM limitations for individual/local numbers |
| 0.3 | 2026-04-02 | Status callback path + env vars for StirVerstat in MiraChat |
