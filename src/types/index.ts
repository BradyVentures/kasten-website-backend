export interface ContactSubmission {
  id: string;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  product_interest?: string;
  created_at: Date;
  read: boolean;
}

export interface VisualizerRequest {
  id: string;
  session_id: string;
  original_image_url: string;
  result_image_url?: string;
  category: 'rolllaeden' | 'terrassendach' | 'fenster-tueren';
  preferences: VisualizerPreferences;
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  message?: string;
  status: 'processing' | 'completed' | 'failed' | 'queued';
  created_at: Date;
  completed_at?: Date;
}

export interface VisualizerPreferences {
  color?: string;
  material?: string;
  style?: string;
  size?: string;
  additional?: string;
}
