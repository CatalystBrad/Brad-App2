import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList, Inspection} from '../types';
import {StorageService} from '../utils/storage';

type Props = NativeStackScreenProps<RootStackParamList, 'InspectionDetails'>;

const InspectionDetailsScreen = ({navigation, route}: Props) => {
  const {inspectionId} = route.params;
  const [inspection, setInspection] = useState<Inspection | null>(null);

  useEffect(() => {
    loadInspection();
  }, [inspectionId]);

  const loadInspection = async () => {
    const data = await StorageService.getInspection(inspectionId);
    setInspection(data);
  };

  const handleEdit = () => {
    navigation.navigate('InspectionForm', {inspectionId});
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Inspection',
      'Are you sure you want to delete this inspection?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await StorageService.deleteInspection(inspectionId);
            navigation.goBack();
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
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'low':
        return '#34C759';
      case 'medium':
        return '#FF9500';
      case 'high':
        return '#FF3B30';
      case 'critical':
        return '#8B0000';
      default:
        return '#8E8E93';
    }
  };

  if (!inspection) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>Inspection not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{inspection.siteName}</Text>
          <Text style={styles.location}>{inspection.location}</Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            {backgroundColor: getStatusColor(inspection.status)},
          ]}>
          <Text style={styles.statusText}>{inspection.status}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Information</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Inspector:</Text>
          <Text style={styles.infoValue}>{inspection.inspectorName}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Date:</Text>
          <Text style={styles.infoValue}>
            {new Date(inspection.date).toLocaleDateString()} at{' '}
            {new Date(inspection.date).toLocaleTimeString()}
          </Text>
        </View>
        {inspection.notes && (
          <>
            <Text style={styles.infoLabel}>Notes:</Text>
            <Text style={styles.notes}>{inspection.notes}</Text>
          </>
        )}
      </View>

      {inspection.photos.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos ({inspection.photos.length})</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.photosScroll}>
            {inspection.photos.map((photo, index) => (
              <Image
                key={index}
                source={{uri: photo.uri}}
                style={styles.photo}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {inspection.findings.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Findings ({inspection.findings.length})
          </Text>
          {inspection.findings.map(finding => (
            <View
              key={finding.id}
              style={[
                styles.findingCard,
                {borderLeftColor: getSeverityColor(finding.severity)},
              ]}>
              <View style={styles.findingHeader}>
                <Text style={styles.findingCategory}>{finding.category}</Text>
                <View
                  style={[
                    styles.severityBadge,
                    {backgroundColor: getSeverityColor(finding.severity)},
                  ]}>
                  <Text style={styles.severityText}>{finding.severity}</Text>
                </View>
              </View>
              <Text style={styles.findingDescription}>
                {finding.description}
              </Text>
              {finding.recommendation && (
                <View style={styles.recommendation}>
                  <Text style={styles.recommendationLabel}>
                    Recommendation:
                  </Text>
                  <Text style={styles.recommendationText}>
                    {finding.recommendation}
                  </Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.editButton]}
          onPress={handleEdit}>
          <Text style={styles.actionButtonText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.deleteButton]}
          onPress={handleDelete}>
          <Text style={styles.actionButtonText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
  },
  location: {
    fontSize: 16,
    color: '#8E8E93',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    width: 100,
  },
  infoValue: {
    fontSize: 14,
    color: '#000',
    flex: 1,
  },
  notes: {
    fontSize: 14,
    color: '#000',
    marginTop: 8,
    lineHeight: 20,
  },
  photosScroll: {
    marginTop: 8,
  },
  photo: {
    width: 150,
    height: 150,
    borderRadius: 8,
    marginRight: 12,
  },
  findingCard: {
    backgroundColor: '#F9F9F9',
    borderLeftWidth: 4,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  findingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  findingCategory: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
    flex: 1,
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  severityText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  findingDescription: {
    fontSize: 14,
    color: '#000',
    marginBottom: 8,
    lineHeight: 20,
  },
  recommendation: {
    backgroundColor: '#E5F5FF',
    padding: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  recommendationLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#007AFF',
    marginBottom: 4,
  },
  recommendationText: {
    fontSize: 14,
    color: '#000',
    lineHeight: 20,
  },
  emptyText: {
    fontSize: 18,
    color: '#8E8E93',
    textAlign: 'center',
    marginTop: 50,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  editButton: {
    backgroundColor: '#007AFF',
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default InspectionDetailsScreen;
