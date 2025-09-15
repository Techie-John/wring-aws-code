// api/invoices/index.js
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Get invoices from global storage or initialize empty
  const invoices = global.invoices || [];

  if (req.method === 'GET') {
    return res.json(invoices);
  }

  if (req.method === 'DELETE') {
    // This would be handled by [id].js file in real Vercel setup
    return res.status(404).json({ error: 'Use DELETE /api/invoices/[id] instead' });
  }

  res.status(405).json({ error: 'Method not allowed' });
}