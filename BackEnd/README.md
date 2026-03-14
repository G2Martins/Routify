<div align="center">
  <img src="Servidor/Logo_Routify.png" alt="Routify Logo" width="350"/>

  # Routify - Back-End (Servidor de Coleta e Roteamento)
  
  <img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/TomTom-E50000?style=for-the-badge&logo=tomtom&logoColor=white" alt="TomTom" />
</div>

<br/>

## 🏗️ Arquitetura do Diretório
```text
📦 BackEnd
 ┣ ...
 ┗ 📂 Servidor
   ┣ 📂 config
   ┃ ┣ 📜 .env                 # Variáveis de ambiente (Supabase URL/Key)
   ┃ ┗ 📜 tomtom_keys.json     # Pool de chaves da API TomTom
   ┣ 📂 models
   ┃ ┗ 📜 db_manager.py        # Conexão e queries em lote para o Supabase
   ┣ 📂 services
   ┃ ┣ 📜 map_extractor.py     # Lógica de extração OpenStreetMap (Overpass)
   ┃ ┗ 📜 traffic_collector.py # Lógica de consumo da API TomTom
   ┣ 📜 main.py                # Ponto de entrada e orquestrador (Scheduler)
   ┣ 📜 requirements.txt       # Dependências do projeto
   ┗ 📜 .gitignore
```


<div align="center">
  <img src="Servidor/Logo_Routify.png" alt="Routify Logo" width="350"/>

 <i>Desenvolvido para o avanço em Cidades Inteligentes e Logística Preditiva.</i>
</div>