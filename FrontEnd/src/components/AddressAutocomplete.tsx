/**
 * Autocomplete de endereços que combina:
 *  - vias_monitoradas do Supabase (rotuladas como "LIA monitora")
 *  - Nominatim (OSM) para endereços genéricos
 *
 * Backend faz a fusão. Frontend só consome /search/places.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Input from './Input';
import Icon from './Icon';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((globalThis as any).__DEV__ ? 'http://localhost:8000' : 'https://routify-api.railway.app');

export interface PlaceSuggestion {
  label: string;
  sublabel: string;
  lat: number;
  lon: number;
  source: 'monitorada' | 'nominatim';
  id_ponto?: number;
}

interface Props {
  placeholder: string;
  iconLeft: string;
  value: string;
  onChangeText: (v: string) => void;
  onSelect: (p: PlaceSuggestion) => void;
}

export default function AddressAutocomplete({
  placeholder,
  iconLeft,
  value,
  onChangeText,
  onSelect,
}: Props) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<any>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value || value.trim().length < 3) {
      setItems([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${API_URL}/search/places?q=${encodeURIComponent(value)}&limit=8`
        );
        if (res.ok) {
          const data = await res.json();
          setItems(data);
          setOpen(true);
        }
      } catch {
        // ignora erro de rede no autocomplete
      } finally {
        setLoading(false);
      }
    }, 280);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  const handlePick = (item: PlaceSuggestion) => {
    onSelect(item);
    onChangeText(item.label);
    setOpen(false);
    setItems([]);
  };

  return (
    <View style={{ position: 'relative', zIndex: 50 }}>
      <Input
        placeholder={placeholder}
        iconLeft={iconLeft}
        value={value}
        onChangeText={(v) => {
          onChangeText(v);
          if (!open) setOpen(true);
        }}
        onFocus={() => items.length > 0 && setOpen(true)}
        autoCapitalize="words"
        autoCorrect={false}
      />

      {open && (loading || items.length > 0) ? (
        <View
          style={[
            styles.dropdown,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              shadowColor: '#000',
            },
          ]}
        >
          {loading ? (
            <View style={{ padding: 16, alignItems: 'center' }}>
              <ActivityIndicator color={c.text} />
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item, i) =>
                `${item.lat}_${item.lon}_${i}`
              }
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handlePick(item)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: pressed ? c.surfaceMuted : 'transparent',
                      borderBottomColor: c.surfaceMuted,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.iconBox,
                      {
                        backgroundColor:
                          item.source === 'monitorada' ? c.success + '22' : c.surfaceMuted,
                      },
                    ]}
                  >
                    <Icon
                      name={
                        item.source === 'monitorada'
                          ? 'ion:flash-outline'
                          : 'ion:location-outline'
                      }
                      size={16}
                      color={item.source === 'monitorada' ? c.success : c.textMuted}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{ color: c.text, fontSize: 15, fontWeight: '500' }}
                      numberOfLines={1}
                    >
                      {item.label || 'Sem nome'}
                    </Text>
                    <Text style={{ color: c.textSubtle, fontSize: 12 }} numberOfLines={1}>
                      {item.sublabel}
                    </Text>
                  </View>
                </Pressable>
              )}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dropdown: {
    position: 'absolute',
    top: 78,
    left: 0,
    right: 0,
    borderWidth: 1,
    borderRadius: 12,
    maxHeight: 320,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.16)' as any },
      default: {
        shadowOpacity: 0.16,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      },
    }),
    zIndex: 100,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
});
