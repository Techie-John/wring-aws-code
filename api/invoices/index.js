import { getInvoices } from '../store'; // Import the new store

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const invoices = await getInvoices(); // Get from persistent storage
    return res.json(invoices);
  }

  if (req.method === 'DELETE') {
    return res.status(404).json({ error: 'Use DELETE /api/invoices/[id] instead' });
  }

  res.status(405).json({ error: 'Method not allowed' });
}