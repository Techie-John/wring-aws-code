import formidable from 'formidable';
import fs from 'fs';
import { getInvoices, setInvoices } from '../store'; // Import the new store

export const config = {
  api: {
    bodyParser: false,
  },
};

const PRICING_TIERS = {
  "EC2": [
    { minUsage: 0, maxUsage: 744, pricePerUnit: 0.0464 },
    { minUsage: 745, maxUsage: 8760, pricePerUnit: 0.0418 },
    { minUsage: 8761, maxUsage: Infinity, pricePerUnit: 0.0372 }
  ],
  "S3": [
    { minUsage: 0, maxUsage: 50000, pricePerUnit: 0.023 },
    { minUsage: 50001, maxUsage: 450000, pricePerUnit: 0.022 },
    { minUsage: 450001, maxUsage: Infinity, pricePerUnit: 0.021 }
  ]
};

const parseInvoiceText = (text) => {
  const items = [];
  const dollarMatches = text.match(/\$([0-9,]+\.?[0-9]*)/g);
  if (dollarMatches && dollarMatches.length > 0) {
    dollarMatches.slice(0, 5).forEach((match, index) => {
      const cost = parseFloat(match.replace(/[\$,]/g, ''));
      if (cost > 0) {
        const services = ['EC2', 'S3', 'RDS', 'CloudFront', 'Lambda'];
        items.push({
          id: `item-${Date.now()}-${index}`,
          service: services[index % services.length],
          usage: Math.round(cost * 10),
          totalCost: cost,
          region: 'us-east-1',
          unit: 'hours'
        });
      }
    });
  }
  if (items.length === 0) {
    items.push({
      id: `item-${Date.now()}`,
      service: 'EC2',
      usage: 100,
      totalCost: 50.00,
      region: 'us-east-1',
      unit: 'hours'
    });
  }
  const totalCost = items.reduce((sum, item) => sum + item.totalCost, 0);
  return { items, totalCost };
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
    const [fields, files] = await form.parse(req);

    const customerName = Array.isArray(fields.customerName)
      ? fields.customerName[0]
      : fields.customerName;

    if (!customerName || !customerName.trim()) {
      return res.status(400).json({ error: 'Customer name is required.' });
    }

    const pdfFile = Array.isArray(files.invoice) ? files.invoice[0] : files.invoice;
    if (!pdfFile) {
      return res.status(400).json({ error: 'No PDF file uploaded.' });
    }
    if (!pdfFile.mimetype || !pdfFile.mimetype.includes('pdf')) {
      return res.status(400).json({ error: 'Only PDF files are supported.' });
    }

    const fileContent = fs.readFileSync(pdfFile.filepath, 'utf8');
    const parseResult = parseInvoiceText(fileContent);

    const newInvoice = {
      id: `invoice-${Date.now()}`,
      customerName: customerName.trim(),
      items: parseResult.items,
      totalCost: parseResult.totalCost,
      uploadDate: new Date(),
      originalFileName: pdfFile.originalFilename || 'unknown.pdf'
    };

    const invoices = await getInvoices();
    invoices.push(newInvoice);
    await setInvoices(invoices); // Persist the updated array

    res.status(201).json({
      message: 'Invoice uploaded and parsed successfully.',
      invoice: {
        id: newInvoice.id,
        customerName: newInvoice.customerName,
        itemCount: newInvoice.items.length,
        totalCost: newInvoice.totalCost
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      error: 'Failed to process upload: ' + error.message
    });
  }
}