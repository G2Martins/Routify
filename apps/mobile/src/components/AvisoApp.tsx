/**
 * Banner de aviso/manutenção publicado pelo painel ADM (tabela avisos_app;
 * a policy só entrega os vigentes). Texto renderizado como texto — nunca HTML.
 * Some ao fechar (até o próximo aviso) e relê a cada 5 min.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import Icon from './Icon';

interface Aviso {
  id: string;
  mensagem: string;
  nivel: 'info' | 'alerta' | 'manutencao';
}

const RELER_MS = 5 * 60 * 1000;

export default function AvisoApp() {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [fechados, setFechados] = useState<string[]>([]);

  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      const { data, error } = await supabase
        .from('avisos_app')
        .select('id, mensagem, nivel')
        .order('criado_em', { ascending: false })
        .limit(1);
      // Sem a migration de ações ADM a tabela não existe: segue sem banner.
      if (vivo && !error) setAviso((data?.[0] as Aviso) ?? null);
    };
    ler();
    const id = setInterval(ler, RELER_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);

  if (!aviso || fechados.includes(aviso.id)) return null;

  const cor = { info: c.accent, alerta: c.warning, manutencao: c.danger }[aviso.nivel] ?? c.accent;
  const icone = { info: 'ion:information-circle', alerta: 'ion:warning-outline', manutencao: 'ion:construct-outline' }[aviso.nivel];

  return (
    <View
      pointerEvents="box-none"
      style={[styles.envelope, { top: insets.top + 8 }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View
        style={[
          styles.banner,
          { backgroundColor: c.surface, borderColor: c.border, borderLeftColor: cor, boxShadow: `0 10px 30px ${c.shadowMedium}` },
        ]}
      >
        <Icon name={icone} size={18} color={cor} />
        <Text style={[theme.typography.caption, { color: c.text, flex: 1 }]}>{aviso.mensagem}</Text>
        <Pressable
          onPress={() => setFechados((f) => [...f, aviso.id])}
          accessibilityRole="button"
          accessibilityLabel="Fechar aviso"
          hitSlop={8}
        >
          <Icon name="ion:close" size={16} color={c.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  envelope: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50, paddingHorizontal: 16 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 640,
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 4,
  },
});
