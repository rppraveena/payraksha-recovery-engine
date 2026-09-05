const express = require('express');
const path = require('path');
const app = express();

// Serve static files from the Vite build output
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback: serve index.html for all routes (client-side routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PayRaksha running on port ${PORT}`);
});
