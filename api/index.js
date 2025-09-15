// api/index.js - Put this in an 'api' folder in your project root
const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

// In-memory storage (will reset on serverless function restart)
let invoices = [];

const app = express();
app.use(cors());
app.use(express.json());
app.use(fileUpload());

// Pricing engine (same as before)
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
  ],
  "RDS": [
    { minUsage: 0, maxUsage: 750, pricePerUnit: 0.017 },
    { minUsage: 751, maxUsage: 8760, pricePerUnit: 0.017 },
    { minUsage: 8761, maxUsage: Infinity, pricePerUnit: 0.015 }
  ],
  "CloudFront": [
    { minUsage: 0, maxUsage: 10000, pricePerUnit: 0.085 },
    { minUsage: 10001, maxUsage: 50000, pricePerUnit: 0.080 },
    { minUsage: 50001, maxUsage: Infinity, pricePerUnit: 0.060 }
  ],
  "DataTransfer": [
    { minUsage: 0, maxUsage: 1000, pricePerUnit: 0.09 },
    { minUsage: 1001, maxUsage: 10000, pricePerUnit: 0.09 },
    { minUsage: 10001, maxUsage: Infinity, pricePerUnit: 0.085 }
  ],
  "Lambda": [
    { minUsage: 0, maxUsage: 1000000, pricePerUnit: 0.0000002 },
    { minUsage: 1000001, maxUsage: Infinity, pricePerUnit: 0.0000002 }
  ]
};

const calculateTieredCost = (service, usage) => {
  const tiers = PRICING_TIERS[service] || PRICING_TIERS["EC2"];
  let cost = 0;
  let remainingUsage = usage;

  for (const tier of tiers) {
    if (remainingUsage <= 0) break;
    
    const tierCapacity = tier.maxUsage === Infinity ? remainingUsage : tier.maxUsage - tier.minUsage + 1;
    const tierUsage = Math.min(remainingUsage, tierCapacity);
    cost += tierUsage * tier.pricePerUnit;
    remainingUsage -= tierUsage;
  }

  return cost;
};

const AWS_SERVICE_MAPPINGS = {
  'Amazon Elastic Compute Cloud': { service: 'EC2', unit: 'hours' },
  'Amazon Simple Storage Service': { service: 'S3', unit: 'GB' },
  'AWS Data Transfer': { service: 'DataTransfer', unit: 'GB' },
  'Amazon Relational Database Service': { service: 'RDS', unit: 'hours' },
  'Amazon RDS Service': { service: 'RDS', unit: 'hours' },
  'Amazon CloudFront': { service: 'CloudFront', unit: 'GB' },
  'AWS Lambda': { service: 'Lambda', unit: 'requests' },
  'Amazon Simple Email Service': { service: 'SES', unit: 'emails' },
  'Amazon Simple Notification Service': { service: 'SNS', unit: 'requests' }
};

// PDF parsing function (simplified for serverless)
const parseAWSInvoicePDF = async (pdfBuffer) => {
  try {
    const document = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= Math.min(document.numPages, 5); i++) { // Limit pages for performance
      const page = await document.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }

    return parseInvoiceText(fullText);
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error('Failed to parse PDF: ' + error.message);
  }
};

const parseInvoiceText = (fullText) => {
  const items = [];
  
  // Simple regex patterns for AWS services and costs
  const servicePatterns = [
    /Amazon\s+EC2.*?\$([0-9,]+\.?[0-9]*)/gi,
    /Amazon\s+S3.*?\$([0-9,]+\.?[0-9]*)/gi,
    /Amazon\s+RDS.*?\$([0-9,]+\.?[0-9]*)/gi,
    /CloudFront.*?\$([0-9,]+\.?[0-9]*)/gi,
    /Data\s+Transfer.*?\$([0-9,]+\.?[0-9]*)/gi,
    /Lambda.*?\$([0-9,]+\.?[0-9]*)/gi
  ];

  const serviceTypes = ['EC2', 'S3', 'RDS', 'CloudFront', 'DataTransfer', 'Lambda'];
  
  servicePatterns.forEach((pattern, index) => {
    let match;
    while ((match = pattern.exec(fullText)) !== null) {
      const cost = parseFloat(match[1].replace(/[,$]/g, ''));
      if (!isNaN(cost) && cost > 0) {
        items.push({
          id: `item-${Date.now()}-${items.length}`,
          service: serviceTypes[index],
          usage: estimateUsageFromCost(serviceTypes[index], cost),
          totalCost: cost,
          region: 'us-east-1',
          unit: AWS_SERVICE_MAPPINGS[Object.keys(AWS_SERVICE_MAPPINGS).find(k => 
            k.toLowerCase().includes(serviceTypes[index].toLowerCase()))]?.unit || 'units'
        });
      }
    }
  });

  if (items.length === 0) {
    // Fallback: look for any dollar amounts
    const dollarMatches = fullText.match(/\$([0-9,]+\.?[0-9]*)/g);
    if (dollarMatches && dollarMatches.length > 0) {
      const cost = parseFloat(dollarMatches[0].replace(/[\$,]/g, ''));
      if (cost > 0) {
        items.push({
          id: `item-${Date.now()}`,
          service: 'EC2',
          usage: estimateUsageFromCost('EC2', cost),
          totalCost: cost,
          region: 'us-east-1',
          unit: 'hours'
        });
      }
    }
  }
  
  const totalCost = items.reduce((sum, item) => sum + item.totalCost, 0);
  
  if (items.length === 0) {
    throw new Error('Could not extract any service data from the PDF. Please ensure it contains AWS billing information.');
  }
  
  return { items, totalCost };
};

