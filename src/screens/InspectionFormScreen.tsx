import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  Platform,
} from 'react-native';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList, Inspection, InspectionFinding, InspectionPhoto} from '../types';
import {StorageService} from '../utils/storage';

type Props = NativeStackScreenProps<RootStackParamList, 'InspectionForm'>;

const InspectionFormScreen = ({navigation, route}: Props) => {
  const {inspectionId} = route.params;
  const [siteName, setSiteName] = useState('');
  const [location, setLocation] = useState('');
  const [inspectorName, setInspectorName] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<Inspection['status']>('in-progress');
  const [photos, setPhotos] = useState<InspectionPhoto[]>([]);
  const [findings, setFindings] = useState<InspectionFinding[]>([]);
  const [currentFinding, setCurrentFinding] = useState({
    category: '',
    description: '',
    severity: 'medium' as const,
    recommendation: '',
  });

  useEffect(() => {
    if (inspectionId) {
      loadInspection();
    }
  }, [inspectionId]);

  const loadInspection = async () => {
    if (!inspectionId) return;
    const inspection = await StorageService.getInspection(inspectionId);
    if (inspection) {
      setSiteName(inspection.siteName);
      setLocation(inspection.location);
      setInspectorName(inspection.inspectorName);
      setNotes(inspection.notes);
      setStatus(inspection.status);
      setPhotos(inspection.photos);
      setFindings(inspection.findings);
    }
  };

  const handleTakePhoto = () => {
    Alert.alert('Add Photo', 'Choose an option', [
      {
        text: 'Take Photo',
        onPress: () => {
          launchCamera(
            {
              mediaType: 'photo',
              quality: 0.8,
              saveToPhotos: true,
            },
            response => {
              if (response.assets && response.assets[0]) {
                const asset = response.assets[0];
                const photo: InspectionPhoto = {
                  uri: asset.uri || '',
                  fileName: asset.fileName || 'photo.jpg',
                  timestamp: Date.now(),
                };
                setPhotos([...photos, photo]);
              }
            },
          );
        },
      },
      {
        text: 'Choose from Library',
        onPress: () => {
          launchImageLibrary(
            {
              mediaType: 'photo',
              quality: 0.8,
              selectionLimit: 5,
            },
            response => {
              if (response.assets) {
                const newPhotos = response.assets.map(asset => ({
                  uri: asset.uri || '',
                  fileName: asset.fileName || 'photo.jpg',
                  timestamp: Date.now(),
                }));
                setPhotos([...photos, ...newPhotos]);
              }
            },
          );
        },
      },
      {text: 'Cancel', style: 'cancel'},
    ]);
  };

  const handleAddFinding = () => {
    if (!currentFinding.category || !currentFinding.description) {
      Alert.alert('Error', 'Please fill in category and description');
      return;
    }

    const finding: InspectionFinding = {
      id: Date.now().toString(),
      category: currentFinding.category,
      description: currentFinding.description,
      severity: currentFinding.severity,
      recommendation: currentFinding.recommendation,
      photos: [],
    };

    setFindings([...findings, finding]);
    setCurrentFinding({
      category: '',
      description: '',
      severity: 'medium',
      recommendation: '',
    });
  };

  const handleRemoveFinding = (id: string) => {
    setFindings(findings.filter(f => f.id !== id));
  };

  const handleSave = async () => {
    if (!siteName.trim() || !location.trim() || !inspectorName.trim()) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    const inspection: Inspection = {
      id: inspectionId || Date.now().toString(),
      siteName: siteName.trim(),
      location: location.trim(),
      inspectorName: inspectorName.trim(),
      date: new Date().toISOString(),
      status,
      notes: notes.trim(),
      photos,
      findings,
      timestamp: Date.now(),
    };

    const success = await StorageService.saveInspection(inspection);
    if (success) {
      Alert.alert('Success', 'Inspection saved successfully', [
        {text: 'OK', onPress: () => navigation.goBack()},
      ]);
    } else {
      Alert.alert('Error', 'Failed to save inspection');
    }
  };

  const getSeverityColor = (severity: InspectionFinding['severity']) => {
    switch (severity) {
      case 'low':
        return '#34C759';
      case 'medium':
        return '#FF9500';
      case 'high':
        return '#FF3B30';
      case 'critical':
        return '#8B0000';
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Basic Information</Text>
        <Text style={styles.label}>Site Name *</Text>
        <TextInput
          style={styles.input}
          value={siteName}
          onChangeText={setSiteName}
          placeholder="Enter site name"
        />

        <Text style={styles.label}>Location *</Text>
        <TextInput
          style={styles.input}
          value={location}
          onChangeText={setLocation}
          placeholder="Enter location"
        />

        <Text style={styles.label}>Inspector Name *</Text>
        <TextInput
          style={styles.input}
          value={inspectorName}
          onChangeText={setInspectorName}
          placeholder="Enter inspector name"
        />

        <Text style={styles.label}>Status</Text>
        <View style={styles.statusButtons}>
          {(['pending', 'in-progress', 'completed'] as const).map(s => (
            <TouchableOpacity
              key={s}
              style={[
                styles.statusButton,
                status === s && styles.statusButtonActive,
              ]}
              onPress={() => setStatus(s)}>
              <Text
                style={[
                  styles.statusButtonText,
                  status === s && styles.statusButtonTextActive,
                ]}>
                {s}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Notes</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Enter notes"
          multiline
          numberOfLines={4}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Photos</Text>
        <TouchableOpacity style={styles.photoButton} onPress={handleTakePhoto}>
          <Text style={styles.photoButtonText}>+ Add Photo</Text>
        </TouchableOpacity>
        <View style={styles.photoGrid}>
          {photos.map((photo, index) => (
            <View key={index} style={styles.photoContainer}>
              <Image source={{uri: photo.uri}} style={styles.photo} />
              <TouchableOpacity
                style={styles.removePhoto}
                onPress={() => setPhotos(photos.filter((_, i) => i !== index))}>
                <Text style={styles.removePhotoText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Findings</Text>

        <Text style={styles.label}>Category</Text>
        <TextInput
          style={styles.input}
          value={currentFinding.category}
          onChangeText={text =>
            setCurrentFinding({...currentFinding, category: text})
          }
          placeholder="e.g., Safety, Structural, Electrical"
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={currentFinding.description}
          onChangeText={text =>
            setCurrentFinding({...currentFinding, description: text})
          }
          placeholder="Describe the finding"
          multiline
          numberOfLines={3}
        />

        <Text style={styles.label}>Severity</Text>
        <View style={styles.statusButtons}>
          {(['low', 'medium', 'high', 'critical'] as const).map(sev => (
            <TouchableOpacity
              key={sev}
              style={[
                styles.severityButton,
                {borderColor: getSeverityColor(sev)},
                currentFinding.severity === sev && {
                  backgroundColor: getSeverityColor(sev),
                },
              ]}
              onPress={() =>
                setCurrentFinding({...currentFinding, severity: sev})
              }>
              <Text
                style={[
                  styles.severityButtonText,
                  currentFinding.severity === sev && {color: '#FFFFFF'},
                ]}>
                {sev}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Recommendation</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={currentFinding.recommendation}
          onChangeText={text =>
            setCurrentFinding({...currentFinding, recommendation: text})
          }
          placeholder="Enter recommendation"
          multiline
          numberOfLines={2}
        />

        <TouchableOpacity
          style={styles.addFindingButton}
          onPress={handleAddFinding}>
          <Text style={styles.addFindingButtonText}>Add Finding</Text>
        </TouchableOpacity>

        {findings.map(finding => (
          <View
            key={finding.id}
            style={[
              styles.findingCard,
              {borderLeftColor: getSeverityColor(finding.severity)},
            ]}>
            <View style={styles.findingHeader}>
              <Text style={styles.findingCategory}>{finding.category}</Text>
              <TouchableOpacity onPress={() => handleRemoveFinding(finding.id)}>
                <Text style={styles.removeFinding}>Remove</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.findingDescription}>{finding.description}</Text>
            <Text style={styles.findingRecommendation}>
              Recommendation: {finding.recommendation}
            </Text>
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
        <Text style={styles.saveButtonText}>Save Inspection</Text>
      </TouchableOpacity>
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
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#000',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#FFFFFF',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  statusButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  statusButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  statusButtonActive: {
    backgroundColor: '#007AFF',
  },
  statusButtonText: {
    color: '#007AFF',
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  statusButtonTextActive: {
    color: '#FFFFFF',
  },
  photoButton: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  photoButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  photoContainer: {
    position: 'relative',
  },
  photo: {
    width: 100,
    height: 100,
    borderRadius: 8,
  },
  removePhoto: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#FF3B30',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removePhotoText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  severityButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 2,
  },
  severityButtonText: {
    fontWeight: '600',
    textTransform: 'capitalize',
    fontSize: 14,
  },
  addFindingButton: {
    backgroundColor: '#34C759',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  addFindingButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  findingCard: {
    backgroundColor: '#F9F9F9',
    borderLeftWidth: 4,
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
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
  },
  removeFinding: {
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: '600',
  },
  findingDescription: {
    fontSize: 14,
    color: '#000',
    marginBottom: 8,
  },
  findingRecommendation: {
    fontSize: 14,
    color: '#8E8E93',
    fontStyle: 'italic',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default InspectionFormScreen;
