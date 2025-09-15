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

const app = express();
app.use(cors());
app.use(express.json());
app.use(fileUpload());

// Updated Pricing Engine with more accurate AWS pricing
const PRICING_TIERS = {
  "EC2": [
    { minUsage: 0, maxUsage: 744, pricePerUnit: 0.0464 }, // First 744 hours (monthly)
    { minUsage: 745, maxUsage: 8760, pricePerUnit: 0.0418 }, // Next hours
    { minUsage: 8761, maxUsage: Infinity, pricePerUnit: 0.0372 }
  ],
  "S3": [
    { minUsage: 0, maxUsage: 50000, pricePerUnit: 0.023 }, // First 50TB
    { minUsage: 50001, maxUsage: 450000, pricePerUnit: 0.022 }, // Next 450TB
    { minUsage: 450001, maxUsage: Infinity, pricePerUnit: 0.021 }
  ],
  "RDS": [
    { minUsage: 0, maxUsage: 750, pricePerUnit: 0.017 }, // Free tier
    { minUsage: 751, maxUsage: 8760, pricePerUnit: 0.017 },
    { minUsage: 8761, maxUsage: Infinity, pricePerUnit: 0.015 }
  ],
  "CloudFront": [
    { minUsage: 0, maxUsage: 10000, pricePerUnit: 0.085 }, // First 10TB
    { minUsage: 10001, maxUsage: 50000, pricePerUnit: 0.080 },
    { minUsage: 50001, maxUsage: Infinity, pricePerUnit: 0.060 }
  ],
  "DataTransfer": [
    { minUsage: 0, maxUsage: 1000, pricePerUnit: 0.09 }, // First 1GB free, then per GB
    { minUsage: 1001, maxUsage: 10000, pricePerUnit: 0.09 },
    { minUsage: 10001, maxUsage: Infinity, pricePerUnit: 0.085 }
  ],
  "Lambda": [
    { minUsage: 0, maxUsage: 1000000, pricePerUnit: 0.0000002 }, // First 1M requests free
    { minUsage: 1000001, maxUsage: Infinity, pricePerUnit: 0.0000002 }
  ]
};

let invoices = [];

// Enhanced helper function for calculations
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

// Enhanced AWS service mapping
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

// Enhanced PDF parsing function
const parseAWSInvoicePDF = async (pdfBuffer) => {
  try {
    const document = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
    let fullText = '';
    let allTextItems = [];
    
    // Extract text from all pages with position data
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      const content = await page.getTextContent();
      
      // Store text items with position for better parsing
      allTextItems.push(...content.items.map(item => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        page: i
      })));
      
      const pageText = content.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }

    console.log('Extracted PDF text (first 500 chars):', fullText.substring(0, 500));
    
    return parseInvoiceText(fullText, allTextItems);
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error('Failed to parse PDF: ' + error.message);
  }
};

// Enhanced text parsing with multiple strategies
const parseInvoiceText = (fullText, textItems) => {
  const items = [];
  let totalCost = 0;
  
  // Strategy 1: Look for service charges in structured format
  const serviceCharges = extractServiceCharges(fullText);
  if (serviceCharges.length > 0) {
    items.push(...serviceCharges);
  }
  
  // Strategy 2: Parse line-by-line for service entries
  const lineItems = parseLineByLine(fullText);
  if (lineItems.length > 0) {
    items.push(...lineItems);
  }
  
  // Strategy 3: Use position-based parsing if available
  if (textItems && textItems.length > 0) {
    const positionItems = parseByPosition(textItems);
    if (positionItems.length > 0) {
      items.push(...positionItems);
    }
  }
  
  // Remove duplicates and calculate total
  const uniqueItems = removeDuplicateItems(items);
  totalCost = uniqueItems.reduce((sum, item) => sum + item.totalCost, 0);
  
  if (uniqueItems.length === 0) {
    throw new Error('Could not extract any service data from the PDF. The invoice format may not be supported.');
  }
  
  return { items: uniqueItems, totalCost };
};

// Extract service charges using regex patterns
const extractServiceCharges = (text) => {
  const items = [];
  
  // Common patterns in AWS invoices
  const patterns = [
    // Pattern: Service name followed by cost
    /(?:Amazon|AWS)\s+([A-Za-z\s]+(?:Service|Cloud|Transfer))\s+.*?\$([0-9,]+\.?[0-9]*)/g,
    // Pattern: Service line with usage and cost
    /([A-Za-z\s]+(?:Service|Cloud|Transfer|Database))\s+.*?([0-9,]+(?:\.[0-9]+)?)\s+.*?\$([0-9,]+\.?[0-9]*)/g,
    // Pattern: Simple service and cost
    /^([A-Za-z\s]{10,50})\s+\$([0-9,]+\.?[0-9]*)$/gm
  ];
  
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const serviceName = match[1].trim();
      const cost = parseFloat(match[match.length - 1].replace(/[,$]/g, ''));
      const usage = match.length > 3 ? parseFloat(match[2].replace(/[,$]/g, '')) : 0;
      
      if (!isNaN(cost) && cost > 0) {
        const mappedService = mapServiceName(serviceName);
        if (mappedService) {
          items.push({
            id: `item-${Date.now()}-${items.length}`,
            service: mappedService.service,
            usage: usage || estimateUsageFromCost(mappedService.service, cost),
            totalCost: cost,
            region: extractRegion(text) || 'us-east-1',
            unit: mappedService.unit
          });
        }
      }
    }
  });
  
  return items;
};

