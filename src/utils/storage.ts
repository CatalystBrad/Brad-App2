import AsyncStorage from '@react-native-async-storage/async-storage';
import {Inspection} from '../types';

const INSPECTIONS_KEY = '@inspections';

export const StorageService = {
  async getAllInspections(): Promise<Inspection[]> {
    try {
      const data = await AsyncStorage.getItem(INSPECTIONS_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error loading inspections:', error);
      return [];
    }
  },

  async getInspection(id: string): Promise<Inspection | null> {
    try {
      const inspections = await this.getAllInspections();
      return inspections.find(i => i.id === id) || null;
    } catch (error) {
      console.error('Error loading inspection:', error);
      return null;
    }
  },

  async saveInspection(inspection: Inspection): Promise<boolean> {
    try {
      const inspections = await this.getAllInspections();
      const existingIndex = inspections.findIndex(i => i.id === inspection.id);

      if (existingIndex >= 0) {
        inspections[existingIndex] = inspection;
      } else {
        inspections.push(inspection);
      }

      await AsyncStorage.setItem(INSPECTIONS_KEY, JSON.stringify(inspections));
      return true;
    } catch (error) {
      console.error('Error saving inspection:', error);
      return false;
    }
  },

  async deleteInspection(id: string): Promise<boolean> {
    try {
      const inspections = await this.getAllInspections();
      const filtered = inspections.filter(i => i.id !== id);
      await AsyncStorage.setItem(INSPECTIONS_KEY, JSON.stringify(filtered));
      return true;
    } catch (error) {
      console.error('Error deleting inspection:', error);
      return false;
    }
  },

  async clearAllInspections(): Promise<boolean> {
    try {
      await AsyncStorage.removeItem(INSPECTIONS_KEY);
      return true;
    } catch (error) {
      console.error('Error clearing inspections:', error);
      return false;
    }
  },
};
