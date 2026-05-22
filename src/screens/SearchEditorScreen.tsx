import React, {useEffect, useMemo, useState} from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {SavedSearch, SavedStackParamList, BoardType} from '../types';
import {Storage} from '../utils/storage';

type Props = NativeStackScreenProps<SavedStackParamList, 'SearchEditor'>;

const BOARDS: Array<{key: BoardType; label: string}> = [
  {key: 'AI', label: 'All Inclusive'},
  {key: 'HB', label: 'Half Board'},
  {key: 'FB', label: 'Full Board'},
  {key: 'BB', label: 'B&B'},
  {key: 'SC', label: 'Self Catering'},
  {key: 'RO', label: 'Room Only'},
];

const AIRPORTS = ['MAN', 'LGW', 'LHR', 'BHX', 'STN', 'LTN', 'LPL', 'EMA'];

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const SearchEditorScreen = ({route, navigation}: Props) => {
  const editingId = route.params?.searchId;
  const [name, setName] = useState('');
  const [destinations, setDestinations] = useState('');
  const [airports, setAirports] = useState<string[]>(['MAN']);
  const [minNights, setMinNights] = useState('7');
  const [maxNights, setMaxNights] = useState('14');
  const [maxPrice, setMaxPrice] = useState('');
  const [boards, setBoards] = useState<BoardType[]>(['AI', 'HB']);
  const [loaded, setLoaded] = useState(!editingId);

  useEffect(() => {
    if (!editingId) return;
    (async () => {
      const all = await Storage.getSavedSearches();
      const found = all.find(s => s.id === editingId);
      if (found) {
        setName(found.name);
        setDestinations(found.destinations.join(', '));
        setAirports(found.departureAirports);
        setMinNights(String(found.minNights));
        setMaxNights(String(found.maxNights));
        setMaxPrice(found.maxPricePerPerson ? String(found.maxPricePerPerson) : '');
        setBoards(found.boardTypes);
      }
      setLoaded(true);
    })();
  }, [editingId]);

  const toggleAirport = (a: string) => {
    setAirports(prev => (prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]));
  };
  const toggleBoard = (b: BoardType) => {
    setBoards(prev => (prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]));
  };

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give this search a name so you can find it later.');
      return;
    }
    const minN = Math.max(1, parseInt(minNights, 10) || 7);
    const maxN = Math.max(minN, parseInt(maxNights, 10) || 14);
    const search: SavedSearch = {
      id: editingId ?? randomId(),
      name: name.trim(),
      destinations: destinations
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
      departureAirports: airports.length > 0 ? airports : ['MAN'],
      minNights: minN,
      maxNights: maxN,
      maxPricePerPerson: maxPrice ? parseInt(maxPrice, 10) : undefined,
      boardTypes: boards,
      createdAt: editingId ? Date.now() : Date.now(),
    };
    await Storage.upsertSavedSearch(search);
    navigation.goBack();
  };

  const headerTitle = useMemo(() => (editingId ? 'Edit search' : 'New search'), [editingId]);
  useEffect(() => {
    navigation.setOptions({title: headerTitle});
  }, [navigation, headerTitle]);

  if (!loaded) {
    return (
      <View style={styles.container}>
        <Text style={styles.label}>Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Summer all-inclusive Greece"
        value={name}
        onChangeText={setName}
      />

      <Text style={styles.label}>Destinations (comma separated, optional)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Rhodes, Crete, Antalya"
        value={destinations}
        onChangeText={setDestinations}
      />

      <Text style={styles.label}>Departure airports</Text>
      <View style={styles.chipRow}>
        {AIRPORTS.map(a => (
          <TouchableOpacity
            key={a}
            style={[styles.chip, airports.includes(a) && styles.chipActive]}
            onPress={() => toggleAirport(a)}>
            <Text style={[styles.chipText, airports.includes(a) && styles.chipTextActive]}>
              {a}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.label}>Min nights</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={minNights}
            onChangeText={setMinNights}
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>Max nights</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={maxNights}
            onChangeText={setMaxNights}
          />
        </View>
      </View>

      <Text style={styles.label}>Max price per person (£, optional)</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        placeholder="e.g. 800"
        value={maxPrice}
        onChangeText={setMaxPrice}
      />

      <Text style={styles.label}>Board type</Text>
      <View style={styles.chipRow}>
        {BOARDS.map(b => (
          <TouchableOpacity
            key={b.key}
            style={[styles.chip, boards.includes(b.key) && styles.chipActive]}
            onPress={() => toggleBoard(b.key)}>
            <Text style={[styles.chipText, boards.includes(b.key) && styles.chipTextActive]}>
              {b.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.saveBtn} onPress={save}>
        <Text style={styles.saveBtnText}>Save search</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#F2F2F7'},
  content: {padding: 16, paddingBottom: 48},
  label: {fontSize: 13, color: '#3C3C43', marginBottom: 6, marginTop: 14, fontWeight: '600'},
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  row: {flexDirection: 'row', gap: 12},
  col: {flex: 1},
  chipRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  chip: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  chipActive: {backgroundColor: '#007AFF', borderColor: '#007AFF'},
  chipText: {fontSize: 13, color: '#3C3C43'},
  chipTextActive: {color: '#FFFFFF', fontWeight: '600'},
  saveBtn: {
    marginTop: 28,
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnText: {color: '#FFFFFF', fontSize: 16, fontWeight: 'bold'},
});

export default SearchEditorScreen;
