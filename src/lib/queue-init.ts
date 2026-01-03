// This file ensures the queue processor is initialized when the server starts
// Import this in a root-level file or API route to ensure queue processing begins

import './queue'; // Import queue.ts to initialize the processor
export { crawlQueue } from './queue';

// Log that queue is ready
console.log('✅ Crawl queue processor initialized and ready');

