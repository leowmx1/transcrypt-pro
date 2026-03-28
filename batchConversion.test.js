const test = require('node:test');
const assert = require('node:assert/strict');
const { runWithConcurrency, createBatchController } = require('./batchConversion');

test('runWithConcurrency handles 5 items and preserves result length', async () => {
    const items = Array.from({ length: 5 }, (_, i) => i + 1);
    const output = await runWithConcurrency(
        items,
        2,
        async (value) => ({ success: true, value: value * 2 }),
        () => false
    );

    assert.equal(output.length, 5);
    assert.equal(output.filter(item => item.success).length, 5);
    assert.deepEqual(output.map(item => item.value), [2, 4, 6, 8, 10]);
});

test('runWithConcurrency works for 50/100规模并限制并发峰值', async () => {
    const runScenario = async (size) => {
        const items = Array.from({ length: size }, (_, i) => i);
        let current = 0;
        let peak = 0;

        const output = await runWithConcurrency(
            items,
            4,
            async (value) => {
                current += 1;
                peak = Math.max(peak, current);
                await new Promise(resolve => setTimeout(resolve, 1));
                current -= 1;
                return { success: true, value };
            },
            () => false
        );

        assert.equal(output.length, size);
        assert.ok(peak <= 4);
        assert.equal(output.filter(item => item.success).length, size);
    };

    await runScenario(50);
    await runScenario(100);
});

test('runWithConcurrency recovers when item throws (损坏文件/网络异常模拟)', async () => {
    const items = ['ok-1', 'broken', 'ok-2', 'network'];
    const output = await runWithConcurrency(
        items,
        3,
        async (value) => {
            if (value === 'broken') {
                throw new Error('文件损坏');
            }
            if (value === 'network') {
                throw new Error('网络中断');
            }
            return { success: true, value };
        },
        () => false
    );

    assert.equal(output.length, 4);
    assert.equal(output.filter(item => item.success).length, 2);
    assert.equal(output.filter(item => !item.success).length, 2);
    assert.match(output.find(item => item.error === '文件损坏').error, /文件损坏/);
    assert.match(output.find(item => item.error === '网络中断').error, /网络中断/);
});

test('batch controller supports cancel flag propagation', () => {
    const controller = createBatchController();
    assert.equal(controller.cancelled, false);
    controller.cancelled = true;
    assert.equal(controller.cancelled, true);
});
