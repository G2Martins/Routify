# Build a partir da RAIZ do repo (a imagem precisa de apps/api + ml/artifacts):
#   docker build -f apps/api/Dockerfile -t routify-api .
# Credenciais entram por variável de ambiente (--env-file), nunca na imagem.
FROM python:3.11-slim

# Mesmo layout do monorepo: main.py lê ../../ml/artifacts
WORKDIR /app/apps/api

COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/api/ .
COPY ml/artifacts/ /app/ml/artifacts/

# LIA_VERSION: default único no main.py (lia_2.2); rollback com -e LIA_VERSION=lia_2.1.
ENV TZ=America/Sao_Paulo

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
