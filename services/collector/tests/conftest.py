"""Ambiente dos testes do coletor: sem rede, sem banco, sem segredo.

- SUPABASE_URL/KEY falsos (db.py exige na importação; o cliente só nasce em get_client()).
- TOMTOM_KEYS_FILE aponta pra um JSON temporário com 3 chaves falsas.
- `supabase` vira um módulo vazio se não estiver instalado (CI instala só o mínimo).
"""
import json
import os
import sys
import tempfile
import types

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)

os.environ.setdefault('SUPABASE_URL', 'http://supabase.invalido')
os.environ.setdefault('SUPABASE_KEY', 'chave-de-teste')

_tmp = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8')
json.dump({'tomtom_keys': [{'id': f'k{i}', 'key': f'segredo{i}'} for i in range(1, 4)]}, _tmp)
_tmp.close()
os.environ['TOMTOM_KEYS_FILE'] = _tmp.name

try:
    import supabase  # noqa: F401
except ImportError:
    falso = types.ModuleType('supabase')
    falso.create_client = lambda *a, **k: None
    falso.Client = object
    sys.modules['supabase'] = falso
