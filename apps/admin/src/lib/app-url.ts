/**
 * Onde fica o app (Expo web) que é dono do login. Em produção é o mesmo domínio
 * (`/`); em dev, o Expo roda no :8081 e compartilha o cookie de sessão com o :3000
 * (cookie não separa por porta).
 */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:8081';
