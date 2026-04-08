import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import contactRouter from './routes/contact';
import visualizerRouter from './routes/visualizer';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
  origin: (process.env.FRONTEND_URL || 'http://localhost:3000,http://localhost:3005,https://bauelemente-kasten.de').split(',').map(s => s.trim()),
  credentials: true,
}));

app.use(express.json());

// Serve uploaded images statically
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Routes
app.use('/api/contact', contactRouter);
app.use('/api/visualizer', visualizerRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
