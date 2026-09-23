"""Textos e metadados da documentação OpenAPI (Swagger em /docs, ReDoc em /redoc)."""

DESCRICAO = """
Motor de **roteamento preditivo** para Brasília/DF — TCC 2026.

A **LIA** (XGBoost) prevê a razão de congestionamento (`velocidade atual / velocidade livre`,
de 0,05 a 1,0) de cada via, e o **A\\*** escolhe a rota mais rápida num grafo OSM de 38 km.
A **TomTom** entra sob demanda, só no corredor da rota: leitura ao vivo das vias
desatualizadas, interdições e ETA de referência.

## Fluxo de uma rota

1. O app manda origem e destino para `POST /route`.
2. A API consulta a TomTom **em paralelo** no corredor (Flow Segment Data + Incident Details).
   A leitura ao vivo entra no cache de recência.
3. A LIA prevê o peso de **todas** as arestas numa chamada vetorizada. Vias sem sensor recebem
   o valor por transferência calibrada (isotônica) da via monitorada mais próxima (≤ 500 m).
4. O A\\* traça a rota sem as arestas interditadas e calcula, na mesma requisição, a rota de
   menor distância para comparação (validação da tese).

Sem chave TomTom, com a cota esgotada ou com a TomTom fora do ar, a rota sai **só com a LIA**
(`tomtom.degradado = true`). A API nunca falha por causa da TomTom.

## Autenticação

Token **JWT do Supabase** (`access_token` da sessão) no header `Authorization: Bearer <token>`.
Use o botão **Authorize** para testar aqui.

| Endpoint | Token |
|---|---|
| `POST /route`, `GET /search/places` | opcional (com token, o uso fica associado à conta) |
| `POST /eventos` | obrigatório |
| demais | não usa |

## Privacidade (LGPD)

A API grava o uso com a service_role. O cliente nunca escreve nessas tabelas.

- Origem e destino são arredondados em 3 casas (~110 m) antes de gravar.
- O texto digitado no autocomplete **não** é guardado.
- Eventos não aceitam coordenadas.
- Retenção de 90 dias.

## Erros

Todo erro devolve `{"detail": "..."}`. Validação de corpo (campo faltando, tipo errado ou
**campo extra**, porque os corpos são estritos) devolve `422` com a lista de problemas.
"""

TAGS = [
    {"name": "Roteamento", "description": "Rota A\\* com pesos da LIA + TomTom sob demanda."},
    {"name": "Autocomplete", "description": "Busca de endereços em cadeia: malha local → TomTom Search → Nominatim."},
    {"name": "LIA", "description": "Inferência do modelo para um trecho (debug e dashboards)."},
    {"name": "Uso", "description": "Eventos do app para a análise de uso do painel ADM."},
    {"name": "Sistema", "description": "Saúde da API e métricas do modelo carregado."},
]

SWAGGER_UI = {
    "docExpansion": "list",
    "defaultModelsExpandDepth": 0,
    "displayRequestDuration": True,
    "filter": True,
    "persistAuthorization": True,
    "tryItOutEnabled": True,
}


def erro(descricao: str, exemplo: str) -> dict:
    """Entrada de `responses=` para um erro {"detail": ...} com exemplo."""
    return {"description": descricao, "content": {"application/json": {"example": {"detail": exemplo}}}}
