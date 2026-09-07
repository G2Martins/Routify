import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import Input from '../components/Input';
import Button from '../components/Button';
import Icon from '../components/Icon';

export default function EditProfileScreen({ navigation }: any) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { user, profile, refreshProfile } = useAuth();

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
      setFeedback({ type: 'error', msg: 'Nome não pode ficar vazio.' });
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
      setFeedback({ type: 'error', msg: error.message });
      return;
    }
    await refreshProfile();
    setFeedback({ type: 'success', msg: 'Perfil atualizado com sucesso.' });
  };

  const initial = (nome || user?.email || 'U')[0]?.toUpperCase();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 60, paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => navigation.goBack()}
          style={[styles.back, { backgroundColor: c.surfaceAlt }]}
        >
          <Icon name="ion:arrow-back" size={20} color={c.text} />
        </Pressable>

        <Text style={[styles.title, { color: c.text }]}>Editar perfil</Text>
        <Text style={[styles.subtitle, { color: c.textMuted }]}>
          Atualize suas informações pessoais.
        </Text>

        <View style={styles.avatarRow}>
          <View style={[styles.avatar, { backgroundColor: c.inverse }]}>
            <Text style={{ color: c.onInverse, fontSize: 32, fontWeight: '700' }}>{initial}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={{ color: c.textMuted, fontSize: 13 }}>Email</Text>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '500' }}>{user?.email}</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.surfaceMuted }]}>
          <Input
            label="Nome de exibição"
            iconLeft="ion:person-outline"
            placeholder="Como devemos te chamar"
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
        </View>

        {feedback ? (
          <View
            style={[
              styles.feedback,
              {
                backgroundColor:
                  feedback.type === 'success' ? c.success + '22' : c.danger + '22',
              },
            ]}
          >
            <Icon
              name={feedback.type === 'success' ? 'ion:checkmark-circle' : 'ion:close'}
              size={16}
              color={feedback.type === 'success' ? c.success : c.danger}
            />
            <Text
              style={{
                color: feedback.type === 'success' ? c.success : c.danger,
                fontSize: 13,
                marginLeft: 8,
                flex: 1,
              }}
            >
              {feedback.msg}
            </Text>
          </View>
        ) : null}

        <Button
          label="Salvar alterações"
          variant="primary"
          fullWidth
          size="lg"
          loading={saving}
          onPress={handleSave}
          style={{ marginTop: 18 }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { fontSize: 32, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, marginTop: 6, marginBottom: 24 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { padding: 16, borderRadius: 14, borderWidth: 1 },
  feedback: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginTop: 14,
  },
});
