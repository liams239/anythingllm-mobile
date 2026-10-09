import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { BottomSheetFlatList, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { ArrowLeft, ArrowsClockwise, CaretDown, Check, ImageSquare, MagnifyingGlass, X } from 'phosphor-react-native';
import { useTranslation } from 'react-i18next';
import { formatOpperPrice, listOpperImageModels, saveOpperSettings, type OpperImageModel, type OpperSettings } from '@/utils/opper';
import { showToast } from '@/utils/Notification';

/**
 * Row under the provider bar in the model chip sheet showing the image model the generate-image
 * tool uses. Without an Opper key it offers to set image generation up instead.
 */
export function ImageModelBar({ settings, onPress }: { settings: OpperSettings | null; onPress: () => void }) {
  const { t } = useTranslation();
  const label = !settings
    ? t('top_bar.model_chip.image_model_setup')
    : settings.model || t('settings.image_generation.default_model');
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex flex-row items-center bg-[#27282A] rounded-lg px-3 mx-5"
      style={{ height: IMAGE_MODEL_BAR_HEIGHT, gap: 10, alignSelf: 'stretch' }}>
      <ImageSquare size={20} color="#FFF" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text className="text-[#9F9FA0] text-xs">{t('top_bar.model_chip.image_model')}</Text>
        <Text className="text-white text-sm" numberOfLines={1} ellipsizeMode="middle">{label}</Text>
      </View>
      <CaretDown size={14} color="#9F9FA0" weight="bold" />
    </TouchableOpacity>
  );
}

export const IMAGE_MODEL_BAR_HEIGHT = 44;

/**
 * In-sheet list of the image models Opper offers. Picking one saves it right away, so the next
 * image in any chat uses it.
 */
export default function ImageModelPicker({ settings, onSaved, onBack, onSearchFocus }: {
  settings: OpperSettings;
  onSaved: (settings: OpperSettings) => void;
  onBack: () => void;
  onSearchFocus?: () => void;
}) {
  const { t } = useTranslation();
  const [models, setModels] = useState<OpperImageModel[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setStatus('loading');
    try {
      setModels(await listOpperImageModels(settings.apiKey));
      setStatus('ready');
    } catch (e) {
      console.error('[ImageModelPicker] could not load image models', e);
      setStatus('error');
    }
  }

  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const matches = query
      ? models.filter((m) => m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query))
      : models;
    // "Opper default" stays on top unless the user is searching
    return query ? matches : [{ id: '', name: t('settings.image_generation.default_model'), provider: 'opper' }, ...matches];
  }, [models, searchQuery, t]);

  async function select(modelId: string) {
    if (saving) return;
    if (modelId === settings.model) return onBack();
    setSaving(true);
    try {
      const next = { ...settings, model: modelId };
      await saveOpperSettings(next);
      onSaved(next);
    } catch (e) {
      console.error('[ImageModelPicker] could not save image model', e);
      showToast(t('settings.update_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="flex-1 w-full" style={{ gap: 12 }}>
      <View className="flex flex-row items-center px-5" style={{ gap: 12 }}>
        <TouchableOpacity onPress={onBack} hitSlop={10} accessibilityLabel={t('common.back')}>
          <ArrowLeft size={22} color="white" weight="bold" />
        </TouchableOpacity>
        <Text className="text-white text-lg font-semibold flex-1" numberOfLines={1}>{t('top_bar.model_chip.image_model')}</Text>
      </View>

      {status === 'loading' && (
        <View className="items-center" style={{ gap: 12, paddingTop: 32 }}>
          <ActivityIndicator size="large" color="white" />
          <Text className="text-[#9F9FA0] text-sm">{t('settings.image_generation.models_loading')}</Text>
        </View>
      )}

      {status === 'error' && (
        <View className="items-center px-8" style={{ gap: 12, paddingTop: 32 }}>
          <Text className="text-[#9F9FA0] text-sm text-center">{t('top_bar.model_chip.image_models_failed')}</Text>
          <TouchableOpacity onPress={load} className="flex flex-row items-center bg-white/10 rounded-lg px-4 py-2" style={{ gap: 6 }}>
            <ArrowsClockwise size={16} color="white" weight="bold" />
            <Text className="text-white text-sm font-medium">{t('top_bar.model_chip.try_again')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {status === 'ready' && (
        <>
          <View className="flex flex-row items-center mx-5 bg-[#27282A] rounded-lg px-4">
            <MagnifyingGlass size={20} weight="bold" color="white" />
            <BottomSheetTextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('common.search')}
              placeholderTextColor="#9F9FA0"
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={onSearchFocus}
              style={{ flex: 1, height: 38, marginLeft: 8, color: '#FFF' }}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <X size={20} color="white" />
              </TouchableOpacity>
            )}
          </View>
          {rows.length === 0 && (
            <Text className="text-white text-sm text-center pt-4 px-5">{t('top_bar.model_chip.no_models_found', { query: searchQuery })}</Text>
          )}
          <BottomSheetFlatList
            data={rows}
            keyExtractor={(m: OpperImageModel) => m.id || 'default'}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100, gap: 8 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: m }: { item: OpperImageModel }) => {
              const isSelected = m.id === settings.model;
              return (
                <TouchableOpacity
                  disabled={saving}
                  onPress={() => select(m.id)}
                  style={{
                    backgroundColor: isSelected ? '#2e404b' : '#2A2A2E',
                    borderWidth: isSelected ? 2 : 0,
                    borderColor: isSelected ? '#7cd4fd' : 'transparent',
                  }}
                  className="w-full p-4 rounded-xl flex-row items-center justify-between">
                  <View className="flex-1" style={{ gap: 2 }}>
                    <Text className="text-white text-base font-medium" numberOfLines={1}>{m.name}</Text>
                    {!!m.id && m.name !== m.id && <Text className="text-[#9F9FA0] text-xs" numberOfLines={1}>{m.id}</Text>}
                    {!!formatOpperPrice(m.price) && <Text className="text-[#7cd4fd] text-xs" numberOfLines={1}>{formatOpperPrice(m.price)}</Text>}
                  </View>
                  {isSelected && <Check size={20} color="#7cd4fd" weight="bold" style={{ marginLeft: 12 }} />}
                </TouchableOpacity>
              );
            }}
          />
        </>
      )}
    </View>
  );
}
