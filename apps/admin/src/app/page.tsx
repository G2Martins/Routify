import { redirect } from 'next/navigation';

// ponytail: em dev a raiz só leva ao painel. No deploy (F10) a raiz passa a servir
// o export web do Expo, no mesmo domínio, para o cookie de sessão ser um só.
export default function Raiz() {
  redirect('/admin');
}
