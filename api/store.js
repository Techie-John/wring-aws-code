import { createClient } from '@vercel/kv';

const kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

// Keys for storing data
const INVOICES_KEY = 'invoices';

// Function to get all invoices
export const getInvoices = async () => {
    const invoices = await kv.get(INVOICES_KEY);
    return invoices || [];
};

// Function to set all invoices (overwrite)
export const setInvoices = async (invoices) => {
    await kv.set(INVOICES_KEY, invoices);
};