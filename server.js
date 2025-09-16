const { DOMMatrix, ImageData, Path2D } = require('canvas');

// These polyfills might not be strictly necessary, but are good practice
// to ensure all expected APIs are available.
global.DOMMatrix = DOMMatrix;
global.ImageData = ImageData;
global.Path2D = Path2D;

const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());
app.use(fileUpload());

// Initialize Gemini AI
// You'll need to set GEMINI_API_KEY environment variable
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY_HERE');
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Updated Pricing Engine with more accurate AWS pricing tiers
const PRICING_TIERS = {
  "EC2": [
    { minUsage: 0, maxUsage: 750, pricePerUnit: 0.0116 }, // t2.micro free tier
    { minUsage: 751, maxUsage: 8760, pricePerUnit: 0.0464 }, // Regular pricing
    { minUsage: 8761, maxUsage: 87600, pricePerUnit: 0.0418 }, // Volume discount tier 1
    { minUsage: 87601, maxUsage: Infinity, pricePerUnit: 0.0372 } // Volume discount tier 2
  ],
  "S3": [
    { minUsage: 0, maxUsage: 50000, pricePerUnit: 0.023 }, // First 50TB per month
    { minUsage: 50001, maxUsage: 450000, pricePerUnit: 0.022 }, // Next 450TB per month
    { minUsage: 450001, maxUsage: Infinity, pricePerUnit: 0.021 } // Over 500TB per month
  ],
  "RDS": [
    { minUsage: 0, maxUsage: 750, pricePerUnit: 0.0 }, // Free tier (db.t2.micro)
    { minUsage: 751, maxUsage: 8760, pricePerUnit: 0.017 }, // Regular db.t2.micro
    { minUsage: 8761, maxUsage: 87600, pricePerUnit: 0.015 }, // Volume discount
    { minUsage: 87601, maxUsage: Infinity, pricePerUnit: 0.013 }
  ],
  "CloudFront": [
    { minUsage: 0, maxUsage: 10000, pricePerUnit: 0.085 }, // First 10TB
    { minUsage: 10001, maxUsage: 40000, pricePerUnit: 0.080 }, // Next 40TB
    { minUsage: 40001, maxUsage: 100000, pricePerUnit: 0.060 }, // Next 100TB
    { minUsage: 100001, maxUsage: Infinity, pricePerUnit: 0.040 } // Over 150TB
  ],
  "DataTransfer": [
    { minUsage: 0, maxUsage: 1, pricePerUnit: 0.0 }, // First 1GB free
    { minUsage: 2, maxUsage: 10000, pricePerUnit: 0.09 }, // Up to 10TB
    { minUsage: 10001, maxUsage: 50000, pricePerUnit: 0.085 }, // Next 40TB
    { minUsage: 50001, maxUsage: Infinity, pricePerUnit: 0.070 } // Over 50TB
  ],
  "Lambda": [
    { minUsage: 0, maxUsage: 1000000, pricePerUnit: 0.0000002 }, // First 1M requests free
    { minUsage: 1000001, maxUsage: Infinity, pricePerUnit: 0.0000002 }
  ],
  "SES": [
    { minUsage: 0, maxUsage: 62000, pricePerUnit: 0.0 }, // First 62k emails free
    { minUsage: 62001, maxUsage: Infinity, pricePerUnit: 0.0001 }
  ],
  "SNS": [
    { minUsage: 0, maxUsage: 1000000, pricePerUnit: 0.0000005 }, // First 1M requests free
    { minUsage: 1000001, maxUsage: Infinity, pricePerUnit: 0.0000005 }
  ]
};

let invoices = [];

// CORRECTED: Calculate tiered cost for given service and usage
const calculateTieredCost = (service, totalUsage) => {
  const tiers = PRICING_TIERS[service] || PRICING_TIERS["EC2"];
  let cost = 0;
  let remainingUsage = totalUsage;

  for (const tier of tiers) {
    if (remainingUsage <= 0) break;
    
    // Calculate how much usage fits in this tier
    const tierMax = tier.maxUsage === Infinity ? remainingUsage : Math.min(tier.maxUsage - tier.minUsage + 1, remainingUsage);
    const usageInThisTier = Math.min(remainingUsage, tierMax);
    
    cost += usageInThisTier * tier.pricePerUnit;
    remainingUsage -= usageInThisTier;
    
    if (tier.maxUsage === Infinity) break;
  }

  return cost;
};

// CORRECTED: Calculate what a customer would pay in the pool
const calculateCustomerPooledCost = (customerItems, poolTotals) => {
  let customerPooledCost = 0;

  customerItems.forEach(item => {
    const totalPoolUsage = poolTotals[item.service] || 0;
    if (totalPoolUsage === 0) return;

    // Calculate total cost for this service at pool volume
    const totalServiceCost = calculateTieredCost(item.service, totalPoolUsage);
    
    // Customer pays their proportional share
    const customerShare = item.usage / totalPoolUsage;
    customerPooledCost += totalServiceCost * customerShare;
  });

  return customerPooledCost;
};

