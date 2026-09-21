"""Server-side IMD credential + token-state manager.

THE PROBLEM: api.imd.gov.in needs an IP-bound key (X-API-Key) AND a short-lived bearer token that the portal
issues after a password + CAPTCHA login. The token expires roughly hourly. There is NO documented refresh
endpoint and none is assumed here; this module never logs in, never touches the CAPTCHA, and never claims a
token was renewed. It only:

  * loads credentials server-side (never sent to, or readable by, the browser);
  * hot-reloads the token without a restart or a frontend rebuild, from (in priority order)
        1. a token set at run time through the protected admin endpoint,
        2. IMD_API_TOKEN_FILE  -- a file holding just the token (rotate by overwriting it),
        3. the repo-root .env   -- re-read when its mtime changes,
        4. the process environment (IMD_API_TOKEN);
  * works out expiry where that is knowable: a real JWT's `exp` claim, else (token-file / .env mtime or the time
    the value was first seen) + IMD_TOKEN_TTL_MIN (default 60 -- an ASSUMPTION, reported as such);
  * remembers what IMD itself last said: a 401/403 marks the CURRENT token value as rejected until it changes;
  * reports one of four states -- valid | expiring_soon | expired | unavailable -- plus how it knows.

Nothing here ever returns, logs or raises a credential value; `fingerprint()` is a short SHA-256 prefix for
"did the token change?" comparisons only.
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

log = logging.getLogger(__name__)

KEY_ENV, TOKEN_ENV, TOKEN_FILE_ENV, TTL_ENV = "IMD_API_KEY", "IMD_API_TOKEN", "IMD_API_TOKEN_FILE", "IMD_TOKEN_TTL_MIN"
DEFAULT_TTL_MIN = 60.0
EXPIRING_SOON_S = 10 * 60

VALID, EXPIRING_SOON, EXPIRED, UNAVAILABLE = "valid", "expiring_soon", "expired", "unavailable"


def fingerprint(secret: Optional[str]) -> Optional[str]:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()[:10] if secret else None


def jwt_expiry(token: str) -> Optional[float]:
    """`exp` (epoch seconds) if `token` is a parseable JWT; None otherwise. The signature is never checked --
    this is a scheduling hint, not authentication."""
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
        exp = payload.get("exp")
        return float(exp) if isinstance(exp, (int, float)) else None
    except Exception:  # noqa: BLE001 -- not a JWT we can read; expiry simply stays unknown
        return None


def _read_dotenv_value(path: Path, name: str) -> Optional[str]:
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith(name + "="):
                return line.partition("=")[2].strip().strip('"').strip("'") or None
    except OSError:
        return None
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

    def to_public_dict(self) -> dict:
        """Safe for an API response: states and times only, never a credential or a fingerprint."""
        iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t)) if t else None  # noqa: E731
        return {"state": self.state, "detail": self.detail, "token_source": self.source,
                "key_configured": self.key_configured, "expires_at": iso(self.expires_at),
                "expiry_basis": self.expiry_basis,
                "minutes_left": None if self.seconds_left is None else round(self.seconds_left / 60.0, 1),
                "last_accepted_at": iso(self.last_ok_at), "last_rejected_at": iso(self.last_rejected_at),
                "auto_renewal": False}


class IMDTokenManager:
    def __init__(self, dotenv_path: Optional[Path] = None, clock=time.time):
        self._dotenv = dotenv_path if dotenv_path is not None else config.REPO_DIR / ".env"
        self._dotenv_token_at_start = _read_dotenv_value(self._dotenv, TOKEN_ENV)
        self._clock = clock
        self._lock = threading.Lock()
        self._runtime_token: Optional[str] = None
        self._runtime_set_at: Optional[float] = None
        self._first_seen: dict[str, float] = {}        # fingerprint -> when this value was first observed
        self._rejected: dict[str, float] = {}           # fingerprint -> when IMD rejected it
        self._last_ok_at: Optional[float] = None

    # ------------------------------------------------------------------ credentials (server-side only)
    def api_key(self) -> Optional[str]:
        return os.environ.get(KEY_ENV) or None      # config.py already loaded .env into the environment

    def _locate_token(self) -> tuple[Optional[str], Optional[str], Optional[float]]:
        """(token, source label, time the value is known to date from)."""
        if self._runtime_token:
            return self._runtime_token, "runtime (admin endpoint)", self._runtime_set_at
        path = os.environ.get(TOKEN_FILE_ENV)
        if path:
            try:
                p = Path(path)
                tok = p.read_text(encoding="utf-8").strip()
                if tok:
                    return tok, "token file", p.stat().st_mtime
            except OSError:
                log.warning("%s is set but the file could not be read", TOKEN_FILE_ENV)
        env_tok = os.environ.get(TOKEN_ENV) or None
        if env_tok is None:
            return None, None, None
        # config.py copied .env into the environment once, at import. If the environment still holds THAT value,
        # the token came from .env -- so re-read the file: editing .env is then a hot reload, no restart. An
        # explicitly set environment variable (Docker --env, a test) differs from it and always wins.
        if env_tok == self._dotenv_token_at_start:
            live = _read_dotenv_value(self._dotenv, TOKEN_ENV)
            if live:
                return live, ".env", None
        return env_tok, "environment", None

    def token(self) -> Optional[str]:
        tok, _, _ = self._locate_token()
        if tok:
            with self._lock:
                self._first_seen.setdefault(fingerprint(tok), self._clock())
        return tok

    def set_runtime_token(self, token: str) -> None:
        """Rotate the token in the running process (admin endpoint). Also rewrites IMD_API_TOKEN_FILE when one
        is configured, so the rotation survives a restart."""
        token = token.strip()
        with self._lock:
            self._runtime_token, self._runtime_set_at = token, self._clock()
        path = os.environ.get(TOKEN_FILE_ENV)
        if path:
            try:
                Path(path).write_text(token, encoding="utf-8")
            except OSError:
                log.warning("token accepted in memory but %s could not be written", TOKEN_FILE_ENV)
        log.info("IMD token rotated at run time (value not logged)")

    def reset(self) -> None:
        """Forget everything learned at run time (test isolation; also used after an admin rotation)."""
        with self._lock:
            self._runtime_token = self._runtime_set_at = self._last_ok_at = None
            self._first_seen.clear()
            self._rejected.clear()

    # ------------------------------------------------------------------ what IMD told us
    def report_success(self) -> None:
        with self._lock:
            self._last_ok_at = self._clock()

    def report_auth_failure(self, token: Optional[str]) -> None:
        if token:
            with self._lock:
                self._rejected[fingerprint(token)] = self._clock()

    # ------------------------------------------------------------------ state
    def status(self) -> TokenStatus:
        key = bool(self.api_key())
        tok, source, dated = self._locate_token()
        now = self._clock()
        with self._lock:
            last_ok = self._last_ok_at
            fp = fingerprint(tok)
            if tok:
                self._first_seen.setdefault(fp, now)
            rejected_at = self._rejected.get(fp) if fp else None
            first_seen = self._first_seen.get(fp) if fp else None
        if not key or not tok:
            missing = [n for n, ok in ((KEY_ENV, key), (TOKEN_ENV, bool(tok))) if not ok]
            return TokenStatus(UNAVAILABLE, f"{' and '.join(missing)} not configured on the server", source, None,
                               "unknown", None, key, last_ok, None)
        if rejected_at is not None:
            return TokenStatus(EXPIRED, "IMD rejected this token; rotate it (docs/DEPLOYMENT.md)", source, None,
                               "unknown", 0.0, key, last_ok, rejected_at)
        exp = jwt_expiry(tok)
        basis = "jwt_exp"
        if exp is None:
            try:
                ttl_s = float(os.environ.get(TTL_ENV, DEFAULT_TTL_MIN)) * 60.0
            except ValueError:
                ttl_s = DEFAULT_TTL_MIN * 60.0
            exp, basis = (dated if dated is not None else first_seen) + ttl_s, "loaded_at+ttl"
        left = exp - now
        if left <= 0:
            note = "token lifetime elapsed" if basis == "jwt_exp" else "assumed token lifetime elapsed (not confirmed by IMD)"
            return TokenStatus(EXPIRED, f"{note}; rotate it (docs/DEPLOYMENT.md)", source, exp, basis, left, key, last_ok, None)
        state = EXPIRING_SOON if left <= EXPIRING_SOON_S else VALID
        return TokenStatus(state, "expiry read from the token" if basis == "jwt_exp"
                           else "expiry estimated from when the token was loaded", source, exp, basis, left, key,
                           last_ok, None)

    def usable(self) -> bool:
        """False only when a request is certain to fail (nothing configured, or IMD already rejected this exact
        token). An ESTIMATED expiry never blocks a request -- IMD's answer is the authority."""
        s = self.status()
        if s.state == UNAVAILABLE or s.last_rejected_at is not None:
            return False
        return not (s.state == EXPIRED and s.expiry_basis == "jwt_exp")     # a real `exp` in the past is certain


manager = IMDTokenManager()
