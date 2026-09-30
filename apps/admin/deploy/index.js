// Entrada na Hostinger: o lsnode do LiteSpeed faz require() deste arquivo CJS e ele
// sobe o servidor standalone do Next (que lê PORT, injetada pelo host).
//
// HOSTNAME: o Next standalone escuta em process.env.HOSTNAME e a hospedagem
// compartilhada pode trazer o nome da máquina (não "bindável").
process.env.HOSTNAME = '0.0.0.0';

// Trava anti-zumbi: o Next ignora os sinais de parada que o LiteSpeed manda no
// restart, e cada deploy deixava o processo antigo vivo. No Valerium, 9 zumbis
// estouraram o teto de 120 processos da conta e derrubaram tudo (2026-08-06).
for (const sinal of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGUSR2']) {
  process.on(sinal, () => process.exit(0));
}

require('./server.js');