// Enhanced Gemini-powered invoice parsing
const parseAWSInvoiceWithGemini = async (pdfText) => {
  const prompt = `
You are an AWS billing expert. Parse this AWS invoice text and extract service usage data.

INVOICE TEXT:
${pdfText}

Return ONLY valid JSON in this exact format:
{
  "services": [
    {
      "service": "EC2|S3|RDS|CloudFront|DataTransfer|Lambda|SES|SNS",
      "cost": <number>,
      "estimatedUsage": <number>,
      "unit": "hours|GB|requests|emails",
      "region": "us-east-1"
    }
  ],
  "totalCost": <number>
}

RULES:
1. Map service names correctly:
   - "Amazon Elastic Compute Cloud" → "EC2" 
   - "Amazon Simple Storage Service" → "S3"
   - "Amazon RDS Service" → "RDS" 
   - "AWS Data Transfer" → "DataTransfer"
   - "Amazon CloudFront" → "CloudFront"
   - "Amazon Simple Email Service" → "SES"
   - "Amazon Simple Notification Service" → "SNS"
   - "AWS Lambda" → "Lambda"

2. For estimatedUsage, use these calculations:
   - EC2: cost ÷ $0.0464 (assume t3.micro hours)
   - S3: cost ÷ $0.023 × 1000 (GB storage)
   - RDS: cost ÷ $0.017 (assume db hours)
   - DataTransfer: cost ÷ $0.09 × 1000 (GB transfer)
   - CloudFront: cost ÷ $0.085 × 1000 (GB transfer)
   - SES: cost ÷ $0.0001 (emails sent)
   - SNS: cost ÷ $0.0000005 (requests)
   - Lambda: cost ÷ $0.0000002 (requests)

3. Extract actual dollar amounts from the invoice text
4. Ignore $0.00 charges
5. Sum all service costs for totalCost
6. If region not specified, use "us-east-1"
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('Gemini raw response:', text);
    
    // Clean up the response to extract JSON
    let jsonText = text.trim();
    
    // Remove markdown code blocks if present
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    
    const parsedData = JSON.parse(jsonText);
    
    // Validate the response structure
    if (!parsedData.services || !Array.isArray(parsedData.services)) {
      throw new Error('Invalid response structure from Gemini');
    }
    
    // Convert to expected format
    const items = parsedData.services.map((service, index) => ({
      id: `item-${Date.now()}-${index}`,
      service: service.service,
      usage: Math.round(service.estimatedUsage || 0),
      totalCost: parseFloat(service.cost || 0),
      region: service.region || 'us-east-1',
      unit: service.unit || 'units'
    })).filter(item => item.totalCost > 0);

    return {
      items,
      totalCost: parsedData.totalCost || items.reduce((sum, item) => sum + item.totalCost, 0)
    };

  } catch (error) {
    console.error('Gemini parsing error:', error);
    
    // Fallback to basic parsing if Gemini fails
    console.log('Falling back to basic parsing...');
    return fallbackParsing(pdfText);
  }
};

// Fallback parsing if Gemini fails
const fallbackParsing = (text) => {
  const items = [];
  const servicePatterns = [
    { pattern: /Amazon Simple Storage Service.*?\$([0-9,]+\.?[0-9]*)/gi, service: 'S3', unit: 'GB' },
    { pattern: /AWS Data Transfer.*?\$([0-9,]+\.?[0-9]*)/gi, service: 'DataTransfer', unit: 'GB' },
    { pattern: /Amazon RDS Service.*?\$([0-9,]+\.?[0-9]*)/gi, service: 'RDS', unit: 'hours' },
    { pattern: /Amazon CloudFront.*?\$([0-9,]+\.?[0-9]*)/gi, service: 'CloudFront', unit: 'GB' },
    { pattern: /Amazon Simple Email Service.*?\$([0-9,]+\.?[0-9]*)/gi, service: 'SES', unit: 'emails' },
    { pattern: /Amazon Elastic Compute Cloud.*?\$([0-9,]+\.?[0-9]*)/gi, service: 'EC2', unit: 'hours' },
    { pattern: /Amazon Simple Notification Service.*?\$([0-9,]+\.?[0-9]*)/gi, service: 'SNS', unit: 'requests' }
  ];

  servicePatterns.forEach(({ pattern, service, unit }) => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const cost = parseFloat(match[1].replace(/[,$]/g, ''));
      if (cost > 0) {
        items.push({
          id: `item-${Date.now()}-${items.length}`,
          service,
          usage: estimateUsageFromCost(service, cost),
          totalCost: cost,
          region: 'us-east-1',
          unit
        });
      }
    }
  });

  const totalCost = items.reduce((sum, item) => sum + item.totalCost, 0);
  return { items, totalCost };
};

// Estimate usage from cost (fallback method)
const estimateUsageFromCost = (service, cost) => {
  const estimations = {
    'EC2': Math.round(cost / 0.0464), // Hours
    'S3': Math.round(cost / 0.023 * 1000), // GB
    'RDS': Math.round(cost / 0.017), // Hours
    'CloudFront': Math.round(cost / 0.085 * 1000), // GB
    'DataTransfer': Math.round(cost / 0.09 * 1000), // GB
    'Lambda': Math.round(cost / 0.0000002), // Requests
    'SES': Math.round(cost / 0.0001), // Emails
    'SNS': Math.round(cost / 0.0000005) // Requests
  };
  
  return estimations[service] || Math.round(cost * 10);
};

// Enhanced PDF parsing with Gemini integration
const parseAWSInvoicePDF = async (pdfBuffer) => {
  try {
    const document = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
    let fullText = '';
    
    // Extract text from all pages
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }

    console.log('Extracted PDF text length:', fullText.length);
    console.log('PDF text preview:', fullText.substring(0, 500));
    
    // Use Gemini to parse the invoice
    return await parseAWSInvoiceWithGemini(fullText);
    
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error('Failed to parse PDF: ' + error.message);
  }
};

// API endpoint for uploading invoices
app.post('/api/invoices/upload', async (req, res) => {
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

  try {
    console.log(`Processing PDF for customer: ${customerName}`);
    console.log(`PDF size: ${pdfFile.size} bytes`);
    
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
    
    console.log(`Successfully parsed invoice for ${customerName}:`);
    console.log(`- ${invoice.items.length} services found`);
    console.log(`- Total cost: $${invoice.totalCost.toFixed(2)}`);
    
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
      error: 'Failed to parse PDF invoice: ' + error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : 'Please ensure the PDF is a valid AWS invoice with readable text.'
    });
  }
});

// CORRECTED: Pool statistics endpoint
app.get('/api/pool/stats', (req, res) => {
  const poolTotals = {};
  let totalStandaloneCost = 0;

  // Calculate pool usage totals and standalone costs
  invoices.forEach(invoice => {
    invoice.items.forEach(item => {
      poolTotals[item.service] = (poolTotals[item.service] || 0) + item.usage;
      totalStandaloneCost += item.totalCost;
    });
  });

  // Calculate pooled costs using volume tiers
  let totalPooledCost = 0;
  Object.entries(poolTotals).forEach(([service, usage]) => {
    totalPooledCost += calculateTieredCost(service, usage);
  });

  const estimatedSavings = Math.max(0, totalStandaloneCost - totalPooledCost);

  const stats = {
    totalCustomers: invoices.length,
    totalUsage: poolTotals,
    totalCost: totalStandaloneCost,
    pooledCost: totalPooledCost,
    estimatedSavings: estimatedSavings,
    savingsPercentage: totalStandaloneCost > 0 ? (estimatedSavings / totalStandaloneCost * 100) : 0
  };

  console.log('Pool stats:', {
    customers: stats.totalCustomers,
    standaloneCost: stats.totalCost,
    pooledCost: stats.pooledCost,
    savings: stats.estimatedSavings,
    savingsRate: `${stats.savingsPercentage.toFixed(1)}%`
  });

  res.json(stats);
});

// Get all invoices
app.get('/api/invoices', (req, res) => {
  res.json(invoices);
});

// Remove invoice from pool
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

// CORRECTED: Calculate individual customer savings
app.get('/api/invoices/savings/:id', (req, res) => {
  const { id } = req.params;
  const invoice = invoices.find(inv => inv.id === id);

  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found.' });
  }

  // Calculate standalone cost (what customer pays alone)
  const standalone = invoice.totalCost;
  
  // Calculate pool usage totals
  const poolTotals = {};
  invoices.forEach(inv => {
    inv.items.forEach(item => {
      poolTotals[item.service] = (poolTotals[item.service] || 0) + item.usage;
    });
  });

  // Calculate what this customer would pay in the pool
  const customerPooledCost = calculateCustomerPooledCost(invoice.items, poolTotals);
  
  const savings = Math.max(0, standalone - customerPooledCost);
  const percentage = standalone > 0 ? (savings / standalone) * 100 : 0;

  const result = {
    standalone,
    pooled: customerPooledCost,
    savings,
    percentage: Math.max(0, percentage)
  };

  console.log(`Savings calculation for ${invoice.customerName}:`, result);

  res.json(result);
});

// Debug endpoint
app.get('/api/debug/invoices', (req, res) => {
  const debugInfo = invoices.map(invoice => ({
    id: invoice.id,
    customerName: invoice.customerName,
    fileName: invoice.originalFileName,
    itemCount: invoice.items.length,
    totalCost: invoice.totalCost,
    services: invoice.items.map(item => ({
      service: item.service,
      usage: item.usage,
      cost: item.totalCost,
      unit: item.unit
    }))
  }));
  
  res.json(debugInfo);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    invoicesCount: invoices.length
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Gemini AI configured:', !!process.env.GEMINI_API_KEY);
  console.log('Ready to process AWS invoice PDFs with AI...');
});