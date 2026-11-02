import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase, ProfileRow } from '../lib/supabase';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: ProfileRow | null;
  loading: boolean;
  /** Só para mostrar/esconder UI. Quem garante o acesso é o banco (RLS/RPC) e a API. */
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, nome: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Tem 2º fator (TOTP) verificado e a sessão ainda é só senha (aal1): falta a etapa 2 do login.
   *  Porta da interface; quem barra de fato é o banco (aal_ok() nas policies) e a API. */
  mfaPendente: boolean;
  /** Relê o nível de garantia (depois de verificar, ativar ou desativar o 2º fator). */
  atualizarAal: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaPendente, setMfaPendente] = useState(false);
  const [aalPronto, setAalPronto] = useState(false);

  // Lê do próprio JWT e dos fatores da sessão (sem rede). Em erro, não trava a interface: o
  // banco e a API seguem exigindo aal2 de quem tem o 2º fator.
  const atualizarAal = async () => {
    try {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      setMfaPendente(!!data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2');
    } catch {
      setMfaPendente(false);
    } finally {
      setAalPronto(true);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    setProfile((data as ProfileRow) || null);
  };

  useEffect(() => {
    if (!session) {
      setMfaPendente(false);
      setAalPronto(true);
      return;
    }
    setAalPronto(false);
    atualizarAal();
  }, [session?.access_token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (session?.user?.id) {
      fetchProfile(session.user.id);
    } else {
      setProfile(null);
    }
  }, [session?.user?.id]);

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp: AuthContextValue['signUp'] = async (email, password, nome) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { nome } },
    });
    return { error: error?.message ?? null };
  };

  const signOut: AuthContextValue['signOut'] = async () => {
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (session?.user?.id) await fetchProfile(session.user.id);
  };

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    profile,
    loading: loading || (!!session && !aalPronto),
    isAdmin: session?.user?.app_metadata?.role === 'admin',
    signIn,
    signUp,
    signOut,
    refreshProfile,
    mfaPendente,
    atualizarAal,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
