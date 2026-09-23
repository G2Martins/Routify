# Deploy 24/7 — Oracle Cloud Free Tier (Ampere A1)

Por que Oracle e não outra gratuita: é a única opção gratuita que dá uma VM
de verdade (não um serviço que hiberna por inatividade) com RAM suficiente
para o pico de ~1,4GB da Fase 3 (grafo de 38km carregado a cada rodada
agendada) rodando ao lado do coletor. O tier "Always Free" da Oracle não tem
prazo de expiração (diferente do free tier de 12 meses da AWS), e o formato
Ampere A1 dá até 4 OCPU / 24GB RAM de graça, permanentemente, por conta.

## 1. Criar a conta e a instância

1. Criar conta em cloud.oracle.com (pede cartão para verificação de
   identidade, mas o Always Free não cobra nada enquanto você ficar dentro
   da cota).
2. Criar uma Compute Instance:
   - **Shape:** `VM.Standard.A1.Flex` (Ampere, ARM64) — usar os 4 OCPU / 24GB
     inteiros, já que é gratuito de qualquer forma.
   - **Imagem:** Ubuntu 22.04 (ou mais recente) — ARM64.
   - **Boot volume:** o padrão (~50GB) sobra; o tier free cobre até 200GB.
3. **Armadilha conhecida:** provisionar Ampere A1 costuma dar erro "Out of
   host capacity" nas regiões mais procuradas — é falta de capacidade da
   Oracle, não erro seu. Tente outro Availability Domain, outra região
   próxima (ex. se `sa-saopaulo-1` estiver cheia, tentar outra região da
   América do Sul), ou tentar de novo em horários diferentes. É um
   incômodo real e documentado, não um sinal de que algo está configurado
   errado.
4. Gerar/usar um par de chaves SSH na criação — é o único acesso à VM.

## 2. Configuração inicial da VM

```bash
ssh ubuntu@<IP_DA_VM>

# Fuso horário — importante: schedule.every().day.at("07:00") no main.py
# usa o horário local do processo. Sem isso, os horários de pico/fora-pico
# da Fase 3 disparam no horário errado (UTC, 3h à frente de Brasília).
sudo timedatectl set-timezone America/Sao_Paulo

sudo apt update && sudo apt install -y python3.12 python3.12-venv git
```

## 3. Levar o código

Do jeito mais simples — `git clone` do repositório na VM (a Fase 3 importa
`ml/` e `apps/api/`, então o coletor precisa do repositório inteiro). Não copiar `.env` nem `tomtom_keys.json` pelo git se o repo for
público — transferir esses dois arquivos separadamente (scp direto) para
`services/collector/config/` (a API e o `ml/` leem esse mesmo arquivo).

```bash
# na VM, depois do clone em ~/Routify/
cd ~/Routify/services/collector
python3.12 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r deploy/requirements-vm.txt
```

**Ponto de atenção real, não hipotético:** os pacotes acima estão travados
nas mesmas versões que serializaram os pickles do modelo (ver comentário em
`apps/api/requirements.txt`). Numa VM ARM64, é preciso confirmar que o PyPI tem
wheel `manylinux...aarch64` para essas versões exatas — a maioria
(numpy/pandas/scipy/scikit-learn/xgboost) publica wheel ARM64 nas versões
recentes usadas aqui, mas se algum `pip install` cair para compilar do
código-fonte, vai ser bem mais lento (às vezes falha por falta de
dependência de build). Rode o `pip install` **primeiro**, antes de
configurar o resto — se algo não tiver wheel ARM64, é melhor descobrir logo
no início.

## 4. Rodar como serviço (systemd)

```bash
sudo useradd -m -s /bin/bash routify   # se ainda não existir
sudo cp ~/Routify/services/collector/deploy/routify-collector.service \
        /etc/systemd/system/
# editar User= e os caminhos dentro do .service se o usuário/diretório
# real na VM for diferente do exemplo (routify / /home/routify/Routify)

sudo systemctl daemon-reload
sudo systemctl enable --now routify-collector
sudo systemctl status routify-collector
journalctl -u routify-collector -f       # acompanhar logs ao vivo
```

`Restart=always` no unit file garante que, se o processo cair por qualquer
motivo (exceção não tratada, OOM), ele volta sozinho — sem precisar você
ficar reiniciando manualmente, que era exatamente o problema original com a
rotação de chaves.

## 5. Verificar que está funcionando

```bash
journalctl -u routify-collector --since "10 min ago" | grep -i "coleta\|rotacion\|fase 3"
```

- A cada 8 min deve aparecer o ciclo de coleta de tráfego.
- Às 07h/12h/18h/22h (horário de Brasília, depois do `timedatectl` acima)
  deve rodar a Fase 3 — procurar por "FASE 3 — Comparação" no log.
- Se alguma chave TomTom esgotar, o log mostra "esgotada — marcada por 24h"
  e continua rotacionando pelas outras, sem travar.

## 6. Custo de rede/egress

O tier Always Free inclui 10TB/mês de saída de dados — o volume desta
aplicação (chamadas de API + Supabase) fica ordens de grandeza abaixo disso.
Não é uma preocupação real aqui.
