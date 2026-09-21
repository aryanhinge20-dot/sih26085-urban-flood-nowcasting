# IMD token renewal — what exists, what FloodNet does, what IMD must provide

Status: investigated 2026-09-21. Evidence below is from IMD's **public** pages and from metadata of our own token
(the value itself was never printed or logged). Anything about the logged-in dashboard is **[UNVERIFIED]**.

## 1. How IMD issues the token (evidence)

| Item | Observed |
|---|---|
| Login page | `login.php`: `<form method="POST">` with fields `email`, `password`, `captcha`, `captcha_key`, `csrf` |
| CAPTCHA | image from `captcha_image.php?key=…`, a new key per page load |
| Session | `PHPSESSID` cookie (Secure, HttpOnly); the page loads no external scripts and fetches no token via JS |
| Registration | `register.php`: same form + CAPTCHA pattern |
| API reference | `api_reference.html`: **no** mention of token, JWT, refresh, login, Authorization or Bearer |
| Token shape | 104 characters, 2 parts: `base64url(JSON {"uid": <int>, "exp": <epoch>})` + `.` + 48-byte signature |
| Token claims | `uid`, `exp` only — no `iat`, `iss`, `aud`, refresh token or refresh URL |
| API key | 64-hex `X-API-Key`, bound to the server's public IP; shares nothing with the token; not used for renewal |

**Conclusion (public flow):** the token is issued inside the portal dashboard after an email + password + CAPTCHA
login. IMD documents **no** refresh endpoint, refresh token or machine credential. Unattended renewal from IMD is
therefore **not possible through any documented mechanism**, and FloodNet does not attempt it. It does not bypass
or solve the CAPTCHA, automate the login form, or probe for undocumented endpoints.

## 2. What FloodNet's "renewal" actually does

Renewal re-reads the **configured server-side secret source** (token file, `.env`, environment, AWS Secrets
Manager or SSM) without using its cache, and uses a newer, well-formed token it finds there. It never contacts IMD's login.

- **Proactive:** if the token's own `exp` is less than 10 minutes away, a newer token is picked up before IMD
  rejects the old one. If nothing newer exists, the current token keeps being used until it expires.
- **On 401:** the token is marked rejected → renewal runs → the original request is retried **once** with the new
  token → only if renewal finds nothing, or the retry fails, does "Best available source" fall back
  (radar-derived → ECMWF → cached → demo).
- **Single-flight:** concurrent 401s share one renewal and one secret-store read. There is no refresh storm.
- **403** (key or IP refused) is a configuration error. It never triggers renewal.
- **Malformed** values (bad length, whitespace or control characters) are never sent to IMD.
- **Status** (`GET /api/data-status`): `imd_auth_status`, `imd_refresh_status` (idle / refreshing / renewed /
  failed), `imd_token_expires_at`, `active_rainfall_source`, `active_source_timestamp`. No credential or fingerprint is included.
- **UI badge:** IMD LIVE only while the token is valid and the last IMD request succeeded; otherwise
  IMD RENEWING / IMD AUTH EXPIRED / IMD UNAVAILABLE.

So a new token still has to be **placed** in the secret source, by an operator today. The rotation steps are in `DEPLOYMENT.md` §4.

## 3. What is still unknown — manual check by the account holder

It is not known whether the logged-in dashboard can issue a new token from an existing session **without** a
new CAPTCHA, or how long that session lasts. To find out (the account holder, in their own browser):

1. Log in to the IMD API portal normally.
2. Open DevTools → Network, tick "Preserve log".
3. Click whatever the dashboard offers to generate or regenerate a token.
4. Note **only**: the request URL and method, which cookies or headers it needs (names only), and whether it
   asks for the CAPTCHA again. Do not copy the token or cookie values anywhere.
5. Log out, log back in a few hours later, and see whether the session survived.

Even if session-based regeneration exists, it is undocumented. **It must not be automated without IMD's written approval.**

## 4. What to request from IMD for unattended server-side renewal

Any one of the following:

1. A **service account / machine-to-machine credential** (for example, OAuth2 client-credentials) to exchange for tokens.
2. A **documented refresh endpoint** plus a refresh token.
3. A **long-lived token bound to the server's static IP**, which is already how the API key works.

Contacts listed on the portal's contact page: the Nodal Officer (sankar.nath@imd.gov.in) and kavita.navria@imd.gov.in.
If IMD provides (1) or (2), it plugs in as one more `TokenSource` (`imd_token_sources.py`). The retry, single-flight
and status logic stay unchanged.