const estimateUsageFromCost = (service, cost) => {
  const estimations = {
    'EC2': cost / 0.0464,
    'S3': cost / 0.023 * 1000,
    'RDS': cost / 0.017,
    'CloudFront': cost / 0.085 * 1000,
    'DataTransfer': cost / 0.09 * 1000,
    'Lambda': cost / 0.0000002
  };
  
  return Math.round(estimations[service] || cost * 10);
};

// API Routes
app.post('/api/invoices/upload', async (req, res) => {
  try {
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ error: 'No files were uploaded.' });
    }

    const { customerName } = req.body;
    if (!customerName || !customerName.trim()) {
      return res.status(400).json({ error: 'Customer name is required.' });
    }

    const pdfFile = req.files.invoice;
    
    if (!pdfFile.mimetype || !pdfFile.mimetype.includes('pdf')) {
      return res.status(400).json({ error: 'Only PDF files are supported.' });
    }

    const parseResult = await parseAWSInvoicePDF(Uint8Array.from(pdfFile.data));
    
    const invoice = {
      id: `invoice-${Date.now()}`,
      customerName: customerName.trim(),
      items: parseResult.items,
      totalCost: parseResult.totalCost,
      uploadDate: new Date(),
      originalFileName: pdfFile.name
    };

    invoices.push(invoice);
    
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
    console.error('PDF processing error:', error);
    res.status(500).json({ 
      error: 'Failed to parse PDF invoice: ' + error.message
    });
  }
});

app.get('/api/pool/stats', (req, res) => {
  const totalUsage = {};
  let totalCost = 0;

  invoices.forEach(invoice => {
    invoice.items.forEach(item => {
      totalUsage[item.service] = (totalUsage[item.service] || 0) + item.usage;
      totalCost += item.totalCost;
    });
  });

  let pooledCost = 0;
  Object.entries(totalUsage).forEach(([service, usage]) => {
    pooledCost += calculateTieredCost(service, usage);
  });

  res.json({
    totalCustomers: invoices.length,
    totalUsage,
    totalCost,
    estimatedSavings: Math.max(0, totalCost - pooledCost)
  });
});

app.get('/api/invoices', (req, res) => {
  res.json(invoices);
});

app.delete('/api/invoices/:id', (req, res) => {
  const { id } = req.params;
  const initialLength = invoices.length;
  invoices = invoices.filter(inv => inv.id !== id);
  if (invoices.length < initialLength) {
    res.status(200).json({ message: 'Invoice removed successfully.' });
  } else {
    res.status(404).json({ error: 'Invoice not found.' });
  }
});

app.get('/api/invoices/savings/:id', (req, res) => {
  const { id } = req.params;
  const invoice = invoices.find(inv => inv.id === id);

  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found.' });
  }

  const standalone = invoice.totalCost;
  
  const tempUsage = {};
  invoices.forEach(inv => {
    inv.items.forEach(item => {
      tempUsage[item.service] = (tempUsage[item.service] || 0) + item.usage;
    });
  });

  let customerPooledCost = 0;
  invoice.items.forEach(item => {
    const totalServiceUsage = tempUsage[item.service];
    if (totalServiceUsage > 0) {
      const customerRatio = item.usage / totalServiceUsage;
      const totalServiceCost = calculateTieredCost(item.service, totalServiceUsage);
      customerPooledCost += totalServiceCost * customerRatio;
    }
  });

  const savings = Math.max(0, standalone - customerPooledCost);
  const percentage = standalone > 0 ? (savings / standalone) * 100 : 0;

  res.json({
    standalone,
    pooled: customerPooledCost,
    savings,
    percentage: Math.max(0, percentage)
  });
});

// For Vercel serverless functions
module.exports = app;