// Parse line by line for service entries
const parseLineByLine = (text) => {
  const items = [];
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Look for AWS service names
    for (const [fullName, mapping] of Object.entries(AWS_SERVICE_MAPPINGS)) {
      if (line.toLowerCase().includes(fullName.toLowerCase()) || 
          line.toLowerCase().includes(mapping.service.toLowerCase())) {
        
        // Look for cost in current line or next few lines
        for (let j = i; j < Math.min(i + 5, lines.length); j++) {
          const costMatch = lines[j].match(/\$([0-9,]+\.?[0-9]*)/);
          if (costMatch) {
            const cost = parseFloat(costMatch[1].replace(/[,$]/g, ''));
            if (cost > 0) {
              items.push({
                id: `item-${Date.now()}-${items.length}`,
                service: mapping.service,
                usage: estimateUsageFromCost(mapping.service, cost),
                totalCost: cost,
                region: extractRegion(text) || 'us-east-1',
                unit: mapping.unit
              });
              break;
            }
          }
        }
      }
    }
  }
  
  return items;
};

// Parse using position data (more accurate for structured PDFs)
const parseByPosition = (textItems) => {
  const items = [];
  
  // Group text items by approximate Y position (lines)
  const lines = {};
  textItems.forEach(item => {
    const lineKey = Math.round(item.y / 10) * 10; // Group by 10-unit Y positions
    if (!lines[lineKey]) lines[lineKey] = [];
    lines[lineKey].push(item);
  });
  
  // Sort lines by Y position (top to bottom)
  const sortedLines = Object.keys(lines)
    .map(Number)
    .sort((a, b) => b - a) // Descending for PDF coordinates
    .map(y => lines[y]);
  
  // Look for service and cost patterns in each line
  sortedLines.forEach(line => {
    const lineText = line.map(item => item.text).join(' ');
    
    // Check if this line contains a service and cost
    for (const [fullName, mapping] of Object.entries(AWS_SERVICE_MAPPINGS)) {
      if (lineText.toLowerCase().includes(fullName.toLowerCase()) || 
          lineText.toLowerCase().includes(mapping.service.toLowerCase())) {
        
        const costMatch = lineText.match(/\$([0-9,]+\.?[0-9]*)/);
        if (costMatch) {
          const cost = parseFloat(costMatch[1].replace(/[,$]/g, ''));
          if (cost > 0) {
            items.push({
              id: `item-${Date.now()}-${items.length}`,
              service: mapping.service,
              usage: estimateUsageFromCost(mapping.service, cost),
              totalCost: cost,
              region: 'us-east-1',
              unit: mapping.unit
            });
          }
        }
      }
    }
  });
  
  return items;
};

// Helper functions
const mapServiceName = (serviceName) => {
  const normalizedName = serviceName.trim().toLowerCase();
  
  for (const [fullName, mapping] of Object.entries(AWS_SERVICE_MAPPINGS)) {
    if (normalizedName.includes(fullName.toLowerCase()) || 
        normalizedName.includes(mapping.service.toLowerCase())) {
      return mapping;
    }
  }
  
  return null;
};

const extractRegion = (text) => {
  const regionMatch = text.match(/(us-east-1|us-west-2|eu-west-1|ap-southeast-1|us-west-1)/i);
  return regionMatch ? regionMatch[1] : null;
};

const estimateUsageFromCost = (service, cost) => {
  // Rough estimation based on typical AWS pricing
  const estimations = {
    'EC2': cost / 0.0464, // Assume t3.micro pricing
    'S3': cost / 0.023 * 1000, // Convert to GB
    'RDS': cost / 0.017, // Hours
    'CloudFront': cost / 0.085 * 1000, // GB
    'DataTransfer': cost / 0.09 * 1000, // GB
    'Lambda': cost / 0.0000002 // Requests
  };
  
  return Math.round(estimations[service] || cost * 10);
};

const removeDuplicateItems = (items) => {
  const seen = new Map();
  return items.filter(item => {
    const key = `${item.service}-${item.totalCost}`;
    if (seen.has(key)) {
      return false;
    }
    seen.set(key, true);
    return true;
  });
};

// Updated API endpoint with better error handling
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
      details: 'Please ensure the PDF is a valid AWS invoice with readable text.'
    });
  }
});

// All other endpoints remain the same...
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

  const stats = {
    totalCustomers: invoices.length,
    totalUsage,
    totalCost,
    estimatedSavings: Math.max(0, totalCost - pooledCost)
  };

  res.json(stats);
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

// Debug endpoint to help with PDF parsing
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Ready to process AWS invoice PDFs...');
});