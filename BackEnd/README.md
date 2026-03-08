📦 Routify/BackEnd
 ┣ 📂 config
 ┃ ┣ 📜 .env                 # Credenciais do Supabase
 ┃ ┗ 📜 tomtom_keys.json     # chave da API do TomTom
 ┣ 📂 models                 
 ┃ ┗ 📜 db_manager.py        # Único arquivo que conversa com o Supabase
 ┣ 📂 services               
 ┃ ┣ 📜 map_extractor.py     # Lógica isolada de baixar e processar o mapa
 ┃ ┗ 📜 traffic_collector.py # Lógica isolada de requisição para o TomTom
 ┣ 📜 .gitignore
 ┣ 📜 requirements.txt
 ┣ 📜 README.md
 ┗ 📜 main.py  