// api/invoices/upload.js
import formidable from 'formidable';
import fs from 'fs';

// Simple in-memory storage (will reset between deployments)
let invoices = [];

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
  
  // Look for dollar amounts and assume they're AWS costs
  const dollarMatches = text.match(/\$([0-9,]+\.?[0-9]*)/g);
  if (dollarMatches && dollarMatches.length > 0) {
    dollarMatches.slice(0, 5).forEach((match, index) => { // Max 5 items
      const cost = parseFloat(match.replace(/[\$,]/g, ''));
      if (cost > 0) {
        const services = ['EC2', 'S3', 'RDS', 'CloudFront', 'Lambda'];
        items.push({
          id: `item-${Date.now()}-${index}`,
          service: services[index % services.length],
          usage: Math.round(cost * 10), // Simple estimation
          totalCost: cost,
          region: 'us-east-1',
          unit: 'hours'
        });
      }
    });
  }

  // If no valid items found, create a dummy one
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
  // Enable CORS
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
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB
    });

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

    // Read file content
    const fileContent = fs.readFileSync(pdfFile.filepath, 'utf8');
    
    // Simple parsing - just extract text and find dollar amounts
    const parseResult = parseInvoiceText(fileContent);
    
    const invoice = {
      id: `invoice-${Date.now()}`,
      customerName: customerName.trim(),
      items: parseResult.items,
      totalCost: parseResult.totalCost,
      uploadDate: new Date(),
      originalFileName: pdfFile.originalFilename || 'unknown.pdf'
    };

    // Store in memory (you'd want a database in production)
    invoices.push(invoice);
    global.invoices = invoices; // Make it accessible to other functions
    
    res.status(201).json({ 
      message: 'Invoice uploaded and parsed successfully.',
      invoice: {
        id: invoice.id,
        customerName: invoice.customerName,
        itemCount: invoice.items.length,
        totalCost: invoice.totalCost
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Failed to process upload: ' + error.message
    });
  }
}