import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useDesktopLayout } from '../lib/responsive';
import Input from '../components/Input';
import Button from '../components/Button';
import Icon from '../components/Icon';
import { Cartao, Surgir, Tela, TituloPagina } from '../components/ui';
import { AvatarAnel } from './ProfileScreen';

export default function EditProfileScreen({ navigation }: any) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { user, profile, refreshProfile } = useAuth();
  const desktop = useDesktopLayout();

  const [nome, setNome] = useState(profile?.nome || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    if (profile) {
      setNome(profile.nome || '');
      setAvatarUrl(profile.avatar_url || '');
    }
  }, [profile]);

  const handleSave = async () => {
    if (!user?.id) return;
    if (!nome.trim()) {
      setFeedback({ type: 'error', msg: 'Informe um nome.' });
      return;
    }
    setSaving(true);
    setFeedback(null);

    // upsert garante criar caso o trigger ainda não tenha rodado
    const { error } = await supabase
      .from('profiles')
      .upsert(
        {
          id: user.id,
          nome: nome.trim(),
          avatar_url: avatarUrl.trim() || null,
        },
        { onConflict: 'id' }
      );

    setSaving(false);
    if (error) {
      console.warn('[Routify] Falha ao salvar o perfil:', error.message);
      setFeedback({ type: 'error', msg: 'Não foi possível salvar o perfil. Tente de novo.' });
      return;
    }
    await refreshProfile();
    setFeedback({ type: 'success', msg: 'Perfil salvo.' });
  };

  const initial = (nome || user?.email || 'U')[0]?.toUpperCase();
  const corAviso = feedback?.type === 'success' ? c.success : c.danger;

  return (
    <Tela voltar={() => navigation.goBack()}>
          <View style={styles.coluna}>
            <Surgir>
              <TituloPagina titulo="Editar perfil" />
            </Surgir>

            <Surgir ordem={1} style={{ marginTop: 24 }}>
              <Cartao>
                <View style={styles.identidade}>
                  <AvatarAnel letra={initial} tamanho={56} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[theme.typography.micro, { color: c.textSubtle, textTransform: 'uppercase' }]}>
                      E-mail
                    </Text>
                    <Text style={[theme.typography.bodyMd, { color: c.text, marginTop: 2 }]} numberOfLines={1}>
                      {user?.email}
                    </Text>
                  </View>
                </View>

                <View style={[styles.divisor, { backgroundColor: c.border }]} />

                <Input
                  label="Nome"
                  iconLeft="ion:person-outline"
                  placeholder="Seu nome"
                  value={nome}
                  onChangeText={setNome}
                />
                <Input
                  label="URL do avatar (opcional)"
                  iconLeft="ion:eye-outline"
                  placeholder="https://..."
                  value={avatarUrl}
                  onChangeText={setAvatarUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                />

                {feedback ? (
                  <View
                    accessibilityLiveRegion="polite"
                    style={[styles.aviso, { borderColor: corAviso, backgroundColor: c.surfaceAlt }]}
                  >
                    <Icon
                      name={feedback.type === 'success' ? 'ion:checkmark-circle' : 'ion:close'}
                      size={16}
                      color={corAviso}
                    />
                    <Text style={[theme.typography.caption, { color: corAviso, flex: 1 }]}>{feedback.msg}</Text>
                  </View>
                ) : null}

                <Button
                  label="Salvar"
                  variant="primary"
                  fullWidth={!desktop}
                  size="lg"
                  loading={saving}
                  onPress={handleSave}
                  style={{ marginTop: 8 }}
                />
              </Cartao>
            </Surgir>
          </View>
    </Tela>
  );
}

const styles = StyleSheet.create({
  coluna: { width: '100%', maxWidth: 640 },
  identidade: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  divisor: { height: 1, marginVertical: 20 },
  aviso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
  },
});
