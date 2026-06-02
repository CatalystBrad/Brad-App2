import React, {useState, useCallback} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList, Inspection} from '../types';
import {StorageService} from '../utils/storage';

type Props = NativeStackScreenProps<RootStackParamList, 'InspectionList'>;

const InspectionListScreen = ({navigation}: Props) => {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadInspections = async () => {
    const data = await StorageService.getAllInspections();
    setInspections(data.sort((a, b) => b.timestamp - a.timestamp));
  };

  useFocusEffect(
    useCallback(() => {
      loadInspections();
    }, []),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadInspections();
    setRefreshing(false);
  };

  const handleDelete = (id: string) => {
    Alert.alert(
      'Delete Inspection',
      'Are you sure you want to delete this inspection?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await StorageService.deleteInspection(id);
            loadInspections();
          },
        },
      ],
    );
  };

  const getStatusColor = (status: Inspection['status']) => {
    switch (status) {
      case 'completed':
        return '#34C759';
      case 'in-progress':
        return '#FF9500';
      case 'pending':
        return '#8E8E93';
      default:
        return '#8E8E93';
    }
  };

  const renderInspectionItem = ({item}: {item: Inspection}) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() =>
        navigation.navigate('InspectionDetails', {inspectionId: item.id})
      }
      onLongPress={() => handleDelete(item.id)}>
      <View style={styles.cardHeader}>
        <Text style={styles.siteName}>{item.siteName}</Text>
        <View
          style={[styles.statusBadge, {backgroundColor: getStatusColor(item.status)}]}>
          <Text style={styles.statusText}>{item.status}</Text>
        </View>
      </View>
      <Text style={styles.location}>{item.location}</Text>
      <View style={styles.cardFooter}>
        <Text style={styles.inspector}>By: {item.inspectorName}</Text>
        <Text style={styles.date}>{new Date(item.date).toLocaleDateString()}</Text>
      </View>
      {item.findings.length > 0 && (
        <Text style={styles.findings}>
          {item.findings.length} finding{item.findings.length !== 1 ? 's' : ''}
        </Text>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={inspections}
        renderItem={renderInspectionItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No inspections yet</Text>
            <Text style={styles.emptySubtext}>
              Tap the + button to create your first inspection
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      />
      <TouchableOpacity
        style={styles.gameFab}
        onPress={() => navigation.navigate('CatalystGame')}>
        <Text style={styles.gameFabText}>🚰</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('InspectionForm', {})}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  listContent: {
    padding: 16,
    paddingBottom: 80,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  siteName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  location: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inspector: {
    fontSize: 14,
    color: '#000',
  },
  date: {
    fontSize: 14,
    color: '#8E8E93',
  },
  findings: {
    fontSize: 12,
    color: '#007AFF',
    marginTop: 8,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 100,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#8E8E93',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
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
  fabText: {
    fontSize: 32,
    color: '#FFFFFF',
    fontWeight: '300',
  },
  gameFab: {
    position: 'absolute',
    right: 20,
    bottom: 92,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#5AC8FA',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  gameFabText: {
    fontSize: 28,
  },
});

export default InspectionListScreen;
