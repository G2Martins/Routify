import pytest

import seguranca


@pytest.fixture(autouse=True)
def _limite_de_auth_limpo(monkeypatch):
    """O limite por IP antes do auth é global do módulo: cada teste começa do zero."""
    monkeypatch.setattr(seguranca, '_limite_auth_ip', seguranca.Limitador(60))
