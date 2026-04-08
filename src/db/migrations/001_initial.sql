-- Contact form submissions
CREATE TABLE IF NOT EXISTS contact_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  message TEXT,
  product_interest VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  read BOOLEAN DEFAULT FALSE
);

-- Visualizer requests
CREATE TABLE IF NOT EXISTS visualizer_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  original_image_url TEXT NOT NULL,
  result_image_url TEXT,
  category VARCHAR(50) NOT NULL,
  preferences JSONB NOT NULL DEFAULT '{}',
  contact_name VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(50),
  message TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'processing',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Index for polling status checks
CREATE INDEX IF NOT EXISTS idx_visualizer_status ON visualizer_requests(id, status);

-- Index for daily limit counting
CREATE INDEX IF NOT EXISTS idx_visualizer_created ON visualizer_requests(created_at);
