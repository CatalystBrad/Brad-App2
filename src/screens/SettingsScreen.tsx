import React, {useCallback, useEffect, useState} from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {AppSettings, DEFAULT_SETTINGS, Storage} from '../utils/storage';
import {TravelParty, DEFAULT_TRAVEL_PARTY} from '../types';
import {fireTestNotification} from '../services/notifications';
import {runBackgroundRefresh} from '../services/backgroundFetch';

const SettingsScreen = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [party, setParty] = useState<TravelParty>(DEFAULT_TRAVEL_PARTY);
  const [dropPct, setDropPct] = useState('10');

  const load = useCallback(async () => {
    const s = await Storage.getSettings();
    const p = await Storage.getParty();
    setSettings(s);
    setParty(p);
    setDropPct(String(s.notifyOnPriceDropPct));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = async (patch: Partial<AppSettings>) => {
    const next = {...settings, ...patch};
    setSettings(next);
    await Storage.saveSettings(next);
  };

  const updateParty = async (next: TravelParty) => {
    setParty(next);
    await Storage.saveParty(next);
  };

  const commitDropPct = async () => {
    const n = parseInt(dropPct, 10);
    if (!Number.isFinite(n) || n < 1 || n > 90) {
      Alert.alert('Out of range', 'Pick a number between 1 and 90.');
      setDropPct(String(settings.notifyOnPriceDropPct));
      return;
    }
    await update({notifyOnPriceDropPct: n});
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.section}>Travel party</Text>
      <View style={styles.card}>
        {party.travellers.map(t => (
          <View key={t.id} style={styles.partyRow}>
            <Text style={styles.partyLabel}>{t.label}</Text>
            <Text style={styles.partyType}>
              {t.age} · {t.type}
            </Text>
          </View>
        ))}
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Count the 18-year-old as an adult</Text>
          <Switch
            value={party.countEighteenAsAdult}
            onValueChange={v => {
              const next: TravelParty = {
                ...party,
                countEighteenAsAdult: v,
                travellers: party.travellers.map(t =>
                  t.age === 18 ? {...t, type: v ? 'adult' : 'child'} : t,
                ),
              };
              updateParty(next);
            }}
          />
        </View>
      </View>

      <Text style={styles.section}>Notifications</Text>
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Notify on new family-friendly deals</Text>
          <Switch
            value={settings.notifyOnNewDeal}
            onValueChange={v => update({notifyOnNewDeal: v})}
          />
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Price-drop threshold (%)</Text>
          <TextInput
            style={styles.smallInput}
            keyboardType="number-pad"
            value={dropPct}
            onChangeText={setDropPct}
            onBlur={commitDropPct}
          />
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Show long-haul destinations</Text>
          <Switch
            value={settings.showLongHaul}
            onValueChange={v => update({showLongHaul: v})}
          />
        </View>

        <TouchableOpacity style={styles.btn} onPress={fireTestNotification}>
          <Text style={styles.btnText}>Send test notification</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>Maintenance</Text>
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.btn}
          onPress={async () => {
            await runBackgroundRefresh();
            Alert.alert('Done', 'Refreshed deals from the daily feed.');
          }}>
          <Text style={styles.btnText}>Refresh deals now</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={() =>
            Alert.alert('Clear price history?', 'This resets notification baselines.', [
              {text: 'Cancel', style: 'cancel'},
              {
                text: 'Clear',
                style: 'destructive',
                onPress: async () => {
                  await Storage.savePriceHistory({});
                  Alert.alert('Cleared', 'Price history reset.');
                },
              },
            ])
          }>
          <Text style={[styles.btnText, styles.btnSecondaryText]}>Clear price history</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>
        Daily deals are scraped server-side via GitHub Actions at 07:00 UTC. The
        app fetches the feed on launch and roughly twice per day in the
        background (best-effort on iOS).
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#F2F2F7'},
  content: {padding: 16, paddingBottom: 40},
  section: {fontSize: 13, color: '#8E8E93', textTransform: 'uppercase', marginTop: 16, marginBottom: 8, marginLeft: 4, fontWeight: '600'},
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  partyRow: {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomColor: '#F2F2F7', borderBottomWidth: 1},
  partyLabel: {fontSize: 15, color: '#000'},
  partyType: {fontSize: 13, color: '#8E8E93', textTransform: 'capitalize'},
  toggleRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10},
  toggleLabel: {fontSize: 15, color: '#000', flex: 1, marginRight: 12},
  smallInput: {backgroundColor: '#F2F2F7', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 15, width: 64, textAlign: 'right'},
  btn: {backgroundColor: '#007AFF', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 10},
  btnSecondary: {backgroundColor: '#F2F2F7'},
  btnText: {color: '#FFFFFF', fontSize: 15, fontWeight: '600'},
  btnSecondaryText: {color: '#FF3B30'},
  footer: {marginTop: 20, fontSize: 12, color: '#8E8E93', textAlign: 'center', lineHeight: 18},
});

export default SettingsScreen;
