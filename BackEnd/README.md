📦 Routify/BackEnd
 ┣ 📂 config
 ┃ ┣ 📜 .env                 # Credenciais do Supabase
 ┃ ┗ 📜 tomtom_keys.json     # Suas 10 chaves da API
 ┣ 📂 models                 # Equivalente aos "models" do Node
 ┃ ┗ 📜 db_manager.py        # Único arquivo que conversa com o Supabase
 ┣ 📂 services               # Equivalente aos "controllers" do Node
 ┃ ┣ 📜 map_extractor.py     # Lógica isolada de baixar e processar o mapa
 ┃ ┗ 📜 traffic_collector.py # Lógica isolada de bater na TomTom
 ┣ 📜 .gitignore
 ┣ 📜 requirements.txt
 ┣ 📜 README.md
 ┗ 📜 main.py                # Equivalente ao seu "app.js" ou "index.js"