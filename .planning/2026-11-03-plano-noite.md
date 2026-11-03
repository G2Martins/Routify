# Plano da noite 2026-11-02 → 03 (autônomo; dono dormindo)

**Última revisão:** 2026-11-02

Pedidos do dono (22:2x e 22:3x): retomar testes; novas telas no ADM e no app; testes até consistência (Playwright,
bateria de busca); `/admin/operacao` sincronizado com o estado real das chaves (coletor na AWS + API); tela de status
ao vivo (banco, API/LIA na AWS, Supabase/AWS/Hostinger); SEO + llms.txt no padrão do Valerium-Portal (só leitura);
segurança (URL do painel escondida, IDOR, CSP, XSS, race condition); ajustar grafo/cobertura à noite; ponytail no fim.
Bug relatado: Brasal → Park Shopping lento (32 s) e destino errado.

## Achados já confirmados (22:2x–22:4x)
- Destino errado: `route_history` do dono tem "Park Shopping" com a coordenada de São Sebastião (23–24/09, ranking
  antigo). O autocomplete põe destinos recentes ANTES da API, mesmo rótulo e sem bairro → erro se repete.
- Lentidão: as duas rotas > 10 s em 14 dias (41 s às 14:02 e 32 s às 22:18 de 02/11) vieram logo depois de build do
  front NA EC2 (t3.small 2 GB: a API vai pro swap). Normal: p50 2,5 s, p90 4,4 s. Mesmo par agora: 2,2 s.
- `claude-ops` sem CloudWatch, Cost Explorer e Free Tier: crédito de CPU e saldo de créditos não monitoráveis daqui.

## Ordem
- [ ] P0 autocomplete: recente herda bairro do item da API; homônimo do 1º da API vai depois dele (+ teste)
- [ ] P0 build do front fora da EC2 (GitHub Actions) + swappiness 10 na EC2 + tempo por etapa no /route
- [ ] P0 política IAM de leitura (CloudWatch/CE/Free Tier) + conta de crédito AWS para o dono decidir t3.medium/Unlimited
- [ ] P1 /admin/status ao vivo (API /admin/sistema + sondas) e /admin/operacao com uso real das chaves (coletor+API)
- [ ] P1 app: telas novas (planejar saída, trânsito agora)
- [ ] P1 SEO/llms.txt (subagente), Playwright (subagente), auditoria de segurança (subagente) → correções
- [ ] P1 bateria de busca em produção; grafo/cobertura (análise + candidato + A/B); ponytail no fim
- [ ] Deploys: tentar nas janelas livres (sem rodada do comparador: 03:00, 07:30); bloqueado → fila para a manhã
