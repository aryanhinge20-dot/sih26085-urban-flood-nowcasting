"""Shared test isolation: process-wide singletons that remember upstream failures must start clean per test."""
import pytest


@pytest.fixture(autouse=True)
def _reset_imd_token_manager():
    from floodnet.rainfall.imd_auth import manager
    manager.reset()
    yield
    manager.reset()


@pytest.fixture(autouse=True)
def _isolated_source_manager(monkeypatch):
    """`auto` runs must never read or write the real on-disk last-good cache during tests."""
    from floodnet.api import state
    from floodnet.rainfall.source_manager import SourceManager
    monkeypatch.setattr(state, "source_manager", SourceManager(cache_dir=None))
    yield
