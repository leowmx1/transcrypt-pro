function createBatchController() {
    return {
        cancelled: false,
        workers: new Set()
    };
}

async function runWithConcurrency(items, concurrency, runItem, shouldCancel) {
    const safeConcurrency = Math.max(1, Math.min(concurrency || 1, items.length || 1));
    const results = new Array(items.length);
    let cursor = 0;

    async function workerLoop() {
        while (true) {
            if (shouldCancel()) {
                return;
            }

            const index = cursor;
            cursor += 1;
            if (index >= items.length) {
                return;
            }

            try {
                results[index] = await runItem(items[index], index);
            } catch (error) {
                results[index] = {
                    success: false,
                    error: error.message || String(error)
                };
            }
        }
    }

    await Promise.all(Array.from({ length: safeConcurrency }, () => workerLoop()));
    return results;
}

module.exports = {
    createBatchController,
    runWithConcurrency
};
