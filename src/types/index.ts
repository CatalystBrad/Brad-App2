export interface InspectionPhoto {
  uri: string;
  fileName: string;
  timestamp: number;
}

export interface Inspection {
  id: string;
  siteName: string;
  location: string;
  inspectorName: string;
  date: string;
  status: 'completed' | 'in-progress' | 'pending';
  notes: string;
  photos: InspectionPhoto[];
  findings: InspectionFinding[];
  timestamp: number;
}

export interface InspectionFinding {
  id: string;
  category: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
  photos: InspectionPhoto[];
}

export type RootStackParamList = {
  InspectionList: undefined;
  InspectionForm: { inspectionId?: string };
  InspectionDetails: { inspectionId: string };
  CatalystGame: undefined;
};
