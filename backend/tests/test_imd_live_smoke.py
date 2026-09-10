"""Opt-in LIVE integration smoke test for IMDObservationProvider -- NOT run by a normal `pytest` invocation.

Per the live-rainfall task: "Add a live integration smoke test that is opt-in and does NOT run in normal
pytest." This module is skipped entirely unless IMD_API_KEY is actually set in the environment (or .env),
i.e. unless someone has genuinely obtained IMD credentials (see docs/LIVE_RAINFALL_AUDIT.md -- this is a
manual, non-self-service registration process; no key was available while building this integration, so
this test has NOT been executed against the real IMD API in this session and that is stated plainly rather
than faked).

Run explicitly once a real key is configured:
    cd backend && .venv/Scripts/python.exe -m pytest tests/test_imd_live_smoke.py -v -m live
"""
from __future__ import annotations

import os

import pytest

from floodnet.rainfall.provider import LIVE_ID, IMDObservationProvider, ProviderUnavailable

# IMD's platform requires BOTH credentials (X-API-Key AND Authorization: Bearer <JWT>) -- they are different
# values, and a key-only configuration is rejected with HTTP 401 "Authorization header missing or invalid".
# Skip unless both are present, so this test only ever runs against a genuinely complete credential set.
pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(not (os.environ.get("IMD_API_KEY") and os.environ.get("IMD_API_TOKEN")),
                       reason="IMD_API_KEY and/or IMD_API_TOKEN not configured; see docs/LIVE_RAINFALL_AUDIT.md"),
]


def test_live_fetch_returns_a_plausible_mumbai_observation():
    prov = IMDObservationProvider()
    try:
        scen, meta = prov.get()
    except ProviderUnavailable as e:
        pytest.fail(f"IMD credentials were set but the live call still failed -- report this, don't silence "
                    f"it (the message names which credential IMD rejected, if that was the cause): {e}")
    assert scen.id == LIVE_ID
    assert meta.source_type == "live_observation"
    # sanity bounds on the observed 24h total this normalises from, not a guess at today's actual weather
    assert 0.0 <= float(scen.intensity_mm_h[0]) * 24.0 <= 500.0, "24h total outside a physically plausible range for Mumbai"
    print(f"\nLIVE IMD fetch OK: {meta.source_name} @ {meta.timestamp} -> {scen.provenance.note}")


def test_live_scenario_drives_a_real_floodnet_run():
    """End-to-end: LIVE input all the way through the unmodified simulation engine, on the real pilot."""
    from floodnet.data.load import load_pilot
    from floodnet.drainage.hydraulics import GraphDrainage
    from floodnet.simulation.engine import run_simulation
    from floodnet.streets.aggregate import make_street_fn
    from floodnet.terrain.runoff import runoff_fn
    from floodnet.terrain.surface import StorageCellSurface

    try:
        pilot = load_pilot()
    except Exception:
        pytest.skip("real pilot data not built")
    scen, meta = IMDObservationProvider().get()
    street_fn = make_street_fn(pilot["roads"], pilot["terrain"].grid)
    res = run_simulation(pilot["terrain"], pilot["net"], scen,
                         StorageCellSurface(pilot["terrain"], open_boundary=True), GraphDrainage(pilot["net"]),
                         runoff_fn, street_fn=street_fn, horizon_s=1800, frame_dt_s=300)
    assert len(res.frames) >= 2
    assert abs(res.mass_balance.error_pct) < 0.1
    assert res.provenance["rainfall"]["tag"] == "ESTIMATED"
    print(f"\nLIVE-driven FloodNet run OK: run_id={res.run_id}, mass-balance error={res.mass_balance.error_pct:.2e}%")
