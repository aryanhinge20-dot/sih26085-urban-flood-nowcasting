"""Server-side IMD credential + token-state manager.

THE PROBLEM: api.imd.gov.in needs an IP-bound key (X-API-Key) AND a short-lived bearer token that the portal
issues after a password + CAPTCHA login. The token expires roughly hourly. There is NO documented refresh
endpoint and none is assumed here; this module never logs in, never touches the CAPTCHA, and never claims a
token was renewed. It only:

  * reads the token from a pluggable source (imd_token_sources.py: environment / .env / file / AWS Secrets Manager
    / SSM), re-asked on every request, so a rotated token is used with no restart and no frontend rebuild;
  * works out expiry where knowable: a JWT's `exp` claim, else (time the value dates from) + IMD_TOKEN_TTL_MIN
    (default 60 -- an ASSUMPTION, reported as such);
  * remembers what IMD itself said: a 401 marks the CURRENT token as rejected; a 403 marks the current KEY / server
    IP as rejected (rotating the token would not help, so the state says what to fix);
  * refuses malformed tokens (whitespace, control characters, implausible length) without sending them;
  * reports one of four states -- VALID | EXPIRING_SOON | EXPIRED | UNAVAILABLE -- plus how it knows.

Nothing here ever returns, logs or raises a credential value; `fingerprint()` is a short SHA-256 prefix used only
in-process for "did it change?" comparisons and is never serialised.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .. import config
from .imd_token_sources import TokenReading, TokenSource, build_source

log = logging.getLogger(__name__)

KEY_ENV, TOKEN_ENV, TTL_ENV = "IMD_API_KEY", "IMD_API_TOKEN", "IMD_TOKEN_TTL_MIN"
DEFAULT_TTL_MIN = 60.0
EXPIRING_SOON_S = 10 * 60
MIN_TOKEN_LEN, MAX_TOKEN_LEN = 20, 8192

VALID, EXPIRING_SOON, EXPIRED, UNAVAILABLE = "VALID", "EXPIRING_SOON", "EXPIRED", "UNAVAILABLE"


def fingerprint(secret: Optional[str]) -> Optional[str]:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()[:10] if secret else None


def _b64_json(part: str) -> Optional[dict]:
    try:
        obj = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        return obj if isinstance(obj, dict) else None
    except Exception:  # noqa: BLE001
        return None


def jwt_expiry(token: str) -> Optional[float]:
    """`exp` (epoch seconds) read from the token itself, or None. Two formats are understood:
      * a standard JWT  header.payload.signature;
      * the IMD API portal's own token (observed 2026-09-21): base64url(JSON {"uid": <int>, "exp": <epoch>})
        + "." + a 48-byte base64url signature -- no iat / iss / aud / refresh claim.
    The signature is never checked: this is scheduling, not authentication."""
    parts = token.split(".")
    payload = _b64_json(parts[1]) if len(parts) == 3 else _b64_json(parts[0]) if len(parts) == 2 else None
    exp = payload.get("exp") if payload else None
    return float(exp) if isinstance(exp, (int, float)) and not isinstance(exp, bool) else None


def malformed_reason(token: str) -> Optional[str]:
    if not (MIN_TOKEN_LEN <= len(token) <= MAX_TOKEN_LEN):
        return "token has an implausible length"
    if any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in token):
        return "token contains whitespace or control characters"
    return None


@dataclass
class TokenStatus:
    state: str
    detail: str
    source: Optional[str]
    expires_at: Optional[float]
    expiry_basis: str                       # "jwt_exp" | "loaded_at+ttl" | "unknown"
    seconds_left: Optional[float]
    key_configured: bool
    last_ok_at: Optional[float]
    last_rejected_at: Optional[float]
    rejected_by: Optional[str] = None       # "token" (401) | "key_or_ip" (403) | None

    refresh_status: str = "idle"            # idle | refreshing | renewed | failed | not_configured
    last_refresh_at: Optional[float] = None

    def to_public_dict(self) -> dict:
        """Safe for an API response: states and times only, never a credential or a fingerprint."""
        iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t)) if t else None  # noqa: E731
        return {"state": self.state, "detail": self.detail, "token_source": self.source,
                "key_configured": self.key_configured, "expires_at": iso(self.expires_at),
                "expiry_basis": self.expiry_basis,
                "minutes_left": None if self.seconds_left is None else round(self.seconds_left / 60.0, 1),
                "last_accepted_at": iso(self.last_ok_at), "last_rejected_at": iso(self.last_rejected_at),
                "rejected_by": self.rejected_by, "refresh_status": self.refresh_status,
                "last_refresh_at": iso(self.last_refresh_at),
                # Renewal = re-reading the configured server-side secret source. It never logs in to IMD: the
                # portal issues tokens only after a password + CAPTCHA login and documents no refresh endpoint.
                "renewal_method": "reload from the configured secret source (no IMD refresh endpoint exists)"}


class IMDTokenManager:
    def __init__(self, dotenv_path: Optional[Path] = None, clock=time.time, source: Optional[TokenSource] = None):
        self._dotenv = dotenv_path if dotenv_path is not None else config.REPO_DIR / ".env"
        self._clock = clock
        self._lock = threading.Lock()
        self._explicit_source = source
        self._runtime: Optional[TokenReading] = None
        self._first_seen: dict[str, float] = {}         # token fingerprint -> first observed
        self._rejected: dict[str, float] = {}            # token fingerprint -> IMD 401 time
        self._rejected_keys: dict[str, float] = {}       # key fingerprint -> IMD 403 time
        self._last_ok_at: Optional[float] = None
        # single-flight renewal: one renewal at a time; concurrent callers wait for and reuse its result
        self._renew_lock = threading.Lock()
        self._refresh_status = "idle"
        self._last_refresh_at: Optional[float] = None

    # ------------------------------------------------------------------ renewal
    def renew(self, rejected: Optional[str], proactive: bool = False) -> Optional[str]:
        """Obtain a token different from `rejected`, or None. Only ONE renewal runs at a time: a caller that
        arrives while another renewal is running waits for it and reuses its result (no refresh storm).

        The renewal step re-reads the configured token source, bypassing any cache (file, .env, environment,
        AWS Secrets Manager / SSM). It succeeds when that source now holds a newer, well-formed token -- e.g.
        rotated there by an operator or by an IMD-approved process. It does NOT contact the IMD login page."""
        with self._renew_lock:                  # later callers block here until the running renewal finishes
            current = self.token()
            if current and current != rejected and self._token_not_known_bad(current):
                return current                  # someone else's renewal (or a rotation) already produced one
            with self._lock:
                self._refresh_status = "refreshing"
                self._runtime = None if self._runtime is not None and self._runtime.value == rejected else self._runtime
            try:
                self._source().invalidate()
            except Exception:  # noqa: BLE001
                pass
            fresh = self.token()
            ok = bool(fresh) and fresh != rejected and self._token_not_known_bad(fresh)
            with self._lock:
                # a proactive look-ahead that finds nothing newer is not a failure: the current token still works
                self._refresh_status = "renewed" if ok else ("idle" if proactive else "failed")
                self._last_refresh_at = self._clock()
            log.info("IMD token renewal %s (value not logged)", "succeeded" if ok else "found no newer token")
            return fresh if ok else None

    def _token_not_known_bad(self, token: str) -> bool:
        if malformed_reason(token):
            return False
        with self._lock:
            if fingerprint(token) in self._rejected:
                return False
        exp = jwt_expiry(token)
        return exp is None or exp > self._clock()

    def token_for_request(self) -> Optional[str]:
        """The token to send now. If the current one is KNOWN to be unusable (rejected by IMD, or its own `exp`
        has passed), renew first -- proactively, before IMD has to say 401."""
        tok = self.token()
        if tok and self._token_not_known_bad(tok):
            exp = jwt_expiry(tok)
            if exp is not None and exp - self._clock() <= EXPIRING_SOON_S:
                # EXPIRING_SOON: look for a newer token before this one lapses; keep using it if there is none
                return self.renew(tok, proactive=True) or tok
            return tok
        return self.renew(tok)

    # ------------------------------------------------------------------ credentials (server-side only)
    def api_key(self) -> Optional[str]:
        return os.environ.get(KEY_ENV) or None       # config.py already loaded .env into the environment

    def _source(self) -> TokenSource:
        # rebuilt per call (cheap) so IMD_TOKEN_PROVIDER / IMD_API_TOKEN_FILE changes take effect without restart;
        # the AWS source keeps its cache on the class instance it owns, so it is built once per configuration
        if self._explicit_source is not None:
            return self._explicit_source
        kind = (os.environ.get("IMD_TOKEN_PROVIDER") or "env", os.environ.get("IMD_API_TOKEN_FILE"))
        with self._lock:
            if getattr(self, "_source_key", None) != kind:
                self._source_obj, self._source_key = build_source(self._dotenv), kind
            return self._source_obj

    def _locate(self) -> Optional[TokenReading]:
        if self._runtime is not None:
            return self._runtime
        return self._source().read()

    def token(self) -> Optional[str]:
        r = self._locate()
        if r is None or malformed_reason(r.value):
            return None                                  # a malformed token is never sent
        with self._lock:
            self._first_seen.setdefault(fingerprint(r.value), self._clock())
        return r.value

    def set_runtime_token(self, token: str) -> None:
        """Rotate the token in the running process (admin endpoint). Also rewrites IMD_API_TOKEN_FILE when one is
        configured, so the rotation survives a restart."""
        token = token.strip()
        with self._lock:
            self._runtime = TokenReading(token, "runtime (admin endpoint)", self._clock())
        path = os.environ.get("IMD_API_TOKEN_FILE")
        if path:
            try:
                Path(path).write_text(token, encoding="utf-8")
            except OSError:
                log.warning("token accepted in memory but the token file could not be written")
        log.info("IMD token rotated at run time (value not logged)")

    def reset(self) -> None:
        """Forget everything learned at run time (test isolation; also used after an admin rotation)."""
        with self._lock:
            self._runtime = self._last_ok_at = None
            self._first_seen.clear()
            self._rejected.clear()
            self._rejected_keys.clear()
            self._source_key = None
            self._refresh_status, self._last_refresh_at = "idle", None

    # ------------------------------------------------------------------ what IMD told us
    def report_success(self) -> None:
        with self._lock:
            self._last_ok_at = self._clock()

    def report_auth_failure(self, token: Optional[str], status_code: int = 401) -> None:
        """401 -> this token is rejected. 403 -> the key / server IP is rejected (a new token would not help)."""
        with self._lock:
            if status_code == 403:
                key = self.api_key()
                if key:
                    self._rejected_keys[fingerprint(key)] = self._clock()
            elif token:
                self._rejected[fingerprint(token)] = self._clock()

    # ------------------------------------------------------------------ state
    def status(self) -> TokenStatus:
        s = self._status()
        with self._lock:
            s.refresh_status, s.last_refresh_at = self._refresh_status, self._last_refresh_at
        return s

    def _status(self) -> TokenStatus:
        key = self.api_key()
        reading = self._locate()
        now = self._clock()
        tok = reading.value if reading else None
        source = reading.source if reading else None
        with self._lock:
            last_ok = self._last_ok_at
            key_rejected_at = self._rejected_keys.get(fingerprint(key)) if key else None
            fp = fingerprint(tok)
            rejected_at = self._rejected.get(fp) if fp else None
            if tok and not malformed_reason(tok):
                self._first_seen.setdefault(fp, now)
            first_seen = self._first_seen.get(fp) if fp else None

        if not key or not tok:
            missing = [n for n, ok in ((KEY_ENV, bool(key)), (TOKEN_ENV, bool(tok))) if not ok]
            return TokenStatus(UNAVAILABLE, f"{' and '.join(missing)} not available on the server", source, None,
                               "unknown", None, bool(key), last_ok, None)
        bad = malformed_reason(tok)
        if bad:
            return TokenStatus(UNAVAILABLE, f"{bad}; it was not sent to IMD", source, None, "unknown", None, True,
                               last_ok, None)
        if key_rejected_at is not None:
            return TokenStatus(UNAVAILABLE, "IMD refused the API key or this server's IP (HTTP 403); a new token will "
                               "not fix this -- check the key's IP binding", source, None, "unknown", None, True,
                               last_ok, key_rejected_at, "key_or_ip")
        if rejected_at is not None:
            return TokenStatus(EXPIRED, "IMD rejected this token (HTTP 401); rotate it (docs/DEPLOYMENT.md)", source,
                               None, "unknown", 0.0, True, last_ok, rejected_at, "token")
        exp = jwt_expiry(tok)
        basis = "jwt_exp"
        if exp is None:
            try:
                ttl_s = float(os.environ.get(TTL_ENV, DEFAULT_TTL_MIN)) * 60.0
            except ValueError:
                ttl_s = DEFAULT_TTL_MIN * 60.0
            dated = reading.dated if reading.dated is not None else first_seen
            exp, basis = dated + ttl_s, "loaded_at+ttl"
        left = exp - now
        if left <= 0:
            note = "token lifetime elapsed" if basis == "jwt_exp" else "assumed token lifetime elapsed (not confirmed by IMD)"
            return TokenStatus(EXPIRED, f"{note}; rotate it (docs/DEPLOYMENT.md)", source, exp, basis, left, True,
                               last_ok, None)
        state = EXPIRING_SOON if left <= EXPIRING_SOON_S else VALID
        return TokenStatus(state, "expiry read from the token" if basis == "jwt_exp"
                           else "expiry estimated from when the token was loaded", source, exp, basis, left, True,
                           last_ok, None)

    def usable(self) -> bool:
        """False only when a request is certain to fail: nothing configured, malformed, key/IP refused, this exact
        token already rejected, or a real JWT `exp` in the past. An ESTIMATED expiry never blocks a request --
        IMD's answer is the authority."""
        s = self.status()
        if s.state == UNAVAILABLE or s.last_rejected_at is not None:
            return False
        return not (s.state == EXPIRED and s.expiry_basis == "jwt_exp")


manager = IMDTokenManager()
