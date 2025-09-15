import { createClient } from '@vercel/kv';

const kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

const INVOICES_KEY = 'invoices';

export const getInvoices = async () => {
    try {
        const invoices = await kv.get(INVOICES_KEY);
        return invoices || [];
    } catch (error) {
        console.error("Error fetching invoices from KV:", error);
        throw error;
    }
};

export const setInvoices = async (invoices) => {
    try {
        await kv.set(INVOICES_KEY, invoices);
    } catch (error) {
        console.error("Error setting invoices in KV:", error);
        throw error;
    }
};