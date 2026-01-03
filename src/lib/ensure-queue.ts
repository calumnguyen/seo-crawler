// This file ensures the queue processor is running
// Import this at the top of any API route that uses the queue

import './queue'; // This imports queue.ts which defines the processor

// The queue processor is automatically registered when queue.ts is imported
// This file just ensures it's imported early

