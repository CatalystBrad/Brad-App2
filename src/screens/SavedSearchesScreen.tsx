import React, {useCallback, useState} from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {SavedSearch, SavedStackParamList} from '../types';
import {Storage} from '../utils/storage';

type Props = NativeStackScreenProps<SavedStackParamList, 'SavedList'>;

const SavedSearchesScreen = ({navigation}: Props) => {
  const [searches, setSearches] = useState<SavedSearch[]>([]);

  const load = useCallback(async () => {
    const all = await Storage.getSavedSearches();
    setSearches(all.sort((a, b) => b.createdAt - a.createdAt));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleDelete = (s: SavedSearch) => {
    Alert.alert('Delete search', `Delete "${s.name}"?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await Storage.deleteSavedSearch(s.id);
          load();
        },
      },
    ]);
  };

  const renderItem = ({item}: {item: SavedSearch}) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('SearchEditor', {searchId: item.id})}
      onLongPress={() => handleDelete(item)}>
      <Text style={styles.name}>{item.name}</Text>
      <Text style={styles.meta}>
        {item.destinations.length > 0
          ? item.destinations.join(', ')
          : 'Any destination'}
      </Text>
      <View style={styles.row}>
        <Text style={styles.pill}>
          {item.departureAirports.join(', ') || 'Any airport'}
        </Text>
        <Text style={styles.pill}>
          {item.minNights}–{item.maxNights} nights
        </Text>
        {item.maxPricePerPerson != null && (
          <Text style={styles.pill}>≤ £{item.maxPricePerPerson} pp</Text>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={searches}
        keyExtractor={s => s.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No saved searches yet</Text>
            <Text style={styles.emptyBody}>
              Save a search to prioritise it in daily refreshes and get notified
              about new matches.
            </Text>
          </View>
        }
      />
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('SearchEditor', {})}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#F2F2F7'},
  list: {padding: 12, paddingBottom: 96},
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  name: {fontSize: 17, fontWeight: 'bold', color: '#000'},
  meta: {fontSize: 13, color: '#8E8E93', marginTop: 4},
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10},
  pill: {fontSize: 12, color: '#3C3C43', backgroundColor: '#F2F2F7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6},
  empty: {alignItems: 'center', marginTop: 80, padding: 24},
  emptyTitle: {fontSize: 18, fontWeight: 'bold', color: '#8E8E93', marginBottom: 8},
  emptyBody: {fontSize: 14, color: '#8E8E93', textAlign: 'center'},
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  fabText: {fontSize: 32, color: '#FFFFFF', fontWeight: '300'},
});

export default SavedSearchesScreen;
